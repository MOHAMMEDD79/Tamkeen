import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseClient, OfferingState } from '@tamkeen/database';
import { IdentityError } from '../identity/policy.js';
import { IdentityService } from '../identity/identity.service.js';
import { minorToString, parseCurrency, parseMinor } from '../projects/money.js';
import { percentString, subscriptionMaths, validateOfferingTerms } from './shares.js';

/**
 * Ventures, offerings and disclosures (06-INVESTMENT-LIFECYCLE, BUS-01/02, PUB-07/08, ADM-04).
 *
 * What this module is careful about:
 *
 *  - **A disclosure is immutable and numbered.** An investor accepts a specific version by its
 *    checksum, and a material revision creates a new version rather than editing the old one. The
 *    database enforces this; the service only decides when a new version is warranted.
 *  - **Review is independent.** An offering is approved by a platform RiskReviewer with MFA, never
 *    by anyone in the issuing organisation, and the decision names the disclosure it judged.
 *  - **Nothing here reserves capacity or takes money.** An interest is an interest. Commitments,
 *    subscriptions and allocations are PART-09, and this part deliberately stops at `open`.
 */

const SLUG_MAX = 120;

const text = (value: unknown, min: number, max: number) => {
  if (typeof value !== 'string') throw new IdentityError('invalid_input', 422);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw new IdentityError('invalid_input', 422);
  return trimmed;
};

const slugify = (title: string) => {
  const base = title.toLowerCase().normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, SLUG_MAX - 6);
  // A random suffix, because a slug is public and guessable sequences leak how many exist.
  return `${base || 'offering'}-${randomBytes(3).toString('hex')}`;
};

/** The checksum an investor's acceptance points at. Covers exactly the text they were shown. */
export const disclosureChecksum = (input: { summary: string; risks: string; useOfFunds: string }) =>
  createHash('sha256').update([input.summary, input.risks, input.useOfFunds].join('\u0000')).digest('hex');

/** States in which the offering is publicly listed. Everything earlier is absent, not forbidden. */
export const PUBLIC_OFFERING_STATES: readonly OfferingState[] = ['open', 'suspended', 'closing', 'allocated', 'reporting', 'closed'] as const;
/** States in which the issuer may still edit the terms. */
const EDITABLE_STATES: readonly OfferingState[] = ['draft', 'changes_requested'] as const;

export class OfferingsService {
  private readonly identity: IdentityService;
  constructor(private readonly db: DatabaseClient) {
    this.identity = new IdentityService(db);
  }

  // ---------------------------------------------------------------- the venture

  /** The commercial entity behind an offering: its share capital, which the maths depends on. */
  async saveVenture(actorId: string, organizationId: string, input: { legalName: string; summary: string; currentShares: string; currency: string; version?: number | undefined }) {
    await this.identity.access(actorId, organizationId, 'offering.manage');
    const legalName = text(input.legalName, 2, 200);
    const summary = text(input.summary, 30, 2000);
    const currency = parseCurrency(input.currency);
    const currentShares = parseMinor(input.currentShares);

    return this.db.$transaction(async tx => {
      const existing = await tx.venture.findUnique({ where: { organizationId } });
      if (!existing) {
        const created = await tx.venture.create({ data: { organizationId, legalName, summary, currentShares, currency, createdBy: actorId } });
        await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: created.id, action: 'venture.created' } });
        return this.ventureView(created);
      }
      if (input.version !== existing.version) throw new IdentityError('conflict', 409);
      // Changing the share count moves every percentage already quoted, so it is refused while an
      // offering is live rather than silently re-basing what investors were told.
      const live = await tx.offering.count({ where: { ventureId: existing.id, state: { in: ['open', 'suspended', 'closing'] } } });
      if (live > 0 && existing.currentShares !== currentShares) throw new IdentityError('conflict', 409);
      const updated = await tx.venture.update({
        where: { id: existing.id },
        data: { legalName, summary, currentShares, currency, version: { increment: 1 } }
      });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: updated.id, action: 'venture.updated' } });
      return this.ventureView(updated);
    });
  }

  async venture(actorId: string, organizationId: string) {
    await this.identity.access(actorId, organizationId, 'organization.read');
    const record = await this.db.venture.findUnique({ where: { organizationId } });
    // Absent rather than empty: a venture that has not been created is not a venture with no shares.
    return record ? this.ventureView(record) : null;
  }

  // ---------------------------------------------------------------- BUS-02: the editor

  /** BUS-02.A01 (create). A draft offering, which is not public and accepts nothing. */
  async create(actorId: string, organizationId: string, input: OfferingInput) {
    await this.identity.access(actorId, organizationId, 'offering.manage');
    const parsed = this.parseInput(input);

    return this.db.$transaction(async tx => {
      const venture = await tx.venture.findUnique({ where: { organizationId }, include: { organization: true } });
      // 06: an offering belongs to a venture, and a venture needs share capital before anyone can
      // be told what a percentage of it is.
      if (!venture) throw new IdentityError('conflict', 409);
      // BUS-01.A01: an unverified organisation cannot raise money from the public.
      if (venture.organization.verification !== 'verified') throw new IdentityError('conflict', 409);
      if (venture.currency !== parsed.currency) throw new IdentityError('conflict', 409);

      const offering = await tx.offering.create({
        data: {
          ventureId: venture.id, organizationId, slug: slugify(parsed.title),
          ...parsed, createdBy: actorId, managerId: actorId, state: 'draft'
        }
      });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: offering.id, action: 'offering.created' } });
      return this.detailView(offering, venture);
    });
  }

  /** BUS-02.A01 (update). Editing is refused once a reviewer is looking at it. */
  async update(actorId: string, organizationId: string, offeringId: string, input: OfferingInput & { version: number }) {
    await this.identity.access(actorId, organizationId, 'offering.manage');
    const parsed = this.parseInput(input);

    return this.db.$transaction(async tx => {
      const offering = await tx.offering.findFirst({ where: { id: offeringId, organizationId }, include: { venture: true } });
      if (!offering) throw new IdentityError('not_found', 404);
      // A submitted offering is frozen: the reviewer is judging the version that was sent.
      if (!EDITABLE_STATES.includes(offering.state)) throw new IdentityError('conflict', 409);
      if (offering.version !== input.version) throw new IdentityError('conflict', 409);
      if (offering.venture.currency !== parsed.currency) throw new IdentityError('conflict', 409);

      const updated = await tx.offering.update({ where: { id: offering.id }, data: { ...parsed, version: { increment: 1 } } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: offering.id, action: 'offering.updated' } });
      return this.detailView(updated, offering.venture);
    });
  }

  /**
   * BUS-02.A02. Checks the numbers without changing anything, so the editor can show what is wrong
   * before the issuer commits to it.
   */
  async validate(actorId: string, organizationId: string, offeringId: string) {
    await this.identity.access(actorId, organizationId, 'offering.manage');
    const offering = await this.db.offering.findFirst({ where: { id: offeringId, organizationId }, include: { venture: true, currentDisclosure: true } });
    if (!offering) throw new IdentityError('not_found', 404);

    const terms = validateOfferingTerms({
      currentShares: offering.venture.currentShares,
      sharesOffered: offering.sharesOffered,
      pricePerShareMinor: offering.pricePerShareMinor,
      minimumRaiseMinor: offering.minimumRaiseMinor,
      minimumTicketMinor: offering.minimumTicketMinor,
      maximumTicketMinor: offering.maximumTicketMinor
    });
    // Readiness is the terms plus everything else a reviewer needs; both are reported as reasons.
    const blockers = [...terms.problems.map(problem => problem.code)];
    if (!offering.currentDisclosure) blockers.push('disclosure_missing');
    if (!offering.closesAt) blockers.push('deadline_missing');
    if (offering.closesAt && offering.closesAt <= new Date()) blockers.push('deadline_in_past');
    if (!offering.useOfFunds.trim()) blockers.push('use_of_funds_missing');

    return { ...terms, blockers, ready: blockers.length === 0 };
  }

  /** BUS-02.A04. A new, numbered disclosure. The previous one is never edited. */
  async addDisclosure(actorId: string, organizationId: string, offeringId: string, input: { summary: string; risks: string; useOfFunds: string; material?: boolean | undefined; reason?: string | undefined; version: number }) {
    await this.identity.access(actorId, organizationId, 'offering.manage');
    const summary = text(input.summary, 50, 4000);
    const risks = text(input.risks, 20, 6000);
    const useOfFunds = text(input.useOfFunds, 20, 4000);
    const material = input.material ?? true;

    return this.db.$transaction(async tx => {
      const offering = await tx.offering.findFirst({ where: { id: offeringId, organizationId }, include: { venture: true } });
      if (!offering) throw new IdentityError('not_found', 404);
      if (offering.version !== input.version) throw new IdentityError('conflict', 409);
      if (['rejected', 'closed', 'failed'].includes(offering.state)) throw new IdentityError('conflict', 409);
      // A revision after review needs a stated reason, because someone already judged the old text.
      const reason = offering.state === 'draft' ? (input.reason ?? '') : text(input.reason, 10, 1000);

      const last = await tx.offeringDisclosure.findFirst({ where: { offeringId }, orderBy: { sequence: 'desc' } });
      const disclosure = await tx.offeringDisclosure.create({
        data: {
          offeringId, sequence: (last?.sequence ?? 0) + 1,
          summary, risks, useOfFunds, material, reason,
          checksum: disclosureChecksum({ summary, risks, useOfFunds }),
          createdBy: actorId
        }
      });

      // 06: a material revision halts the offering until existing commitments have been handled.
      // There are no commitments in this part, so the halt is the whole of the handling — and it is
      // applied rather than skipped, so the behaviour is right when PART-09 adds them.
      const suspend = material && ['open', 'closing'].includes(offering.state);
      const updated = await tx.offering.update({
        where: { id: offering.id },
        data: {
          currentDisclosureId: disclosure.id,
          ...(suspend ? { state: 'suspended' as const, stateReason: 'disclosure_revised' } : {}),
          version: { increment: 1 }
        }
      });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: disclosure.id, action: 'offering.disclosure_published' } });
      return { disclosure: this.disclosureView(disclosure), offering: this.detailView(updated, offering.venture) };
    });
  }

  /** BUS-02.A03. Sends the offering to an independent reviewer and freezes it. */
  async submit(actorId: string, organizationId: string, offeringId: string, version: number) {
    await this.identity.access(actorId, organizationId, 'offering.manage');
    return this.db.$transaction(async tx => {
      const offering = await tx.offering.findFirst({ where: { id: offeringId, organizationId }, include: { venture: true } });
      if (!offering) throw new IdentityError('not_found', 404);
      if (!EDITABLE_STATES.includes(offering.state)) throw new IdentityError('conflict', 409);
      if (offering.version !== version) throw new IdentityError('conflict', 409);

      const scoped = new OfferingsService(tx as DatabaseClient);
      const readiness = await scoped.validate(actorId, organizationId, offeringId);
      // An incomplete offering is refused here rather than wasting a reviewer's time on it.
      if (!readiness.ready) throw new IdentityError('invalid_input', 422);

      const updated = await tx.offering.update({ where: { id: offering.id }, data: { state: 'submitted', stateReason: '', version: { increment: 1 } } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: offering.id, action: 'offering.submitted' } });
      return this.detailView(updated, offering.venture);
    });
  }

  /** BUS-01.A03. Closing stops new money; it does not allocate anything (that is PART-09). */
  async close(actorId: string, organizationId: string, offeringId: string, version: number) {
    await this.identity.access(actorId, organizationId, 'offering.manage');
    return this.db.$transaction(async tx => {
      const offering = await tx.offering.findFirst({ where: { id: offeringId, organizationId }, include: { venture: true } });
      if (!offering) throw new IdentityError('not_found', 404);
      if (!['open', 'suspended'].includes(offering.state)) throw new IdentityError('conflict', 409);
      if (offering.version !== version) throw new IdentityError('conflict', 409);
      const updated = await tx.offering.update({ where: { id: offering.id }, data: { state: 'closing', version: { increment: 1 } } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: offering.id, action: 'offering.closed' } });
      return this.detailView(updated, offering.venture);
    });
  }

  /** BUS-01. The issuer's own list, including drafts nobody else can see. */
  async listForOrganization(actorId: string, organizationId: string) {
    await this.identity.access(actorId, organizationId, 'organization.read');
    const rows = await this.db.offering.findMany({
      where: { organizationId },
      include: { venture: true },
      orderBy: { createdAt: 'desc' }, take: 100
    });
    return rows.map(row => this.detailView(row, row.venture));
  }

  /** BUS-02. One offering as the issuer sees it, with its disclosure history. */
  async getForOrganization(actorId: string, organizationId: string, offeringId: string) {
    await this.identity.access(actorId, organizationId, 'organization.read');
    const offering = await this.db.offering.findFirst({
      where: { id: offeringId, organizationId },
      include: {
        venture: true, currentDisclosure: true,
        disclosures: { orderBy: { sequence: 'desc' } },
        reviewDecisions: { orderBy: { createdAt: 'desc' }, include: { reviewer: { select: { name: true } } } },
        interests: { select: { id: true, indicativeAmountMinor: true, withdrawnAt: true } }
      }
    });
    if (!offering) throw new IdentityError('not_found', 404);
    const live = offering.interests.filter(interest => !interest.withdrawnAt);
    return {
      ...this.detailView(offering, offering.venture),
      disclosure: offering.currentDisclosure ? this.disclosureView(offering.currentDisclosure) : null,
      disclosureHistory: offering.disclosures.map(disclosure => this.disclosureView(disclosure)),
      decisions: offering.reviewDecisions.map(decision => ({
        id: decision.id, outcome: decision.outcome, reviewer: decision.reviewer.name,
        publicReason: decision.publicReason, at: decision.createdAt,
        // Whether the decision was made against the disclosure that is in force now.
        matchesCurrentDisclosure: decision.disclosureId === offering.currentDisclosureId
      })),
      // 06: an interest is not funding, so it is reported as a count and an indication only.
      interest: {
        count: live.length,
        indicativeTotalMinor: minorToString(live.reduce((total, row) => total + (row.indicativeAmountMinor ?? 0n), 0n)),
        reservesCapacity: false
      }
    };
  }

  // ---------------------------------------------------------------- ADM-04: independent review

  /** The queue a RiskReviewer works from. */
  async reviewQueue(actorId: string) {
    await this.identity.riskReviewerUser(actorId);
    const rows = await this.db.offering.findMany({
      where: { state: { in: ['submitted', 'due_diligence'] } },
      include: { organization: { select: { displayName: true } }, venture: true },
      orderBy: { updatedAt: 'asc' }, take: 100
    });
    return rows.map(row => ({ ...this.detailView(row, row.venture), organization: row.organization.displayName }));
  }

  /** ADM-04. The full submission, with its disclosure and its decision history. */
  async reviewOne(actorId: string, offeringId: string) {
    await this.identity.riskReviewerUser(actorId);
    const offering = await this.db.offering.findUnique({
      where: { id: offeringId },
      include: {
        venture: true, currentDisclosure: true,
        organization: { select: { displayName: true, verification: true } },
        reviewDecisions: { orderBy: { createdAt: 'asc' }, include: { reviewer: { select: { name: true } } } },
        documents: { orderBy: { createdAt: 'asc' } }
      }
    });
    if (!offering) throw new IdentityError('not_found', 404);
    const scoped = new OfferingsService(this.db);
    const terms = validateOfferingTerms({
      currentShares: offering.venture.currentShares,
      sharesOffered: offering.sharesOffered,
      pricePerShareMinor: offering.pricePerShareMinor,
      minimumRaiseMinor: offering.minimumRaiseMinor,
      minimumTicketMinor: offering.minimumTicketMinor,
      maximumTicketMinor: offering.maximumTicketMinor
    });
    return {
      ...scoped.detailView(offering, offering.venture),
      organization: offering.organization,
      disclosure: offering.currentDisclosure ? scoped.disclosureView(offering.currentDisclosure) : null,
      terms,
      documents: offering.documents.map(document => ({ id: document.id, title: document.title, category: document.category, classification: document.classification })),
      decisions: offering.reviewDecisions.map(decision => ({
        id: decision.id, outcome: decision.outcome, reviewer: decision.reviewer.name,
        publicReason: decision.publicReason, at: decision.createdAt
      }))
    };
  }

  /** ADM-04.A01. Claiming moves it to due_diligence so two reviewers cannot both work on it. */
  async claim(actorId: string, offeringId: string) {
    const reviewer = await this.identity.riskReviewerUser(actorId);
    return this.db.$transaction(async tx => {
      // Atomic: only a submitted offering can be claimed, so the second claimant changes no rows.
      const claimed = await tx.offering.updateMany({ where: { id: offeringId, state: 'submitted' }, data: { state: 'due_diligence', version: { increment: 1 } } });
      if (claimed.count !== 1) throw new IdentityError('conflict', 409);
      const offering = await tx.offering.findUniqueOrThrow({ where: { id: offeringId }, include: { venture: true } });
      await tx.identityAuditEvent.create({ data: { actorId: reviewer.id, resourceId: offeringId, action: 'offering.claimed' } });
      return this.detailView(offering, offering.venture);
    });
  }

  /**
   * ADM-04.A01. The decision, bound to the disclosure that was judged.
   *
   * Approving does not publish. 06 separates the two: a reviewer says the offering may be sold,
   * and the issuer decides when it opens.
   */
  async decide(actorId: string, offeringId: string, input: { outcome: 'approved' | 'changes_requested' | 'rejected'; publicReason: string; version: number }) {
    const reviewer = await this.identity.riskReviewerUser(actorId);
    return this.db.$transaction(async tx => {
      const offering = await tx.offering.findUnique({ where: { id: offeringId }, include: { venture: true } });
      if (!offering) throw new IdentityError('not_found', 404);
      if (offering.state !== 'due_diligence') throw new IdentityError('conflict', 409);
      if (offering.version !== input.version) throw new IdentityError('conflict', 409);
      if (!offering.currentDisclosureId) throw new IdentityError('conflict', 409);

      // A reviewer who belongs to the issuing organisation is not independent, whatever grant they
      // hold. The same rule as project content review (05), for the same reason.
      const membership = await tx.membership.findUnique({ where: { userId_organizationId: { userId: reviewer.id, organizationId: offering.organizationId } } });
      if (membership) throw new IdentityError('forbidden', 403);

      const publicReason = input.outcome === 'approved' ? (input.publicReason ?? '').trim() : text(input.publicReason, 10, 1000);
      await tx.offeringReviewDecision.create({
        data: { offeringId, disclosureId: offering.currentDisclosureId, reviewerId: reviewer.id, outcome: input.outcome, publicReason }
      });
      const state: OfferingState = input.outcome === 'approved' ? 'approved' : input.outcome === 'rejected' ? 'rejected' : 'changes_requested';
      const updated = await tx.offering.update({ where: { id: offeringId }, data: { state, stateReason: publicReason, version: { increment: 1 } } });
      await tx.identityAuditEvent.create({ data: { actorId: reviewer.id, resourceId: offeringId, action: `offering.${input.outcome}` } });
      return this.detailView(updated, offering.venture);
    });
  }

  /**
   * Opening the offering to investors. Separate from approval, and re-checks what may have lapsed
   * since: the organisation's verification, and whether the disclosure has changed under it.
   */
  async open(actorId: string, organizationId: string, offeringId: string, version: number) {
    await this.identity.access(actorId, organizationId, 'offering.manage');
    return this.db.$transaction(async tx => {
      const offering = await tx.offering.findFirst({
        where: { id: offeringId, organizationId },
        include: { venture: true, organization: true, reviewDecisions: { orderBy: { createdAt: 'desc' }, take: 1 } }
      });
      if (!offering) throw new IdentityError('not_found', 404);
      if (!['approved', 'suspended'].includes(offering.state)) throw new IdentityError('conflict', 409);
      if (offering.version !== version) throw new IdentityError('conflict', 409);
      // Verification can lapse between approval and opening, so it is checked again here (05's rule).
      if (offering.organization.verification !== 'verified') throw new IdentityError('conflict', 409);
      if (!offering.closesAt || offering.closesAt <= new Date()) throw new IdentityError('conflict', 409);

      // The approval was for a specific disclosure. If a revision has been published since, the
      // offering goes back for review rather than opening on text nobody approved.
      const approval = offering.reviewDecisions[0];
      if (!approval || approval.outcome !== 'approved' || approval.disclosureId !== offering.currentDisclosureId) {
        throw new IdentityError('conflict', 409);
      }

      const updated = await tx.offering.update({
        where: { id: offering.id },
        data: { state: 'open', stateReason: '', opensAt: offering.opensAt ?? new Date(), version: { increment: 1 } }
      });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: offering.id, action: 'offering.opened' } });
      return this.detailView(updated, offering.venture);
    });
  }

  // ---------------------------------------------------------------- PUB-07 / PUB-08: the public

  /** PUB-07. The public index. Anything before `open` is absent, not forbidden. */
  async browse(filters: { instrument?: string; cursor?: string; limit?: number }) {
    const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
    const rows = await this.db.offering.findMany({
      where: { state: { in: [...PUBLIC_OFFERING_STATES] }, organization: { status: 'active' } },
      include: { venture: true, organization: { select: { slug: true, displayName: true, city: true, country: true, verification: true } } },
      orderBy: [{ opensAt: 'desc' }, { id: 'asc' }],
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {})
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map(row => this.publicCard(row)),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
      hasMore: rows.length > limit
    };
  }

  /** PUB-08. The public detail, including the disclosure but never the private data room. */
  async publicOffering(slug: string) {
    if (typeof slug !== 'string' || slug.length > SLUG_MAX) throw new IdentityError('not_found', 404);
    const offering = await this.db.offering.findFirst({
      where: { slug, state: { in: [...PUBLIC_OFFERING_STATES] }, organization: { status: 'active' } },
      include: {
        venture: true, currentDisclosure: true,
        organization: { select: { slug: true, displayName: true, city: true, country: true, verification: true } },
        documents: { where: { classification: 'public' }, orderBy: { createdAt: 'asc' } }
      }
    });
    if (!offering) throw new IdentityError('not_found', 404);
    return {
      ...this.publicCard(offering),
      // The identifier is on the detail projection but not on the cards. Every action an investor
      // can take from this page — an access request, a question, an NDA acceptance, a commitment —
      // is addressed by id, and a page that cannot name the thing it is about can only offer dead
      // controls. It discloses nothing: it is an opaque identifier for an offering already public.
      id: offering.id,
      useOfFunds: offering.useOfFunds,
      // Built field by field: the data room's own documents are not in this projection at all.
      disclosure: offering.currentDisclosure ? this.disclosureView(offering.currentDisclosure) : null,
      publicDocuments: offering.documents.map(document => ({ id: document.id, title: document.title, category: document.category })),
      requiresEligibility: offering.requiresEligibility,
      requiresNda: offering.requiresNda,
      // PART-09 built the subscribe path, so this is now a fact about this offering rather than a
      // fact about the build. It is the same condition the commitment endpoint enforces, computed
      // here so the page never offers a button that the server would refuse.
      acceptsCommitments: offering.state === 'open'
        && offering.currentDisclosure !== null
        && (offering.closesAt === null || offering.closesAt > new Date()),
      /** Why the subscribe path is closed, so the page states it instead of offering a dead button. */
      commitmentsUnavailableReason: this.commitmentsUnavailableReason(offering)
    };
  }

  /** Names the one reason an open subscribe button would be refused, in the order the server checks. */
  private commitmentsUnavailableReason(offering: { state: string; currentDisclosure: unknown; closesAt: Date | null }) {
    if (offering.state === 'suspended') return 'disclosure_revised';
    if (offering.state === 'closing') return 'closing';
    if (['failed', 'allocated', 'reporting', 'closed'].includes(offering.state)) return 'round_ended';
    if (offering.state !== 'open') return 'not_open';
    if (!offering.currentDisclosure) return 'no_disclosure';
    if (offering.closesAt !== null && offering.closesAt <= new Date()) return 'closing_date_passed';
    return '';
  }

  /**
   * PUB-08. What an amount would buy. Public because an investor must be able to see the maths
   * before deciding anything, and it commits them to nothing.
   */
  async quote(slug: string, amountMinorRaw: string) {
    const offering = await this.db.offering.findFirst({ where: { slug, state: { in: [...PUBLIC_OFFERING_STATES] } }, include: { venture: true } });
    if (!offering) throw new IdentityError('not_found', 404);
    const requested = parseMinor(amountMinorRaw);
    const maths = subscriptionMaths({
      currentShares: offering.venture.currentShares,
      sharesOffered: offering.sharesOffered,
      pricePerShareMinor: offering.pricePerShareMinor,
      minimumTicketMinor: offering.minimumTicketMinor,
      maximumTicketMinor: offering.maximumTicketMinor
    }, requested);
    return {
      currency: offering.currency,
      requestedMinor: minorToString(maths.requestedMinor),
      amountMinor: minorToString(maths.amountMinor),
      remainderMinor: minorToString(maths.remainderMinor),
      units: maths.units.toString(),
      percentOfPostRaise: maths.percentOfPostRaise,
      percentOfOffering: maths.percentOfOffering,
      postRaiseShares: maths.postRaiseShares.toString(),
      belowMinimumTicket: maths.amountMinor < offering.minimumTicketMinor,
      aboveMaximumTicket: offering.maximumTicketMinor !== null && maths.amountMinor > offering.maximumTicketMinor,
      // 06: the percentage is indicative until the final allocation, and saying so is not optional.
      indicative: true,
      simulated: true
    };
  }

  /** PUB-08.A01. An interest. It reserves nothing and is not funding (06). */
  async registerInterest(actorId: string, slug: string, input: { indicativeAmountMinor?: string | null | undefined }) {
    const user = await this.identity.activeUser(actorId);
    const offering = await this.db.offering.findFirst({ where: { slug, state: { in: ['open', 'suspended'] } } });
    if (!offering) throw new IdentityError('not_found', 404);
    const indicativeAmountMinor = input.indicativeAmountMinor ? parseMinor(input.indicativeAmountMinor) : null;
    const record = await this.db.offeringInterest.upsert({
      where: { offeringId_userId: { offeringId: offering.id, userId: user.id } },
      create: { offeringId: offering.id, userId: user.id, indicativeAmountMinor },
      update: { indicativeAmountMinor, withdrawnAt: null }
    });
    return {
      id: record.id,
      indicativeAmountMinor: record.indicativeAmountMinor === null ? null : minorToString(record.indicativeAmountMinor),
      // Said plainly in the response, because the screen must not imply anything was secured.
      reservesCapacity: false,
      isFunding: false
    };
  }

  // ---------------------------------------------------------------- shapes

  private parseInput(input: OfferingInput) {
    const sharesOffered = parseMinor(input.sharesOffered);
    const pricePerShareMinor = parseMinor(input.pricePerShareMinor);
    const minimumRaiseMinor = parseMinor(input.minimumRaiseMinor);
    const minimumTicketMinor = parseMinor(input.minimumTicketMinor);
    const maximumTicketMinor = input.maximumTicketMinor ? parseMinor(input.maximumTicketMinor) : null;
    const closesAt = input.closesAt ? new Date(input.closesAt) : null;
    if (closesAt && Number.isNaN(closesAt.getTime())) throw new IdentityError('invalid_input', 422);
    if (input.oversubscriptionPolicy && !['reject', 'pro_rata'].includes(input.oversubscriptionPolicy)) throw new IdentityError('invalid_input', 422);
    // 06: pro_rata needs a remainder rule and a tie-break before it can be offered, and neither is
    // specified yet. Allowing it now would mean an offering whose closing rules do not exist.
    if (input.oversubscriptionPolicy === 'pro_rata') throw new IdentityError('invalid_input', 422);

    return {
      title: text(input.title, 4, 200),
      currency: parseCurrency(input.currency),
      sharesOffered, pricePerShareMinor, minimumRaiseMinor, minimumTicketMinor, maximumTicketMinor,
      useOfFunds: text(input.useOfFunds, 20, 4000),
      requiresEligibility: input.requiresEligibility ?? true,
      requiresNda: input.requiresNda ?? false,
      closesAt
    };
  }

  private ventureView(venture: { id: string; organizationId: string; legalName: string; summary: string; currentShares: bigint; currency: string; version: number }) {
    return {
      id: venture.id, organizationId: venture.organizationId,
      legalName: venture.legalName, summary: venture.summary,
      // Share counts are integers carried as strings, for the same reason money is.
      currentShares: venture.currentShares.toString(),
      currency: venture.currency, version: venture.version
    };
  }

  private disclosureView(disclosure: { id: string; sequence: number; summary: string; risks: string; useOfFunds: string; checksum: string; material: boolean; reason: string; publishedAt: Date }) {
    return {
      id: disclosure.id, sequence: disclosure.sequence,
      summary: disclosure.summary, risks: disclosure.risks, useOfFunds: disclosure.useOfFunds,
      // Published so an acceptance can be checked against the text, by anyone, at any time.
      checksum: disclosure.checksum,
      material: disclosure.material, reason: disclosure.reason, publishedAt: disclosure.publishedAt
    };
  }

  private publicCard(offering: {
    id: string; slug: string; title: string; instrument: string; currency: string; state: string;
    sharesOffered: bigint; pricePerShareMinor: bigint; minimumRaiseMinor: bigint;
    minimumTicketMinor: bigint; maximumTicketMinor: bigint | null;
    opensAt: Date | null; closesAt: Date | null; simulated: boolean;
    venture: { currentShares: bigint; legalName: string };
    organization: { slug: string; displayName: string; city: string; country: string; verification: string };
  }) {
    const postRaiseShares = offering.venture.currentShares + offering.sharesOffered;
    return {
      slug: offering.slug,
      title: offering.title,
      instrument: offering.instrument,
      currency: offering.currency,
      state: offering.state,
      sharesOffered: offering.sharesOffered.toString(),
      pricePerShareMinor: minorToString(offering.pricePerShareMinor),
      maximumRaiseMinor: minorToString(offering.sharesOffered * offering.pricePerShareMinor),
      minimumRaiseMinor: minorToString(offering.minimumRaiseMinor),
      minimumTicketMinor: minorToString(offering.minimumTicketMinor),
      maximumTicketMinor: offering.maximumTicketMinor === null ? null : minorToString(offering.maximumTicketMinor),
      // Stated on every card: the whole offering is this share of the company, not all of it.
      offeringPercentOfPostRaise: percentString(offering.sharesOffered, postRaiseShares),
      postRaiseShares: postRaiseShares.toString(),
      opensAt: offering.opensAt,
      closesAt: offering.closesAt,
      organization: {
        slug: offering.organization.slug, displayName: offering.organization.displayName,
        city: offering.organization.city, country: offering.organization.country,
        verified: offering.organization.verification === 'verified'
      },
      // No projected return, no valuation and no performance figure appears anywhere in this DTO.
      simulated: offering.simulated
    };
  }

  private detailView(offering: {
    id: string; slug: string; title: string; instrument: string; currency: string; state: string;
    stateReason: string; sharesOffered: bigint; pricePerShareMinor: bigint; minimumRaiseMinor: bigint;
    minimumTicketMinor: bigint; maximumTicketMinor: bigint | null; useOfFunds: string;
    oversubscriptionPolicy: string; requiresEligibility: boolean; requiresNda: boolean;
    opensAt: Date | null; closesAt: Date | null; currentDisclosureId: string | null;
    organizationId: string; simulated: boolean; version: number; createdAt: Date;
  }, venture: { currentShares: bigint }) {
    const postRaiseShares = venture.currentShares + offering.sharesOffered;
    return {
      id: offering.id,
      organizationId: offering.organizationId,
      slug: offering.slug,
      title: offering.title,
      instrument: offering.instrument,
      currency: offering.currency,
      state: offering.state,
      stateReason: offering.stateReason,
      sharesOffered: offering.sharesOffered.toString(),
      pricePerShareMinor: minorToString(offering.pricePerShareMinor),
      maximumRaiseMinor: minorToString(offering.sharesOffered * offering.pricePerShareMinor),
      minimumRaiseMinor: minorToString(offering.minimumRaiseMinor),
      minimumTicketMinor: minorToString(offering.minimumTicketMinor),
      maximumTicketMinor: offering.maximumTicketMinor === null ? null : minorToString(offering.maximumTicketMinor),
      useOfFunds: offering.useOfFunds,
      oversubscriptionPolicy: offering.oversubscriptionPolicy,
      requiresEligibility: offering.requiresEligibility,
      requiresNda: offering.requiresNda,
      currentShares: venture.currentShares.toString(),
      postRaiseShares: postRaiseShares.toString(),
      offeringPercentOfPostRaise: percentString(offering.sharesOffered, postRaiseShares),
      opensAt: offering.opensAt,
      closesAt: offering.closesAt,
      hasDisclosure: Boolean(offering.currentDisclosureId),
      simulated: offering.simulated,
      version: offering.version,
      createdAt: offering.createdAt
    };
  }
}

export interface OfferingInput {
  title: string;
  currency: string;
  sharesOffered: string;
  pricePerShareMinor: string;
  minimumRaiseMinor: string;
  minimumTicketMinor: string;
  maximumTicketMinor?: string | null | undefined;
  useOfFunds: string;
  oversubscriptionPolicy?: string | undefined;
  requiresEligibility?: boolean | undefined;
  requiresNda?: boolean | undefined;
  closesAt?: string | null | undefined;
}
