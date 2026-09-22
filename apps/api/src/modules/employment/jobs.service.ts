import { randomBytes } from 'node:crypto';
import type { DatabaseClient, JobState } from '@tamkeen/database';
import { IdentityError } from '../identity/policy.js';
import { IdentityService } from '../identity/identity.service.js';
import { minorToString, parseCurrency, parseMinor } from '../projects/money.js';

/**
 * Jobs, applications and referrals (07-INCUBATION-EMPLOYMENT, PUB-11, PRG-07).
 *
 * What this module is careful about:
 *
 *  - **A job application is not a training application.** 07 says it has its own state machine, so
 *    it has its own table. Nothing here can be reached from a cohort, and being accepted onto
 *    training grants nobody a place in this queue.
 *  - **Pay is disclosed or its absence is explained.** A listing that simply omits it leaves a
 *    candidate guessing, so the reason is a required field and a CHECK constraint.
 *  - **A referral needs the candidate's agreement.** Nothing about a person reaches an employer
 *    because somebody else decided they would be a good fit.
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
  return `${base || 'job'}-${randomBytes(3).toString('hex')}`;
};

const jobReference = () => `JOB-${randomBytes(4).toString('hex').toUpperCase()}`;

/** States in which a job is publicly listed. Anything earlier is absent, not forbidden. */
export const PUBLIC_JOB_STATES: readonly JobState[] = ['open', 'paused', 'filled'] as const;
const EDITABLE_STATES: readonly JobState[] = ['draft', 'paused'] as const;
/** States in which the operator is still working on a candidacy. */
const IN_REVIEW = ['submitted', 'screening', 'shortlisted', 'interview'] as const;

const CONTRACT_TYPES = ['full_time', 'part_time', 'fixed_term', 'apprenticeship', 'temporary'] as const;

export interface JobInput {
  title: string;
  summary: string;
  responsibilities?: string | undefined;
  requirements?: string | undefined;
  skills?: string[] | undefined;
  contractType?: typeof CONTRACT_TYPES[number] | undefined;
  contractMonths?: number | null | undefined;
  deliveryMode?: 'in_person' | 'remote' | 'hybrid' | undefined;
  city?: string | undefined;
  hoursPerWeek?: number | undefined;
  salaryDisclosed?: boolean | undefined;
  salaryMinMinor?: string | null | undefined;
  salaryMaxMinor?: string | null | undefined;
  salaryCurrency?: string | null | undefined;
  salaryPeriod?: string | undefined;
  salaryUndisclosedReason?: string | undefined;
  closesAt?: string | null | undefined;
  openings?: number | undefined;
  programId?: string | null | undefined;
}

export class JobsService {
  private readonly identity: IdentityService;
  constructor(private readonly db: DatabaseClient) {
    this.identity = new IdentityService(db);
  }

  // ---------------------------------------------------------------- PRG-07: the employer

  /** PRG-07.A01. A draft job, which is not public and accepts nothing. */
  async create(actorId: string, organizationId: string, input: JobInput) {
    await this.identity.access(actorId, organizationId, 'job.manage');
    const parsed = await this.parseInput(input, organizationId);

    return this.db.$transaction(async tx => {
      const organization = await tx.organization.findUniqueOrThrow({ where: { id: organizationId } });
      // 07: no job without a known employer. An unverified organisation cannot advertise work.
      if (organization.verification !== 'verified') throw new IdentityError('conflict', 409);

      const job = await tx.job.create({ data: { organizationId, slug: slugify(parsed.title), ...parsed, createdBy: actorId, state: 'draft' } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: job.id, action: 'job.created' } });
      return this.detailView(job);
    });
  }

  /** PRG-07.A02. Editing. A material change while open is refused: it would move the goalposts. */
  async update(actorId: string, organizationId: string, jobId: string, input: JobInput & { version: number }) {
    await this.identity.access(actorId, organizationId, 'job.manage');
    const parsed = await this.parseInput(input, organizationId);

    return this.db.$transaction(async tx => {
      const job = await tx.job.findFirst({ where: { id: jobId, organizationId } });
      if (!job) throw new IdentityError('not_found', 404);
      if (!EDITABLE_STATES.includes(job.state)) throw new IdentityError('conflict', 409);
      if (job.version !== input.version) throw new IdentityError('conflict', 409);
      const updated = await tx.job.update({ where: { id: job.id }, data: { ...parsed, version: { increment: 1 } } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: job.id, action: 'job.updated' } });
      return this.detailView(updated);
    });
  }

  /** What a publish would refuse, named field by field rather than as one opaque failure. */
  private checkReadiness(job: {
    summary: string; requirements: string; closesAt: Date | null; contractType: string;
    contractMonths: number | null; salaryDisclosed: boolean; salaryMinMinor: bigint | null;
    salaryCurrency: string | null; salaryUndisclosedReason: string;
  }) {
    const problems: Array<{ code: string }> = [];
    const add = (code: string) => problems.push({ code });
    if (job.summary.trim().length < 50) add('summary_too_short');
    if (job.requirements.trim().length < 20) add('requirements_missing');
    if (!job.closesAt) add('deadline_missing');
    if (job.closesAt && job.closesAt <= new Date()) add('deadline_in_past');
    if (job.contractType === 'fixed_term' && !job.contractMonths) add('fixed_term_length_missing');
    // Pay is stated, or its absence is. Silence is the one thing that is not allowed.
    if (job.salaryDisclosed && (!job.salaryMinMinor || !job.salaryCurrency)) add('salary_incomplete');
    if (!job.salaryDisclosed && job.salaryUndisclosedReason.trim().length < 10) add('salary_silence_unexplained');
    return { valid: problems.length === 0, ready: problems.length === 0, problems, blockers: problems.map(p => p.code) };
  }

  async validate(actorId: string, organizationId: string, jobId: string) {
    await this.identity.access(actorId, organizationId, 'job.manage');
    const job = await this.db.job.findFirst({ where: { id: jobId, organizationId } });
    if (!job) throw new IdentityError('not_found', 404);
    return this.checkReadiness(job);
  }

  /** PRG-07.A03. Publishing. Verification and the deadline are re-checked, because time passed. */
  async publish(actorId: string, organizationId: string, jobId: string, version: number) {
    await this.identity.access(actorId, organizationId, 'job.publish');
    return this.db.$transaction(async tx => {
      const job = await tx.job.findFirst({ where: { id: jobId, organizationId }, include: { organization: true } });
      if (!job) throw new IdentityError('not_found', 404);
      if (!['draft', 'paused'].includes(job.state)) throw new IdentityError('conflict', 409);
      if (job.version !== version) throw new IdentityError('conflict', 409);
      if (job.organization.verification !== 'verified') throw new IdentityError('conflict', 409);
      if (!this.checkReadiness(job).ready) throw new IdentityError('conflict', 409);

      const updated = await tx.job.update({
        where: { id: job.id },
        data: { state: 'open', stateReason: '', publishedAt: job.publishedAt ?? new Date(), version: { increment: 1 } }
      });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: job.id, action: 'job.published' } });
      return this.detailView(updated);
    });
  }

  /**
   * PRG-07.A04. Closing, with what happens to the candidacies said out loud.
   *
   * 07 requires existing applications to be dealt with rather than left hanging, so closing reports
   * how many are still open and refuses to pretend they have gone away.
   */
  async close(actorId: string, organizationId: string, jobId: string, input: { reason: string; version: number; rejectOpen?: boolean | undefined }) {
    await this.identity.access(actorId, organizationId, 'job.manage');
    const reason = text(input.reason, 10, 200);

    return this.db.$transaction(async tx => {
      const job = await tx.job.findFirst({ where: { id: jobId, organizationId } });
      if (!job) throw new IdentityError('not_found', 404);
      if (!['open', 'paused'].includes(job.state)) throw new IdentityError('conflict', 409);
      if (job.version !== input.version) throw new IdentityError('conflict', 409);

      const open = await tx.jobApplication.findMany({ where: { jobId, state: { in: [...IN_REVIEW] } }, select: { id: true } });
      // Closing without dealing with the people waiting is what 07 forbids. Either the operator
      // says to reject them — with the job's own reason shown to each — or it is refused.
      if (open.length > 0 && !input.rejectOpen) throw new IdentityError('conflict', 409);
      if (open.length > 0) {
        await tx.jobApplication.updateMany({
          where: { id: { in: open.map(application => application.id) } },
          data: { state: 'rejected', decidedAt: new Date(), withdrawnReason: reason, version: { increment: 1 } }
        });
        await tx.outboxEvent.create({ data: { topic: 'job_application.decided', payload: { jobId, outcome: 'rejected', count: open.length, reason } } });
      }

      const updated = await tx.job.update({ where: { id: job.id }, data: { state: 'closed', stateReason: reason, version: { increment: 1 } } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: job.id, action: 'job.closed' } });
      return { ...this.detailView(updated), applicationsRejected: open.length };
    });
  }

  /** PRG-07. The employer's own jobs, including the drafts the public cannot see. */
  async listForOrganization(actorId: string, organizationId: string, filters: { state?: string | undefined }) {
    await this.identity.access(actorId, organizationId, 'organization.read');
    const rows = await this.db.job.findMany({
      where: { organizationId, ...(filters.state ? { state: filters.state as JobState } : {}) },
      include: { _count: { select: { applications: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200
    });
    const now = new Date();
    return rows.map(row => ({
      ...this.detailView(row),
      applicationCount: row._count.applications,
      /** Computed once here so no screen has to re-derive "still open" from a date. */
      deadlinePassed: row.closesAt !== null && row.closesAt <= now,
      publiclyVisible: PUBLIC_JOB_STATES.includes(row.state)
    }));
  }

  /** One job as its employer sees it, with the publish blockers already worked out. */
  async getForOrganization(actorId: string, organizationId: string, jobId: string) {
    await this.identity.access(actorId, organizationId, 'organization.read');
    const job = await this.db.job.findFirst({
      where: { id: jobId, organizationId },
      include: { program: { select: { id: true, slug: true, title: true } }, _count: { select: { applications: true, referrals: true, placements: true } } }
    });
    if (!job) throw new IdentityError('not_found', 404);
    return {
      ...this.detailView(job),
      program: job.program,
      applicationCount: job._count.applications,
      referralCount: job._count.referrals,
      placementCount: job._count.placements,
      readiness: this.checkReadiness(job),
      publiclyVisible: PUBLIC_JOB_STATES.includes(job.state)
    };
  }

  // ---------------------------------------------------------------- PUB-11: the public surface

  /** PUB-09/PUB-11. Published jobs. Anything before `open` is absent, not forbidden. */
  async browse(filters: { skill?: string | undefined; city?: string | undefined; cursor?: string | undefined; limit?: number | undefined }) {
    const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
    const skill = filters.skill ? text(filters.skill, 1, 60) : undefined;
    const city = filters.city ? text(filters.city, 1, 100) : undefined;
    const rows = await this.db.job.findMany({
      where: {
        state: { in: [...PUBLIC_JOB_STATES] },
        organization: { status: 'active' },
        adminVisibility: 'visible',
        ...(skill ? { skills: { has: skill } } : {}),
        ...(city ? { city } : {})
      },
      include: { organization: { select: { slug: true, displayName: true, city: true, country: true, verification: true } } },
      orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
      take: limit,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {})
    });
    return rows.map(row => this.publicCard(row));
  }

  /** PUB-11. One job. No candidate data of any kind is in this projection. */
  async publicJob(slug: string) {
    if (typeof slug !== 'string' || slug.length > SLUG_MAX) throw new IdentityError('not_found', 404);
    const job = await this.db.job.findFirst({
      where: { slug, state: { in: [...PUBLIC_JOB_STATES] }, organization: { status: 'active' }, adminVisibility: 'visible' },
      include: {
        organization: { select: { slug: true, displayName: true, city: true, country: true, verification: true } },
        program: { select: { slug: true, title: true, state: true } }
      }
    });
    if (!job) throw new IdentityError('not_found', 404);
    const closed = this.acceptsApplications(job);
    return {
      ...this.publicCard(job),
      id: job.id,
      summary: job.summary,
      responsibilities: job.responsibilities,
      requirements: job.requirements,
      hoursPerWeek: job.hoursPerWeek,
      openings: job.openings,
      // Named where it exists, because 07 wants a reader to see which training this came out of —
      // and because a job linked to a programme is still not something that programme promised.
      program: job.program,
      programDidNotPromiseThisJob: true as const,
      acceptsApplications: closed === '',
      applicationsUnavailableReason: closed
    };
  }

  private acceptsApplications(job: { state: string; closesAt: Date | null }): string {
    if (job.state === 'paused') return 'paused';
    if (job.state === 'filled') return 'filled';
    if (job.state !== 'open') return 'not_open';
    if (job.closesAt && job.closesAt <= new Date()) return 'deadline_passed';
    return '';
  }

  // ---------------------------------------------------------------- the candidate

  /** PUB-11.A01. Applying. A draft first, visible to nobody but its author. */
  async saveDraft(actorId: string, input: { jobId: string; coverNote?: string | undefined; applicationId?: string | undefined; version?: number | undefined }) {
    const user = await this.identity.activeUser(actorId);
    const coverNote = optionalText(input.coverNote, 4000);

    return this.db.$transaction(async tx => {
      const job = await tx.job.findUnique({ where: { id: input.jobId } });
      if (!job) throw new IdentityError('not_found', 404);
      if (!PUBLIC_JOB_STATES.includes(job.state)) throw new IdentityError('conflict', 409);

      if (input.applicationId) {
        const existing = await tx.jobApplication.findUnique({ where: { id: input.applicationId } });
        if (!existing || existing.userId !== user.id) throw new IdentityError('not_found', 404);
        if (existing.state !== 'draft') throw new IdentityError('conflict', 409);
        if (existing.version !== input.version) throw new IdentityError('conflict', 409);
        const updated = await tx.jobApplication.update({ where: { id: existing.id }, data: { coverNote, version: { increment: 1 } } });
        return this.applicationView(updated);
      }

      const duplicate = await tx.jobApplication.findUnique({ where: { jobId_userId: { jobId: job.id, userId: user.id } } });
      if (duplicate) throw new IdentityError('conflict', 409);
      const created = await tx.jobApplication.create({
        data: { jobId: job.id, userId: user.id, reference: jobReference(), state: 'draft', coverNote }
      });
      return this.applicationView(created);
    });
  }

  /** Submitting. The deadline is checked here, at submission, not when the form was opened. */
  async submit(actorId: string, applicationId: string, input: { sharingConsent: boolean; version: number }) {
    const user = await this.identity.activeUser(actorId);

    return this.db.$transaction(async tx => {
      const application = await tx.jobApplication.findUnique({ where: { id: applicationId }, include: { job: true } });
      if (!application || application.userId !== user.id) throw new IdentityError('not_found', 404);
      if (application.state !== 'draft') throw new IdentityError('conflict', 409);
      if (application.version !== input.version) throw new IdentityError('conflict', 409);
      if (application.job.state !== 'open') throw new IdentityError('conflict', 409);
      if (application.job.closesAt && application.job.closesAt <= new Date()) throw new IdentityError('conflict', 409);
      // Sharing the profile with this employer is what makes the candidacy assessable at all.
      if (!input.sharingConsent) throw new IdentityError('invalid_input', 422);
      const profile = await tx.candidateProfile.findUnique({ where: { userId: user.id } });
      if (!profile) throw new IdentityError('conflict', 409);

      const updated = await tx.jobApplication.update({
        where: { id: application.id },
        data: { state: 'submitted', sharingConsent: true, submittedAt: new Date(), version: { increment: 1 } }
      });
      await tx.identityAuditEvent.create({ data: { actorId: user.id, resourceId: application.id, action: 'job_application.submitted' } });
      return this.applicationView(updated);
    });
  }

  async withdraw(actorId: string, applicationId: string, input: { reason: string; version: number }) {
    const user = await this.identity.activeUser(actorId);
    const reason = text(input.reason, 10, 1000);
    const application = await this.db.jobApplication.findUnique({ where: { id: applicationId } });
    if (!application || application.userId !== user.id) throw new IdentityError('not_found', 404);
    if (!['draft', ...IN_REVIEW, 'offered'].includes(application.state)) throw new IdentityError('conflict', 409);
    if (application.version !== input.version) throw new IdentityError('conflict', 409);
    const updated = await this.db.jobApplication.update({
      where: { id: application.id },
      data: { state: 'withdrawn', withdrawnReason: reason, version: { increment: 1 } }
    });
    return this.applicationView(updated);
  }

  async mine(actorId: string) {
    const user = await this.identity.activeUser(actorId);
    const rows = await this.db.jobApplication.findMany({
      where: { userId: user.id },
      include: {
        job: { select: { slug: true, title: true, state: true, organization: { select: { displayName: true } } } },
        interviews: { orderBy: { scheduledAt: 'asc' } },
        offers: { orderBy: { sequence: 'desc' }, take: 1 }
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });
    return rows.map(row => ({
      ...this.applicationView(row),
      jobSlug: row.job.slug,
      jobTitle: row.job.title,
      employer: row.job.organization.displayName,
      interviews: row.interviews.map(interview => this.interviewView(interview)),
      latestOffer: row.offers[0] ? { id: row.offers[0].id, sequence: row.offers[0].sequence, state: row.offers[0].state, respondByAt: row.offers[0].respondByAt } : null
    }));
  }

  // ---------------------------------------------------------------- PRG-07.A05: referrals

  /**
   * PRG-07.A05. Putting a trainee forward.
   *
   * It creates an invitation to be referred, not a referral: 07 requires the person's agreement to
   * share their profile, and nothing reaches the employer until they give it.
   */
  async refer(actorId: string, organizationId: string, jobId: string, input: { userId: string; note?: string | undefined }) {
    await this.identity.access(actorId, organizationId, 'application.review');
    const note = optionalText(input.note, 1000);

    return this.db.$transaction(async tx => {
      const job = await tx.job.findFirst({ where: { id: jobId, organizationId } });
      if (!job) throw new IdentityError('not_found', 404);
      if (job.state !== 'open') throw new IdentityError('conflict', 409);
      const candidate = await tx.user.findUnique({ where: { id: input.userId } });
      if (!candidate || candidate.status !== 'active') throw new IdentityError('not_found', 404);
      const existing = await tx.jobReferral.findUnique({ where: { jobId_userId: { jobId, userId: candidate.id } } });
      if (existing) throw new IdentityError('conflict', 409);

      const referral = await tx.jobReferral.create({ data: { jobId, userId: candidate.id, referredBy: actorId, note } });
      await tx.outboxEvent.create({ data: { topic: 'job.referral_offered', payload: { referralId: referral.id } } });
      return {
        id: referral.id,
        jobId,
        /** Nothing about this person has reached the employer yet, and the reply says so. */
        profileShared: false,
        awaitingCandidateConsent: true as const,
        createdAt: referral.createdAt
      };
    });
  }

  /** The candidate agrees, and only then does an application exist. */
  async respondToReferral(actorId: string, referralId: string, input: { accept: boolean; version: number }) {
    const user = await this.identity.activeUser(actorId);

    return this.db.$transaction(async tx => {
      const referral = await tx.jobReferral.findUnique({ where: { id: referralId }, include: { job: true } });
      if (!referral || referral.userId !== user.id) throw new IdentityError('not_found', 404);
      if (referral.consentedAt || referral.declinedAt) throw new IdentityError('conflict', 409);
      if (referral.version !== input.version) throw new IdentityError('conflict', 409);

      if (!input.accept) {
        await tx.jobReferral.update({ where: { id: referral.id }, data: { declinedAt: new Date(), version: { increment: 1 } } });
        return { id: referral.id, accepted: false, applicationId: null, profileShared: false };
      }

      if (referral.job.state !== 'open') throw new IdentityError('conflict', 409);
      const profile = await tx.candidateProfile.findUnique({ where: { userId: user.id } });
      if (!profile) throw new IdentityError('conflict', 409);
      const duplicate = await tx.jobApplication.findUnique({ where: { jobId_userId: { jobId: referral.jobId, userId: user.id } } });
      if (duplicate) throw new IdentityError('conflict', 409);

      const application = await tx.jobApplication.create({
        data: {
          jobId: referral.jobId, userId: user.id, reference: jobReference(),
          state: 'submitted', sharingConsent: true, submittedAt: new Date(), referralId: referral.id
        }
      });
      await tx.jobReferral.update({ where: { id: referral.id }, data: { consentedAt: new Date(), version: { increment: 1 } } });
      return { id: referral.id, accepted: true, applicationId: application.id, profileShared: true };
    });
  }

  async myReferrals(actorId: string) {
    const user = await this.identity.activeUser(actorId);
    const rows = await this.db.jobReferral.findMany({
      where: { userId: user.id, consentedAt: null, declinedAt: null },
      include: { job: { select: { slug: true, title: true, state: true, organization: { select: { displayName: true } } } }, referrer: { select: { name: true } } },
      orderBy: { createdAt: 'desc' }
    });
    return rows.map(row => ({
      id: row.id, note: row.note, version: row.version, createdAt: row.createdAt,
      job: { slug: row.job.slug, title: row.job.title, state: row.job.state, employer: row.job.organization.displayName },
      referredBy: row.referrer.name,
      /** Said plainly: until this person agrees, the employer has been told nothing about them. */
      profileShared: false
    }));
  }

  // ---------------------------------------------------------------- PRG-07: the employer's queue

  async listApplications(actorId: string, organizationId: string, filters: { jobId?: string | undefined; pending?: boolean | undefined }) {
    await this.identity.access(actorId, organizationId, 'application.review');
    const rows = await this.db.jobApplication.findMany({
      where: {
        job: { organizationId },
        state: filters.pending ? { in: [...IN_REVIEW] } : { not: 'draft' },
        ...(filters.jobId ? { jobId: filters.jobId } : {})
      },
      include: {
        user: { select: { id: true, name: true, email: true, candidateProfile: true } },
        job: { select: { id: true, title: true } },
        interviews: { orderBy: { scheduledAt: 'desc' }, take: 1 },
        offers: { orderBy: { sequence: 'desc' }, take: 1 },
        referral: { select: { referredBy: true, consentedAt: true } }
      },
      orderBy: { submittedAt: 'asc' },
      take: 200
    });
    return rows.map(row => this.employerApplicationView(row));
  }

  async getApplication(actorId: string, organizationId: string, applicationId: string) {
    await this.identity.access(actorId, organizationId, 'application.review');
    const application = await this.db.jobApplication.findFirst({
      where: { id: applicationId, job: { organizationId } },
      include: {
        user: { select: { id: true, name: true, email: true, candidateProfile: true } },
        job: { select: { id: true, title: true, requirements: true } },
        interviews: { orderBy: { scheduledAt: 'desc' } },
        offers: { orderBy: { sequence: 'desc' } },
        referral: { select: { referredBy: true, consentedAt: true } }
      }
    });
    if (!application) throw new IdentityError('not_found', 404);
    return {
      ...this.employerApplicationView(application),
      coverNote: application.coverNote,
      job: application.job,
      interviews: application.interviews.map(interview => this.interviewView(interview)),
      offers: application.offers.map(offer => ({
        id: offer.id, sequence: offer.sequence, state: offer.state, respondByAt: offer.respondByAt,
        proposedStartDate: offer.proposedStartDate, sentAt: offer.sentAt, version: offer.version
      }))
    };
  }

  /** Moving a candidacy along. Rejecting says why, because the candidate is shown it. */
  async decide(actorId: string, organizationId: string, applicationId: string, input: { outcome: 'screening' | 'shortlisted' | 'rejected'; reason: string; version: number }) {
    await this.identity.access(actorId, organizationId, 'application.review');
    const reason = input.outcome === 'rejected' ? text(input.reason, 10, 1000) : optionalText(input.reason, 1000);

    return this.db.$transaction(async tx => {
      const application = await tx.jobApplication.findFirst({ where: { id: applicationId, job: { organizationId } } });
      if (!application) throw new IdentityError('not_found', 404);
      if (!IN_REVIEW.includes(application.state as typeof IN_REVIEW[number])) throw new IdentityError('conflict', 409);
      if (application.version !== input.version) throw new IdentityError('conflict', 409);
      if (!application.sharingConsent) throw new IdentityError('conflict', 409);

      const updated = await tx.jobApplication.update({
        where: { id: application.id },
        data: {
          state: input.outcome,
          withdrawnReason: input.outcome === 'rejected' ? reason : application.withdrawnReason,
          ...(input.outcome === 'rejected' ? { decidedAt: new Date() } : {}),
          version: { increment: 1 }
        }
      });
      await tx.outboxEvent.create({ data: { topic: 'job_application.decided', payload: { applicationId: application.id, outcome: input.outcome } } });
      return {
        ...this.applicationView(updated),
        /** Stated on every decision: nothing here is a job until a start is confirmed. */
        hiredCount: 0
      };
    });
  }

  // ---------------------------------------------------------------- shaping

  private async parseInput(input: JobInput, organizationId: string) {
    const contractType = input.contractType ?? 'full_time';
    if (!CONTRACT_TYPES.includes(contractType)) throw new IdentityError('invalid_input', 422);
    const contractMonths = input.contractMonths === undefined || input.contractMonths === null ? null : wholeNumber(input.contractMonths, 1, 120);
    if (contractType === 'fixed_term' && !contractMonths) throw new IdentityError('invalid_input', 422);

    const salaryDisclosed = input.salaryDisclosed ?? false;
    const salaryMinMinor = salaryDisclosed ? parseMinor(String(input.salaryMinMinor ?? '')) : null;
    const salaryMaxMinor = salaryDisclosed && input.salaryMaxMinor ? parseMinor(String(input.salaryMaxMinor)) : null;
    if (salaryDisclosed && (!salaryMinMinor || salaryMinMinor <= 0n)) throw new IdentityError('invalid_input', 422);
    if (salaryMinMinor && salaryMaxMinor && salaryMaxMinor < salaryMinMinor) throw new IdentityError('invalid_input', 422);
    const salaryCurrency = salaryDisclosed ? parseCurrency(String(input.salaryCurrency ?? '')) : null;
    // A listing that says nothing about pay leaves the reader guessing, so the silence is explained.
    const salaryUndisclosedReason = salaryDisclosed ? '' : text(input.salaryUndisclosedReason, 10, 200);

    const deliveryMode = input.deliveryMode ?? 'in_person';
    if (!['in_person', 'remote', 'hybrid'].includes(deliveryMode)) throw new IdentityError('invalid_input', 422);
    const skills = (input.skills ?? []).map(skill => text(skill, 1, 60));
    if (skills.length > 30 || new Set(skills).size !== skills.length) throw new IdentityError('invalid_input', 422);

    const closesAt = input.closesAt ? new Date(input.closesAt) : null;
    if (closesAt && Number.isNaN(closesAt.getTime())) throw new IdentityError('invalid_input', 422);

    let programId: string | null = null;
    if (input.programId) {
      // A job may point at the programme it came out of, but only one this organisation runs.
      const program = await this.db.program.findFirst({ where: { id: input.programId, organizationId }, select: { id: true } });
      if (!program) throw new IdentityError('invalid_input', 422);
      programId = program.id;
    }

    return {
      title: text(input.title, 4, 200),
      summary: text(input.summary, 20, 2000),
      responsibilities: optionalText(input.responsibilities, 4000),
      requirements: optionalText(input.requirements, 4000),
      skills,
      contractType,
      contractMonths,
      deliveryMode,
      city: optionalText(input.city, 100),
      hoursPerWeek: input.hoursPerWeek === undefined ? 0 : wholeNumber(input.hoursPerWeek, 0, 80),
      salaryDisclosed,
      salaryMinMinor,
      salaryMaxMinor,
      salaryCurrency,
      salaryPeriod: optionalText(input.salaryPeriod, 20),
      salaryUndisclosedReason,
      closesAt,
      openings: input.openings === undefined ? 1 : wholeNumber(input.openings, 1, 10000),
      programId
    } as const;
  }

  private salaryView(job: {
    salaryDisclosed: boolean; salaryMinMinor: bigint | null; salaryMaxMinor: bigint | null;
    salaryCurrency: string | null; salaryPeriod: string; salaryUndisclosedReason: string;
  }) {
    return {
      salaryDisclosed: job.salaryDisclosed,
      salaryMinMinor: job.salaryMinMinor === null ? null : minorToString(job.salaryMinMinor),
      salaryMaxMinor: job.salaryMaxMinor === null ? null : minorToString(job.salaryMaxMinor),
      salaryCurrency: job.salaryCurrency,
      salaryPeriod: job.salaryPeriod,
      // Never an empty field: either the pay is here, or the reason it is not.
      salaryUndisclosedReason: job.salaryUndisclosedReason
    };
  }

  private detailView(job: {
    id: string; organizationId: string; programId: string | null; slug: string; title: string;
    summary: string; responsibilities: string; requirements: string; skills: string[];
    contractType: string; contractMonths: number | null; deliveryMode: string; city: string;
    hoursPerWeek: number; salaryDisclosed: boolean; salaryMinMinor: bigint | null;
    salaryMaxMinor: bigint | null; salaryCurrency: string | null; salaryPeriod: string;
    salaryUndisclosedReason: string; closesAt: Date | null; openings: number; state: string;
    stateReason: string; publishedAt: Date | null; version: number; createdAt: Date;
  }) {
    return {
      id: job.id,
      organizationId: job.organizationId,
      programId: job.programId,
      slug: job.slug,
      title: job.title,
      summary: job.summary,
      responsibilities: job.responsibilities,
      requirements: job.requirements,
      skills: job.skills,
      contractType: job.contractType,
      contractMonths: job.contractMonths,
      deliveryMode: job.deliveryMode,
      city: job.city,
      hoursPerWeek: job.hoursPerWeek,
      ...this.salaryView(job),
      closesAt: job.closesAt,
      openings: job.openings,
      state: job.state,
      stateReason: job.stateReason,
      publishedAt: job.publishedAt,
      version: job.version,
      createdAt: job.createdAt
    };
  }

  private publicCard(job: {
    slug: string; title: string; skills: string[]; contractType: string; contractMonths: number | null;
    deliveryMode: string; city: string; closesAt: Date | null; openings: number; state: string;
    salaryDisclosed: boolean; salaryMinMinor: bigint | null; salaryMaxMinor: bigint | null;
    salaryCurrency: string | null; salaryPeriod: string; salaryUndisclosedReason: string;
    organization: { slug: string; displayName: string; city: string; country: string; verification: string };
  }) {
    return {
      slug: job.slug,
      title: job.title,
      skills: job.skills,
      contractType: job.contractType,
      contractMonths: job.contractMonths,
      deliveryMode: job.deliveryMode,
      city: job.city,
      closesAt: job.closesAt,
      openings: job.openings,
      state: job.state,
      ...this.salaryView(job),
      organization: {
        slug: job.organization.slug,
        displayName: job.organization.displayName,
        city: job.organization.city,
        country: job.organization.country,
        verified: job.organization.verification === 'verified'
      }
    };
  }

  private applicationView(application: {
    id: string; jobId: string; reference: string; state: string; coverNote: string;
    sharingConsent: boolean; submittedAt: Date | null; decidedAt: Date | null;
    withdrawnReason: string; version: number; createdAt: Date;
  }) {
    return {
      id: application.id,
      jobId: application.jobId,
      reference: application.reference,
      state: application.state,
      sharingConsent: application.sharingConsent,
      submittedAt: application.submittedAt,
      decidedAt: application.decidedAt,
      withdrawnReason: application.withdrawnReason,
      version: application.version,
      createdAt: application.createdAt,
      /** A job candidacy and a training candidacy are different things, and the DTO says which. */
      kind: 'job' as const
    };
  }

  private employerApplicationView(row: {
    id: string; jobId: string; reference: string; state: string; coverNote: string;
    sharingConsent: boolean; submittedAt: Date | null; decidedAt: Date | null;
    withdrawnReason: string; version: number; createdAt: Date;
    user: { id: string; name: string; email?: string; candidateProfile: {
      headline: string; summary: string; city: string; availability: string; education: string;
      experience: string; skills: string[]; cvReference: string; shareWithOperators: boolean; shareContact: boolean;
    } | null };
    job: { id: string; title: string };
    interviews?: Array<{ scheduledAt: Date; state: string; timezone: string }> | undefined;
    offers?: Array<{ id: string; sequence: number; state: string }> | undefined;
    referral?: { referredBy: string; consentedAt: Date | null } | null | undefined;
  }) {
    // Two conditions, both required: consent on this application, and a profile still set to share.
    const shared = row.sharingConsent && Boolean(row.user.candidateProfile?.shareWithOperators);
    const profile = row.user.candidateProfile;
    return {
      id: row.id,
      reference: row.reference,
      state: row.state,
      job: row.job,
      submittedAt: row.submittedAt,
      version: row.version,
      candidate: shared && profile
        ? {
            name: row.user.name,
            headline: profile.headline,
            summary: profile.summary,
            city: profile.city,
            availability: profile.availability,
            education: profile.education,
            experience: profile.experience,
            skills: profile.skills,
            cvReference: profile.cvReference,
            email: profile.shareContact ? row.user.email ?? null : null
          }
        : null,
      profileShared: shared,
      profileWithheldReason: shared ? '' : row.sharingConsent ? 'consent_revoked' : 'no_consent',
      viaReferral: Boolean(row.referral),
      nextInterview: row.interviews?.[0] ? { scheduledAt: row.interviews[0].scheduledAt, state: row.interviews[0].state, timezone: row.interviews[0].timezone } : null,
      latestOffer: row.offers?.[0] ? { id: row.offers[0].id, sequence: row.offers[0].sequence, state: row.offers[0].state } : null
    };
  }

  private interviewView(interview: {
    id: string; scheduledAt: Date; durationMinutes: number; timezone: string; mode: string;
    location: string; state: string; confirmedAt: Date | null; version: number;
  }) {
    return {
      id: interview.id,
      scheduledAt: interview.scheduledAt,
      durationMinutes: interview.durationMinutes,
      timezone: interview.timezone,
      mode: interview.mode,
      location: interview.location,
      state: interview.state,
      confirmedAt: interview.confirmedAt,
      version: interview.version
    };
  }
}
