import type { DatabaseClient, Placement } from '@tamkeen/database';
import { IdentityError } from '../identity/policy.js';
import { IdentityService } from '../identity/identity.service.js';

/**
 * Placements: confirmed starts, follow-ups, disputes and the impact figures (07, 14, PRG-09, PER-14).
 *
 * Two rules shape everything here, and both exist because the easy version of this module would
 * flatter the platform:
 *
 *  - **JOB-01.** A start is an event somebody confirms, not a date somebody proposed. `started`
 *    requires an actual date agreed by both sides, or a reviewer's decision against evidence.
 *  - **JOB-02.** Silence is `unknown`. A checkpoint nobody answered is not a person still working;
 *    14 requires `unknown` reported as its own figure rather than folded into either column.
 *
 * Every follow-up is dated from the **actual** start date. Dating them from the offer would make a
 * placement that began a month late look retained a month before anybody checked.
 */

const CHECKPOINTS = [30, 90] as const;
const DAY = 86_400_000;

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

const dayKey = (date: Date) => date.toISOString().slice(0, 10);

export class PlacementsService {
  private readonly identity: IdentityService;
  constructor(private readonly db: DatabaseClient) {
    this.identity = new IdentityService(db);
  }

  // ---------------------------------------------------------------- confirming a start

  /**
   * PER-14.A03 (candidate) and PRG-08.A04 (employer). One party's statement that work began.
   *
   * One statement is a claim. The placement only moves to `started` when both sides have said so
   * **and named the same day**, or when a reviewer records a decision against evidence. Two
   * different dates is a disagreement, and it is recorded as one rather than resolved by whoever
   * wrote last.
   */
  async confirmStart(actorId: string, placementId: string, input: { startDate: string; evidenceRef?: string | undefined; asEmployer?: boolean | undefined }) {
    const user = await this.identity.activeUser(actorId);
    const startDate = plainDate(input.startDate);
    const evidenceRef = optionalText(input.evidenceRef, 200);
    // A start in the future has not happened yet, whoever says it has.
    if (startDate.getTime() > Date.now()) throw new IdentityError('invalid_input', 422);

    return this.db.$transaction(async tx => {
      const placement = await tx.placement.findUnique({ where: { id: placementId }, include: { job: true } });
      if (!placement) throw new IdentityError('not_found', 404);

      let party: 'employer' | 'candidate';
      if (placement.userId === user.id && !input.asEmployer) {
        party = 'candidate';
      } else {
        // The employer side is a permission on the organisation that owns the job, re-checked here
        // rather than inherited from whatever page the request came from.
        await this.identity.access(user.id, placement.job.organizationId, 'placement.verify');
        party = 'employer';
      }

      if (!['start_pending', 'disputed'].includes(placement.state)) throw new IdentityError('conflict', 409);
      const already = await tx.placementStartConfirmation.findUnique({ where: { placementId_party: { placementId, party } } });
      // Confirmations are append-only. A party gets one statement; changing it is a dispute.
      if (already) throw new IdentityError('conflict', 409);

      await tx.placementStartConfirmation.create({ data: { placementId, party, startDate, evidenceRef, confirmedBy: user.id } });
      const confirmations = await tx.placementStartConfirmation.findMany({ where: { placementId } });
      const employer = confirmations.find(row => row.party === 'employer');
      const candidate = confirmations.find(row => row.party === 'candidate');

      if (!employer || !candidate) {
        return {
          ...this.placementView(placement),
          confirmedBy: confirmations.map(row => row.party),
          /** Said plainly: one side has spoken, and that is not a start. */
          started: false as const,
          awaiting: employer ? 'candidate' : 'employer',
          reason: 'one_party_only'
        };
      }

      if (dayKey(employer.startDate) !== dayKey(candidate.startDate)) {
        const disputed = await tx.placement.update({
          where: { id: placement.id },
          data: {
            state: 'disputed',
            disputeReason: `the two sides gave different start dates: ${dayKey(employer.startDate)} and ${dayKey(candidate.startDate)}`,
            version: { increment: 1 }
          }
        });
        await tx.outboxEvent.create({ data: { topic: 'placement.start_disputed', payload: { placementId } } });
        return { ...this.placementView(disputed), confirmedBy: ['employer', 'candidate'], started: false as const, awaiting: 'review', reason: 'dates_disagree' };
      }

      const started = await this.markStarted(tx as DatabaseClient, placement.id, employer.startDate);
      return { ...this.placementView(started), confirmedBy: ['employer', 'candidate'], started: true as const, awaiting: '', reason: '' };
    });
  }

  /**
   * Writing the start, and the checkpoints that follow from it.
   *
   * The 30- and 90-day rows are created here, dated from the actual start date, and they are
   * created as `unknown`: they are questions that are due, not outcomes that happened.
   */
  private async markStarted(tx: DatabaseClient, placementId: string, startDate: Date) {
    const placement = await tx.placement.update({
      where: { id: placementId },
      data: { state: 'started', actualStartDate: startDate, startVerifiedAt: new Date(), disputeReason: '', version: { increment: 1 } }
    });
    for (const dayOffset of CHECKPOINTS) {
      await tx.placementFollowup.upsert({
        where: { placementId_dayOffset: { placementId, dayOffset } },
        // Re-dated if a review corrected the start date, because a checkpoint counted from the
        // wrong day is the bug this whole module exists to avoid.
        update: { dueAt: new Date(startDate.getTime() + dayOffset * DAY) },
        create: { placementId, dayOffset, dueAt: new Date(startDate.getTime() + dayOffset * DAY), result: 'unknown' }
      });
    }
    await tx.outboxEvent.create({ data: { topic: 'placement.started', payload: { placementId, startDate: dayKey(startDate) } } });
    return placement;
  }

  // ---------------------------------------------------------------- follow-ups

  /**
   * PRG-09.A01. Asking the question.
   *
   * It sends a request and writes nothing to the result. This is the action most likely to be
   * quietly turned into an outcome, so it is separated from recording one entirely.
   */
  async requestFollowup(actorId: string, placementId: string, dayOffset: number) {
    const placement = await this.db.placement.findUnique({ where: { id: placementId }, include: { job: true } });
    if (!placement) throw new IdentityError('not_found', 404);
    await this.identity.access(actorId, placement.job.organizationId, 'placement.verify');
    if (!CHECKPOINTS.includes(dayOffset as typeof CHECKPOINTS[number])) throw new IdentityError('invalid_input', 422);
    if (!['started', 'retained'].includes(placement.state)) throw new IdentityError('conflict', 409);

    const followup = await this.db.placementFollowup.findUnique({ where: { placementId_dayOffset: { placementId, dayOffset } } });
    if (!followup) throw new IdentityError('not_found', 404);
    if (followup.dueAt.getTime() > Date.now()) throw new IdentityError('conflict', 409);
    if (followup.recordedAt) throw new IdentityError('conflict', 409);

    await this.db.outboxEvent.create({ data: { topic: 'placement.followup_requested', payload: { placementId, dayOffset } } });
    return {
      placementId,
      dayOffset,
      dueAt: followup.dueAt,
      requested: true as const,
      /** Asking is not answering. The row stays `unknown` until somebody actually replies. */
      result: followup.result,
      resultRecorded: false as const
    };
  }

  /**
   * PRG-09.A02 (operator) and PER-14.A04 (the person themselves) — **JOB-02**.
   *
   * `unknown` is a permitted, first-class answer and the one a checkpoint keeps if nobody replies.
   * Any other answer has to say where it came from: a CHECK constraint refuses a `working` or
   * `ended` row with no recorder and no source, so silence cannot become success by any path.
   */
  async recordFollowup(actorId: string, placementId: string, input: {
    dayOffset: number; result: 'working' | 'ended' | 'unknown' | 'disputed';
    source?: string | undefined; evidenceRef?: string | undefined; note?: string | undefined;
    selfFound?: boolean | undefined; version: number;
  }) {
    const user = await this.identity.activeUser(actorId);
    if (!CHECKPOINTS.includes(input.dayOffset as typeof CHECKPOINTS[number])) throw new IdentityError('invalid_input', 422);
    if (!['working', 'ended', 'unknown', 'disputed'].includes(input.result)) throw new IdentityError('invalid_input', 422);

    return this.db.$transaction(async tx => {
      const placement = await tx.placement.findUnique({ where: { id: placementId }, include: { job: true } });
      if (!placement) throw new IdentityError('not_found', 404);
      const isCandidate = placement.userId === user.id;
      if (!isCandidate) await this.identity.access(user.id, placement.job.organizationId, 'placement.verify');
      if (!['started', 'retained'].includes(placement.state)) throw new IdentityError('conflict', 409);

      const followup = await tx.placementFollowup.findUnique({ where: { placementId_dayOffset: { placementId, dayOffset: input.dayOffset } } });
      if (!followup) throw new IdentityError('not_found', 404);
      if (followup.version !== input.version) throw new IdentityError('conflict', 409);
      // A checkpoint answered before it is due is an answer to a question nobody asked yet.
      if (followup.dueAt.getTime() > Date.now()) throw new IdentityError('conflict', 409);

      if (input.result === 'unknown') {
        // Recording "nobody replied" leaves the row exactly as it was: unanswered. There is nothing
        // to write, and writing a recorder would make silence look like a source.
        return {
          ...this.followupView(followup),
          placementState: placement.state,
          /** Explicit, because this is the figure 14 wants reported rather than absorbed. */
          countedAsRetained: false as const,
          note: 'no_answer_recorded'
        };
      }

      // Anything other than `unknown` names where the answer came from. Enforced in SQL too.
      const source = text(input.source, 3, 120);
      const recorded = await tx.placementFollowup.update({
        where: { id: followup.id },
        data: {
          result: input.result,
          source,
          evidenceRef: optionalText(input.evidenceRef, 200),
          note: optionalText(input.note, 1000),
          recordedAt: new Date(),
          recordedBy: user.id,
          version: { increment: 1 }
        }
      });

      let state = placement.state;
      if (input.result === 'ended') {
        const updated = await tx.placement.update({
          where: { id: placement.id },
          data: {
            state: 'ended',
            endedAt: new Date(),
            endReason: optionalText(input.note, 1000) || 'reported ended at a follow-up checkpoint',
            // 14: a job the person found themselves is reported separately, never added in.
            selfFound: input.selfFound ?? placement.selfFound,
            version: { increment: 1 }
          }
        });
        state = updated.state;
      } else if (input.result === 'disputed') {
        const updated = await tx.placement.update({
          where: { id: placement.id },
          data: { state: 'disputed', disputeReason: optionalText(input.note, 1000) || 'a follow-up answer was disputed', version: { increment: 1 } }
        });
        state = updated.state;
      } else if (input.result === 'working' && input.dayOffset === 90) {
        // 14 counts retention at ninety days, and only on a recorded answer. Thirty days working is
        // still `started`: it is not yet the thing being measured.
        const updated = await tx.placement.update({ where: { id: placement.id }, data: { state: 'retained', version: { increment: 1 } } });
        state = updated.state;
      }

      return {
        ...this.followupView(recorded),
        placementState: state,
        countedAsRetained: state === 'retained'
      };
    });
  }

  // ---------------------------------------------------------------- disputes and review

  /**
   * PER-14.A05. The person objecting to what was recorded about them.
   *
   * The shared support queue is PART-13, so this is the placement's own objection rather than a
   * ticket: the placement moves to `disputed`, which stops it counting either way until a reviewer
   * settles it.
   */
  async dispute(actorId: string, placementId: string, input: { reason: string; version: number }) {
    const user = await this.identity.activeUser(actorId);
    const reason = text(input.reason, 10, 1000);
    const placement = await this.db.placement.findUnique({ where: { id: placementId } });
    if (!placement || placement.userId !== user.id) throw new IdentityError('not_found', 404);
    if (placement.state === 'disputed') throw new IdentityError('conflict', 409);
    if (placement.version !== input.version) throw new IdentityError('conflict', 409);
    const updated = await this.db.placement.update({
      where: { id: placement.id },
      data: { state: 'disputed', disputeReason: reason, version: { increment: 1 } }
    });
    await this.db.outboxEvent.create({ data: { topic: 'placement.disputed', payload: { placementId } } });
    return { ...this.placementView(updated), awaiting: 'review' };
  }

  /**
   * PRG-09.A03. Settling it.
   *
   * `placement.review` is deliberately not a recruiter's permission: 07 wants the disagreement
   * decided by somebody other than the side that recorded the figure. The decision row is
   * append-only, enforced by a trigger.
   */
  async review(actorId: string, placementId: string, input: {
    outcome: 'confirm_start' | 'reject_start' | 'confirm_end' | 'reinstate';
    reason: string; startDate?: string | undefined; evidenceRef?: string | undefined; version: number;
  }) {
    const reason = text(input.reason, 10, 1000);
    const evidenceRef = optionalText(input.evidenceRef, 200);

    return this.db.$transaction(async tx => {
      const placement = await tx.placement.findUnique({ where: { id: placementId }, include: { job: true } });
      if (!placement) throw new IdentityError('not_found', 404);
      const membership = await this.identity.access(actorId, placement.job.organizationId, 'placement.review');
      if (placement.version !== input.version) throw new IdentityError('conflict', 409);

      // Nobody settles a disagreement about a start they themselves reported.
      const own = await tx.placementStartConfirmation.findFirst({ where: { placementId, confirmedBy: membership.user.id } });
      if (own) throw new IdentityError('forbidden', 403);

      await tx.placementReviewDecision.create({ data: { placementId, reviewerId: membership.user.id, outcome: input.outcome, reason, evidenceRef } });

      // The row with its job attached is wider than the rows the branches produce, so the
      // variable is typed as the placement itself rather than as whatever the first read returned.
      let result: Placement;
      if (input.outcome === 'confirm_start') {
        // A reviewer may only confirm a start against evidence and an actual date. JOB-01 has no
        // exception for an authority figure.
        if (evidenceRef.length < 3) throw new IdentityError('invalid_input', 422);
        const startDate = plainDate(input.startDate);
        if (startDate.getTime() > Date.now()) throw new IdentityError('invalid_input', 422);
        await tx.placementStartConfirmation.upsert({
          where: { placementId_party: { placementId, party: 'reviewer' } },
          update: {},
          create: { placementId, party: 'reviewer', startDate, evidenceRef, confirmedBy: membership.user.id }
        });
        result = await this.markStarted(tx as DatabaseClient, placementId, startDate);
      } else if (input.outcome === 'reject_start') {
        result = await tx.placement.update({
          where: { id: placementId },
          data: { state: 'start_pending', actualStartDate: null, startVerifiedAt: null, disputeReason: '', version: { increment: 1 } }
        });
        // The checkpoints went with the start that was rejected.
        await tx.placementFollowup.deleteMany({ where: { placementId, recordedAt: null } });
      } else if (input.outcome === 'confirm_end') {
        if (!placement.actualStartDate) throw new IdentityError('conflict', 409);
        result = await tx.placement.update({
          where: { id: placementId },
          data: { state: 'ended', endedAt: placement.endedAt ?? new Date(), endReason: reason, disputeReason: '', version: { increment: 1 } }
        });
      } else {
        if (!placement.actualStartDate) throw new IdentityError('conflict', 409);
        result = await tx.placement.update({ where: { id: placementId }, data: { state: 'started', disputeReason: '', endedAt: null, endReason: '', version: { increment: 1 } } });
      }

      return { ...this.placementView(result), decision: { outcome: input.outcome, reason, evidenceRef } };
    });
  }

  // ---------------------------------------------------------------- reads

  /** PER-14. The candidate's own placements. */
  async mine(actorId: string) {
    const user = await this.identity.activeUser(actorId);
    const rows = await this.db.placement.findMany({
      where: { userId: user.id },
      include: {
        job: { select: { slug: true, title: true, city: true, organization: { select: { displayName: true } } } },
        offer: { select: { id: true, sequence: true, title: true, termsChecksum: true, proposedStartDate: true } },
        followups: { orderBy: { dayOffset: 'asc' } },
        confirmations: { select: { party: true, startDate: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    const now = Date.now();
    return rows.map(row => ({
      ...this.placementView(row),
      job: { slug: row.job.slug, title: row.job.title, city: row.job.city, employer: row.job.organization.displayName },
      offer: row.offer,
      confirmedByMe: row.confirmations.some(confirmation => confirmation.party === 'candidate'),
      confirmedByEmployer: row.confirmations.some(confirmation => confirmation.party === 'employer'),
      followups: row.followups.map(followup => ({
        ...this.followupView(followup),
        due: followup.dueAt.getTime() <= now && !followup.recordedAt
      }))
    }));
  }

  /**
   * PRG-09. The operator's list.
   *
   * A candidate's name appears only where they consented to share their profile with the
   * organisation and have not revoked it. Everything else on the row is about the placement, not
   * about the person.
   */
  async listForOrganization(actorId: string, organizationId: string, filters: { state?: string | undefined; dueOnly?: boolean | undefined }) {
    await this.identity.access(actorId, organizationId, 'placement.verify');
    const rows = await this.db.placement.findMany({
      where: { job: { organizationId }, ...(filters.state ? { state: filters.state as 'started' } : {}) },
      include: {
        job: { select: { id: true, slug: true, title: true } },
        user: { select: { name: true, candidateProfile: { select: { shareWithOperators: true } } } },
        offer: { select: { id: true, sequence: true, proposedStartDate: true } },
        followups: { orderBy: { dayOffset: 'asc' } },
        confirmations: { select: { party: true, startDate: true } },
        reviews: { orderBy: { createdAt: 'desc' }, take: 1, select: { outcome: true, reason: true, createdAt: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 200
    });
    const now = Date.now();
    const mapped = rows.map(row => {
      const shared = Boolean(row.user.candidateProfile?.shareWithOperators);
      const followups = row.followups.map(followup => ({ ...this.followupView(followup), due: followup.dueAt.getTime() <= now && !followup.recordedAt }));
      return {
        ...this.placementView(row),
        job: row.job,
        candidateName: shared ? row.user.name : null,
        profileShared: shared,
        profileWithheldReason: shared ? '' : 'consent_revoked',
        confirmedByEmployer: row.confirmations.some(confirmation => confirmation.party === 'employer'),
        confirmedByCandidate: row.confirmations.some(confirmation => confirmation.party === 'candidate'),
        followups,
        followupsDue: followups.filter(followup => followup.due).length,
        latestReview: row.reviews[0] ?? null
      };
    });
    return filters.dueOnly ? mapped.filter(row => row.followupsDue > 0) : mapped;
  }

  /**
   * PRG-09.A04. The impact figures, and what they are a proportion of.
   *
   * 14 requires the denominator to be stated rather than implied, `unknown` reported as its own
   * percentage, and self-found work kept separate. The export carries no names: it is counts.
   */
  async exportSummary(actorId: string, organizationId: string) {
    await this.identity.access(actorId, organizationId, 'report.read');
    const placements = await this.db.placement.findMany({
      where: { job: { organizationId } },
      select: { state: true, selfFound: true, actualStartDate: true, followups: { select: { dayOffset: true, result: true, recordedAt: true } } }
    });

    const count = (predicate: (row: typeof placements[number]) => boolean) => placements.filter(predicate).length;
    const started = placements.filter(row => row.actualStartDate !== null);
    const ninetyDue = started.filter(row => row.actualStartDate !== null && row.actualStartDate.getTime() + 90 * DAY <= Date.now());
    const ninetyAnswered = ninetyDue.filter(row => row.followups.some(followup => followup.dayOffset === 90 && followup.recordedAt !== null));
    const ninetyWorking = ninetyDue.filter(row => row.followups.some(followup => followup.dayOffset === 90 && followup.result === 'working'));

    return {
      generatedAt: new Date(),
      offersAccepted: placements.length,
      /** JOB-01: the started figure counts confirmed starts, and nothing else. */
      startsConfirmed: started.length,
      startsPending: count(row => row.state === 'start_pending'),
      ended: count(row => row.state === 'ended'),
      disputed: count(row => row.state === 'disputed'),
      selfFound: count(row => row.selfFound),
      retention: {
        /** Stated, not implied: placements whose ninetieth day has actually arrived. */
        denominator: ninetyDue.length,
        /**
       * A code, not a sentence. 14 requires the denominator to be stated rather than implied, and
       * the screen states it in the reader's language; sending English prose from here put an
       * English sentence in the middle of an Arabic page.
       */
      denominatorDefinition: 'ninety_days_since_confirmed_start',
        answered: ninetyAnswered.length,
        working: ninetyWorking.length,
        /** JOB-02: the ones nobody answered, reported rather than absorbed into either column. */
        unknown: ninetyDue.length - ninetyAnswered.length
      },
      /** No names, no contact details: 12 keeps beneficiary data out of any exported projection. */
      redacted: true as const,
      containsPersonalData: false as const
    };
  }

  // ---------------------------------------------------------------- shaping

  private placementView(placement: {
    id: string; jobId: string; userId: string; offerId: string; state: string;
    proposedStartDate: Date; actualStartDate: Date | null; startVerifiedAt: Date | null;
    endedAt: Date | null; endReason: string; disputeReason: string; selfFound: boolean;
    version: number; createdAt: Date;
  }) {
    return {
      id: placement.id,
      jobId: placement.jobId,
      offerId: placement.offerId,
      state: placement.state,
      /** What the offer said. Kept next to the actual date so the two can never be confused. */
      proposedStartDate: placement.proposedStartDate,
      actualStartDate: placement.actualStartDate,
      startVerifiedAt: placement.startVerifiedAt,
      endedAt: placement.endedAt,
      endReason: placement.endReason,
      disputeReason: placement.disputeReason,
      selfFound: placement.selfFound,
      version: placement.version,
      createdAt: placement.createdAt,
      /** The two derived facts, computed in one place so no screen has to guess the rule. */
      startConfirmed: placement.actualStartDate !== null && placement.startVerifiedAt !== null,
      countsAsEmployment: placement.state === 'started' || placement.state === 'retained'
    };
  }

  private followupView(followup: {
    id: string; dayOffset: number; dueAt: Date; result: string; source: string;
    evidenceRef: string; note: string; recordedAt: Date | null; version: number;
  }) {
    return {
      id: followup.id,
      dayOffset: followup.dayOffset,
      dueAt: followup.dueAt,
      result: followup.result,
      source: followup.source,
      evidenceRef: followup.evidenceRef,
      note: followup.note,
      recordedAt: followup.recordedAt,
      version: followup.version,
      /** `unknown` with no recorder is a question nobody answered, not an outcome. */
      answered: followup.recordedAt !== null
    };
  }
}
