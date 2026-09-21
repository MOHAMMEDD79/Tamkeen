import { randomBytes } from 'node:crypto';
import type { DatabaseClient, ProgramState } from '@tamkeen/database';
import { Prisma } from '@tamkeen/database';
import { IdentityError } from '../identity/policy.js';
import { IdentityService } from '../identity/identity.service.js';
import { minorToString, parseCurrency, parseMinor } from '../projects/money.js';

/**
 * Programmes and cohorts (07-INCUBATION-EMPLOYMENT, PRG-01/02, PUB-09/10).
 *
 * What this module is careful about:
 *
 *  - **A promise of work is qualified or it is not made.** 07 is explicit that "10 jobs" must say
 *    whether it is a target or an obligation, on what criteria, and when. `jobCommitmentKind` is a
 *    column and a CHECK constraint rather than a sentence somebody may forget to write.
 *  - **Approving is not publishing.** An independent content reviewer approves the programme; the
 *    operator then decides when applications actually open, exactly as an offering does in 08.
 *  - **Nothing here takes money.** A stipend is declared so a candidate can read it before
 *    applying; paying it is PART-12, and an application fee is refused outright.
 */

const SLUG_MAX = 120;

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

const wholeNumber = (value: unknown, min: number, max: number) => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new IdentityError('invalid_input', 422);
  return value;
};

const slugify = (title: string) => {
  const base = title.toLowerCase().normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, SLUG_MAX - 6);
  // A random suffix, because a slug is public and a guessable sequence leaks how many exist.
  return `${base || 'program'}-${randomBytes(3).toString('hex')}`;
};

const parseDate = (value: unknown, field: string): Date => {
  const parsed = new Date(String(value ?? ''));
  if (Number.isNaN(parsed.getTime())) throw new IdentityError('invalid_input', 422);
  void field;
  return parsed;
};

/** States in which a programme is publicly listed. Anything earlier is absent, not forbidden. */
export const PUBLIC_PROGRAM_STATES: readonly ProgramState[] = ['recruiting', 'selection', 'active', 'completed', 'follow_up'] as const;
/** States in which the operator may still edit the plan. */
const EDITABLE_STATES: readonly ProgramState[] = ['draft'] as const;
/** The only states in which a new application may be started. */
export const APPLYING_STATES: readonly ProgramState[] = ['recruiting'] as const;

export interface ProgramInput {
  title: string;
  summary: string;
  skills?: string[] | undefined;
  level?: string | undefined;
  deliveryMode?: 'in_person' | 'remote' | 'hybrid' | undefined;
  city?: string | undefined;
  capacity: number;
  applyOpensAt?: string | null | undefined;
  applyClosesAt?: string | null | undefined;
  durationWeeks?: number | undefined;
  hoursPerWeek?: number | undefined;
  schedule?: string | undefined;
  attendancePolicy?: string | undefined;
  assessmentPolicy?: string | undefined;
  selectionMethod?: string | undefined;
  withdrawalPolicy?: string | undefined;
  accessibilityNote?: string | undefined;
  privacyNote?: string | undefined;
  complaintsContact?: string | undefined;
  stipendOffered?: boolean | undefined;
  stipendAmountMinor?: string | null | undefined;
  stipendCurrency?: string | null | undefined;
  stipendConditions?: string | undefined;
  jobCommitmentKind?: 'none' | 'expected' | 'committed' | undefined;
  jobCount?: number | undefined;
  jobCommitmentTerms?: string | undefined;
  minimumAge?: number | null | undefined;
  maximumAge?: number | null | undefined;
  educationRequirement?: string | undefined;
}

/**
 * What counts as a seat being held.
 *
 * A confirmed member holds one, and so does an invitation that has not run out — that is the whole
 * point of the acceptance window. A lapsed invitation holds nothing, which is why a seat returns to
 * the waitlist without a job having to run.
 *
 * Exported because every count of seats in the product must mean the same thing: the public page
 * that tells a candidate how many are left, the operator screen that decides whether an acceptance
 * is possible, and the trigger in SQL all use this one rule.
 */
export const seatHoldingStates = (): { OR: Prisma.EnrollmentWhereInput[] } => ({
  OR: [
    { state: { in: ['confirmed', 'active', 'completed'] } },
    { state: 'invited', invitationExpiresAt: { gt: new Date() } }
  ]
});

export class ProgramsService {
  private readonly identity: IdentityService;
  constructor(private readonly db: DatabaseClient) {
    this.identity = new IdentityService(db);
  }

  // ---------------------------------------------------------------- PRG-02: the editor

  /** PRG-02.A01 (create). A draft programme, which is not public and accepts nothing. */
  async create(actorId: string, organizationId: string, input: ProgramInput) {
    await this.identity.access(actorId, organizationId, 'program.manage');
    const parsed = this.parseInput(input);

    return this.db.$transaction(async tx => {
      const organization = await tx.organization.findUniqueOrThrow({ where: { id: organizationId } });
      // 07: a programme raises money and takes applications from the public, so the operator has to
      // be a verified organisation before anyone can be invited to trust it.
      if (organization.verification !== 'verified') throw new IdentityError('conflict', 409);

      const program = await tx.program.create({
        data: { organizationId, slug: slugify(parsed.title), ...parsed, createdBy: actorId, managerId: actorId, state: 'draft' }
      });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: program.id, action: 'program.created' } });
      return this.detailView(program);
    });
  }

  /** PRG-02.A01 (update). Editing stops once a reviewer is looking at it. */
  async update(actorId: string, organizationId: string, programId: string, input: ProgramInput & { version: number }) {
    await this.identity.access(actorId, organizationId, 'program.manage');
    const parsed = this.parseInput(input);

    return this.db.$transaction(async tx => {
      const program = await tx.program.findFirst({ where: { id: programId, organizationId } });
      if (!program) throw new IdentityError('not_found', 404);
      // A submitted programme is frozen: the reviewer is judging the version that was sent.
      if (!EDITABLE_STATES.includes(program.state)) throw new IdentityError('conflict', 409);
      if (program.version !== input.version) throw new IdentityError('conflict', 409);
      const updated = await tx.program.update({ where: { id: program.id }, data: { ...parsed, version: { increment: 1 } } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: program.id, action: 'program.updated' } });
      return this.detailView(updated);
    });
  }

  /**
   * What a reviewer would refuse, before anyone wastes their time on it.
   *
   * Each problem is named separately rather than returned as one opaque failure, because the
   * operator has to know which field to fix.
   */
  async validate(actorId: string, organizationId: string, programId: string) {
    await this.identity.access(actorId, organizationId, 'program.read');
    const program = await this.db.program.findFirst({ where: { id: programId, organizationId }, include: { cohorts: true } });
    if (!program) throw new IdentityError('not_found', 404);
    return this.checkReadiness(program, program.cohorts);
  }

  private checkReadiness(program: {
    summary: string; attendancePolicy: string; selectionMethod: string; withdrawalPolicy: string;
    assessmentPolicy: string; complaintsContact: string; applyClosesAt: Date | null; applyOpensAt: Date | null;
    capacity: number; jobCommitmentKind: string; jobCount: number; jobCommitmentTerms: string;
    stipendOffered: boolean; stipendAmountMinor: bigint | null;
  }, cohorts: Array<{ capacity: number; startAt: Date; endAt: Date }>) {
    const problems: Array<{ code: string }> = [];
    const add = (code: string) => problems.push({ code });

    if (program.summary.trim().length < 50) add('summary_too_short');
    if (program.attendancePolicy.trim().length < 20) add('attendance_policy_missing');
    if (program.selectionMethod.trim().length < 20) add('selection_method_missing');
    if (program.withdrawalPolicy.trim().length < 20) add('withdrawal_policy_missing');
    if (program.assessmentPolicy.trim().length < 20) add('assessment_policy_missing');
    if (!program.complaintsContact.trim()) add('complaints_contact_missing');
    if (!program.applyClosesAt) add('application_deadline_missing');
    if (program.applyClosesAt && program.applyClosesAt <= new Date()) add('application_deadline_in_past');
    if (!cohorts.length) add('no_cohort');
    // The seats the operator advertises have to exist somewhere a person can actually sit.
    const cohortSeats = cohorts.reduce((total, cohort) => total + cohort.capacity, 0);
    if (cohorts.length && cohortSeats < program.capacity) add('cohort_seats_below_capacity');
    if (cohorts.some(cohort => cohort.startAt <= new Date())) add('cohort_starts_in_past');
    // 07: a claim about jobs must say which kind of claim it is.
    if (program.jobCount > 0 && program.jobCommitmentKind === 'none') add('job_claim_unqualified');
    if (program.jobCommitmentKind === 'committed' && program.jobCommitmentTerms.trim().length < 20) add('job_commitment_terms_missing');
    if (program.stipendOffered && !program.stipendAmountMinor) add('stipend_amount_missing');

    return {
      valid: problems.length === 0,
      ready: problems.length === 0,
      problems,
      blockers: problems.map(problem => problem.code),
      cohortSeats: String(cohortSeats),
      capacity: String(program.capacity)
    };
  }

  /** PRG-02.A03. Sends it to an independent reviewer and freezes it. */
  async submit(actorId: string, organizationId: string, programId: string, version: number) {
    await this.identity.access(actorId, organizationId, 'program.manage');
    return this.db.$transaction(async tx => {
      const program = await tx.program.findFirst({ where: { id: programId, organizationId }, include: { cohorts: true } });
      if (!program) throw new IdentityError('not_found', 404);
      if (program.state !== 'draft') throw new IdentityError('conflict', 409);
      if (program.version !== version) throw new IdentityError('conflict', 409);
      // Refused here rather than wasting a reviewer's time on an incomplete prospectus.
      if (!this.checkReadiness(program, program.cohorts).ready) throw new IdentityError('conflict', 409);

      const updated = await tx.program.update({ where: { id: program.id }, data: { state: 'review', stateReason: '', version: { increment: 1 } } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: program.id, action: 'program.submitted' } });
      return this.detailView(updated);
    });
  }

  /**
   * PRG-02.A04. Opens applications.
   *
   * Separate from approval on purpose: 08-PERMISSION-EXTENSIONS says `program.publish` is not a way
   * around the review, and an approved programme is one the operator may open, not one that is
   * already open. Verification and the deadline are re-checked, because time has passed.
   */
  async publish(actorId: string, organizationId: string, programId: string, version: number) {
    await this.identity.access(actorId, organizationId, 'program.publish');
    return this.db.$transaction(async tx => {
      const program = await tx.program.findFirst({ where: { id: programId, organizationId }, include: { cohorts: true, organization: true } });
      if (!program) throw new IdentityError('not_found', 404);
      if (!['approved', 'paused'].includes(program.state)) throw new IdentityError('conflict', 409);
      if (program.version !== version) throw new IdentityError('conflict', 409);
      if (program.organization.verification !== 'verified') throw new IdentityError('conflict', 409);
      if (!this.checkReadiness(program, program.cohorts).ready) throw new IdentityError('conflict', 409);

      const updated = await tx.program.update({
        where: { id: program.id },
        data: { state: 'recruiting', stateReason: '', publishedAt: program.publishedAt ?? new Date(), version: { increment: 1 } }
      });
      await tx.cohort.updateMany({ where: { programId: program.id, state: 'planned' }, data: { state: 'recruiting' } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: program.id, action: 'program.published' } });
      return this.detailView(updated);
    });
  }

  /** Stops new applications without ending the programme. Existing candidacies are untouched. */
  async closeApplications(actorId: string, organizationId: string, programId: string, version: number) {
    await this.identity.access(actorId, organizationId, 'program.manage');
    return this.db.$transaction(async tx => {
      const program = await tx.program.findFirst({ where: { id: programId, organizationId } });
      if (!program) throw new IdentityError('not_found', 404);
      if (program.state !== 'recruiting') throw new IdentityError('conflict', 409);
      if (program.version !== version) throw new IdentityError('conflict', 409);
      const updated = await tx.program.update({ where: { id: program.id }, data: { state: 'selection', version: { increment: 1 } } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: program.id, action: 'program.applications_closed' } });
      return this.detailView(updated);
    });
  }

  // ---------------------------------------------------------------- cohorts

  /** PRG-02.A02. A group with its own seats and dates, inside the programme's own window. */
  async addCohort(actorId: string, organizationId: string, programId: string, input: { name: string; capacity: number; startAt: string; endAt: string; acceptanceWindowHours?: number | undefined; timezone?: string | undefined }) {
    await this.identity.access(actorId, organizationId, 'program.manage');
    const name = text(input.name, 2, 140);
    const capacity = wholeNumber(input.capacity, 1, 100000);
    const startAt = parseDate(input.startAt, 'startAt');
    const endAt = parseDate(input.endAt, 'endAt');
    if (startAt >= endAt) throw new IdentityError('invalid_input', 422);
    const acceptanceWindowHours = input.acceptanceWindowHours === undefined ? 72 : wholeNumber(input.acceptanceWindowHours, 1, 24 * 30);
    const timezone = optionalText(input.timezone, 60) || 'Asia/Hebron';

    return this.db.$transaction(async tx => {
      const program = await tx.program.findFirst({ where: { id: programId, organizationId } });
      if (!program) throw new IdentityError('not_found', 404);
      if (['completed', 'closed', 'cancelled'].includes(program.state)) throw new IdentityError('conflict', 409);
      // A cohort that starts before applications close would be recruiting for a group already
      // running, which is how somebody ends up accepted onto training that has begun without them.
      if (program.applyClosesAt && startAt <= program.applyClosesAt) throw new IdentityError('invalid_input', 422);

      const cohort = await tx.cohort.create({
        data: { programId: program.id, name, capacity, startAt, endAt, acceptanceWindowHours, timezone, state: program.state === 'recruiting' ? 'recruiting' : 'planned' }
      });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: cohort.id, action: 'cohort.created' } });
      return this.cohortView(cohort, 0);
    });
  }

  // ---------------------------------------------------------------- PRG-01: the operator's lists

  /** PRG-01. The operator's own programmes, drafts included, with what needs a decision. */
  async listForOrganization(actorId: string, organizationId: string) {
    await this.identity.access(actorId, organizationId, 'program.read');
    const programs = await this.db.program.findMany({
      where: { organizationId },
      include: {
        cohorts: { orderBy: { startAt: 'asc' } },
        _count: { select: { applications: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });
    const programIds = programs.map(program => program.id);
    const [pending, enrolled] = await Promise.all([
      this.db.application.groupBy({ by: ['programId'], where: { programId: { in: programIds }, state: { in: ['submitted', 'screening', 'shortlisted', 'interview'] } }, _count: true }),
      this.db.enrollment.groupBy({ by: ['cohortId'], where: { cohort: { programId: { in: programIds } }, ...seatHoldingStates() }, _count: true })
    ]);
    const pendingByProgram = new Map(pending.map(row => [row.programId, row._count]));
    const enrolledByCohort = new Map(enrolled.map(row => [row.cohortId, row._count]));

    return programs.map(program => ({
      ...this.detailView(program),
      cohorts: program.cohorts.map(cohort => this.cohortView(cohort, enrolledByCohort.get(cohort.id) ?? 0)),
      applicationCount: program._count.applications,
      // The number PRG-01 exists to surface: what is sitting waiting for a human decision.
      awaitingDecision: pendingByProgram.get(program.id) ?? 0
    }));
  }

  async getForOrganization(actorId: string, organizationId: string, programId: string) {
    await this.identity.access(actorId, organizationId, 'program.read');
    const program = await this.db.program.findFirst({
      where: { id: programId, organizationId },
      include: {
        cohorts: { orderBy: { startAt: 'asc' } },
        reviewDecisions: { include: { reviewer: { select: { name: true } } }, orderBy: { createdAt: 'desc' } }
      }
    });
    if (!program) throw new IdentityError('not_found', 404);
    const enrolled = await this.db.enrollment.groupBy({
      by: ['cohortId'],
      where: { cohortId: { in: program.cohorts.map(cohort => cohort.id) }, ...seatHoldingStates() },
      _count: true
    });
    const enrolledByCohort = new Map(enrolled.map(row => [row.cohortId, row._count]));
    return {
      ...this.detailView(program),
      cohorts: program.cohorts.map(cohort => this.cohortView(cohort, enrolledByCohort.get(cohort.id) ?? 0)),
      readiness: this.checkReadiness(program, program.cohorts),
      decisions: program.reviewDecisions.map(decision => ({
        id: decision.id, outcome: decision.outcome, publicReason: decision.publicReason,
        reviewer: decision.reviewer.name, at: decision.createdAt
      }))
    };
  }

  // ---------------------------------------------------------------- ADM: independent review

  /** Programmes waiting for an independent content reviewer. */
  async reviewQueue(actorId: string) {
    await this.identity.contentReviewerUser(actorId);
    const rows = await this.db.program.findMany({
      where: { state: 'review' },
      include: { organization: { select: { displayName: true } }, cohorts: true },
      orderBy: { updatedAt: 'asc' },
      take: 100
    });
    return rows.map(row => ({ ...this.detailView(row), organization: row.organization.displayName, cohortCount: row.cohorts.length }));
  }

  async reviewOne(actorId: string, programId: string) {
    await this.identity.contentReviewerUser(actorId);
    const program = await this.db.program.findUnique({
      where: { id: programId },
      include: {
        organization: { select: { displayName: true, verification: true } },
        cohorts: { orderBy: { startAt: 'asc' } },
        reviewDecisions: { include: { reviewer: { select: { name: true } } }, orderBy: { createdAt: 'desc' } }
      }
    });
    if (!program) throw new IdentityError('not_found', 404);
    return {
      ...this.detailView(program),
      organization: program.organization,
      cohorts: program.cohorts.map(cohort => this.cohortView(cohort, 0)),
      readiness: this.checkReadiness(program, program.cohorts),
      decisions: program.reviewDecisions.map(decision => ({
        id: decision.id, outcome: decision.outcome, publicReason: decision.publicReason,
        reviewer: decision.reviewer.name, at: decision.createdAt
      }))
    };
  }

  async claim(actorId: string, programId: string) {
    const reviewer = await this.identity.contentReviewerUser(actorId);
    return this.db.$transaction(async tx => {
      const program = await tx.program.findUnique({ where: { id: programId } });
      if (!program) throw new IdentityError('not_found', 404);
      if (program.state !== 'review') throw new IdentityError('conflict', 409);
      // A reviewer inside the operator is not independent, whatever grant they hold.
      const membership = await tx.membership.findUnique({ where: { userId_organizationId: { userId: reviewer.id, organizationId: program.organizationId } } });
      if (membership) throw new IdentityError('forbidden', 403);
      // Atomic: two reviewers cannot both take the same submission.
      const claimed = await tx.program.updateMany({ where: { id: program.id, currentReviewerId: null, state: 'review' }, data: { currentReviewerId: reviewer.id } });
      if (claimed.count !== 1) throw new IdentityError('conflict', 409);
      return this.detailView(await tx.program.findUniqueOrThrow({ where: { id: program.id } }));
    });
  }

  /**
   * The decision. Append-only, and approving does not publish: the operator opens applications
   * itself, which is the same separation an offering has in 08.
   */
  async decide(actorId: string, programId: string, input: { outcome: 'approved' | 'changes_requested' | 'rejected'; publicReason: string; version: number }) {
    const reviewer = await this.identity.contentReviewerUser(actorId);
    const publicReason = input.outcome === 'approved' ? optionalText(input.publicReason, 1000) : text(input.publicReason, 10, 1000);

    return this.db.$transaction(async tx => {
      const program = await tx.program.findUnique({ where: { id: programId } });
      if (!program) throw new IdentityError('not_found', 404);
      if (program.state !== 'review') throw new IdentityError('conflict', 409);
      if (program.version !== input.version) throw new IdentityError('conflict', 409);
      const membership = await tx.membership.findUnique({ where: { userId_organizationId: { userId: reviewer.id, organizationId: program.organizationId } } });
      if (membership) throw new IdentityError('forbidden', 403);

      await tx.programReviewDecision.create({ data: { programId: program.id, reviewerId: reviewer.id, outcome: input.outcome, publicReason } });
      const nextState: ProgramState = input.outcome === 'approved' ? 'approved' : input.outcome === 'rejected' ? 'cancelled' : 'draft';
      const updated = await tx.program.update({
        where: { id: program.id },
        data: { state: nextState, stateReason: input.outcome, currentReviewerId: null, version: { increment: 1 } }
      });
      await tx.identityAuditEvent.create({ data: { actorId: reviewer.id, organizationId: program.organizationId, resourceId: program.id, action: `program.${input.outcome}` } });
      return this.detailView(updated);
    });
  }

  // ---------------------------------------------------------------- PUB-09 / PUB-10: the public

  /** PUB-09. Published programmes. Anything before `recruiting` is absent, not forbidden. */
  async browse(filters: { skill?: string | undefined; city?: string | undefined; cursor?: string | undefined; limit?: number | undefined }) {
    const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
    const skill = filters.skill ? text(filters.skill, 1, 60) : undefined;
    const city = filters.city ? text(filters.city, 1, 100) : undefined;
    const rows = await this.db.program.findMany({
      where: {
        state: { in: [...PUBLIC_PROGRAM_STATES] },
        organization: { status: 'active' },
        ...(skill ? { skills: { has: skill } } : {}),
        ...(city ? { city } : {})
      },
      include: { organization: { select: { slug: true, displayName: true, city: true, country: true, verification: true } }, cohorts: true },
      orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
      take: limit,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {})
    });
    return rows.map(row => this.publicCard(row));
  }

  /** PUB-10. One programme, with everything 07 requires a candidate to be able to read first. */
  async publicProgram(slug: string) {
    if (typeof slug !== 'string' || slug.length > SLUG_MAX) throw new IdentityError('not_found', 404);
    const program = await this.db.program.findFirst({
      where: { slug, state: { in: [...PUBLIC_PROGRAM_STATES] }, organization: { status: 'active' } },
      include: {
        organization: { select: { slug: true, displayName: true, city: true, country: true, verification: true } },
        cohorts: { orderBy: { startAt: 'asc' } }
      }
    });
    if (!program) throw new IdentityError('not_found', 404);

    const enrolled = await this.db.enrollment.groupBy({
      by: ['cohortId'],
      where: { cohortId: { in: program.cohorts.map(cohort => cohort.id) }, ...seatHoldingStates() },
      _count: true
    });
    const enrolledByCohort = new Map(enrolled.map(row => [row.cohortId, row._count]));
    const open = this.acceptsApplications(program);

    return {
      ...this.publicCard(program),
      summary: program.summary,
      schedule: program.schedule,
      attendancePolicy: program.attendancePolicy,
      assessmentPolicy: program.assessmentPolicy,
      selectionMethod: program.selectionMethod,
      withdrawalPolicy: program.withdrawalPolicy,
      accessibilityNote: program.accessibilityNote,
      privacyNote: program.privacyNote,
      complaintsContact: program.complaintsContact,
      educationRequirement: program.educationRequirement,
      minimumAge: program.minimumAge,
      maximumAge: program.maximumAge,
      // Built field by field. Nothing about the operator's internal plan crosses into this.
      cohorts: program.cohorts
        .filter(cohort => cohort.state !== 'cancelled')
        .map(cohort => ({
          id: cohort.id, name: cohort.name, startAt: cohort.startAt, endAt: cohort.endAt,
          timezone: cohort.timezone, capacity: cohort.capacity,
          seatsTaken: enrolledByCohort.get(cohort.id) ?? 0,
          seatsRemaining: Math.max(0, cohort.capacity - (enrolledByCohort.get(cohort.id) ?? 0))
        })),
      acceptsApplications: open === '',
      /** A machine code, empty when an application would be accepted. Rendered by the reader's UI. */
      applicationsUnavailableReason: open
    };
  }

  /** PUB-10.A03. The public curriculum: what will be taught and how it is assessed. */
  async curriculum(slug: string) {
    const program = await this.db.program.findFirst({
      where: { slug, state: { in: [...PUBLIC_PROGRAM_STATES] }, organization: { status: 'active' } },
      include: { cohorts: { orderBy: { startAt: 'asc' } } }
    });
    if (!program) throw new IdentityError('not_found', 404);
    return {
      title: program.title,
      skills: program.skills,
      level: program.level,
      durationWeeks: program.durationWeeks,
      hoursPerWeek: program.hoursPerWeek,
      schedule: program.schedule,
      assessmentPolicy: program.assessmentPolicy,
      attendancePolicy: program.attendancePolicy,
      sessions: program.cohorts.map(cohort => ({ cohort: cohort.name, startAt: cohort.startAt, endAt: cohort.endAt }))
    };
  }

  /** Why an application would be refused right now, in the order the server checks it. */
  private acceptsApplications(program: { state: string; applyOpensAt: Date | null; applyClosesAt: Date | null }): string {
    if (program.state === 'paused') return 'paused';
    if (program.state === 'selection') return 'selection_in_progress';
    if (['active', 'completed', 'follow_up', 'closed'].includes(program.state)) return 'programme_started';
    if (!APPLYING_STATES.includes(program.state as ProgramState)) return 'not_open';
    if (program.applyOpensAt && program.applyOpensAt > new Date()) return 'not_open_yet';
    if (program.applyClosesAt && program.applyClosesAt <= new Date()) return 'deadline_passed';
    return '';
  }

  // ---------------------------------------------------------------- shaping

  private parseInput(input: ProgramInput) {
    const capacity = wholeNumber(input.capacity, 1, 100000);
    const jobCommitmentKind = input.jobCommitmentKind ?? 'none';
    if (!['none', 'expected', 'committed'].includes(jobCommitmentKind)) throw new IdentityError('invalid_input', 422);
    const jobCount = input.jobCount === undefined ? 0 : wholeNumber(input.jobCount, 0, 100000);
    // 07: a number of jobs without a kind is exactly the ambiguity the specification forbids, and a
    // kind without a number is a claim about nothing.
    if ((jobCommitmentKind === 'none') !== (jobCount === 0)) throw new IdentityError('invalid_input', 422);
    const jobCommitmentTerms = optionalText(input.jobCommitmentTerms, 2000);
    if (jobCommitmentKind === 'committed' && jobCommitmentTerms.length < 20) throw new IdentityError('invalid_input', 422);

    const stipendOffered = input.stipendOffered ?? false;
    const stipendAmountMinor = stipendOffered
      ? parseMinor(String(input.stipendAmountMinor ?? ''))
      : null;
    if (stipendOffered && (stipendAmountMinor === null || stipendAmountMinor <= 0n)) throw new IdentityError('invalid_input', 422);
    const stipendCurrency = stipendOffered ? parseCurrency(String(input.stipendCurrency ?? '')) : null;

    const applyOpensAt = input.applyOpensAt ? parseDate(input.applyOpensAt, 'applyOpensAt') : null;
    const applyClosesAt = input.applyClosesAt ? parseDate(input.applyClosesAt, 'applyClosesAt') : null;
    if (applyOpensAt && applyClosesAt && applyOpensAt >= applyClosesAt) throw new IdentityError('invalid_input', 422);

    const minimumAge = input.minimumAge === undefined || input.minimumAge === null ? null : wholeNumber(input.minimumAge, 14, 100);
    const maximumAge = input.maximumAge === undefined || input.maximumAge === null ? null : wholeNumber(input.maximumAge, 14, 100);
    if (minimumAge !== null && maximumAge !== null && minimumAge > maximumAge) throw new IdentityError('invalid_input', 422);

    const skills = (input.skills ?? []).map(skill => text(skill, 1, 60));
    if (skills.length > 30 || new Set(skills).size !== skills.length) throw new IdentityError('invalid_input', 422);
    const deliveryMode = input.deliveryMode ?? 'in_person';
    if (!['in_person', 'remote', 'hybrid'].includes(deliveryMode)) throw new IdentityError('invalid_input', 422);

    return {
      title: text(input.title, 4, 200),
      summary: text(input.summary, 20, 2000),
      skills,
      level: optionalText(input.level, 60),
      deliveryMode,
      city: optionalText(input.city, 100),
      capacity,
      applyOpensAt,
      applyClosesAt,
      durationWeeks: input.durationWeeks === undefined ? 0 : wholeNumber(input.durationWeeks, 0, 520),
      hoursPerWeek: input.hoursPerWeek === undefined ? 0 : wholeNumber(input.hoursPerWeek, 0, 80),
      schedule: optionalText(input.schedule, 1000),
      attendancePolicy: optionalText(input.attendancePolicy, 2000),
      assessmentPolicy: optionalText(input.assessmentPolicy, 2000),
      selectionMethod: optionalText(input.selectionMethod, 2000),
      withdrawalPolicy: optionalText(input.withdrawalPolicy, 2000),
      accessibilityNote: optionalText(input.accessibilityNote, 1000),
      privacyNote: optionalText(input.privacyNote, 1000),
      complaintsContact: optionalText(input.complaintsContact, 200),
      stipendOffered,
      stipendAmountMinor,
      stipendCurrency,
      stipendConditions: optionalText(input.stipendConditions, 1000),
      jobCommitmentKind,
      jobCount,
      jobCommitmentTerms,
      minimumAge,
      maximumAge,
      educationRequirement: optionalText(input.educationRequirement, 500)
    } as const;
  }

  private detailView(program: {
    id: string; organizationId: string; slug: string; title: string; summary: string; skills: string[];
    level: string; deliveryMode: string; city: string; capacity: number;
    applyOpensAt: Date | null; applyClosesAt: Date | null; durationWeeks: number; hoursPerWeek: number;
    schedule: string; attendancePolicy: string; assessmentPolicy: string; selectionMethod: string;
    withdrawalPolicy: string; accessibilityNote: string; privacyNote: string; complaintsContact: string;
    stipendOffered: boolean; stipendAmountMinor: bigint | null; stipendCurrency: string | null; stipendConditions: string;
    jobCommitmentKind: string; jobCount: number; jobCommitmentTerms: string;
    minimumAge: number | null; maximumAge: number | null; educationRequirement: string;
    state: string; stateReason: string; publishedAt: Date | null; version: number; createdAt: Date;
  }) {
    return {
      id: program.id,
      organizationId: program.organizationId,
      slug: program.slug,
      title: program.title,
      summary: program.summary,
      skills: program.skills,
      level: program.level,
      deliveryMode: program.deliveryMode,
      city: program.city,
      capacity: program.capacity,
      applyOpensAt: program.applyOpensAt,
      applyClosesAt: program.applyClosesAt,
      durationWeeks: program.durationWeeks,
      hoursPerWeek: program.hoursPerWeek,
      schedule: program.schedule,
      attendancePolicy: program.attendancePolicy,
      assessmentPolicy: program.assessmentPolicy,
      selectionMethod: program.selectionMethod,
      withdrawalPolicy: program.withdrawalPolicy,
      accessibilityNote: program.accessibilityNote,
      privacyNote: program.privacyNote,
      complaintsContact: program.complaintsContact,
      ...this.jobClaim(program),
      ...this.stipendView(program),
      minimumAge: program.minimumAge,
      maximumAge: program.maximumAge,
      educationRequirement: program.educationRequirement,
      state: program.state,
      stateReason: program.stateReason,
      publishedAt: program.publishedAt,
      version: program.version,
      createdAt: program.createdAt
    };
  }

  /**
   * The jobs claim, always as three fields rather than a number on its own.
   *
   * 07 is explicit: a programme advertising "10 jobs" has to say whether those are a target or an
   * obligation, and under what terms. A DTO that returned only the count would let every screen
   * render the more flattering reading.
   */
  private jobClaim(program: { jobCommitmentKind: string; jobCount: number; jobCommitmentTerms: string }) {
    return {
      jobCommitmentKind: program.jobCommitmentKind,
      jobCount: program.jobCount,
      jobCommitmentTerms: program.jobCommitmentTerms,
      /** Stated rather than inferred: completing this programme does not entitle anyone to a job. */
      completionGuaranteesJob: false
    };
  }

  private stipendView(program: { stipendOffered: boolean; stipendAmountMinor: bigint | null; stipendCurrency: string | null; stipendConditions: string }) {
    return {
      stipendOffered: program.stipendOffered,
      stipendAmountMinor: program.stipendAmountMinor === null ? null : minorToString(program.stipendAmountMinor),
      stipendCurrency: program.stipendCurrency,
      stipendConditions: program.stipendConditions,
      /** No stipend is paid by this build at all; PART-12 owns that, and the DTO says so. */
      stipendPayable: false,
      stipendUnavailableReason: program.stipendOffered ? 'not_implemented' : ''
    };
  }

  private cohortView(cohort: {
    id: string; programId: string; name: string; capacity: number; startAt: Date; endAt: Date;
    acceptanceWindowHours: number; timezone: string; state: string; version: number;
  }, seatsTaken: number) {
    return {
      id: cohort.id,
      programId: cohort.programId,
      name: cohort.name,
      capacity: cohort.capacity,
      seatsTaken,
      seatsRemaining: Math.max(0, cohort.capacity - seatsTaken),
      startAt: cohort.startAt,
      endAt: cohort.endAt,
      acceptanceWindowHours: cohort.acceptanceWindowHours,
      timezone: cohort.timezone,
      state: cohort.state,
      version: cohort.version
    };
  }

  private publicCard(program: {
    slug: string; title: string; skills: string[]; level: string; deliveryMode: string; city: string;
    capacity: number; durationWeeks: number; hoursPerWeek: number;
    applyOpensAt: Date | null; applyClosesAt: Date | null; state: string;
    stipendOffered: boolean; stipendAmountMinor: bigint | null; stipendCurrency: string | null; stipendConditions: string;
    jobCommitmentKind: string; jobCount: number; jobCommitmentTerms: string;
    organization: { slug: string; displayName: string; city: string; country: string; verification: string };
  }) {
    return {
      slug: program.slug,
      title: program.title,
      skills: program.skills,
      level: program.level,
      deliveryMode: program.deliveryMode,
      city: program.city,
      capacity: program.capacity,
      durationWeeks: program.durationWeeks,
      hoursPerWeek: program.hoursPerWeek,
      applyOpensAt: program.applyOpensAt,
      applyClosesAt: program.applyClosesAt,
      state: program.state,
      ...this.jobClaim(program),
      ...this.stipendView(program),
      organization: {
        slug: program.organization.slug,
        displayName: program.organization.displayName,
        city: program.organization.city,
        country: program.organization.country,
        verified: program.organization.verification === 'verified'
      }
    };
  }
}
