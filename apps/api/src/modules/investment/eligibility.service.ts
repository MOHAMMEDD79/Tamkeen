import { createHash } from 'node:crypto';
import { Prisma, type DatabaseClient } from '@tamkeen/database';
import { IdentityError } from '../identity/policy.js';
import { IdentityService } from '../identity/identity.service.js';

/**
 * Investor eligibility (PER-07, ADM-04.A02, 06-INVESTMENT-LIFECYCLE).
 *
 * The rule this module exists to enforce, and PART-08's first acceptance criterion:
 * **choosing the Investor capability does not make anyone eligible.** A capability says what a
 * person wants to do. Eligibility is a reviewed decision, by someone else, with a reason and an
 * expiry. The two are stored apart, decided apart, and `isEligible` reads only the second.
 *
 * Nothing here ever infers eligibility from a profile field. If that were possible, a person could
 * grant it to themselves by ticking a box on their own profile, which is exactly the failure the
 * specification names.
 */

/** How long an approval lasts unless the reviewer sets something else. */
const DEFAULT_VALIDITY_DAYS = 365;

const text = (value: unknown, min: number, max: number) => {
  if (typeof value !== 'string') throw new IdentityError('invalid_input', 422);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw new IdentityError('invalid_input', 422);
  return trimmed;
};

/**
 * What a submission has to answer. Deliberately small and declared here rather than free-form, so
 * a reviewer sees the same questions every time and a person knows what is being asked of them.
 */
export interface EligibilityAnswers {
  /** Self-declared category. A claim being reviewed, never a grant. */
  investorType: 'individual' | 'institution';
  /** Whether they have invested in private companies before. */
  hasPriorExperience: boolean;
  /** Their own statement that they can bear a total loss, which 06 requires to be explicit. */
  acknowledgesTotalLossRisk: boolean;
  /** Free text the reviewer reads: source of funds, or anything the person wants considered. */
  declaration: string;
}

export function parseAnswers(value: unknown): EligibilityAnswers {
  if (typeof value !== 'object' || value === null) throw new IdentityError('invalid_input', 422);
  const input = value as Record<string, unknown>;
  if (input.investorType !== 'individual' && input.investorType !== 'institution') throw new IdentityError('invalid_input', 422);
  if (typeof input.hasPriorExperience !== 'boolean') throw new IdentityError('invalid_input', 422);
  if (typeof input.acknowledgesTotalLossRisk !== 'boolean') throw new IdentityError('invalid_input', 422);
  return {
    investorType: input.investorType,
    hasPriorExperience: input.hasPriorExperience,
    acknowledgesTotalLossRisk: input.acknowledgesTotalLossRisk,
    declaration: text(input.declaration, 20, 2000)
  };
}

const answersChecksum = (answers: EligibilityAnswers) =>
  createHash('sha256').update(JSON.stringify([
    answers.investorType, answers.hasPriorExperience, answers.acknowledgesTotalLossRisk, answers.declaration
  ])).digest('hex');

export class EligibilityService {
  private readonly identity: IdentityService;
  constructor(private readonly db: DatabaseClient) {
    this.identity = new IdentityService(db);
  }

  /**
   * Whether this person may invest right now.
   *
   * The only function anything else should ask. It reads a reviewed decision and its expiry, and
   * it does not look at capabilities at all — a person who has ticked "Investor" and never been
   * reviewed gets `false` here, which is the whole point.
   */
  async isEligible(userId: string): Promise<{ eligible: boolean; reason: string; expiresAt: Date | null }> {
    const record = await this.db.investorEligibility.findUnique({ where: { userId } });
    if (!record) return { eligible: false, reason: 'not_started', expiresAt: null };
    if (record.state !== 'approved') return { eligible: false, reason: record.state, expiresAt: record.expiresAt };
    // 06: an approval that has run out stops the person continuing, even mid-way through a purchase.
    if (record.expiresAt && record.expiresAt <= new Date()) return { eligible: false, reason: 'expired', expiresAt: record.expiresAt };
    return { eligible: true, reason: 'approved', expiresAt: record.expiresAt };
  }

  /** PER-07. The person's own record, including what they last submitted. */
  async mine(actorId: string) {
    const user = await this.identity.activeUser(actorId);
    const record = await this.db.investorEligibility.findUnique({
      where: { userId: user.id },
      include: {
        submissions: { orderBy: { sequence: 'desc' }, take: 5 },
        decisions: { orderBy: { createdAt: 'desc' }, take: 5, include: { reviewer: { select: { name: true } } } }
      }
    });
    const profile = await this.db.individualProfile.findUnique({ where: { userId: user.id } });
    const capabilityChosen = (profile?.capabilities ?? []).includes('Investor');

    if (!record) {
      return {
        state: 'not_started', draft: null, expiresAt: null, reason: '', version: 0,
        submissions: [], decisions: [],
        // Both facts, side by side, because they are genuinely different and people conflate them.
        capabilityChosen,
        eligible: false
      };
    }
    const eligibility = await this.isEligible(user.id);
    return {
      state: eligibility.reason === 'expired' ? 'expired' : record.state,
      draft: record.draft,
      expiresAt: record.expiresAt,
      reason: record.reason,
      version: record.version,
      capabilityChosen,
      eligible: eligibility.eligible,
      submissions: record.submissions.map(submission => ({ id: submission.id, sequence: submission.sequence, checksum: submission.checksum, submittedAt: submission.submittedAt })),
      decisions: record.decisions.map(decision => ({ id: decision.id, outcome: decision.outcome, reason: decision.reason, expiresAt: decision.expiresAt, reviewer: decision.reviewer.name, at: decision.createdAt }))
    };
  }

  /** PER-07.A01. A draft saves nothing for review; it is only the person's own working copy. */
  async saveDraft(actorId: string, draft: unknown) {
    const user = await this.identity.activeUser(actorId);
    // Validated even as a draft, so the person finds out now rather than at submission.
    const answers = parseAnswers(draft);
    const record = await this.db.investorEligibility.upsert({
      where: { userId: user.id },
      create: { userId: user.id, state: 'draft', draft: answers as unknown as object },
      update: {
        draft: answers as unknown as object,
        // A draft never moves a submitted or decided record backwards.
        ...(['not_started', 'draft', 'changes_requested'].includes((await this.db.investorEligibility.findUnique({ where: { userId: user.id } }))?.state ?? 'not_started')
          ? { state: 'draft' as const } : {}),
        version: { increment: 1 }
      }
    });
    return { state: record.state, version: record.version, saved: true };
  }

  /** PER-07.A02 and A03. Submitting creates an immutable snapshot for a reviewer to judge. */
  async submit(actorId: string, answersInput: unknown) {
    const user = await this.identity.activeUser(actorId);
    const answers = parseAnswers(answersInput);
    // 06 requires the risk acknowledgement to be explicit; a submission without it is incomplete.
    if (!answers.acknowledgesTotalLossRisk) throw new IdentityError('invalid_input', 422);

    return this.db.$transaction(async tx => {
      const existing = await tx.investorEligibility.findUnique({ where: { userId: user.id } });
      // Resubmitting while a reviewer holds it would change what they are judging.
      if (existing && ['submitted', 'in_review'].includes(existing.state)) throw new IdentityError('conflict', 409);

      const record = existing ?? await tx.investorEligibility.create({ data: { userId: user.id, state: 'not_started' } });
      const last = await tx.investorEligibilitySubmission.findFirst({ where: { eligibilityId: record.id }, orderBy: { sequence: 'desc' } });
      const submission = await tx.investorEligibilitySubmission.create({
        data: {
          eligibilityId: record.id, sequence: (last?.sequence ?? 0) + 1,
          answers: answers as unknown as object, checksum: answersChecksum(answers)
        }
      });
      const updated = await tx.investorEligibility.update({
        where: { id: record.id },
        // The draft is cleared because it has become a submission; Prisma needs JSON null named.
        data: { state: 'submitted', draft: Prisma.JsonNull, reason: '', version: { increment: 1 } }
      });
      await tx.identityAuditEvent.create({ data: { actorId: user.id, resourceId: record.id, action: 'eligibility.submitted' } });
      return { state: updated.state, version: updated.version, submissionId: submission.id, sequence: submission.sequence };
    });
  }

  // ---------------------------------------------------------------- ADM-04.A02: the reviewer

  async queue(actorId: string) {
    await this.identity.riskReviewerUser(actorId);
    const rows = await this.db.investorEligibility.findMany({
      where: { state: { in: ['submitted', 'in_review'] } },
      include: {
        user: { select: { id: true, name: true } },
        submissions: { orderBy: { sequence: 'desc' }, take: 1 }
      },
      orderBy: { updatedAt: 'asc' }, take: 100
    });
    return rows.map(row => ({
      id: row.id, state: row.state, version: row.version,
      // A reviewer needs to know who they are judging; this is the one read where that is the point.
      applicant: row.user.name,
      latestSubmissionId: row.submissions[0]?.id ?? null,
      submittedAt: row.submissions[0]?.submittedAt ?? null
    }));
  }

  /** The full application, with the answers exactly as submitted. */
  async review(actorId: string, eligibilityId: string) {
    await this.identity.riskReviewerUser(actorId);
    const record = await this.db.investorEligibility.findUnique({
      where: { id: eligibilityId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        submissions: { orderBy: { sequence: 'desc' }, take: 1 },
        decisions: { orderBy: { createdAt: 'desc' }, include: { reviewer: { select: { name: true } } } }
      }
    });
    if (!record) throw new IdentityError('not_found', 404);
    const latest = record.submissions[0];
    if (!latest) throw new IdentityError('conflict', 409);
    return {
      id: record.id, state: record.state, version: record.version,
      applicant: { name: record.user.name, email: record.user.email },
      submission: { id: latest.id, sequence: latest.sequence, answers: latest.answers, checksum: latest.checksum, submittedAt: latest.submittedAt },
      decisions: record.decisions.map(decision => ({ id: decision.id, outcome: decision.outcome, reason: decision.reason, expiresAt: decision.expiresAt, reviewer: decision.reviewer.name, at: decision.createdAt }))
    };
  }

  /**
   * ADM-04.A02. The decision, with a reason and — for an approval — an expiry that the database
   * refuses to let be omitted.
   */
  async decide(actorId: string, eligibilityId: string, input: { outcome: 'approved' | 'changes_requested' | 'rejected'; reason: string; validityDays?: number | undefined; version: number }) {
    const reviewer = await this.identity.riskReviewerUser(actorId);
    return this.db.$transaction(async tx => {
      const record = await tx.investorEligibility.findUnique({
        where: { id: eligibilityId },
        include: { submissions: { orderBy: { sequence: 'desc' }, take: 1 } }
      });
      if (!record) throw new IdentityError('not_found', 404);
      if (!['submitted', 'in_review'].includes(record.state)) throw new IdentityError('conflict', 409);
      if (record.version !== input.version) throw new IdentityError('conflict', 409);
      // Nobody reviews their own application, whatever grant they hold.
      if (record.userId === reviewer.id) throw new IdentityError('forbidden', 403);

      const submission = record.submissions[0];
      if (!submission) throw new IdentityError('conflict', 409);

      const reason = input.outcome === 'approved' ? (input.reason ?? '').trim() : text(input.reason, 10, 1000);
      const days = Math.min(Math.max(input.validityDays ?? DEFAULT_VALIDITY_DAYS, 1), 1095);
      const expiresAt = input.outcome === 'approved' ? new Date(Date.now() + days * 86_400_000) : null;

      await tx.eligibilityDecision.create({
        data: { eligibilityId: record.id, submissionId: submission.id, reviewerId: reviewer.id, outcome: input.outcome, reason, expiresAt }
      });
      const state = input.outcome === 'approved' ? 'approved' as const : input.outcome === 'rejected' ? 'rejected' as const : 'changes_requested' as const;
      const updated = await tx.investorEligibility.update({
        where: { id: record.id },
        data: { state, reason, expiresAt, decidedAt: new Date(), version: { increment: 1 } }
      });
      await tx.identityAuditEvent.create({ data: { actorId: reviewer.id, resourceId: record.id, action: `eligibility.${input.outcome}` } });
      return { id: updated.id, state: updated.state, expiresAt: updated.expiresAt, reason: updated.reason, version: updated.version };
    });
  }
}
