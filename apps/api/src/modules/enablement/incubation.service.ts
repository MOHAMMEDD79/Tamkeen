import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseClient } from '@tamkeen/database';
import { IdentityError } from '../identity/policy.js';
import { IdentityService } from '../identity/identity.service.js';
import { minorToString, parseCurrency, parseMinor } from '../projects/money.js';

/**
 * Incubation: an idea, a decision, an agreement, a mentor, milestones (PRG-10, PER-16).
 *
 * **LOOP-INC, and what it refuses.** 22 describes the path as: a private idea → an incubation
 * decision → an agreement with a *separate* grant → a mentor and milestones → a verified prototype
 * → **the founder** creating a company → a linked venture → a new offering only if they ask for
 * equity funding. Two things are named there as forbidden, and both are enforced here:
 *
 *  - **No account is created for anybody.** The founder already has one; nothing in this file makes
 *    a user, and creating the company is a navigation to the ordinary organisation form they fill
 *    in themselves.
 *  - **No grant becomes registered capital.** `grantsEquity` is false and a CHECK keeps it there.
 *    An incubator stake needs an explicit agreement on the PART-08/09 investment path, and this
 *    module has no route to one.
 *
 * **A mentor comments; they do not decide.** 08's permission table is explicit about that, so a
 * mentor holds no `proposal.review`: their reach is the ideas they were assigned, exactly as a
 * trainer's reach is the cohorts they were assigned.
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

const reference = () => `IDEA-${randomBytes(4).toString('hex').toUpperCase()}`;

const checksumOf = (input: { title: string; terms: string; ipTerms: string; grantMinor: bigint | null; currency: string | null; durationMonths: number | null }) =>
  createHash('sha256').update(JSON.stringify({
    title: input.title,
    terms: input.terms,
    ipTerms: input.ipTerms,
    grantMinor: input.grantMinor === null ? null : input.grantMinor.toString(),
    currency: input.currency,
    durationMonths: input.durationMonths,
    grantsEquity: false
  })).digest('hex');

export class IncubationService {
  private readonly identity: IdentityService;
  constructor(private readonly db: DatabaseClient) {
    this.identity = new IdentityService(db);
  }

  // ---------------------------------------------------------------- PER-16: the founder

  /** PER-16.A01. A private draft. No incubator sees it, and it is attached to none yet. */
  async saveDraft(actorId: string, input: {
    proposalId?: string | undefined; title: string; summary?: string | undefined; problem?: string | undefined;
    stage?: string | undefined; sector?: string | undefined; city?: string | undefined;
    supportSought?: string | undefined; version?: number | undefined;
  }) {
    const user = await this.identity.activeUser(actorId);
    const data = {
      title: text(input.title, 4, 200),
      summary: optionalText(input.summary, 4000),
      problem: optionalText(input.problem, 4000),
      stage: optionalText(input.stage, 60),
      sector: optionalText(input.sector, 100),
      city: optionalText(input.city, 100),
      supportSought: optionalText(input.supportSought, 2000)
    };

    if (input.proposalId) {
      const existing = await this.db.proposal.findUnique({ where: { id: input.proposalId } });
      if (!existing || existing.ownerId !== user.id) throw new IdentityError('not_found', 404);
      if (existing.state !== 'draft') throw new IdentityError('conflict', 409);
      if (existing.version !== input.version) throw new IdentityError('conflict', 409);
      const updated = await this.db.proposal.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } });
      return this.view(updated);
    }
    const created = await this.db.proposal.create({
      data: { ...data, ownerId: user.id, reference: reference(), state: 'draft' }
    });
    return this.view(created);
  }

  /**
   * PER-16.A02. Sending it to an incubator.
   *
   * The consent is explicit and part of the same act: until the founder agrees to share it, the
   * idea is theirs alone, and an incubator cannot see something merely because it exists.
   */
  async submit(actorId: string, proposalId: string, input: { organizationId: string; sharingConsent: boolean; version: number }) {
    const user = await this.identity.activeUser(actorId);

    return this.db.$transaction(async tx => {
      const proposal = await tx.proposal.findUnique({ where: { id: proposalId } });
      if (!proposal || proposal.ownerId !== user.id) throw new IdentityError('not_found', 404);
      if (proposal.state !== 'draft') throw new IdentityError('conflict', 409);
      if (proposal.version !== input.version) throw new IdentityError('conflict', 409);
      if (!input.sharingConsent) throw new IdentityError('invalid_input', 422);
      // An idea with nothing in it cannot be judged, and sending one wastes the founder's turn.
      if (proposal.summary.trim().length < 50) throw new IdentityError('conflict', 409);

      const organization = await tx.organization.findUnique({ where: { id: input.organizationId } });
      if (!organization || organization.status !== 'active') throw new IdentityError('not_found', 404);
      // 07: an incubator taking ideas is a verified organisation, for the same reason an employer is.
      if (organization.verification !== 'verified') throw new IdentityError('conflict', 409);

      const updated = await tx.proposal.update({
        where: { id: proposal.id },
        data: {
          organizationId: organization.id, sharingConsent: true, state: 'submitted',
          submittedAt: new Date(), version: { increment: 1 }
        }
      });
      await tx.outboxEvent.create({ data: { topic: 'proposal.submitted', payload: { proposalId } } });
      return {
        ...this.view(updated),
        /** 07: submitting an idea costs the founder no share of it. */
        equityTaken: 0 as const,
        platformTakesNoStake: true as const
      };
    });
  }

  async withdraw(actorId: string, proposalId: string, input: { reason: string; version: number }) {
    const user = await this.identity.activeUser(actorId);
    const reason = text(input.reason, 10, 1000);
    const proposal = await this.db.proposal.findUnique({ where: { id: proposalId } });
    if (!proposal || proposal.ownerId !== user.id) throw new IdentityError('not_found', 404);
    if (!['draft', 'submitted', 'review'].includes(proposal.state)) throw new IdentityError('conflict', 409);
    if (proposal.version !== input.version) throw new IdentityError('conflict', 409);
    const updated = await this.db.proposal.update({
      where: { id: proposal.id }, data: { state: 'withdrawn', stateReason: reason, version: { increment: 1 } }
    });
    return this.view(updated);
  }

  /** PER-16. The founder's own ideas, with everything that has happened to them. */
  async mine(actorId: string) {
    const user = await this.identity.activeUser(actorId);
    const rows = await this.db.proposal.findMany({
      where: { ownerId: user.id },
      include: {
        organization: { select: { id: true, slug: true, displayName: true } },
        startupOrg: { select: { id: true, slug: true, displayName: true } },
        decisions: { orderBy: { createdAt: 'desc' }, take: 1 },
        mentors: { where: { endedAt: null }, include: { mentor: { select: { name: true } } } },
        agreements: { orderBy: { sequence: 'desc' } },
        milestones: { orderBy: { sequence: 'asc' } }
      },
      orderBy: { createdAt: 'desc' }
    });
    return rows.map(row => ({
      ...this.view(row),
      incubator: row.organization,
      startup: row.startupOrg,
      latestDecision: row.decisions[0] ? { outcome: row.decisions[0].outcome, reason: row.decisions[0].reason, at: row.decisions[0].createdAt } : null,
      mentors: row.mentors.map(assignment => ({ name: assignment.mentor.name, note: assignment.note, since: assignment.createdAt })),
      agreements: row.agreements.map(agreement => this.agreementView(agreement)),
      milestones: row.milestones.map(milestone => this.milestoneView(milestone))
    }));
  }

  /**
   * PER-16.A03. The founder accepting incubation terms.
   *
   * Accepting names the checksum of the text they read. It creates no company, transfers no share,
   * and moves no money: the grant it describes is paid, if at all, through the ordinary approval
   * chain with its own controls.
   */
  async acceptAgreement(actorId: string, agreementId: string, input: { checksum: string; version: number }) {
    const user = await this.identity.activeUser(actorId);
    const acknowledged = text(input.checksum, 64, 64);

    return this.db.$transaction(async tx => {
      const agreement = await tx.incubationAgreement.findUnique({ where: { id: agreementId }, include: { proposal: true } });
      if (!agreement || agreement.proposal.ownerId !== user.id) throw new IdentityError('not_found', 404);
      if (agreement.state !== 'offered') throw new IdentityError('conflict', 409);
      if (agreement.version !== input.version) throw new IdentityError('conflict', 409);
      if (agreement.checksum !== acknowledged) throw new IdentityError('conflict', 409);

      const accepted = await tx.incubationAgreement.update({
        where: { id: agreement.id }, data: { state: 'accepted', respondedAt: new Date(), version: { increment: 1 } }
      });
      const proposal = await tx.proposal.update({
        where: { id: agreement.proposalId }, data: { state: 'active', version: { increment: 1 } }
      });
      await tx.outboxEvent.create({ data: { topic: 'incubation_agreement.accepted', payload: { agreementId } } });

      return {
        agreement: this.agreementView(accepted),
        proposal: this.view(proposal),
        /** The three things an acceptance does not do, said where somebody might assume it does. */
        grantsEquity: false as const,
        createsOrganization: false as const,
        moneyMoved: false as const
      };
    });
  }

  async declineAgreement(actorId: string, agreementId: string, input: { reason: string; version: number }) {
    const user = await this.identity.activeUser(actorId);
    const reason = text(input.reason, 10, 1000);
    const agreement = await this.db.incubationAgreement.findUnique({ where: { id: agreementId }, include: { proposal: true } });
    if (!agreement || agreement.proposal.ownerId !== user.id) throw new IdentityError('not_found', 404);
    if (agreement.state !== 'offered') throw new IdentityError('conflict', 409);
    if (agreement.version !== input.version) throw new IdentityError('conflict', 409);
    const updated = await this.db.incubationAgreement.update({
      where: { id: agreement.id },
      data: { state: 'declined', declineReason: reason, respondedAt: new Date(), version: { increment: 1 } }
    });
    return this.agreementView(updated);
  }

  /** PER-16.A04. Evidence for a milestone, from the person doing the work. */
  async submitMilestoneEvidence(actorId: string, milestoneId: string, input: {
    evidenceRef: string; evidenceNote?: string | undefined; version: number;
  }) {
    const user = await this.identity.activeUser(actorId);
    const evidenceRef = text(input.evidenceRef, 3, 200);
    const milestone = await this.db.incubationMilestone.findUnique({ where: { id: milestoneId }, include: { proposal: true } });
    if (!milestone || milestone.proposal.ownerId !== user.id) throw new IdentityError('not_found', 404);
    if (milestone.proposal.state !== 'active') throw new IdentityError('conflict', 409);
    if (!['planned', 'changes_requested'].includes(milestone.state)) throw new IdentityError('conflict', 409);
    if (milestone.version !== input.version) throw new IdentityError('conflict', 409);
    const updated = await this.db.incubationMilestone.update({
      where: { id: milestone.id },
      data: {
        state: 'evidence_submitted', evidenceRef,
        evidenceNote: optionalText(input.evidenceNote, 4000),
        submittedAt: new Date(), version: { increment: 1 }
      }
    });
    return this.milestoneView(updated);
  }

  /**
   * PER-16.A05, the server's half.
   *
   * The founder creates the company themselves through the ordinary organisation form; this only
   * records which idea it came out of, once it exists. It copies no identity, grants nobody a
   * share, and refuses a company the founder does not own.
   */
  async linkStartup(actorId: string, proposalId: string, input: { organizationId: string; version: number }) {
    const user = await this.identity.activeUser(actorId);

    return this.db.$transaction(async tx => {
      const proposal = await tx.proposal.findUnique({ where: { id: proposalId } });
      if (!proposal || proposal.ownerId !== user.id) throw new IdentityError('not_found', 404);
      if (!['active', 'accepted'].includes(proposal.state)) throw new IdentityError('conflict', 409);
      if (proposal.version !== input.version) throw new IdentityError('conflict', 409);
      if (proposal.startupOrgId) throw new IdentityError('conflict', 409);

      // The founder must actually run the company. Linking somebody else's organisation to your
      // idea would attach their record to your history.
      const membership = await tx.membership.findUnique({
        where: { userId_organizationId: { userId: user.id, organizationId: input.organizationId } }
      });
      if (!membership || membership.status !== 'active' || !membership.roles.includes('Owner')) throw new IdentityError('forbidden', 403);

      const updated = await tx.proposal.update({
        where: { id: proposal.id }, data: { startupOrgId: input.organizationId, version: { increment: 1 } }
      });
      return {
        ...this.view(updated),
        startupOrgId: input.organizationId,
        /** LOOP-INC's two prohibitions, stated at the moment they would be violated. */
        sharesIssued: 0 as const,
        incubatorHoldsNoStake: true as const,
        note: 'company_created_by_the_founder'
      };
    });
  }

  // ---------------------------------------------------------------- PRG-10: the incubator

  /** The incubator's pipeline. A mentor sees only what they were assigned. */
  async listForOrganization(actorId: string, organizationId: string, filters: { state?: string | undefined }) {
    const membership = await this.identity.access(actorId, organizationId, 'program.read');
    const canSeeAll = membership.roles.includes('ProgramManager') || membership.roles.includes('Owner') || membership.roles.includes('OrgAdmin');
    const rows = await this.db.proposal.findMany({
      where: {
        organizationId,
        state: filters.state ? (filters.state as 'submitted') : { not: 'draft' },
        // 08: a mentor's reach is their assignments, not the incubator's whole pipeline.
        ...(canSeeAll ? {} : { mentors: { some: { mentorId: membership.user.id, endedAt: null } } })
      },
      include: {
        owner: { select: { id: true, name: true } },
        mentors: { where: { endedAt: null }, include: { mentor: { select: { id: true, name: true } } } },
        agreements: { orderBy: { sequence: 'desc' }, take: 1 },
        milestones: { select: { state: true } },
        decisions: { orderBy: { createdAt: 'desc' }, take: 1 }
      },
      orderBy: { submittedAt: 'asc' },
      take: 200
    });
    return rows.map(row => ({
      ...this.view(row),
      founder: { id: row.owner.id, name: row.owner.name },
      mentors: row.mentors.map(assignment => ({ id: assignment.mentor.id, name: assignment.mentor.name })),
      latestAgreement: row.agreements[0] ? this.agreementView(row.agreements[0]) : null,
      milestonesApproved: row.milestones.filter(milestone => milestone.state === 'approved').length,
      milestonesTotal: row.milestones.length,
      latestDecision: row.decisions[0] ? { outcome: row.decisions[0].outcome, reason: row.decisions[0].reason, at: row.decisions[0].createdAt } : null,
      /** Said on every row of an incubator's pipeline, because it is the assumption 07 forbids. */
      incubatorHoldsNoStake: true as const
    }));
  }

  async get(actorId: string, organizationId: string, proposalId: string) {
    const membership = await this.identity.access(actorId, organizationId, 'program.read');
    const canSeeAll = membership.roles.includes('ProgramManager') || membership.roles.includes('Owner') || membership.roles.includes('OrgAdmin');
    const proposal = await this.db.proposal.findFirst({
      where: {
        id: proposalId, organizationId, state: { not: 'draft' },
        ...(canSeeAll ? {} : { mentors: { some: { mentorId: membership.user.id, endedAt: null } } })
      },
      include: {
        owner: { select: { id: true, name: true } },
        mentors: { include: { mentor: { select: { id: true, name: true } } } },
        agreements: { orderBy: { sequence: 'desc' } },
        milestones: { orderBy: { sequence: 'asc' }, include: { decisions: { orderBy: { createdAt: 'desc' }, take: 1 } } },
        decisions: { orderBy: { createdAt: 'desc' } },
        startupOrg: { select: { id: true, slug: true, displayName: true } }
      }
    });
    if (!proposal) throw new IdentityError('not_found', 404);
    return {
      ...this.view(proposal),
      founder: { id: proposal.owner.id, name: proposal.owner.name },
      summary: proposal.summary,
      problem: proposal.problem,
      supportSought: proposal.supportSought,
      mentors: proposal.mentors.map(assignment => ({
        id: assignment.id, mentorId: assignment.mentor.id, name: assignment.mentor.name,
        note: assignment.note, since: assignment.createdAt, endedAt: assignment.endedAt
      })),
      agreements: proposal.agreements.map(agreement => this.agreementView(agreement)),
      milestones: proposal.milestones.map(milestone => ({
        ...this.milestoneView(milestone),
        latestDecision: milestone.decisions[0]
          ? { outcome: milestone.decisions[0].outcome, reason: milestone.decisions[0].reason, at: milestone.decisions[0].createdAt }
          : null
      })),
      decisions: proposal.decisions.map(decision => ({ outcome: decision.outcome, reason: decision.reason, criteria: decision.criteria, at: decision.createdAt })),
      startup: proposal.startupOrg,
      /** The reader is told which of the two they are, so no screen infers it from a role name. */
      canDecide: canSeeAll,
      decisionUnavailableReason: canSeeAll ? '' : 'mentors_comment_but_do_not_decide'
    };
  }

  /** PRG-10.A01. Accepting or refusing an idea, with the criteria it was judged against. */
  async decide(actorId: string, organizationId: string, proposalId: string, input: {
    outcome: 'accepted' | 'rejected'; reason: string; criteria?: string | undefined; version: number;
  }) {
    const membership = await this.identity.access(actorId, organizationId, 'proposal.review');
    const reason = text(input.reason, 10, 2000);
    if (!['accepted', 'rejected'].includes(input.outcome)) throw new IdentityError('invalid_input', 422);

    return this.db.$transaction(async tx => {
      const proposal = await tx.proposal.findFirst({ where: { id: proposalId, organizationId } });
      if (!proposal) throw new IdentityError('not_found', 404);
      if (!['submitted', 'review'].includes(proposal.state)) throw new IdentityError('conflict', 409);
      if (proposal.version !== input.version) throw new IdentityError('conflict', 409);

      await tx.proposalDecision.create({
        data: { proposalId, reviewerId: membership.user.id, outcome: input.outcome, reason, criteria: optionalText(input.criteria, 2000) }
      });
      const updated = await tx.proposal.update({
        where: { id: proposal.id },
        data: { state: input.outcome, decidedAt: new Date(), version: { increment: 1 } }
      });
      await tx.outboxEvent.create({ data: { topic: 'proposal.decided', payload: { proposalId, outcome: input.outcome } } });
      return {
        ...this.view(updated),
        /** Accepting an idea is accepting to work on it, not acquiring part of it. */
        equityTaken: 0 as const,
        incubatorHoldsNoStake: true as const
      };
    });
  }

  /** PRG-10.A02. Assigning a mentor, which is what gives them any reach at all. */
  async assignMentor(actorId: string, organizationId: string, proposalId: string, input: { mentorId: string; note?: string | undefined }) {
    await this.identity.access(actorId, organizationId, 'program.manage');

    return this.db.$transaction(async tx => {
      const proposal = await tx.proposal.findFirst({ where: { id: proposalId, organizationId } });
      if (!proposal) throw new IdentityError('not_found', 404);
      if (!['accepted', 'active', 'review'].includes(proposal.state)) throw new IdentityError('conflict', 409);
      // A mentor is a member of this incubator. Somebody outside it has no standing here.
      const membership = await tx.membership.findUnique({
        where: { userId_organizationId: { userId: input.mentorId, organizationId } }
      });
      if (!membership || membership.status !== 'active') throw new IdentityError('not_found', 404);

      const existing = await tx.mentorAssignment.findUnique({ where: { proposalId_mentorId: { proposalId, mentorId: input.mentorId } } });
      if (existing && !existing.endedAt) throw new IdentityError('conflict', 409);
      const assignment = existing
        ? await tx.mentorAssignment.update({ where: { id: existing.id }, data: { endedAt: null, endReason: '', note: optionalText(input.note, 1000) } })
        : await tx.mentorAssignment.create({ data: { proposalId, mentorId: input.mentorId, assignedBy: actorId, note: optionalText(input.note, 1000) } });

      return {
        id: assignment.id,
        proposalId,
        mentorId: assignment.mentorId,
        note: assignment.note,
        createdAt: assignment.createdAt,
        /** What the assignment actually grants, said plainly: reach, not authority. */
        grantsDecisionRights: false as const,
        scope: 'this_proposal_only'
      };
    });
  }

  async endMentorAssignment(actorId: string, organizationId: string, assignmentId: string, input: { reason: string }) {
    await this.identity.access(actorId, organizationId, 'program.manage');
    const reason = text(input.reason, 10, 1000);
    const assignment = await this.db.mentorAssignment.findFirst({ where: { id: assignmentId, proposal: { organizationId } } });
    if (!assignment || assignment.endedAt) throw new IdentityError('not_found', 404);
    const updated = await this.db.mentorAssignment.update({ where: { id: assignment.id }, data: { endedAt: new Date(), endReason: reason } });
    // The reach goes with the assignment, immediately: the same rule PART-10 applies to a trainer.
    return { id: updated.id, endedAt: updated.endedAt, accessRevoked: true as const };
  }

  /**
   * PRG-10.A03. Proposing incubation terms.
   *
   * Rights, money and limits are each required fields. 07 names the IP terms specifically, because
   * leaving them unsaid is how founders lose what they built.
   */
  async proposeAgreement(actorId: string, organizationId: string, proposalId: string, input: {
    title: string; terms: string; ipTerms: string; responsibilities?: string | undefined;
    grantMinor?: string | null | undefined; currency?: string | null | undefined;
    grantConditions?: string | undefined; durationMonths?: number | null | undefined;
  }) {
    await this.identity.access(actorId, organizationId, 'agreement.manage');
    const title = text(input.title, 4, 200);
    const terms = text(input.terms, 20, 8000);
    const ipTerms = text(input.ipTerms, 20, 4000);
    const grantMinor = input.grantMinor ? parseMinor(input.grantMinor) : null;
    const currency = grantMinor === null ? null : parseCurrency(String(input.currency ?? ''));
    const durationMonths = input.durationMonths === undefined || input.durationMonths === null ? null : Number(input.durationMonths);
    if (durationMonths !== null && (!Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > 120)) throw new IdentityError('invalid_input', 422);

    return this.db.$transaction(async tx => {
      const proposal = await tx.proposal.findFirst({ where: { id: proposalId, organizationId } });
      if (!proposal) throw new IdentityError('not_found', 404);
      if (!['accepted', 'active'].includes(proposal.state)) throw new IdentityError('conflict', 409);

      const previous = await tx.incubationAgreement.aggregate({ where: { proposalId }, _max: { sequence: true } });
      const shape = { title, terms, ipTerms, grantMinor, currency, durationMonths };
      const agreement = await tx.incubationAgreement.create({
        data: {
          proposalId,
          sequence: (previous._max.sequence ?? 0) + 1,
          ...shape,
          responsibilities: optionalText(input.responsibilities, 4000),
          grantConditions: optionalText(input.grantConditions, 2000),
          grantsEquity: false,
          checksum: checksumOf(shape),
          state: 'draft',
          createdBy: actorId
        }
      });
      return this.agreementView(agreement);
    });
  }

  /** Sending the terms to the founder. From here the text is frozen by a trigger. */
  async offerAgreement(actorId: string, organizationId: string, agreementId: string, version: number) {
    await this.identity.access(actorId, organizationId, 'agreement.manage');
    return this.db.$transaction(async tx => {
      const agreement = await tx.incubationAgreement.findFirst({ where: { id: agreementId, proposal: { organizationId } } });
      if (!agreement) throw new IdentityError('not_found', 404);
      if (agreement.state !== 'draft') throw new IdentityError('conflict', 409);
      if (agreement.version !== version) throw new IdentityError('conflict', 409);
      const offered = await tx.incubationAgreement.update({
        where: { id: agreement.id }, data: { state: 'offered', offeredAt: new Date(), version: { increment: 1 } }
      });
      await tx.outboxEvent.create({ data: { topic: 'incubation_agreement.offered', payload: { agreementId } } });
      return this.agreementView(offered);
    });
  }

  async addMilestone(actorId: string, organizationId: string, proposalId: string, input: {
    title: string; description?: string | undefined; dueAt: string;
  }) {
    await this.identity.access(actorId, organizationId, 'program.manage');
    const title = text(input.title, 4, 200);
    const dueAt = plainDate(input.dueAt);

    return this.db.$transaction(async tx => {
      const proposal = await tx.proposal.findFirst({ where: { id: proposalId, organizationId } });
      if (!proposal) throw new IdentityError('not_found', 404);
      if (!['accepted', 'active'].includes(proposal.state)) throw new IdentityError('conflict', 409);
      const previous = await tx.incubationMilestone.aggregate({ where: { proposalId }, _max: { sequence: true } });
      const milestone = await tx.incubationMilestone.create({
        data: { proposalId, sequence: (previous._max.sequence ?? 0) + 1, title, description: optionalText(input.description, 2000), dueAt }
      });
      return this.milestoneView(milestone);
    });
  }

  /** PRG-10.A04. Judging a milestone against its evidence. It releases no money. */
  async decideMilestone(actorId: string, organizationId: string, milestoneId: string, input: {
    outcome: 'approved' | 'changes_requested'; reason: string; evidenceRef?: string | undefined; version: number;
  }) {
    const membership = await this.identity.access(actorId, organizationId, 'proposal.review');
    const reason = text(input.reason, 10, 2000);
    if (!['approved', 'changes_requested'].includes(input.outcome)) throw new IdentityError('invalid_input', 422);

    return this.db.$transaction(async tx => {
      const milestone = await tx.incubationMilestone.findFirst({ where: { id: milestoneId, proposal: { organizationId } } });
      if (!milestone) throw new IdentityError('not_found', 404);
      // Evidence first. Approving a milestone nobody has evidenced approves nothing.
      if (milestone.state !== 'evidence_submitted') throw new IdentityError('conflict', 409);
      if (milestone.version !== input.version) throw new IdentityError('conflict', 409);

      await tx.incubationMilestoneDecision.create({
        data: { milestoneId, reviewerId: membership.user.id, outcome: input.outcome, reason, evidenceRef: optionalText(input.evidenceRef, 200) }
      });
      const updated = await tx.incubationMilestone.update({
        where: { id: milestone.id }, data: { state: input.outcome, decidedAt: new Date(), version: { increment: 1 } }
      });
      return { ...this.milestoneView(updated), releasedFunds: false as const };
    });
  }

  /**
   * PRG-10.A05. Closing an incubation.
   *
   * 07 requires an outcome, what was spent and what happens next. A close with none of those is the
   * "pending item nobody owns" that 22's close definition exists to prevent.
   */
  async close(actorId: string, organizationId: string, proposalId: string, input: {
    outcome: 'graduated' | 'company_created' | 'employment' | 'ended'; note: string; version: number;
  }) {
    await this.identity.access(actorId, organizationId, 'program.manage');
    const note = text(input.note, 20, 2000);
    if (!['graduated', 'company_created', 'employment', 'ended'].includes(input.outcome)) throw new IdentityError('invalid_input', 422);

    return this.db.$transaction(async tx => {
      const proposal = await tx.proposal.findFirst({ where: { id: proposalId, organizationId } });
      if (!proposal) throw new IdentityError('not_found', 404);
      if (!['active', 'accepted'].includes(proposal.state)) throw new IdentityError('conflict', 409);
      if (proposal.version !== input.version) throw new IdentityError('conflict', 409);

      const openMilestones = await tx.incubationMilestone.count({ where: { proposalId, state: { in: ['planned', 'evidence_submitted'] } } });
      const updated = await tx.proposal.update({
        where: { id: proposal.id },
        data: { state: 'closed', closeOutcome: input.outcome, closeNote: note, closedAt: new Date(), version: { increment: 1 } }
      });
      return {
        ...this.view(updated),
        /** Named rather than silently dropped: 22 forbids leaving an item without an owner. */
        milestonesLeftOpen: openMilestones,
        sharesIssued: 0 as const
      };
    });
  }

  // ---------------------------------------------------------------- shaping

  private view(proposal: {
    id: string; reference: string; title: string; state: string; stateReason: string;
    stage: string; sector: string; city: string; sharingConsent: boolean;
    submittedAt: Date | null; decidedAt: Date | null; closedAt: Date | null;
    closeOutcome: string; closeNote: string; startupOrgId: string | null;
    version: number; createdAt: Date;
  }) {
    return {
      id: proposal.id,
      reference: proposal.reference,
      title: proposal.title,
      state: proposal.state,
      stateReason: proposal.stateReason,
      stage: proposal.stage,
      sector: proposal.sector,
      city: proposal.city,
      sharingConsent: proposal.sharingConsent,
      submittedAt: proposal.submittedAt,
      decidedAt: proposal.decidedAt,
      closedAt: proposal.closedAt,
      closeOutcome: proposal.closeOutcome,
      closeNote: proposal.closeNote,
      startupOrgId: proposal.startupOrgId,
      version: proposal.version,
      createdAt: proposal.createdAt
    };
  }

  private agreementView(agreement: {
    id: string; proposalId: string; sequence: number; title: string; terms: string; ipTerms: string;
    responsibilities: string; grantMinor: bigint | null; currency: string | null;
    grantConditions: string; durationMonths: number | null; checksum: string; state: string;
    declineReason: string; offeredAt: Date | null; respondedAt: Date | null; version: number;
  }) {
    return {
      id: agreement.id,
      proposalId: agreement.proposalId,
      sequence: agreement.sequence,
      title: agreement.title,
      terms: agreement.terms,
      /** Required, and shown, because an unstated IP term is how a founder loses their work. */
      ipTerms: agreement.ipTerms,
      responsibilities: agreement.responsibilities,
      grantMinor: agreement.grantMinor === null ? null : minorToString(agreement.grantMinor),
      currency: agreement.currency,
      grantConditions: agreement.grantConditions,
      durationMonths: agreement.durationMonths,
      checksum: agreement.checksum,
      state: agreement.state,
      declineReason: agreement.declineReason,
      offeredAt: agreement.offeredAt,
      respondedAt: agreement.respondedAt,
      version: agreement.version,
      /** On every projection: the grant buys no part of the company. */
      grantsEquity: false as const,
      equityPercent: 0 as const
    };
  }

  private milestoneView(milestone: {
    id: string; proposalId: string; sequence: number; title: string; description: string;
    dueAt: Date; state: string; evidenceRef: string; evidenceNote: string;
    submittedAt: Date | null; decidedAt: Date | null; version: number;
  }) {
    return {
      id: milestone.id,
      proposalId: milestone.proposalId,
      sequence: milestone.sequence,
      title: milestone.title,
      description: milestone.description,
      dueAt: milestone.dueAt,
      state: milestone.state,
      evidenceRef: milestone.evidenceRef,
      evidenceNote: milestone.evidenceNote,
      submittedAt: milestone.submittedAt,
      decidedAt: milestone.decidedAt,
      version: milestone.version
    };
  }
}
