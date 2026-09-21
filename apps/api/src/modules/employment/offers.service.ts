import { createHash } from 'node:crypto';
import type { DatabaseClient } from '@tamkeen/database';
import { IdentityError } from '../identity/policy.js';
import { IdentityService } from '../identity/identity.service.js';
import { minorToString, parseCurrency, parseMinor } from '../projects/money.js';

/**
 * Interviews, offers, and the moment an offer is accepted (07, PRG-08, PER-14).
 *
 * **JOB-01 lives here.** Accepting an offer creates a placement in `start_pending` and nothing
 * else. It is not a hire, it is not a started job, and it is not counted as one anywhere — the
 * acceptance reply says so in its own fields rather than leaving the caller to infer it.
 *
 * A sent offer is frozen. Changing what somebody is deciding on, or has already agreed to, is the
 * failure this module is shaped to prevent: a change is a new version with its own sequence and its
 * own checksum, so the candidate always knows which text they said yes to.
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

/** A date with no time of day. A start date is a day, not an instant, and timezones must not move it. */
const plainDate = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new IdentityError('invalid_input', 422);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new IdentityError('invalid_input', 422);
  return date;
};

const futureInstant = (value: unknown) => {
  if (typeof value !== 'string') throw new IdentityError('invalid_input', 422);
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date <= new Date()) throw new IdentityError('invalid_input', 422);
  return date;
};

const CONTRACT_TYPES = ['full_time', 'part_time', 'fixed_term', 'apprenticeship', 'temporary'] as const;

/** The exact text as sent, so an acceptance names a specific document and not "the offer". */
const checksum = (offer: { title: string; terms: string; contractType: string; contractMonths: number | null; salaryMinor: bigint | null; salaryCurrency: string | null; salaryPeriod: string; proposedStartDate: Date }) =>
  createHash('sha256').update(JSON.stringify({
    title: offer.title,
    terms: offer.terms,
    contractType: offer.contractType,
    contractMonths: offer.contractMonths,
    salaryMinor: offer.salaryMinor === null ? null : offer.salaryMinor.toString(),
    salaryCurrency: offer.salaryCurrency,
    salaryPeriod: offer.salaryPeriod,
    proposedStartDate: offer.proposedStartDate.toISOString().slice(0, 10)
  })).digest('hex');

export class OffersService {
  private readonly identity: IdentityService;
  constructor(private readonly db: DatabaseClient) {
    this.identity = new IdentityService(db);
  }

  // ---------------------------------------------------------------- interviews (PRG-08)

  /**
   * An appointment for a job candidacy.
   *
   * The timezone is stored rather than assumed: a candidate and a recruiter in different places
   * reading the same row is how people miss interviews.
   */
  async scheduleInterview(actorId: string, organizationId: string, applicationId: string, input: {
    scheduledAt: string; durationMinutes?: number | undefined; timezone?: string | undefined;
    mode?: 'in_person' | 'remote' | 'hybrid' | undefined; location?: string | undefined; version: number;
  }) {
    await this.identity.access(actorId, organizationId, 'application.review');
    const scheduledAt = futureInstant(input.scheduledAt);
    const mode = input.mode ?? 'in_person';
    if (!['in_person', 'remote', 'hybrid'].includes(mode)) throw new IdentityError('invalid_input', 422);
    const location = optionalText(input.location, 300);
    // An in-person appointment with no address is a meeting nobody can attend.
    if (mode !== 'remote' && location.length < 3) throw new IdentityError('invalid_input', 422);

    return this.db.$transaction(async tx => {
      const application = await tx.jobApplication.findFirst({ where: { id: applicationId, job: { organizationId } } });
      if (!application) throw new IdentityError('not_found', 404);
      if (!['submitted', 'screening', 'shortlisted', 'interview'].includes(application.state)) throw new IdentityError('conflict', 409);
      if (application.version !== input.version) throw new IdentityError('conflict', 409);

      const interview = await tx.interview.create({
        data: {
          jobApplicationId: application.id,
          scheduledAt,
          durationMinutes: input.durationMinutes ?? 45,
          timezone: input.timezone ? text(input.timezone, 3, 60) : 'Asia/Hebron',
          mode,
          location,
          scheduledBy: actorId,
          state: 'proposed'
        }
      });
      if (application.state !== 'interview') {
        await tx.jobApplication.update({ where: { id: application.id }, data: { state: 'interview', version: { increment: 1 } } });
      }
      await tx.outboxEvent.create({ data: { topic: 'job_interview.scheduled', payload: { interviewId: interview.id } } });
      return { id: interview.id, scheduledAt: interview.scheduledAt, timezone: interview.timezone, mode: interview.mode, location: interview.location, state: interview.state, version: interview.version };
    });
  }

  // A job interview is confirmed and rescheduled through the appointment routes PART-10 already
  // owns: `Interview` is one table with two kinds of owner, and those handlers resolve either.
  // Adding a second pair here would be two code paths for one screen's button.

  // ---------------------------------------------------------------- offers (PRG-08)

  /** PRG-08.A01. A draft offer. Nothing has been said to the candidate yet. */
  async createOffer(actorId: string, organizationId: string, input: {
    jobApplicationId: string; title: string; terms: string;
    contractType?: typeof CONTRACT_TYPES[number] | undefined; contractMonths?: number | null | undefined;
    salaryMinor?: string | null | undefined; salaryCurrency?: string | null | undefined; salaryPeriod?: string | undefined;
    proposedStartDate: string; respondByAt: string;
  }) {
    await this.identity.access(actorId, organizationId, 'job.manage');
    const shape = this.parseOffer(input);

    return this.db.$transaction(async tx => {
      const application = await tx.jobApplication.findFirst({
        where: { id: input.jobApplicationId, job: { organizationId } },
        include: { job: true }
      });
      if (!application) throw new IdentityError('not_found', 404);
      if (!['shortlisted', 'interview', 'offered'].includes(application.state)) throw new IdentityError('conflict', 409);
      if (!application.sharingConsent) throw new IdentityError('conflict', 409);
      if (!['open', 'paused'].includes(application.job.state)) throw new IdentityError('conflict', 409);

      // 07: the seats an employer advertised are the seats they have. An offer beyond the openings
      // already taken up would promise work that does not exist.
      const taken = await tx.placement.count({ where: { jobId: application.jobId, state: { in: ['start_pending', 'started', 'retained'] } } });
      const live = await tx.jobOffer.count({ where: { state: { in: ['draft', 'sent'] }, jobApplication: { jobId: application.jobId } } });
      if (taken + live >= application.job.openings) throw new IdentityError('conflict', 409);

      const previous = await tx.jobOffer.aggregate({ where: { jobApplicationId: application.id }, _max: { sequence: true } });
      const sequence = (previous._max.sequence ?? 0) + 1;
      const body = { ...shape, jobApplicationId: application.id, sequence, createdBy: actorId, state: 'draft' as const };
      const offer = await tx.jobOffer.create({ data: { ...body, termsChecksum: checksum(shape) } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: offer.id, action: 'job_offer.created' } });
      return this.offerView(offer);
    });
  }

  /** Editing a draft. A sent offer is refused here and by a trigger underneath. */
  async updateOffer(actorId: string, organizationId: string, offerId: string, input: Parameters<OffersService['createOffer']>[2] & { version: number }) {
    await this.identity.access(actorId, organizationId, 'job.manage');
    const shape = this.parseOffer(input);

    return this.db.$transaction(async tx => {
      const offer = await tx.jobOffer.findFirst({ where: { id: offerId, jobApplication: { job: { organizationId } } } });
      if (!offer) throw new IdentityError('not_found', 404);
      if (offer.state !== 'draft') throw new IdentityError('conflict', 409);
      if (offer.version !== input.version) throw new IdentityError('conflict', 409);
      const updated = await tx.jobOffer.update({ where: { id: offer.id }, data: { ...shape, termsChecksum: checksum(shape), version: { increment: 1 } } });
      return this.offerView(updated);
    });
  }

  /** PRG-08.A02. Sending it. From here the text is fixed and the clock is running. */
  async sendOffer(actorId: string, organizationId: string, offerId: string, version: number) {
    await this.identity.access(actorId, organizationId, 'job.manage');

    return this.db.$transaction(async tx => {
      const offer = await tx.jobOffer.findFirst({ where: { id: offerId, jobApplication: { job: { organizationId } } }, include: { jobApplication: true } });
      if (!offer) throw new IdentityError('not_found', 404);
      if (offer.state !== 'draft') throw new IdentityError('conflict', 409);
      if (offer.version !== version) throw new IdentityError('conflict', 409);
      // A deadline that has already passed gives the candidate no time to decide.
      if (offer.respondByAt <= new Date()) throw new IdentityError('conflict', 409);

      const sent = await tx.jobOffer.update({ where: { id: offer.id }, data: { state: 'sent', sentAt: new Date(), version: { increment: 1 } } });
      await tx.jobApplication.update({ where: { id: offer.jobApplicationId }, data: { state: 'offered', version: { increment: 1 } } });
      await tx.outboxEvent.create({ data: { topic: 'job_offer.sent', payload: { offerId: offer.id } } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: offer.id, action: 'job_offer.sent' } });
      return this.offerView(sent);
    });
  }

  /**
   * PRG-08.A03. Withdrawing.
   *
   * Before acceptance this is the employer's to do, with a reason the candidate is shown. After
   * acceptance it is not: a placement exists, and unwinding it is an ended placement with its own
   * record, not a quietly retracted offer.
   */
  async withdrawOffer(actorId: string, organizationId: string, offerId: string, input: { reason: string; version: number }) {
    await this.identity.access(actorId, organizationId, 'job.manage');
    const reason = text(input.reason, 10, 1000);

    return this.db.$transaction(async tx => {
      const offer = await tx.jobOffer.findFirst({ where: { id: offerId, jobApplication: { job: { organizationId } } } });
      if (!offer) throw new IdentityError('not_found', 404);
      if (!['draft', 'sent'].includes(offer.state)) throw new IdentityError('conflict', 409);
      if (offer.version !== input.version) throw new IdentityError('conflict', 409);

      const updated = await tx.jobOffer.update({
        where: { id: offer.id },
        data: { state: 'withdrawn', withdrawReason: reason, respondedAt: new Date(), version: { increment: 1 } }
      });
      const application = await tx.jobApplication.findUniqueOrThrow({ where: { id: offer.jobApplicationId } });
      if (application.state === 'offered') {
        // The candidacy goes back to where it was, not to rejected: the employer changed their mind
        // about this offer, which is not the same as deciding against the person.
        await tx.jobApplication.update({ where: { id: application.id }, data: { state: 'shortlisted', version: { increment: 1 } } });
      }
      await tx.outboxEvent.create({ data: { topic: 'job_offer.withdrawn', payload: { offerId: offer.id, reason } } });
      return this.offerView(updated);
    });
  }

  // ---------------------------------------------------------------- the candidate (PER-14)

  /** PER-14. The offer as the candidate sees it, with the deadline resolved rather than implied. */
  async offerForCandidate(actorId: string, offerId: string) {
    const user = await this.identity.activeUser(actorId);
    const offer = await this.db.jobOffer.findUnique({
      where: { id: offerId },
      include: {
        jobApplication: {
          include: { job: { select: { id: true, slug: true, title: true, city: true, deliveryMode: true, organization: { select: { slug: true, displayName: true } } } } }
        },
        placement: { select: { id: true, state: true } }
      }
    });
    if (!offer || offer.jobApplication.userId !== user.id) throw new IdentityError('not_found', 404);
    // A draft has not been sent. To the candidate it does not exist at all.
    if (offer.state === 'draft') throw new IdentityError('not_found', 404);

    const expired = offer.state === 'sent' && offer.respondByAt <= new Date();
    return {
      ...this.offerView(offer),
      job: {
        slug: offer.jobApplication.job.slug,
        title: offer.jobApplication.job.title,
        city: offer.jobApplication.job.city,
        deliveryMode: offer.jobApplication.job.deliveryMode,
        employer: offer.jobApplication.job.organization.displayName
      },
      applicationReference: offer.jobApplication.reference,
      /** Answerable only while it is `sent` and the deadline has not passed. Never inferred in the UI. */
      canRespond: offer.state === 'sent' && !expired,
      respondUnavailableReason: offer.state !== 'sent' ? `offer_${offer.state}` : expired ? 'deadline_passed' : '',
      placement: offer.placement,
      /** Said on the offer itself, before anybody accepts: yes is not a start. */
      acceptanceIsNotAStart: true as const
    };
  }

  /**
   * PER-14.A01 — **JOB-01**.
   *
   * Accepting creates a placement at `start_pending`. It does not create an employment, it is not
   * counted as one, and the reply states both facts rather than leaving them to be assumed. A start
   * is a separate, confirmed event with its own date; see `PlacementsService.confirmStart`.
   */
  async acceptOffer(actorId: string, offerId: string, input: { termsChecksum: string; version: number }) {
    const user = await this.identity.activeUser(actorId);
    const acknowledged = text(input.termsChecksum, 64, 64);

    return this.db.$transaction(async tx => {
      const offer = await tx.jobOffer.findUnique({ where: { id: offerId }, include: { jobApplication: { include: { job: true } } } });
      if (!offer || offer.jobApplication.userId !== user.id) throw new IdentityError('not_found', 404);
      if (offer.state !== 'sent') throw new IdentityError('conflict', 409);
      if (offer.version !== input.version) throw new IdentityError('conflict', 409);
      if (offer.respondByAt <= new Date()) throw new IdentityError('conflict', 409);
      // Acceptance names the exact text. If the checksum does not match what the candidate read,
      // they are agreeing to a document they have not seen.
      if (offer.termsChecksum !== acknowledged) throw new IdentityError('conflict', 409);

      const existing = await tx.placement.findUnique({ where: { jobId_userId: { jobId: offer.jobApplication.jobId, userId: user.id } } });
      if (existing) throw new IdentityError('conflict', 409);

      const accepted = await tx.jobOffer.update({ where: { id: offer.id }, data: { state: 'accepted', respondedAt: new Date(), version: { increment: 1 } } });
      await tx.jobApplication.update({ where: { id: offer.jobApplicationId }, data: { state: 'hired', decidedAt: new Date(), version: { increment: 1 } } });

      // JOB-01. `start_pending`, and a CHECK constraint stops anything writing `started` without an
      // actual, verified start date — including any future code that forgets why.
      const placement = await tx.placement.create({
        data: {
          jobId: offer.jobApplication.jobId,
          userId: user.id,
          offerId: offer.id,
          state: 'start_pending',
          proposedStartDate: offer.proposedStartDate
        }
      });

      // Any other live offer to this person for this job is now moot.
      await tx.jobOffer.updateMany({
        where: { jobApplicationId: offer.jobApplicationId, state: 'draft', id: { not: offer.id } },
        data: { state: 'withdrawn', withdrawReason: 'a later offer on this application was accepted', respondedAt: new Date() }
      });

      await tx.outboxEvent.create({ data: { topic: 'job_offer.accepted', payload: { offerId: offer.id, placementId: placement.id } } });
      return {
        offer: this.offerView(accepted),
        placement: {
          id: placement.id,
          state: placement.state,
          proposedStartDate: placement.proposedStartDate,
          actualStartDate: null,
          version: placement.version
        },
        /** JOB-01, said in the payload so no caller has to infer it from the state name. */
        employmentStarted: false as const,
        countedAsEmployment: false as const,
        awaitingStartConfirmation: true as const
      };
    });
  }

  /** PER-14.A02. Declining, with a reason kept on the record. */
  async declineOffer(actorId: string, offerId: string, input: { reason: string; version: number }) {
    const user = await this.identity.activeUser(actorId);
    const reason = text(input.reason, 10, 1000);

    return this.db.$transaction(async tx => {
      const offer = await tx.jobOffer.findUnique({ where: { id: offerId }, include: { jobApplication: true } });
      if (!offer || offer.jobApplication.userId !== user.id) throw new IdentityError('not_found', 404);
      if (offer.state !== 'sent') throw new IdentityError('conflict', 409);
      if (offer.version !== input.version) throw new IdentityError('conflict', 409);

      const declined = await tx.jobOffer.update({
        where: { id: offer.id },
        data: { state: 'declined', declineReason: reason, respondedAt: new Date(), version: { increment: 1 } }
      });
      await tx.jobApplication.update({ where: { id: offer.jobApplicationId }, data: { state: 'withdrawn', withdrawnReason: reason, decidedAt: new Date(), version: { increment: 1 } } });
      await tx.outboxEvent.create({ data: { topic: 'job_offer.declined', payload: { offerId: offer.id } } });
      return this.offerView(declined);
    });
  }

  /**
   * A deadline that has passed with no answer.
   *
   * It runs on read rather than on a schedule, because this build has no job runner. It expires
   * only what is genuinely past its deadline, and never turns silence into an acceptance.
   */
  async expireOverdueOffers() {
    const overdue = await this.db.jobOffer.findMany({ where: { state: 'sent', respondByAt: { lte: new Date() } }, select: { id: true, jobApplicationId: true } });
    for (const offer of overdue) {
      await this.db.$transaction(async tx => {
        const current = await tx.jobOffer.findUnique({ where: { id: offer.id } });
        if (!current || current.state !== 'sent' || current.respondByAt > new Date()) return;
        await tx.jobOffer.update({ where: { id: offer.id }, data: { state: 'expired', version: { increment: 1 } } });
        const application = await tx.jobApplication.findUniqueOrThrow({ where: { id: offer.jobApplicationId } });
        if (application.state === 'offered') {
          await tx.jobApplication.update({ where: { id: application.id }, data: { state: 'shortlisted', version: { increment: 1 } } });
        }
      });
    }
    return { expired: overdue.length };
  }

  // ---------------------------------------------------------------- PRG-08 list

  async listOffers(actorId: string, organizationId: string, filters: { jobId?: string | undefined; state?: string | undefined }) {
    await this.identity.access(actorId, organizationId, 'job.manage');
    await this.expireOverdueOffers();
    const rows = await this.db.jobOffer.findMany({
      where: {
        jobApplication: { job: { organizationId, ...(filters.jobId ? { id: filters.jobId } : {}) } },
        ...(filters.state ? { state: filters.state as 'draft' } : {})
      },
      include: {
        jobApplication: {
          select: {
            id: true, reference: true, state: true, sharingConsent: true,
            job: { select: { id: true, title: true } },
            user: { select: { name: true, candidateProfile: { select: { shareWithOperators: true } } } }
          }
        },
        placement: { select: { id: true, state: true, actualStartDate: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 200
    });
    return rows.map(row => {
      const shared = row.jobApplication.sharingConsent && Boolean(row.jobApplication.user.candidateProfile?.shareWithOperators);
      return {
        ...this.offerView(row),
        application: { id: row.jobApplication.id, reference: row.jobApplication.reference, state: row.jobApplication.state },
        job: row.jobApplication.job,
        candidateName: shared ? row.jobApplication.user.name : null,
        profileShared: shared,
        placement: row.placement,
        /** The list never adds an accepted offer to a started count. This is what it would be. */
        countsAsStarted: row.placement?.state === 'started' || row.placement?.state === 'retained'
      };
    });
  }

  // ---------------------------------------------------------------- shaping

  private parseOffer(input: {
    title: string; terms: string; contractType?: string | undefined; contractMonths?: number | null | undefined;
    salaryMinor?: string | null | undefined; salaryCurrency?: string | null | undefined; salaryPeriod?: string | undefined;
    proposedStartDate: string; respondByAt: string;
  }) {
    const contractType = (input.contractType ?? 'full_time') as typeof CONTRACT_TYPES[number];
    if (!CONTRACT_TYPES.includes(contractType)) throw new IdentityError('invalid_input', 422);
    const contractMonths = input.contractMonths === undefined || input.contractMonths === null ? null : Number(input.contractMonths);
    if (contractMonths !== null && (!Number.isInteger(contractMonths) || contractMonths < 1 || contractMonths > 120)) throw new IdentityError('invalid_input', 422);
    if (contractType === 'fixed_term' && contractMonths === null) throw new IdentityError('invalid_input', 422);

    const salaryMinor = input.salaryMinor === undefined || input.salaryMinor === null || input.salaryMinor === '' ? null : parseMinor(input.salaryMinor);
    if (salaryMinor !== null && salaryMinor <= 0n) throw new IdentityError('invalid_input', 422);
    const salaryCurrency = salaryMinor === null ? null : parseCurrency(input.salaryCurrency ?? '');

    const proposedStartDate = plainDate(input.proposedStartDate);
    const respondByAt = futureInstant(input.respondByAt);
    // Deciding after the day the work is meant to begin is a deadline that answers nothing.
    if (respondByAt.getTime() > proposedStartDate.getTime() + 86_400_000) throw new IdentityError('invalid_input', 422);

    return {
      title: text(input.title, 4, 200),
      // 07: the terms are what the candidate is agreeing to, so a one-line offer is refused.
      terms: text(input.terms, 20, 4000),
      contractType,
      contractMonths,
      salaryMinor,
      salaryCurrency,
      salaryPeriod: optionalText(input.salaryPeriod, 20),
      proposedStartDate,
      respondByAt
    } as const;
  }

  private offerView(offer: {
    id: string; jobApplicationId: string; sequence: number; state: string; title: string; terms: string;
    contractType: string; contractMonths: number | null; salaryMinor: bigint | null; salaryCurrency: string | null;
    salaryPeriod: string; proposedStartDate: Date; respondByAt: Date; termsChecksum: string;
    sentAt: Date | null; respondedAt: Date | null; declineReason: string; withdrawReason: string;
    version: number; createdAt: Date;
  }) {
    return {
      id: offer.id,
      jobApplicationId: offer.jobApplicationId,
      sequence: offer.sequence,
      state: offer.state,
      title: offer.title,
      terms: offer.terms,
      contractType: offer.contractType,
      contractMonths: offer.contractMonths,
      salaryMinor: offer.salaryMinor === null ? null : minorToString(offer.salaryMinor),
      salaryCurrency: offer.salaryCurrency,
      salaryPeriod: offer.salaryPeriod,
      proposedStartDate: offer.proposedStartDate,
      respondByAt: offer.respondByAt,
      /** Returned so acceptance can name the exact text, and so a changed offer cannot be accepted. */
      termsChecksum: offer.termsChecksum,
      sentAt: offer.sentAt,
      respondedAt: offer.respondedAt,
      declineReason: offer.declineReason,
      withdrawReason: offer.withdrawReason,
      version: offer.version,
      createdAt: offer.createdAt
    };
  }
}
