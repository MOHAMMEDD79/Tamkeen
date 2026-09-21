import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseClient } from '@tamkeen/database';
import { IdentityError } from '../identity/policy.js';
import { IdentityService } from '../identity/identity.service.js';
import { minorToString, parseCurrency, parseMinor } from '../projects/money.js';

/**
 * Partnerships and grants between two organisations (BUS-06), and the sponsor's side of them
 * (PRG-11).
 *
 * **A grant is not equity.** Nothing in this file creates an offering, a commitment or a holding,
 * and the two columns that could ever be read as ownership are held to `false` by CHECK
 * constraints. 07 is explicit: the platform takes no shares for funding, and any stake needs a
 * separate, explicit investment agreement on the PART-08/09 path.
 *
 * **Both sides accept a named version.** An acceptance records the checksum of the text it was
 * given, and the agreement becomes active only when both parties have accepted the *same* one — so
 * "we agreed" always points at a specific document rather than at a moving target.
 *
 * **Approving a deliverable moves no money.** A milestone decision is a judgement about evidence;
 * releasing funds is the payout chain, with its own maker, its own independent approver and its own
 * proof. The decision row carries `releasedFunds: false` and a constraint that keeps it there.
 */

const text = (value: unknown, min: number, max: number) => {
  if (typeof value !== 'string') throw new IdentityError('invalid_input', 422);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw new IdentityError('invalid_input', 422);
  return trimmed;
};

const optionalText = (value: unknown, max: number) => {
  if (value === undefined || value === null) return '';
  return text(value, 0, max);
};

const plainDate = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new IdentityError('invalid_input', 422);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new IdentityError('invalid_input', 422);
  return date;
};

const instant = (value: unknown) => {
  if (typeof value !== 'string') throw new IdentityError('invalid_input', 422);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new IdentityError('invalid_input', 422);
  return date;
};

const reference = () => `AGR-${randomBytes(4).toString('hex').toUpperCase()}`;

const KINDS = ['cash', 'in_kind', 'mixed'] as const;
type Kind = typeof KINDS[number];

/** The exact terms as sent, so an acceptance names a specific text. */
const checksumOf = (input: { title: string; purpose: string; obligations: string; terms: string; amountMinor: bigint | null; currency: string | null; inKindValueMinor: bigint | null; surplusTerms: string; reportingTerms: string }) =>
  createHash('sha256').update(JSON.stringify({
    title: input.title,
    purpose: input.purpose,
    obligations: input.obligations,
    terms: input.terms,
    amountMinor: input.amountMinor === null ? null : input.amountMinor.toString(),
    currency: input.currency,
    inKindValueMinor: input.inKindValueMinor === null ? null : input.inKindValueMinor.toString(),
    surplusTerms: input.surplusTerms,
    reportingTerms: input.reportingTerms
  })).digest('hex');

export interface AgreementInput {
  operatorOrgId: string;
  title: string;
  kind?: Kind | undefined;
  amountMinor?: string | null | undefined;
  currency?: string | null | undefined;
  inKindDescription?: string | undefined;
  inKindValueMinor?: string | null | undefined;
  purpose: string;
  obligations?: string | undefined;
  reportingTerms?: string | undefined;
  surplusTerms?: string | undefined;
  programId?: string | null | undefined;
  projectId?: string | null | undefined;
  startsAt?: string | null | undefined;
  endsAt?: string | null | undefined;
}

export class AgreementsService {
  private readonly identity: IdentityService;
  constructor(private readonly db: DatabaseClient) {
    this.identity = new IdentityService(db);
  }

  // ---------------------------------------------------------------- BUS-06: proposing

  /** BUS-06.A01. A draft between two named organisations. The other side sees nothing yet. */
  async create(actorId: string, organizationId: string, input: AgreementInput) {
    await this.identity.access(actorId, organizationId, 'agreement.manage');
    const parsed = await this.parse(input, organizationId);

    return this.db.$transaction(async tx => {
      const operator = await tx.organization.findUnique({ where: { id: input.operatorOrgId } });
      if (!operator || operator.status !== 'active') throw new IdentityError('not_found', 404);
      // An agreement with yourself is not an agreement: one side's signature would stand for both.
      if (operator.id === organizationId) throw new IdentityError('invalid_input', 422);

      const agreement = await tx.agreement.create({
        data: {
          sponsorOrgId: organizationId,
          operatorOrgId: operator.id,
          reference: reference(),
          ...parsed,
          state: 'draft',
          createdBy: actorId
        }
      });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: agreement.id, action: 'agreement.created' } });
      return this.view(agreement);
    });
  }

  async update(actorId: string, organizationId: string, agreementId: string, input: AgreementInput & { version: number }) {
    await this.identity.access(actorId, organizationId, 'agreement.manage');
    const parsed = await this.parse(input, organizationId);

    return this.db.$transaction(async tx => {
      const agreement = await tx.agreement.findFirst({ where: { id: agreementId, sponsorOrgId: organizationId } });
      if (!agreement) throw new IdentityError('not_found', 404);
      // Once it has been sent, a change is a new revision the other side must accept afresh.
      if (agreement.state !== 'draft') throw new IdentityError('conflict', 409);
      if (agreement.version !== input.version) throw new IdentityError('conflict', 409);
      const updated = await tx.agreement.update({ where: { id: agreement.id }, data: { ...parsed, version: { increment: 1 } } });
      return this.view(updated);
    });
  }

  /**
   * BUS-06.A02. Sending it to the other party.
   *
   * The terms become a numbered revision with a checksum. Any later change is a new revision, and
   * an acceptance of the old one no longer matches — which is exactly what stops a party being
   * bound to a document they never read.
   */
  async send(actorId: string, organizationId: string, agreementId: string, input: { terms: string; version: number }) {
    await this.identity.access(actorId, organizationId, 'agreement.manage');
    const terms = text(input.terms, 50, 8000);

    return this.db.$transaction(async tx => {
      const agreement = await tx.agreement.findFirst({ where: { id: agreementId, sponsorOrgId: organizationId } });
      if (!agreement) throw new IdentityError('not_found', 404);
      if (!['draft', 'pending_acceptance'].includes(agreement.state)) throw new IdentityError('conflict', 409);
      if (agreement.version !== input.version) throw new IdentityError('conflict', 409);

      const checksum = checksumOf({ ...agreement, terms });
      const previous = await tx.agreementRevision.aggregate({ where: { agreementId }, _max: { sequence: true } });
      await tx.agreementRevision.create({
        data: { agreementId, sequence: (previous._max.sequence ?? 0) + 1, terms, checksum, createdBy: actorId }
      });
      // A new revision resets both acceptances: agreeing to the previous text says nothing about
      // this one. The acceptances stay on the record; they simply no longer match the checksum.
      const updated = await tx.agreement.update({
        where: { id: agreement.id },
        data: { state: 'pending_acceptance', termsChecksum: checksum, sentAt: new Date(), version: { increment: 1 } }
      });
      await tx.outboxEvent.create({ data: { topic: 'agreement.sent', payload: { agreementId } } });
      return this.view(updated);
    });
  }

  /**
   * BUS-06.A03. One party accepting the version in front of them.
   *
   * It becomes active only when both have accepted the same checksum. Accepting on behalf of the
   * wrong party is refused: the actor's permission is checked against the organisation whose role
   * they are claiming, not against whichever one they happen to belong to.
   */
  async accept(actorId: string, organizationId: string, agreementId: string, input: { checksum: string; version: number }) {
    const membership = await this.identity.access(actorId, organizationId, 'agreement.accept');
    const acknowledged = text(input.checksum, 64, 64);

    return this.db.$transaction(async tx => {
      const agreement = await tx.agreement.findUnique({ where: { id: agreementId } });
      if (!agreement) throw new IdentityError('not_found', 404);
      const partyRole = agreement.sponsorOrgId === organizationId ? 'sponsor'
        : agreement.operatorOrgId === organizationId ? 'operator'
          : null;
      if (!partyRole) throw new IdentityError('not_found', 404);
      if (agreement.state !== 'pending_acceptance') throw new IdentityError('conflict', 409);
      if (agreement.version !== input.version) throw new IdentityError('conflict', 409);
      // Accepting a text other than the one on the table is agreeing to a document nobody sent.
      if (agreement.termsChecksum !== acknowledged) throw new IdentityError('conflict', 409);

      const already = await tx.agreementAcceptance.findUnique({ where: { agreementId_partyRole: { agreementId, partyRole } } });
      if (already) throw new IdentityError('conflict', 409);
      await tx.agreementAcceptance.create({ data: { agreementId, partyRole, checksum: acknowledged, acceptedBy: membership.user.id } });

      const accepted = await tx.agreementAcceptance.findMany({ where: { agreementId, checksum: acknowledged } });
      const bothAccepted = accepted.length === 2;
      const updated = bothAccepted
        ? await tx.agreement.update({ where: { id: agreementId }, data: { state: 'active', activatedAt: new Date(), version: { increment: 1 } } })
        : agreement;
      if (bothAccepted) await tx.outboxEvent.create({ data: { topic: 'agreement.activated', payload: { agreementId } } });

      return {
        ...this.view(updated),
        acceptedBy: accepted.map(row => row.partyRole),
        awaiting: bothAccepted ? '' : partyRole === 'sponsor' ? 'operator' : 'sponsor',
        active: bothAccepted,
        /** Said on the acceptance itself, because this is the moment somebody might assume otherwise. */
        createsEquity: false as const
      };
    });
  }

  // ---------------------------------------------------------------- milestones and reports

  async addMilestone(actorId: string, organizationId: string, agreementId: string, input: {
    title: string; description?: string | undefined; dueAt: string; amountMinor?: string | null | undefined;
  }) {
    await this.identity.access(actorId, organizationId, 'agreement.manage');
    const title = text(input.title, 4, 200);
    const dueAt = plainDate(input.dueAt);
    const amountMinor = input.amountMinor ? parseMinor(input.amountMinor) : null;

    return this.db.$transaction(async tx => {
      const agreement = await this.partyAgreement(tx as DatabaseClient, agreementId, organizationId);
      if (!['draft', 'pending_acceptance', 'active'].includes(agreement.state)) throw new IdentityError('conflict', 409);
      const previous = await tx.agreementMilestone.aggregate({ where: { agreementId }, _max: { sequence: true } });
      const milestone = await tx.agreementMilestone.create({
        data: {
          agreementId, sequence: (previous._max.sequence ?? 0) + 1, title,
          description: optionalText(input.description, 2000), dueAt, amountMinor
        }
      });
      return this.milestoneView(milestone);
    });
  }

  /** The operator saying a deliverable is done. It is a submission, not an approval. */
  async submitMilestoneEvidence(actorId: string, organizationId: string, milestoneId: string, input: {
    evidenceRef: string; evidenceNote?: string | undefined; version: number;
  }) {
    await this.identity.access(actorId, organizationId, 'agreement.manage');
    const evidenceRef = text(input.evidenceRef, 3, 200);

    return this.db.$transaction(async tx => {
      const milestone = await tx.agreementMilestone.findUnique({ where: { id: milestoneId }, include: { agreement: true } });
      if (!milestone) throw new IdentityError('not_found', 404);
      // Evidence comes from the side doing the work.
      if (milestone.agreement.operatorOrgId !== organizationId) throw new IdentityError('not_found', 404);
      if (milestone.agreement.state !== 'active') throw new IdentityError('conflict', 409);
      if (!['planned', 'changes_requested'].includes(milestone.state)) throw new IdentityError('conflict', 409);
      if (milestone.version !== input.version) throw new IdentityError('conflict', 409);

      const updated = await tx.agreementMilestone.update({
        where: { id: milestone.id },
        data: {
          state: 'evidence_submitted', evidenceRef,
          evidenceNote: optionalText(input.evidenceNote, 2000),
          submittedAt: new Date(), version: { increment: 1 }
        }
      });
      return this.milestoneView(updated);
    });
  }

  /**
   * BUS-06.A04. Judging a deliverable.
   *
   * It is decided by the *other* side — the one that did not submit the evidence — and it releases
   * no money. Both facts are in the reply, and the second is held by a constraint as well.
   */
  async decideMilestone(actorId: string, organizationId: string, milestoneId: string, input: {
    outcome: 'approved' | 'changes_requested'; reason: string; evidenceRef?: string | undefined; version: number;
  }) {
    const membership = await this.identity.access(actorId, organizationId, 'agreement.review');
    const reason = text(input.reason, 10, 1000);
    if (!['approved', 'changes_requested'].includes(input.outcome)) throw new IdentityError('invalid_input', 422);

    return this.db.$transaction(async tx => {
      const milestone = await tx.agreementMilestone.findUnique({ where: { id: milestoneId }, include: { agreement: true } });
      if (!milestone) throw new IdentityError('not_found', 404);
      // 08: the party that produced the evidence does not also certify it.
      if (milestone.agreement.sponsorOrgId !== organizationId) throw new IdentityError('not_found', 404);
      if (milestone.agreement.state !== 'active') throw new IdentityError('conflict', 409);
      if (milestone.state !== 'evidence_submitted') throw new IdentityError('conflict', 409);
      if (milestone.version !== input.version) throw new IdentityError('conflict', 409);

      await tx.agreementMilestoneDecision.create({
        data: {
          milestoneId, reviewerId: membership.user.id, outcome: input.outcome, reason,
          evidenceRef: optionalText(input.evidenceRef, 200), releasedFunds: false
        }
      });
      const updated = await tx.agreementMilestone.update({
        where: { id: milestone.id },
        data: { state: input.outcome, decidedAt: new Date(), version: { increment: 1 } }
      });
      return {
        ...this.milestoneView(updated),
        /** Approving a deliverable is not paying for it. Releasing funds is the payout chain. */
        releasedFunds: false as const,
        note: 'approval_is_not_payment'
      };
    });
  }

  /** The operator's report back to the sponsor: what was spent and what was reached. */
  async createReport(actorId: string, organizationId: string, agreementId: string, input: {
    periodStart: string; periodEnd: string; narrative?: string | undefined; spentMinor?: string | undefined;
    participantsReached?: number | undefined; outcomesNote?: string | undefined; varianceNote?: string | undefined;
  }) {
    await this.identity.access(actorId, organizationId, 'report.create');
    const periodStart = plainDate(input.periodStart);
    const periodEnd = plainDate(input.periodEnd);
    if (periodEnd < periodStart) throw new IdentityError('invalid_input', 422);
    const participants = input.participantsReached ?? 0;
    if (!Number.isInteger(participants) || participants < 0) throw new IdentityError('invalid_input', 422);

    return this.db.$transaction(async tx => {
      const agreement = await tx.agreement.findFirst({ where: { id: agreementId, operatorOrgId: organizationId } });
      if (!agreement) throw new IdentityError('not_found', 404);
      if (!['active', 'completed'].includes(agreement.state)) throw new IdentityError('conflict', 409);
      const existing = await tx.agreementReport.findUnique({ where: { agreementId_periodStart_periodEnd: { agreementId, periodStart, periodEnd } } });
      if (existing) throw new IdentityError('conflict', 409);

      const report = await tx.agreementReport.create({
        data: {
          agreementId, periodStart, periodEnd,
          narrative: optionalText(input.narrative, 8000),
          spentMinor: input.spentMinor ? parseMinor(input.spentMinor, { allowZero: true }) : 0n,
          participantsReached: participants,
          outcomesNote: optionalText(input.outcomesNote, 4000),
          varianceNote: optionalText(input.varianceNote, 2000),
          createdBy: actorId
        }
      });
      return this.reportView(report);
    });
  }

  async submitReport(actorId: string, organizationId: string, reportId: string, version: number) {
    await this.identity.access(actorId, organizationId, 'report.submit');
    return this.db.$transaction(async tx => {
      const report = await tx.agreementReport.findUnique({ where: { id: reportId }, include: { agreement: true } });
      if (!report || report.agreement.operatorOrgId !== organizationId) throw new IdentityError('not_found', 404);
      if (!['draft', 'changes_requested'].includes(report.state)) throw new IdentityError('conflict', 409);
      if (report.version !== version) throw new IdentityError('conflict', 409);
      // 14: a report with nothing in it tells a funder nothing. The narrative is the minimum.
      if (report.narrative.trim().length < 50) throw new IdentityError('conflict', 409);
      const updated = await tx.agreementReport.update({
        where: { id: report.id }, data: { state: 'submitted', submittedAt: new Date(), version: { increment: 1 } }
      });
      return this.reportView(updated);
    });
  }

  /** PRG-11.A02. The sponsor's judgement on a report. It moves no money either. */
  async decideReport(actorId: string, organizationId: string, reportId: string, input: {
    outcome: 'approved' | 'changes_requested'; reason: string; version: number;
  }) {
    const membership = await this.identity.access(actorId, organizationId, 'agreement.review');
    const reason = text(input.reason, 10, 1000);
    if (!['approved', 'changes_requested'].includes(input.outcome)) throw new IdentityError('invalid_input', 422);

    return this.db.$transaction(async tx => {
      const report = await tx.agreementReport.findUnique({ where: { id: reportId }, include: { agreement: true } });
      if (!report) throw new IdentityError('not_found', 404);
      // The sponsor reviews the operator's report, never its own.
      if (report.agreement.sponsorOrgId !== organizationId) throw new IdentityError('not_found', 404);
      if (report.state !== 'submitted') throw new IdentityError('conflict', 409);
      if (report.version !== input.version) throw new IdentityError('conflict', 409);

      const updated = await tx.agreementReport.update({
        where: { id: report.id },
        data: {
          state: input.outcome, decisionReason: reason, reviewerId: membership.user.id,
          decidedAt: new Date(), version: { increment: 1 }
        }
      });
      return { ...this.reportView(updated), releasedFunds: false as const };
    });
  }

  // ---------------------------------------------------------------- PRG-11.A01: funding

  /**
   * PRG-11.A01. A sponsor putting money behind an active agreement.
   *
   * It creates a payment intent on the same simulated rail every other payment in this build uses,
   * and it creates **no share**: the reply says so, and a CHECK constraint keeps the column false.
   * 07 keeps grant money and investment money on separate paths all the way down.
   */
  async fund(actorId: string, organizationId: string, agreementId: string, input: { amountMinor: string; currency: string; note?: string | undefined }) {
    await this.identity.access(actorId, organizationId, 'sponsorship.fund');
    const amountMinor = parseMinor(input.amountMinor);
    const currency = parseCurrency(input.currency);
    if (amountMinor <= 0n) throw new IdentityError('invalid_input', 422);

    return this.db.$transaction(async tx => {
      const agreement = await tx.agreement.findFirst({ where: { id: agreementId, sponsorOrgId: organizationId } });
      if (!agreement) throw new IdentityError('not_found', 404);
      // Funding a document nobody has agreed to is money with no obligation attached.
      if (agreement.state !== 'active') throw new IdentityError('conflict', 409);
      if (agreement.kind === 'in_kind') throw new IdentityError('conflict', 409);
      // 08: one pool, one currency. A figure in another currency is not a smaller or larger number,
      // it is a different thing, and this build has no FX.
      if (agreement.currency && agreement.currency !== currency) throw new IdentityError('invalid_input', 422);

      const funded = await tx.agreementFundingIntent.aggregate({ where: { agreementId }, _sum: { amountMinor: true } });
      const alreadyFunded = funded._sum.amountMinor ?? 0n;
      // Funding beyond what was agreed is money outside the obligation it was supposed to carry.
      if (agreement.amountMinor !== null && alreadyFunded + amountMinor > agreement.amountMinor) throw new IdentityError('conflict', 409);

      const intent = await tx.agreementFundingIntent.create({
        data: { agreementId, amountMinor, currency, note: optionalText(input.note, 1000), createsEquity: false, createdBy: actorId }
      });
      await tx.outboxEvent.create({ data: { topic: 'agreement.funding_intent_created', payload: { intentId: intent.id, agreementId } } });

      return {
        id: intent.id,
        agreementId,
        amountMinor: minorToString(intent.amountMinor),
        currency: intent.currency,
        committedMinor: agreement.amountMinor === null ? null : minorToString(agreement.amountMinor),
        fundedMinor: minorToString(alreadyFunded + amountMinor),
        /** The three facts a funder could otherwise assume wrongly, stated rather than implied. */
        createsEquity: false as const,
        createsHolding: false as const,
        /**
         * No money has moved. This build has no payment provider, and an intent recorded here is a
         * stated intention, not a transfer — the same honesty PART-06 applies to a contribution.
         */
        moneyMoved: false as const,
        awaitingExternalPayment: true as const,
        createdAt: intent.createdAt
      };
    });
  }

  // ---------------------------------------------------------------- reads

  /** Both sides of an agreement see it. Nobody else does. */
  async listForOrganization(actorId: string, organizationId: string, filters: { role?: 'sponsor' | 'operator' | undefined; state?: string | undefined }) {
    await this.identity.access(actorId, organizationId, 'organization.read');
    const where = filters.role === 'sponsor' ? { sponsorOrgId: organizationId }
      : filters.role === 'operator' ? { operatorOrgId: organizationId }
        : { OR: [{ sponsorOrgId: organizationId }, { operatorOrgId: organizationId }] };
    const rows = await this.db.agreement.findMany({
      where: { ...where, ...(filters.state ? { state: filters.state as 'draft' } : {}) },
      include: {
        sponsorOrg: { select: { id: true, displayName: true } },
        operatorOrg: { select: { id: true, displayName: true } },
        program: { select: { id: true, title: true } },
        acceptances: { select: { partyRole: true, checksum: true, createdAt: true } },
        fundingIntents: { select: { amountMinor: true } },
        _count: { select: { milestones: true, reports: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 200
    });
    return rows.map(row => this.summaryView(row, organizationId));
  }

  async get(actorId: string, organizationId: string, agreementId: string) {
    await this.identity.access(actorId, organizationId, 'organization.read');
    const agreement = await this.db.agreement.findFirst({
      where: { id: agreementId, OR: [{ sponsorOrgId: organizationId }, { operatorOrgId: organizationId }] },
      include: {
        sponsorOrg: { select: { id: true, displayName: true } },
        operatorOrg: { select: { id: true, displayName: true } },
        program: { select: { id: true, title: true } },
        acceptances: { select: { partyRole: true, checksum: true, createdAt: true } },
        revisions: { orderBy: { sequence: 'desc' }, take: 5 },
        milestones: { orderBy: { sequence: 'asc' }, include: { decisions: { orderBy: { createdAt: 'desc' }, take: 1 } } },
        reports: { orderBy: { periodStart: 'desc' } },
        fundingIntents: { orderBy: { createdAt: 'desc' } },
        _count: { select: { milestones: true, reports: true } }
      }
    });
    if (!agreement) throw new IdentityError('not_found', 404);
    const current = agreement.revisions.find(revision => revision.checksum === agreement.termsChecksum) ?? agreement.revisions[0] ?? null;

    return {
      ...this.summaryView(agreement, organizationId),
      purpose: agreement.purpose,
      obligations: agreement.obligations,
      reportingTerms: agreement.reportingTerms,
      surplusTerms: agreement.surplusTerms,
      inKindDescription: agreement.inKindDescription,
      inKindValueMinor: agreement.inKindValueMinor === null ? null : minorToString(agreement.inKindValueMinor),
      currentTerms: current ? { sequence: current.sequence, terms: current.terms, checksum: current.checksum, createdAt: current.createdAt } : null,
      revisionCount: agreement.revisions.length,
      milestones: agreement.milestones.map(milestone => ({
        ...this.milestoneView(milestone),
        latestDecision: milestone.decisions[0]
          ? { outcome: milestone.decisions[0].outcome, reason: milestone.decisions[0].reason, at: milestone.decisions[0].createdAt, releasedFunds: false }
          : null
      })),
      reports: agreement.reports.map(report => this.reportView(report)),
      funding: agreement.fundingIntents.map(intent => ({
        id: intent.id,
        amountMinor: minorToString(intent.amountMinor),
        currency: intent.currency,
        createsEquity: false as const,
        moneyMoved: false as const,
        createdAt: intent.createdAt
      }))
    };
  }

  /**
   * PRG-11.A04. The sponsor's aggregate export.
   *
   * 12 forbids naming trainees or assistance applicants in a sponsor report, so this is counts and
   * money only — and the reply says so rather than leaving the reader to check.
   */
  async exportForSponsor(actorId: string, organizationId: string) {
    await this.identity.access(actorId, organizationId, 'report.read');
    const agreements = await this.db.agreement.findMany({
      where: { sponsorOrgId: organizationId },
      select: {
        id: true, reference: true, title: true, kind: true, state: true,
        amountMinor: true, currency: true, inKindValueMinor: true,
        program: { select: { title: true } },
        fundingIntents: { select: { amountMinor: true } },
        reports: { select: { state: true, spentMinor: true, participantsReached: true, periodStart: true, periodEnd: true } },
        milestones: { select: { state: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    const rows = agreements.map(agreement => {
      const funded = agreement.fundingIntents.reduce((total, intent) => total + intent.amountMinor, 0n);
      const approved = agreement.reports.filter(report => report.state === 'approved');
      return {
        reference: agreement.reference,
        title: agreement.title,
        programme: agreement.program?.title ?? null,
        kind: agreement.kind,
        state: agreement.state,
        /** Cash and in-kind stay two figures. 08 never adds them. */
        committedCashMinor: agreement.amountMinor === null ? null : minorToString(agreement.amountMinor),
        inKindValueMinor: agreement.inKindValueMinor === null ? null : minorToString(agreement.inKindValueMinor),
        currency: agreement.currency,
        fundingIntentsMinor: minorToString(funded),
        /** Reported spend, from approved reports only. An unreviewed figure is not evidence. */
        reportedSpentMinor: minorToString(approved.reduce((total, report) => total + report.spentMinor, 0n)),
        participantsReached: approved.reduce((total, report) => total + report.participantsReached, 0),
        reportsApproved: approved.length,
        reportsAwaitingReview: agreement.reports.filter(report => report.state === 'submitted').length,
        milestonesApproved: agreement.milestones.filter(milestone => milestone.state === 'approved').length,
        milestonesTotal: agreement.milestones.length
      };
    });

    return {
      generatedAt: new Date(),
      agreements: rows,
      /** No names, no beneficiary records, no trainee files: 12 keeps them out of a sponsor view. */
      containsPersonalData: false as const,
      redacted: true as const,
      note: 'counts_and_money_only',
      /** The one number a sponsor might read as ownership, said plainly. */
      equityHeld: 0 as const
    };
  }

  // ---------------------------------------------------------------- shaping

  private async partyAgreement(tx: DatabaseClient, agreementId: string, organizationId: string) {
    const agreement = await tx.agreement.findFirst({
      where: { id: agreementId, OR: [{ sponsorOrgId: organizationId }, { operatorOrgId: organizationId }] }
    });
    if (!agreement) throw new IdentityError('not_found', 404);
    return agreement;
  }

  private async parse(input: AgreementInput, organizationId: string) {
    const kind = input.kind ?? 'cash';
    if (!KINDS.includes(kind)) throw new IdentityError('invalid_input', 422);

    const wantsCash = kind !== 'in_kind';
    const amountMinor = wantsCash ? parseMinor(String(input.amountMinor ?? '')) : null;
    if (wantsCash && (!amountMinor || amountMinor <= 0n)) throw new IdentityError('invalid_input', 422);
    const currency = wantsCash ? parseCurrency(String(input.currency ?? '')) : null;

    const wantsInKind = kind !== 'cash';
    // 08: an in-kind contribution is reported at a stated estimated value and never enters cash.
    const inKindDescription = wantsInKind ? text(input.inKindDescription, 10, 2000) : '';
    const inKindValueMinor = wantsInKind ? parseMinor(String(input.inKindValueMinor ?? ''), { allowZero: true }) : null;

    let programId: string | null = null;
    if (input.programId) {
      const program = await this.db.program.findUnique({ where: { id: input.programId }, select: { id: true } });
      if (!program) throw new IdentityError('invalid_input', 422);
      programId = program.id;
    }
    let projectId: string | null = null;
    if (input.projectId) {
      const project = await this.db.project.findUnique({ where: { id: input.projectId }, select: { id: true } });
      if (!project) throw new IdentityError('invalid_input', 422);
      projectId = project.id;
    }
    void organizationId;

    return {
      title: text(input.title, 4, 200),
      kind,
      amountMinor,
      currency,
      inKindDescription,
      inKindValueMinor,
      purpose: text(input.purpose, 20, 4000),
      obligations: optionalText(input.obligations, 4000),
      reportingTerms: optionalText(input.reportingTerms, 2000),
      surplusTerms: optionalText(input.surplusTerms, 1000),
      programId,
      projectId,
      startsAt: input.startsAt ? instant(input.startsAt) : null,
      endsAt: input.endsAt ? instant(input.endsAt) : null
    } as const;
  }

  private view(agreement: {
    id: string; reference: string; title: string; kind: string; state: string; stateReason: string;
    amountMinor: bigint | null; currency: string | null; termsChecksum: string;
    sentAt: Date | null; activatedAt: Date | null; startsAt: Date | null; endsAt: Date | null;
    version: number; createdAt: Date;
  }) {
    return {
      id: agreement.id,
      reference: agreement.reference,
      title: agreement.title,
      kind: agreement.kind,
      state: agreement.state,
      stateReason: agreement.stateReason,
      amountMinor: agreement.amountMinor === null ? null : minorToString(agreement.amountMinor),
      currency: agreement.currency,
      termsChecksum: agreement.termsChecksum,
      sentAt: agreement.sentAt,
      activatedAt: agreement.activatedAt,
      startsAt: agreement.startsAt,
      endsAt: agreement.endsAt,
      version: agreement.version,
      createdAt: agreement.createdAt,
      /** On every projection of an agreement, because this is the assumption 07 exists to prevent. */
      createsEquity: false as const
    };
  }

  private summaryView(row: {
    id: string; reference: string; title: string; kind: string; state: string; stateReason: string;
    amountMinor: bigint | null; currency: string | null; termsChecksum: string;
    sentAt: Date | null; activatedAt: Date | null; startsAt: Date | null; endsAt: Date | null;
    version: number; createdAt: Date; sponsorOrgId: string; operatorOrgId: string;
    sponsorOrg: { id: string; displayName: string };
    operatorOrg: { id: string; displayName: string };
    program?: { id: string; title: string } | null | undefined;
    acceptances: Array<{ partyRole: string; checksum: string; createdAt: Date }>;
    fundingIntents: Array<{ amountMinor: bigint }>;
    _count?: { milestones: number; reports: number } | undefined;
  }, organizationId: string) {
    const matching = row.acceptances.filter(acceptance => acceptance.checksum === row.termsChecksum);
    const myRole = row.sponsorOrgId === organizationId ? 'sponsor' : 'operator';
    return {
      ...this.view(row),
      sponsor: row.sponsorOrg,
      operator: row.operatorOrg,
      program: row.program ?? null,
      /** Which side the reader is on, so no screen has to work it out from two identifiers. */
      myRole,
      acceptedBy: matching.map(acceptance => acceptance.partyRole),
      /** Accepting an older text counts for nothing, and this says which side is still missing. */
      awaitingAcceptanceFrom: row.state === 'pending_acceptance'
        ? (['sponsor', 'operator'] as const).filter(role => !matching.some(acceptance => acceptance.partyRole === role))
        : [],
      fundedMinor: minorToString(row.fundingIntents.reduce((total, intent) => total + intent.amountMinor, 0n)),
      milestoneCount: row._count?.milestones ?? 0,
      reportCount: row._count?.reports ?? 0
    };
  }

  private milestoneView(milestone: {
    id: string; sequence: number; title: string; description: string; dueAt: Date;
    amountMinor: bigint | null; state: string; evidenceRef: string; evidenceNote: string;
    submittedAt: Date | null; decidedAt: Date | null; version: number;
  }) {
    return {
      id: milestone.id,
      sequence: milestone.sequence,
      title: milestone.title,
      description: milestone.description,
      dueAt: milestone.dueAt,
      /** The tranche it is associated with. Informational: approving it releases nothing. */
      amountMinor: milestone.amountMinor === null ? null : minorToString(milestone.amountMinor),
      state: milestone.state,
      evidenceRef: milestone.evidenceRef,
      evidenceNote: milestone.evidenceNote,
      submittedAt: milestone.submittedAt,
      decidedAt: milestone.decidedAt,
      version: milestone.version
    };
  }

  private reportView(report: {
    id: string; periodStart: Date; periodEnd: Date; narrative: string; spentMinor: bigint;
    participantsReached: number; outcomesNote: string; varianceNote: string; state: string;
    submittedAt: Date | null; decidedAt: Date | null; decisionReason: string; version: number;
  }) {
    return {
      id: report.id,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      narrative: report.narrative,
      spentMinor: minorToString(report.spentMinor),
      /** A count. 12 keeps names out of anything a sponsor reads. */
      participantsReached: report.participantsReached,
      outcomesNote: report.outcomesNote,
      varianceNote: report.varianceNote,
      state: report.state,
      submittedAt: report.submittedAt,
      decidedAt: report.decidedAt,
      decisionReason: report.decisionReason,
      version: report.version
    };
  }
}
