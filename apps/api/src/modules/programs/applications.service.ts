import { randomBytes } from 'node:crypto';
import type { DatabaseClient } from '@tamkeen/database';
import { IdentityError } from '../identity/policy.js';
import { IdentityService } from '../identity/identity.service.js';
import { APPLYING_STATES, seatHoldingStates } from './programs.service.js';

/**
 * Candidate profiles, applications, interviews, decisions and seats
 * (07-INCUBATION-EMPLOYMENT, PER-10/11/12, PRG-03).
 *
 * The three things this module exists to get right:
 *
 *  - **A seat is never sold twice.** An acceptance locks the cohort row, counts the seats actually
 *    held, and only then writes. A deferred constraint trigger says the same thing at COMMIT, so
 *    the rule survives any future code path that forgets to take the lock.
 *  - **A file is shared because somebody said so.** An operator sees a candidate's profile only
 *    where that candidate consented, for that application, and the consent is revocable.
 *  - **Training is not employment.** Nothing in here creates, implies or reserves a job, and the
 *    acceptance DTO says so where a reader would otherwise assume it.
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

/** Short, human-quotable, and not a database identifier. */
const applicationReference = () => `APP-${randomBytes(4).toString('hex').toUpperCase()}`;

/** Application states a candidate may still abandon without a decision having been taken. */
const WITHDRAWABLE = ['submitted', 'screening', 'shortlisted', 'interview', 'waitlisted', 'accepted'] as const;
/** States in which the operator is still working on the candidacy. */
const IN_REVIEW = ['submitted', 'screening', 'shortlisted', 'interview'] as const;

export class ApplicationsService {
  private readonly identity: IdentityService;
  constructor(private readonly db: DatabaseClient) {
    this.identity = new IdentityService(db);
  }

  // ---------------------------------------------------------------- PER-10: the candidate profile

  async myProfile(actorId: string) {
    const user = await this.identity.activeUser(actorId);
    const profile = await this.db.candidateProfile.findUnique({ where: { userId: user.id } });
    // Absent rather than empty: never having filled it in is not the same as filling it in blank.
    if (!profile) {
      return {
        exists: false as const, headline: '', summary: '', city: '', availability: '',
        education: '', experience: '', skills: [] as string[], cvReference: '',
        shareWithOperators: false, shareContact: false, version: 0
      };
    }
    return { exists: true as const, ...this.profileView(profile) };
  }

  /** PER-10.A01. Consent is part of the same save, and defaults to off. */
  async saveProfile(actorId: string, input: {
    headline?: string | undefined; summary?: string | undefined; city?: string | undefined;
    availability?: string | undefined; education?: string | undefined; experience?: string | undefined;
    skills?: string[] | undefined; cvReference?: string | undefined;
    shareWithOperators?: boolean | undefined; shareContact?: boolean | undefined;
    version?: number | undefined;
  }) {
    const user = await this.identity.activeUser(actorId);
    const skills = (input.skills ?? []).map(skill => text(skill, 1, 60));
    if (skills.length > 40 || new Set(skills).size !== skills.length) throw new IdentityError('invalid_input', 422);
    const data = {
      headline: optionalText(input.headline, 200),
      summary: optionalText(input.summary, 2000),
      city: optionalText(input.city, 100),
      availability: optionalText(input.availability, 200),
      education: optionalText(input.education, 1000),
      experience: optionalText(input.experience, 2000),
      skills,
      cvReference: optionalText(input.cvReference, 200),
      shareWithOperators: input.shareWithOperators ?? false,
      // Sharing a contact detail is a second, narrower decision than sharing a profile, so it is
      // its own switch and cannot be turned on without the first.
      shareContact: (input.shareWithOperators ?? false) ? (input.shareContact ?? false) : false
    };

    const existing = await this.db.candidateProfile.findUnique({ where: { userId: user.id } });
    if (!existing) {
      const created = await this.db.candidateProfile.create({ data: { userId: user.id, ...data } });
      return this.profileView(created);
    }
    if (input.version !== existing.version) throw new IdentityError('conflict', 409);
    const updated = await this.db.candidateProfile.update({ where: { userId: user.id }, data: { ...data, version: { increment: 1 } } });
    return this.profileView(updated);
  }

  /**
   * PER-10.A03. Exactly what an operator would see, built from the same allowlist they read.
   *
   * This is the point of the screen: the candidate checks what leaves their account, and finds the
   * answer produced by the same function the operator's view uses rather than a hand-written mock.
   */
  async employerPreview(actorId: string) {
    const user = await this.identity.activeUser(actorId);
    const profile = await this.db.candidateProfile.findUnique({ where: { userId: user.id } });
    if (!profile) throw new IdentityError('not_found', 404);
    return {
      shared: profile.shareWithOperators,
      /** Named, so the reader knows the absence is a policy and not a loading failure. */
      withheld: ['email', 'phone', 'nationalId', 'dateOfBirth', 'attendanceRecord', 'assessmentScores'],
      profile: this.sharedProfileView(profile, { name: user.name, email: user.email })
    };
  }

  // ---------------------------------------------------------------- PER-11: applying

  /** PER-11.A01. A draft. It reserves nothing, and is visible to nobody but its author. */
  async saveDraft(actorId: string, input: { cohortId: string; answers?: Record<string, unknown> | undefined; motivation?: string | undefined; sharingConsent?: boolean | undefined; applicationId?: string | undefined; version?: number | undefined }) {
    const user = await this.identity.activeUser(actorId);
    const motivation = optionalText(input.motivation, 4000);
    const answers = (input.answers ?? {}) as object;
    const sharingConsent = input.sharingConsent ?? false;

    return this.db.$transaction(async tx => {
      const cohort = await tx.cohort.findUnique({ where: { id: input.cohortId }, include: { program: true } });
      if (!cohort) throw new IdentityError('not_found', 404);
      if (cohort.state === 'cancelled') throw new IdentityError('conflict', 409);

      if (input.applicationId) {
        const existing = await tx.application.findUnique({ where: { id: input.applicationId } });
        if (!existing || existing.userId !== user.id) throw new IdentityError('not_found', 404);
        if (existing.state !== 'draft') throw new IdentityError('conflict', 409);
        if (existing.version !== input.version) throw new IdentityError('conflict', 409);
        const updated = await tx.application.update({
          where: { id: existing.id },
          data: { answers, motivation, sharingConsent, version: { increment: 1 } }
        });
        return this.applicationView(updated);
      }

      // 07: one application per person per cohort. The unique index is what actually enforces it;
      // this read only turns a database error into a clear conflict.
      const duplicate = await tx.application.findUnique({ where: { cohortId_userId: { cohortId: cohort.id, userId: user.id } } });
      if (duplicate) throw new IdentityError('conflict', 409);

      const created = await tx.application.create({
        data: {
          programId: cohort.programId, cohortId: cohort.id, userId: user.id,
          reference: applicationReference(), state: 'draft', answers, motivation, sharingConsent
        }
      });
      return this.applicationView(created);
    });
  }

  /**
   * PER-11.A02. Submitting.
   *
   * The deadline is checked here, on the server, at the moment of submission — not when the form
   * was opened. A candidate who left the tab open overnight does not get in after the window shut.
   */
  async submit(actorId: string, applicationId: string, input: { sharingConsent: boolean; version: number }) {
    const user = await this.identity.activeUser(actorId);

    return this.db.$transaction(async tx => {
      const application = await tx.application.findUnique({
        where: { id: applicationId },
        include: { program: true, cohort: true }
      });
      if (!application || application.userId !== user.id) throw new IdentityError('not_found', 404);
      if (application.state !== 'draft') throw new IdentityError('conflict', 409);
      if (application.version !== input.version) throw new IdentityError('conflict', 409);
      if (!APPLYING_STATES.includes(application.program.state)) throw new IdentityError('conflict', 409);
      if (application.program.applyOpensAt && application.program.applyOpensAt > new Date()) throw new IdentityError('conflict', 409);
      if (application.program.applyClosesAt && application.program.applyClosesAt <= new Date()) throw new IdentityError('conflict', 409);
      if (application.cohort.state === 'cancelled') throw new IdentityError('conflict', 409);
      if (!application.motivation.trim()) throw new IdentityError('invalid_input', 422);
      // Sharing the profile with this operator is what makes the application readable at all, so a
      // submission without it would be a candidacy nobody could assess.
      if (!input.sharingConsent) throw new IdentityError('invalid_input', 422);

      const profile = await tx.candidateProfile.findUnique({ where: { userId: user.id } });
      if (!profile) throw new IdentityError('conflict', 409);

      const updated = await tx.application.update({
        where: { id: application.id },
        data: { state: 'submitted', sharingConsent: true, submittedAt: new Date(), version: { increment: 1 } }
      });
      await tx.identityAuditEvent.create({ data: { actorId: user.id, resourceId: application.id, action: 'application.submitted' } });
      return this.applicationView(updated);
    });
  }

  /** PER-11.A04. Discarding a draft. Archived rather than deleted; it was never anybody else's. */
  async discard(actorId: string, applicationId: string, version: number) {
    const user = await this.identity.activeUser(actorId);
    const application = await this.db.application.findUnique({ where: { id: applicationId } });
    if (!application || application.userId !== user.id) throw new IdentityError('not_found', 404);
    if (application.state !== 'draft') throw new IdentityError('conflict', 409);
    if (application.version !== version) throw new IdentityError('conflict', 409);
    const updated = await this.db.application.update({ where: { id: application.id }, data: { state: 'discarded', version: { increment: 1 } } });
    return this.applicationView(updated);
  }

  /** PER-12.A02. Withdrawing. Frees the seat where one was held, and keeps the record of why. */
  async withdraw(actorId: string, applicationId: string, input: { reason: string; version: number }) {
    const user = await this.identity.activeUser(actorId);
    const reason = text(input.reason, 10, 1000);

    return this.db.$transaction(async tx => {
      const application = await tx.application.findUnique({ where: { id: applicationId }, include: { enrollment: true, waitlistEntry: true } });
      if (!application || application.userId !== user.id) throw new IdentityError('not_found', 404);
      if (!WITHDRAWABLE.includes(application.state as typeof WITHDRAWABLE[number])) throw new IdentityError('conflict', 409);
      if (application.version !== input.version) throw new IdentityError('conflict', 409);

      const updated = await tx.application.update({
        where: { id: application.id },
        data: { state: 'withdrawn', withdrawnReason: reason, version: { increment: 1 } }
      });
      // An invitation the candidate has walked away from stops holding a seat immediately, which is
      // what makes the next person on the waitlist reachable rather than blocked by a ghost.
      if (application.enrollment && ['invited', 'confirmed'].includes(application.enrollment.state)) {
        await tx.enrollment.update({ where: { id: application.enrollment.id }, data: { state: 'dropped_out', exitReason: reason, version: { increment: 1 } } });
      }
      if (application.waitlistEntry && application.waitlistEntry.state === 'waiting') {
        await tx.waitlistEntry.update({ where: { id: application.waitlistEntry.id }, data: { state: 'withdrawn' } });
      }
      await tx.identityAuditEvent.create({ data: { actorId: user.id, resourceId: application.id, action: 'application.withdrawn' } });
      return this.applicationView(updated);
    });
  }

  // ---------------------------------------------------------------- PER-12: the candidate's view

  async mine(actorId: string) {
    const user = await this.identity.activeUser(actorId);
    const rows = await this.db.application.findMany({
      where: { userId: user.id, state: { not: 'discarded' } },
      include: {
        program: { select: { slug: true, title: true, state: true, organization: { select: { displayName: true } } } },
        cohort: { select: { id: true, name: true, startAt: true, endAt: true, timezone: true } },
        interviews: { orderBy: { scheduledAt: 'asc' } },
        enrollment: true,
        waitlistEntry: true,
        decisions: { orderBy: { createdAt: 'desc' }, take: 1 }
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });
    return rows.map(row => this.candidateApplicationView(row));
  }

  async one(actorId: string, applicationId: string) {
    const user = await this.identity.activeUser(actorId);
    const application = await this.db.application.findUnique({
      where: { id: applicationId },
      include: {
        program: { select: { slug: true, title: true, state: true, withdrawalPolicy: true, attendancePolicy: true, complaintsContact: true, organization: { select: { displayName: true, slug: true } } } },
        cohort: { select: { id: true, name: true, startAt: true, endAt: true, timezone: true, acceptanceWindowHours: true } },
        interviews: { include: { rescheduleRequests: { orderBy: { createdAt: 'desc' } } }, orderBy: { scheduledAt: 'asc' } },
        enrollment: true,
        waitlistEntry: true,
        decisions: { orderBy: { createdAt: 'desc' } }
      }
    });
    if (!application || application.userId !== user.id) throw new IdentityError('not_found', 404);
    return {
      ...this.candidateApplicationView(application),
      program: application.program,
      // The reasons the candidate was given, in order. The reviewer's private note is not here.
      decisions: application.decisions.map(decision => ({ id: decision.id, outcome: decision.outcome, reason: decision.reason, at: decision.createdAt })),
      interviews: application.interviews.map(interview => ({
        ...this.interviewView(interview),
        rescheduleRequests: interview.rescheduleRequests.map(request => ({ id: request.id, reason: request.reason, alternatives: request.alternatives, resolvedAt: request.resolvedAt, createdAt: request.createdAt }))
      }))
    };
  }

  /** PER-12.A03. Confirming an appointment, which is the candidate's to confirm and nobody else's. */
  async confirmInterview(actorId: string, interviewId: string, version: number) {
    const user = await this.identity.activeUser(actorId);
    return this.db.$transaction(async tx => {
      const interview = await tx.interview.findUnique({ where: { id: interviewId }, include: { application: true, jobApplication: true } });
      // PART-11 made an appointment belong to a programme candidacy or a job candidacy. Either way
      // the person confirming has to be the candidate, so the owner is resolved before the check
      // rather than one kind being assumed.
      const owner = interview?.application?.userId ?? interview?.jobApplication?.userId;
      if (!interview || owner !== user.id) throw new IdentityError('not_found', 404);
      if (!['proposed', 'reschedule_requested'].includes(interview.state)) throw new IdentityError('conflict', 409);
      if (interview.version !== version) throw new IdentityError('conflict', 409);
      // Confirming an appointment that has already passed tells nobody anything useful.
      if (interview.scheduledAt <= new Date()) throw new IdentityError('conflict', 409);
      const updated = await tx.interview.update({ where: { id: interview.id }, data: { state: 'confirmed', confirmedAt: new Date(), version: { increment: 1 } } });
      return this.interviewView(updated);
    });
  }

  /**
   * PER-12.A04. Asking for a different time.
   *
   * It is a request. The appointment does not move, because a silent reschedule leaves two people
   * holding two different beliefs about when to turn up.
   */
  async requestReschedule(actorId: string, interviewId: string, input: { reason: string; alternatives?: string | undefined }) {
    const user = await this.identity.activeUser(actorId);
    const reason = text(input.reason, 10, 1000);
    const alternatives = optionalText(input.alternatives, 1000);

    return this.db.$transaction(async tx => {
      const interview = await tx.interview.findUnique({ where: { id: interviewId }, include: { application: true, jobApplication: true } });
      const owner = interview?.application?.userId ?? interview?.jobApplication?.userId;
      if (!interview || owner !== user.id) throw new IdentityError('not_found', 404);
      if (['completed', 'cancelled'].includes(interview.state)) throw new IdentityError('conflict', 409);
      const request = await tx.interviewRescheduleRequest.create({ data: { interviewId: interview.id, requestedBy: user.id, reason, alternatives } });
      await tx.interview.update({ where: { id: interview.id }, data: { state: 'reschedule_requested', version: { increment: 1 } } });
      return {
        id: request.id,
        interviewId: interview.id,
        reason: request.reason,
        alternatives: request.alternatives,
        /** The original time still stands until the operator acts, and the reply says so. */
        appointmentMoved: false,
        scheduledAt: interview.scheduledAt,
        timezone: interview.timezone,
        createdAt: request.createdAt
      };
    });
  }

  /**
   * PER-12.A05. Accepting a seat.
   *
   * The lock, then the count, then the write — the same shape a commitment uses in PART-09, and for
   * the same reason: two people accepting the last seat at the same moment must not both get it.
   */
  async acceptSeat(actorId: string, enrollmentId: string, version: number) {
    const user = await this.identity.activeUser(actorId);

    return this.db.$transaction(async tx => {
      const enrollment = await tx.enrollment.findUnique({ where: { id: enrollmentId }, include: { cohort: true } });
      if (!enrollment || enrollment.userId !== user.id) throw new IdentityError('not_found', 404);
      if (enrollment.state !== 'invited') throw new IdentityError('conflict', 409);
      if (enrollment.version !== version) throw new IdentityError('conflict', 409);
      // An invitation that has run out is not one somebody gets to accept late.
      if (enrollment.invitationExpiresAt <= new Date()) throw new IdentityError('conflict', 409);
      if (enrollment.cohort.state === 'cancelled') throw new IdentityError('conflict', 409);

      await tx.$queryRaw`SELECT id FROM cohorts WHERE id = ${enrollment.cohortId}::uuid FOR UPDATE`;
      const taken = await this.seatsTaken(tx as DatabaseClient, enrollment.cohortId, enrollment.id);
      if (taken >= enrollment.cohort.capacity) throw new IdentityError('conflict', 409);

      const updated = await tx.enrollment.update({
        where: { id: enrollment.id },
        data: { state: 'confirmed', confirmedAt: new Date(), version: { increment: 1 } }
      });
      if (enrollment.applicationId) {
        await tx.waitlistEntry.updateMany({ where: { applicationId: enrollment.applicationId }, data: { state: 'enrolled' } });
      }
      await tx.identityAuditEvent.create({ data: { actorId: user.id, resourceId: enrollment.id, action: 'enrollment.confirmed' } });
      return this.enrollmentView(updated);
    });
  }

  // ---------------------------------------------------------------- PRG-03: screening

  /** PRG-03. The operator's queue. A profile appears only where its owner consented to share it. */
  async listForOrganization(actorId: string, organizationId: string, filters: { programId?: string | undefined; cohortId?: string | undefined; state?: string | undefined; pending?: boolean | undefined }) {
    await this.identity.access(actorId, organizationId, 'application.review');
    const rows = await this.db.application.findMany({
      where: {
        program: { organizationId },
        state: filters.pending ? { in: [...IN_REVIEW] } : filters.state ? (filters.state as never) : { not: 'draft' },
        ...(filters.programId ? { programId: filters.programId } : {}),
        ...(filters.cohortId ? { cohortId: filters.cohortId } : {})
      },
      include: {
        user: { select: { id: true, name: true, candidateProfile: true } },
        cohort: { select: { id: true, name: true, capacity: true } },
        program: { select: { id: true, title: true } },
        reviews: { orderBy: { createdAt: 'desc' }, take: 1 },
        interviews: { orderBy: { scheduledAt: 'desc' }, take: 1 },
        enrollment: true,
        waitlistEntry: true
      },
      orderBy: { submittedAt: 'asc' },
      take: 200
    });
    return rows.map(row => this.operatorApplicationView(row));
  }

  /** PRG-03.A01. One candidate, with only what they agreed to share. */
  async getForOrganization(actorId: string, organizationId: string, applicationId: string) {
    await this.identity.access(actorId, organizationId, 'application.review');
    const application = await this.db.application.findFirst({
      where: { id: applicationId, program: { organizationId } },
      include: {
        user: { select: { id: true, name: true, email: true, candidateProfile: true } },
        cohort: { select: { id: true, name: true, capacity: true, startAt: true, endAt: true, timezone: true } },
        program: { select: { id: true, title: true, selectionMethod: true } },
        reviews: { include: { reviewer: { select: { name: true } } }, orderBy: { createdAt: 'desc' } },
        decisions: { include: { decider: { select: { name: true } } }, orderBy: { createdAt: 'desc' } },
        interviews: { orderBy: { scheduledAt: 'desc' } },
        enrollment: true,
        waitlistEntry: true
      }
    });
    if (!application) throw new IdentityError('not_found', 404);
    return {
      ...this.operatorApplicationView(application),
      answers: application.answers,
      motivation: application.motivation,
      program: application.program,
      // The reviewer's own notes stay inside the operator; they are never in the candidate's view.
      reviews: application.reviews.map(review => ({
        id: review.id, total: review.total, scaleMax: review.scaleMax, scores: review.scores,
        note: review.note, reviewer: review.reviewer.name, at: review.createdAt
      })),
      decisions: application.decisions.map(decision => ({ id: decision.id, outcome: decision.outcome, reason: decision.reason, decider: decision.decider.name, at: decision.createdAt })),
      interviews: application.interviews.map(interview => this.interviewView(interview))
    };
  }

  /** PRG-03.A02. A score against a rubric, with the reason kept private to the operator. */
  async review(actorId: string, organizationId: string, applicationId: string, input: { scores: Record<string, number>; note: string; scaleMax?: number | undefined }) {
    await this.identity.access(actorId, organizationId, 'application.review');
    const note = text(input.note, 10, 2000);
    const scaleMax = input.scaleMax ?? 5;
    if (!Number.isInteger(scaleMax) || scaleMax < 1 || scaleMax > 100) throw new IdentityError('invalid_input', 422);
    const entries = Object.entries(input.scores ?? {});
    if (!entries.length || entries.length > 20) throw new IdentityError('invalid_input', 422);
    let total = 0;
    for (const [criterion, score] of entries) {
      if (typeof criterion !== 'string' || criterion.length > 60) throw new IdentityError('invalid_input', 422);
      if (!Number.isInteger(score) || score < 0 || score > scaleMax) throw new IdentityError('invalid_input', 422);
      total += score;
    }

    return this.db.$transaction(async tx => {
      const application = await tx.application.findFirst({ where: { id: applicationId, program: { organizationId } } });
      if (!application) throw new IdentityError('not_found', 404);
      if (!IN_REVIEW.includes(application.state as typeof IN_REVIEW[number])) throw new IdentityError('conflict', 409);

      const review = await tx.applicationReview.create({
        data: { applicationId: application.id, reviewerId: actorId, scores: input.scores as object, total, scaleMax, note }
      });
      if (application.state === 'submitted') {
        await tx.application.update({ where: { id: application.id }, data: { state: 'screening', version: { increment: 1 } } });
      }
      return { id: review.id, total: review.total, scaleMax: review.scaleMax, at: review.createdAt };
    });
  }

  /** PRG-03.A03. An appointment, with the zone it was set in and an invitation to confirm. */
  async scheduleInterview(actorId: string, organizationId: string, applicationId: string, input: { scheduledAt: string; durationMinutes?: number | undefined; timezone?: string | undefined; mode?: 'in_person' | 'remote' | 'hybrid' | undefined; location?: string | undefined }) {
    await this.identity.access(actorId, organizationId, 'application.review');
    const scheduledAt = new Date(input.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) throw new IdentityError('invalid_input', 422);
    // An appointment in the past is not an appointment.
    if (scheduledAt <= new Date()) throw new IdentityError('invalid_input', 422);
    const durationMinutes = input.durationMinutes ?? 30;
    if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 480) throw new IdentityError('invalid_input', 422);
    const timezone = optionalText(input.timezone, 60) || 'Asia/Hebron';
    const mode = input.mode ?? 'in_person';
    if (!['in_person', 'remote', 'hybrid'].includes(mode)) throw new IdentityError('invalid_input', 422);
    const location = optionalText(input.location, 300);
    // A place is what makes an in-person appointment attendable.
    if (mode !== 'remote' && !location) throw new IdentityError('invalid_input', 422);

    return this.db.$transaction(async tx => {
      const application = await tx.application.findFirst({ where: { id: applicationId, program: { organizationId } } });
      if (!application) throw new IdentityError('not_found', 404);
      if (!IN_REVIEW.includes(application.state as typeof IN_REVIEW[number])) throw new IdentityError('conflict', 409);

      const interview = await tx.interview.create({
        data: { applicationId: application.id, scheduledAt, durationMinutes, timezone, mode, location, scheduledBy: actorId, state: 'proposed' }
      });
      if (application.state !== 'interview') {
        await tx.application.update({ where: { id: application.id }, data: { state: 'interview', version: { increment: 1 } } });
      }
      await tx.outboxEvent.create({ data: { topic: 'interview.proposed', payload: { interviewId: interview.id } } });
      return this.interviewView(interview);
    });
  }

  /**
   * PRG-03.A04. Accept, waitlist or reject.
   *
   * Accepting is where the seat is actually taken, so this is the transaction that locks the cohort
   * and counts. An acceptance that would exceed capacity is refused rather than waitlisted quietly:
   * the operator asked for something impossible and needs to know.
   */
  async decide(actorId: string, organizationId: string, applicationId: string, input: { outcome: 'accepted' | 'waitlisted' | 'rejected'; reason: string; version: number }) {
    await this.identity.access(actorId, organizationId, 'application.review');
    const reason = input.outcome === 'accepted' ? optionalText(input.reason, 1000) : text(input.reason, 10, 1000);

    return this.db.$transaction(async tx => {
      const application = await tx.application.findFirst({
        where: { id: applicationId, program: { organizationId } },
        include: { cohort: true }
      });
      if (!application) throw new IdentityError('not_found', 404);
      if (!IN_REVIEW.includes(application.state as typeof IN_REVIEW[number])) throw new IdentityError('conflict', 409);
      if (application.version !== input.version) throw new IdentityError('conflict', 409);
      if (!application.sharingConsent) throw new IdentityError('conflict', 409);

      await tx.applicationDecision.create({ data: { applicationId: application.id, deciderId: actorId, outcome: input.outcome, reason } });

      if (input.outcome === 'rejected') {
        const updated = await tx.application.update({ where: { id: application.id }, data: { state: 'rejected', decidedAt: new Date(), version: { increment: 1 } } });
        await tx.outboxEvent.create({ data: { topic: 'application.decided', payload: { applicationId: application.id, outcome: 'rejected' } } });
        return { application: this.applicationView(updated), enrollment: null, waitlistPosition: null, trainingIsNotEmployment: true as const };
      }

      if (input.outcome === 'waitlisted') {
        const last = await tx.waitlistEntry.findFirst({ where: { cohortId: application.cohortId }, orderBy: { position: 'desc' } });
        const entry = await tx.waitlistEntry.upsert({
          where: { applicationId: application.id },
          create: { cohortId: application.cohortId, applicationId: application.id, position: (last?.position ?? 0) + 1, state: 'waiting' },
          update: { state: 'waiting' }
        });
        const updated = await tx.application.update({ where: { id: application.id }, data: { state: 'waitlisted', decidedAt: new Date(), version: { increment: 1 } } });
        await tx.outboxEvent.create({ data: { topic: 'application.decided', payload: { applicationId: application.id, outcome: 'waitlisted' } } });
        return { application: this.applicationView(updated), enrollment: null, waitlistPosition: entry.position, trainingIsNotEmployment: true as const };
      }

      // Accepted. The lock is taken before the seats are counted and inside the transaction that
      // writes the invitation, so two acceptances cannot both read the same last free seat.
      await tx.$queryRaw`SELECT id FROM cohorts WHERE id = ${application.cohortId}::uuid FOR UPDATE`;
      const taken = await this.seatsTaken(tx as DatabaseClient, application.cohortId);
      if (taken >= application.cohort.capacity) throw new IdentityError('conflict', 409);

      const enrollment = await tx.enrollment.create({
        data: {
          cohortId: application.cohortId, userId: application.userId, applicationId: application.id,
          state: 'invited',
          invitationExpiresAt: new Date(Date.now() + application.cohort.acceptanceWindowHours * 3_600_000)
        }
      });
      const updated = await tx.application.update({ where: { id: application.id }, data: { state: 'accepted', decidedAt: new Date(), version: { increment: 1 } } });
      await tx.outboxEvent.create({ data: { topic: 'application.decided', payload: { applicationId: application.id, outcome: 'accepted' } } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: application.id, action: 'application.accepted' } });
      return {
        application: this.applicationView(updated),
        enrollment: this.enrollmentView(enrollment),
        waitlistPosition: null,
        /** 07's stage limit, said in the reply: being accepted onto training is not being hired. */
        trainingIsNotEmployment: true as const
      };
    });
  }

  /**
   * Seats actually held right now.
   *
   * An invitation that has lapsed holds nothing, which is the whole point of having a window: the
   * seat comes back without anybody running a job. The same definition is used by the deferred
   * constraint trigger, so the two can never disagree about what "taken" means.
   */
  private async seatsTaken(tx: DatabaseClient, cohortId: string, excludeEnrollmentId?: string) {
    return tx.enrollment.count({
      where: {
        cohortId,
        ...(excludeEnrollmentId ? { id: { not: excludeEnrollmentId } } : {}),
        ...seatHoldingStates()
      }
    });
  }

  /** Seats, for a screen that must not invite an operator to accept into a full cohort. */
  async cohortCapacity(actorId: string, organizationId: string, cohortId: string) {
    await this.identity.access(actorId, organizationId, 'program.read');
    const cohort = await this.db.cohort.findFirst({ where: { id: cohortId, program: { organizationId } } });
    if (!cohort) throw new IdentityError('not_found', 404);
    const taken = await this.seatsTaken(this.db, cohortId);
    const waiting = await this.db.waitlistEntry.count({ where: { cohortId, state: 'waiting' } });
    return {
      cohortId, capacity: cohort.capacity, seatsTaken: taken,
      seatsRemaining: Math.max(0, cohort.capacity - taken),
      waitlistLength: waiting
    };
  }

  // ---------------------------------------------------------------- shaping

  private profileView(profile: {
    headline: string; summary: string; city: string; availability: string; education: string;
    experience: string; skills: string[]; cvReference: string; shareWithOperators: boolean;
    shareContact: boolean; version: number;
  }) {
    return {
      headline: profile.headline, summary: profile.summary, city: profile.city,
      availability: profile.availability, education: profile.education, experience: profile.experience,
      skills: profile.skills, cvReference: profile.cvReference,
      shareWithOperators: profile.shareWithOperators, shareContact: profile.shareContact,
      version: profile.version,
      /** Uploading is PART-13; this build stores the name the candidate typed, not a file. */
      cvUploadAvailable: false
    };
  }

  /**
   * The allowlist. One function, used both by the candidate's preview and by the operator's read,
   * so what the candidate is shown is what the operator actually gets.
   */
  private sharedProfileView(profile: {
    headline: string; summary: string; city: string; availability: string; education: string;
    experience: string; skills: string[]; cvReference: string; shareContact: boolean;
  }, user: { name: string; email: string }) {
    return {
      name: user.name,
      headline: profile.headline,
      summary: profile.summary,
      city: profile.city,
      availability: profile.availability,
      education: profile.education,
      experience: profile.experience,
      skills: profile.skills,
      cvReference: profile.cvReference,
      // A second, narrower consent. Off by default, and absent rather than blank when withheld.
      email: profile.shareContact ? user.email : null
    };
  }

  private applicationView(application: {
    id: string; programId: string; cohortId: string; reference: string; state: string;
    motivation: string; sharingConsent: boolean; submittedAt: Date | null; decidedAt: Date | null;
    withdrawnReason: string; version: number; createdAt: Date;
  }) {
    return {
      id: application.id,
      programId: application.programId,
      cohortId: application.cohortId,
      reference: application.reference,
      state: application.state,
      motivation: application.motivation,
      sharingConsent: application.sharingConsent,
      submittedAt: application.submittedAt,
      decidedAt: application.decidedAt,
      withdrawnReason: application.withdrawnReason,
      version: application.version,
      createdAt: application.createdAt
    };
  }

  private candidateApplicationView(row: {
    id: string; programId: string; cohortId: string; reference: string; state: string;
    motivation: string; sharingConsent: boolean; submittedAt: Date | null; decidedAt: Date | null;
    withdrawnReason: string; version: number; createdAt: Date;
    program: { slug: string; title: string; state: string; organization: { displayName: string } };
    cohort: { id: string; name: string; startAt: Date; endAt: Date; timezone: string };
    interviews: Array<{ id: string; scheduledAt: Date; durationMinutes: number; timezone: string; mode: string; location: string; state: string; confirmedAt: Date | null; version: number }>;
    enrollment: { id: string; state: string; invitationExpiresAt: Date; confirmedAt: Date | null; version: number } | null;
    waitlistEntry: { position: number; state: string } | null;
    decisions: Array<{ outcome: string; reason: string; createdAt: Date }>;
  }) {
    const latest = row.decisions[0];
    return {
      ...this.applicationView(row),
      programSlug: row.program.slug,
      programTitle: row.program.title,
      operator: row.program.organization.displayName,
      cohort: row.cohort,
      interviews: row.interviews.map(interview => this.interviewView(interview)),
      enrollment: row.enrollment
        ? {
            id: row.enrollment.id, state: row.enrollment.state,
            invitationExpiresAt: row.enrollment.invitationExpiresAt,
            confirmedAt: row.enrollment.confirmedAt, version: row.enrollment.version,
            /** True only while the seat can still be taken, so a screen never offers a dead button. */
            acceptable: row.enrollment.state === 'invited' && row.enrollment.invitationExpiresAt > new Date()
          }
        : null,
      waitlistPosition: row.waitlistEntry?.state === 'waiting' ? row.waitlistEntry.position : null,
      latestDecision: latest ? { outcome: latest.outcome, reason: latest.reason, at: latest.createdAt } : null,
      /** Repeated on every application, because it is the thing people most often assume wrongly. */
      trainingIsNotEmployment: true as const
    };
  }

  private operatorApplicationView(row: {
    id: string; programId: string; cohortId: string; reference: string; state: string;
    motivation: string; sharingConsent: boolean; submittedAt: Date | null; decidedAt: Date | null;
    withdrawnReason: string; version: number; createdAt: Date;
    user: { id: string; name: string; email?: string; candidateProfile: {
      headline: string; summary: string; city: string; availability: string; education: string;
      experience: string; skills: string[]; cvReference: string; shareWithOperators: boolean; shareContact: boolean;
    } | null };
    cohort: { id: string; name: string; capacity: number };
    reviews?: Array<{ total: number; scaleMax: number }> | undefined;
    interviews?: Array<{ scheduledAt: Date; state: string; timezone: string }> | undefined;
    enrollment: { id: string; state: string; invitationExpiresAt: Date } | null;
    waitlistEntry: { position: number; state: string } | null;
  }) {
    // Two separate conditions, both required. The candidate consented on this application, and the
    // profile itself is still set to be shared: revoking the second takes it back everywhere.
    const shared = row.sharingConsent && Boolean(row.user.candidateProfile?.shareWithOperators);
    const latestReview = row.reviews?.[0];
    return {
      id: row.id,
      reference: row.reference,
      state: row.state,
      cohort: row.cohort,
      submittedAt: row.submittedAt,
      decidedAt: row.decidedAt,
      version: row.version,
      candidate: shared && row.user.candidateProfile
        ? this.sharedProfileView(row.user.candidateProfile, { name: row.user.name, email: row.user.email ?? '' })
        : null,
      /** Said rather than left as a null the screen has to guess about. */
      profileShared: shared,
      profileWithheldReason: shared ? '' : row.sharingConsent ? 'consent_revoked' : 'no_consent',
      latestScore: latestReview ? { total: latestReview.total, scaleMax: latestReview.scaleMax } : null,
      nextInterview: row.interviews?.[0] ? { scheduledAt: row.interviews[0].scheduledAt, state: row.interviews[0].state, timezone: row.interviews[0].timezone } : null,
      enrollmentState: row.enrollment?.state ?? null,
      waitlistPosition: row.waitlistEntry?.state === 'waiting' ? row.waitlistEntry.position : null
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
      // Carried with every appointment. An instant without the zone it was agreed in is how two
      // people end up an hour apart on the same day.
      timezone: interview.timezone,
      mode: interview.mode,
      location: interview.location,
      state: interview.state,
      confirmedAt: interview.confirmedAt,
      version: interview.version
    };
  }

  private enrollmentView(enrollment: {
    id: string; cohortId: string; userId: string; applicationId: string; state: string;
    invitedAt: Date; invitationExpiresAt: Date; confirmedAt: Date | null; exitReason: string; version: number;
  }) {
    return {
      id: enrollment.id,
      cohortId: enrollment.cohortId,
      applicationId: enrollment.applicationId,
      state: enrollment.state,
      invitedAt: enrollment.invitedAt,
      invitationExpiresAt: enrollment.invitationExpiresAt,
      confirmedAt: enrollment.confirmedAt,
      exitReason: enrollment.exitReason,
      version: enrollment.version,
      acceptable: enrollment.state === 'invited' && enrollment.invitationExpiresAt > new Date(),
      trainingIsNotEmployment: true as const
    };
  }
}
