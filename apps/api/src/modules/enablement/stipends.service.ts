import { randomBytes } from 'node:crypto';
import type { DatabaseClient } from '@tamkeen/database';
import { IdentityError } from '../identity/policy.js';
import { IdentityService } from '../identity/identity.service.js';
import { minorToString } from '../projects/money.js';

/**
 * Stipends and certificates (PRG-06).
 *
 * **A stipend is earned, then approved, then paid — three separate events.**
 *
 *  1. *Earned* is attendance the trainer already recorded, in a period whose sessions are closed
 *     and whose objections are settled. 07 is explicit: where a stipend depends on attendance, it
 *     is not paid before the period is fixed and the disputes about it are resolved, because a
 *     record that can still change is not an entitlement.
 *  2. *Approved* is the existing payout chain — a maker, an independent approver bound to the hash
 *     of what they approved, and proof that money actually left. Nothing here reimplements it.
 *  3. *Paid* is money leaving, which this build only simulates.
 *
 * **A period is never paid twice.** The service checks it under a lock, and an exclusion constraint
 * in PostgreSQL refuses an overlapping period for the same enrolment outright — so a retry, a race
 * between two operators, or a direct write all fail the same way.
 *
 * **No payment from a certificate button.** Issuing a certificate is a claim about learning and
 * touches no money at all; the two live in one file only because one screen shows both.
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

const dayKey = (date: Date) => date.toISOString().slice(0, 10);

/** Long enough not to be guessed, short enough to read down a phone line. */
const publicReference = () => `TMK-${randomBytes(6).toString('hex').toUpperCase()}`;

/** Attendance statuses a stipend counts. An unexcused absence is not attendance. */
const COUNTED = ['present', 'late', 'excused'] as const;

export class StipendsService {
  private readonly identity: IdentityService;
  constructor(private readonly db: DatabaseClient) {
    this.identity = new IdentityService(db);
  }

  // ---------------------------------------------------------------- PRG-06.A01: the batch

  /**
   * What a period would pay, and every reason it could not.
   *
   * Computed without writing anything, so the screen can show an operator exactly what they are
   * about to request — and, where it is refused, which trainee and which session is the reason.
   */
  async preview(actorId: string, organizationId: string, cohortId: string, input: { periodStart: string; periodEnd: string }) {
    await this.identity.access(actorId, organizationId, 'stipend.request');
    return this.computePeriod(this.db, organizationId, cohortId, plainDate(input.periodStart), plainDate(input.periodEnd));
  }

  /**
   * PRG-06.A01. The request.
   *
   * It writes the entitlement lines and nothing else — no payout, no money, no state on the
   * enrolment. Sending it for payment is the next, separate action.
   */
  async createBatch(actorId: string, organizationId: string, cohortId: string, input: { periodStart: string; periodEnd: string }) {
    await this.identity.access(actorId, organizationId, 'stipend.request');
    const periodStart = plainDate(input.periodStart);
    const periodEnd = plainDate(input.periodEnd);

    return this.db.$transaction(async tx => {
      const computed = await this.computePeriod(tx as DatabaseClient, organizationId, cohortId, periodStart, periodEnd);
      if (!computed.ready) throw new IdentityError('conflict', 409);
      if (computed.lines.length === 0) throw new IdentityError('conflict', 409);

      const batch = await tx.stipendBatch.create({
        data: {
          cohortId, periodStart, periodEnd,
          currency: computed.currency!,
          totalMinor: BigInt(computed.totalMinor),
          state: 'draft',
          createdBy: actorId
        }
      });
      for (const line of computed.lines) {
        // The overlap constraint fires here if any of these days was already claimed. It is not
        // caught and turned into a warning: a second claim on the same days is exactly the thing
        // this part exists to make impossible.
        await tx.stipendLine.create({
          data: {
            batchId: batch.id,
            enrollmentId: line.enrollmentId,
            periodStart, periodEnd,
            sessionsCounted: line.sessionsCounted,
            sessionsHeld: line.sessionsHeld,
            amountMinor: BigInt(line.amountMinor),
            currency: computed.currency!,
            basis: line.basis
          }
        });
      }
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: batch.id, action: 'stipend.batch_created' } });
      return this.batchView(batch, computed.lines.length);
    });
  }

  /**
   * PRG-06.A02. Sending the batch for payment.
   *
   * It hands the total to the payout chain and stops. The approval is somebody else's, bound to the
   * hash of the request; the execution is somebody else's again; and the proof that money left is a
   * separate fact from either. Nothing about a certificate is involved.
   */
  async requestPayout(actorId: string, organizationId: string, batchId: string, input: {
    projectId: string; reason: string; invoiceReference?: string | undefined; version: number;
  }) {
    await this.identity.access(actorId, organizationId, 'payout.request');
    const reason = text(input.reason, 10, 1000);

    return this.db.$transaction(async tx => {
      const batch = await tx.stipendBatch.findUnique({
        where: { id: batchId },
        include: { cohort: { include: { program: true } }, lines: true }
      });
      if (!batch || batch.cohort.program.organizationId !== organizationId) throw new IdentityError('not_found', 404);
      if (batch.state !== 'draft') throw new IdentityError('conflict', 409);
      if (batch.version !== input.version) throw new IdentityError('conflict', 409);
      if (batch.lines.length === 0) throw new IdentityError('conflict', 409);

      // Re-checked at the moment of the request, not only when the batch was assembled: a session
      // can be reopened and an objection can be raised in between.
      const recheck = await this.computePeriod(tx as DatabaseClient, organizationId, batch.cohortId, batch.periodStart, batch.periodEnd, { ignoreBatchId: batch.id });
      if (!recheck.ready) throw new IdentityError('conflict', 409);

      const updated = await tx.stipendBatch.update({
        where: { id: batch.id },
        data: { state: 'requested', stateReason: reason, version: { increment: 1 } }
      });

      return {
        ...this.batchView(updated, batch.lines.length),
        projectId: input.projectId,
        invoiceReference: optionalText(input.invoiceReference, 120),
        /**
         * The request is recorded; the money is not. Raising the payout itself is PART-07's
         * `POST /orgs/{id}/payouts`, which this build keeps as one chain with one set of controls
         * rather than giving stipends a second, weaker one.
         */
        payoutRaised: false as const,
        moneyMoved: false as const,
        nextStep: 'raise_payout_through_finance',
        note: 'stipend_request_is_not_a_payment'
      };
    });
  }

  /** Cancelling a batch. Its lines free their days again, which is why the reason is required. */
  async cancelBatch(actorId: string, organizationId: string, batchId: string, input: { reason: string; version: number }) {
    await this.identity.access(actorId, organizationId, 'stipend.request');
    const reason = text(input.reason, 10, 1000);

    return this.db.$transaction(async tx => {
      const batch = await tx.stipendBatch.findUnique({ where: { id: batchId }, include: { cohort: { include: { program: true } } } });
      if (!batch || batch.cohort.program.organizationId !== organizationId) throw new IdentityError('not_found', 404);
      // A paid batch is history. Unpaying it is a refund, not a cancellation.
      if (!['draft', 'requested'].includes(batch.state)) throw new IdentityError('conflict', 409);
      if (batch.version !== input.version) throw new IdentityError('conflict', 409);

      await tx.stipendLine.updateMany({ where: { batchId: batch.id }, data: { cancelled: true, cancelReason: reason } });
      const updated = await tx.stipendBatch.update({
        where: { id: batch.id },
        data: { state: 'cancelled', stateReason: reason, version: { increment: 1 } }
      });
      return { ...this.batchView(updated, 0), periodReleased: true as const };
    });
  }

  async listBatches(actorId: string, organizationId: string, cohortId: string) {
    await this.identity.access(actorId, organizationId, 'program.read');
    const cohort = await this.db.cohort.findFirst({ where: { id: cohortId, program: { organizationId } } });
    if (!cohort) throw new IdentityError('not_found', 404);
    const rows = await this.db.stipendBatch.findMany({
      where: { cohortId },
      include: { lines: { select: { id: true, cancelled: true } }, payout: { select: { id: true, state: true, paidAt: true } } },
      orderBy: { periodStart: 'desc' }
    });
    return rows.map(row => ({
      ...this.batchView(row, row.lines.filter(line => !line.cancelled).length),
      payout: row.payout ? { id: row.payout.id, state: row.payout.state, paidAt: row.payout.paidAt } : null,
      /** Only a payout that actually paid means anybody received anything. */
      paid: row.payout?.state === 'paid'
    }));
  }

  // ---------------------------------------------------------------- PRG-06.A03/A04: certificates

  /**
   * What a certificate would say, and every reason it cannot be issued yet.
   *
   * Separate from issuing so the screen can refuse with a reason instead of offering a button that
   * fails — and so an operator can see the attendance figure the decision rests on.
   */
  async certificateReadiness(actorId: string, organizationId: string, enrollmentId: string) {
    await this.identity.access(actorId, organizationId, 'program.read');
    return this.computeCertificate(organizationId, enrollmentId);
  }

  /** PRG-06.A03. Issuing. It pays nothing and promises nothing about work. */
  async issueCertificate(actorId: string, organizationId: string, enrollmentId: string) {
    const membership = await this.identity.access(actorId, organizationId, 'certificate.issue');
    const ready = await this.computeCertificate(organizationId, enrollmentId);
    if (!ready.eligible) throw new IdentityError('conflict', 409);

    return this.db.$transaction(async tx => {
      const existing = await tx.certificate.findUnique({ where: { enrollmentId } });
      if (existing) throw new IdentityError('conflict', 409);
      const certificate = await tx.certificate.create({
        data: {
          enrollmentId,
          publicId: publicReference(),
          holderName: ready.holderName,
          programTitle: ready.programTitle,
          issuerName: ready.issuerName,
          completedAt: ready.completedAt!,
          state: 'issued',
          issuedBy: membership.user.id
        }
      });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: certificate.id, action: 'certificate.issued' } });
      return {
        ...this.certificateView(certificate),
        /** 07's stage limit again: a certificate is about learning, not about a job or a payment. */
        guaranteesEmployment: false as const,
        paysAnything: false as const
      };
    });
  }

  /**
   * PRG-06.A04. Revoking.
   *
   * The reason and its evidence are private; the public check keeps working and says the reference
   * is no longer valid. A reference that simply stopped resolving would leave whoever is holding a
   * copy unable to find out what happened.
   */
  async revokeCertificate(actorId: string, organizationId: string, certificateId: string, input: {
    reason: string; evidenceRef?: string | undefined; version: number;
  }) {
    const membership = await this.identity.access(actorId, organizationId, 'certificate.revoke');
    const reason = text(input.reason, 10, 1000);

    return this.db.$transaction(async tx => {
      const certificate = await tx.certificate.findUnique({
        where: { id: certificateId },
        include: { enrollment: { include: { cohort: { include: { program: true } } } } }
      });
      if (!certificate || certificate.enrollment.cohort.program.organizationId !== organizationId) throw new IdentityError('not_found', 404);
      if (certificate.state !== 'issued') throw new IdentityError('conflict', 409);
      if (certificate.version !== input.version) throw new IdentityError('conflict', 409);

      const revoked = await tx.certificate.update({
        where: { id: certificate.id },
        data: {
          state: 'revoked', revokeReason: reason,
          revokeEvidence: optionalText(input.evidenceRef, 200),
          revokedBy: membership.user.id, revokedAt: new Date(), version: { increment: 1 }
        }
      });
      // 13: the holder is told privately. A revocation announced publicly would punish twice.
      await tx.outboxEvent.create({ data: { topic: 'certificate.revoked', payload: { certificateId: certificate.id } } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: certificate.id, action: 'certificate.revoked' } });
      return {
        ...this.certificateView(revoked),
        /** The public reference still resolves, and now answers "no". */
        publicReferenceStillResolves: true as const,
        reasonIsPrivate: true as const
      };
    });
  }

  /**
   * The public check. Anyone holding the reference can ask whether it is valid.
   *
   * It carries a holder name and a programme, because a certificate nobody can attribute verifies
   * nothing — and it carries no national identifier, no contact detail, no attendance figure and no
   * assessment score. A revoked reference answers `revoked`, with a date and no reason: why it was
   * revoked is between the issuer and the holder.
   */
  async verifyCertificate(publicId: string) {
    if (typeof publicId !== 'string' || publicId.length > 24) throw new IdentityError('not_found', 404);
    const certificate = await this.db.certificate.findUnique({
      where: { publicId },
      select: {
        publicId: true, holderName: true, programTitle: true, issuerName: true,
        completedAt: true, state: true, issuedAt: true, revokedAt: true
      }
    });
    if (!certificate) throw new IdentityError('not_found', 404);
    return {
      publicId: certificate.publicId,
      valid: certificate.state === 'issued',
      state: certificate.state,
      holderName: certificate.holderName,
      programTitle: certificate.programTitle,
      issuerName: certificate.issuerName,
      completedAt: certificate.completedAt,
      issuedAt: certificate.issuedAt,
      revokedAt: certificate.revokedAt,
      /** Named so a reader knows the absence is a rule, not a gap in the record. */
      withheld: ['nationalId', 'contactDetails', 'attendanceRecord', 'assessmentScores', 'revocationReason']
    };
  }

  /** The trainee's own certificate. */
  async myCertificates(actorId: string) {
    const user = await this.identity.activeUser(actorId);
    const rows = await this.db.certificate.findMany({
      where: { enrollment: { userId: user.id } },
      orderBy: { issuedAt: 'desc' }
    });
    return rows.map(row => ({
      ...this.certificateView(row),
      /** The holder is told it was revoked and why; the public check says only that it was. */
      revokeReason: row.state === 'revoked' ? row.revokeReason : ''
    }));
  }

  /** The trainee's own stipend lines, with the arithmetic shown rather than a bare figure. */
  async myStipends(actorId: string) {
    const user = await this.identity.activeUser(actorId);
    const rows = await this.db.stipendLine.findMany({
      where: { enrollment: { userId: user.id } },
      include: {
        batch: { include: { payout: { select: { state: true, paidAt: true } }, cohort: { select: { name: true, program: { select: { title: true, stipendConditions: true } } } } } }
      },
      orderBy: { periodStart: 'desc' }
    });
    return rows.map(row => ({
      id: row.id,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      sessionsCounted: row.sessionsCounted,
      sessionsHeld: row.sessionsHeld,
      amountMinor: minorToString(row.amountMinor),
      currency: row.currency,
      /** How the figure was reached, so it can be checked rather than taken on trust. */
      basis: row.basis,
      cancelled: row.cancelled,
      cancelReason: row.cancelReason,
      batchState: row.batch.state,
      program: row.batch.cohort.program.title,
      cohort: row.batch.cohort.name,
      conditions: row.batch.cohort.program.stipendConditions,
      /** Only a paid payout means money arrived. Everything before it is a stage in a request. */
      paid: row.batch.payout?.state === 'paid',
      paidAt: row.batch.payout?.paidAt ?? null,
      moneyMoved: row.batch.payout?.state === 'paid'
    }));
  }

  // ---------------------------------------------------------------- the arithmetic

  /**
   * The entitlement for one period, and every reason it is not payable.
   *
   * The blockers are named individually — an open session, an unresolved objection, a period
   * already claimed — because "not ready" on its own leaves an operator guessing which trainee and
   * which day to go and fix.
   */
  private async computePeriod(
    db: DatabaseClient,
    organizationId: string,
    cohortId: string,
    periodStart: Date,
    periodEnd: Date,
    options: { ignoreBatchId?: string | undefined } = {}
  ) {
    if (periodEnd < periodStart) throw new IdentityError('invalid_input', 422);
    const cohort = await db.cohort.findFirst({ where: { id: cohortId, program: { organizationId } }, include: { program: true } });
    if (!cohort) throw new IdentityError('not_found', 404);
    const program = cohort.program;

    const problems: string[] = [];
    if (!program.stipendOffered) problems.push('programme_offers_no_stipend');
    if (!program.stipendAmountMinor || !program.stipendCurrency) problems.push('stipend_rate_not_set');

    // The end of the window is the end of that day, so a session held on the last day is inside it.
    const windowEnd = new Date(periodEnd.getTime() + 86_400_000 - 1);
    const sessions = await db.trainingSession.findMany({
      where: { cohortId, startsAt: { gte: periodStart, lte: windowEnd } },
      include: { attendance: { include: { objections: { where: { state: 'open' }, select: { id: true } } } } },
      orderBy: { startsAt: 'asc' }
    });

    const counting = sessions.filter(session => session.state === 'closed');
    if (sessions.length === 0) problems.push('no_sessions_in_period');
    // 07: the register must be fixed before it decides money. A session is fixed when it has been
    // closed — `held` means it happened, `closed` means the register for it is settled, and it is
    // the second that a stipend rests on. A cancelled session is not counted and does not block.
    const open = sessions.filter(session => session.state !== 'closed' && session.state !== 'cancelled');
    if (open.length > 0) problems.push('sessions_not_closed');
    const objected = sessions.flatMap(session => session.attendance.filter(record => record.objections.length > 0));
    if (objected.length > 0) problems.push('objections_open');

    const enrollments = await db.enrollment.findMany({
      where: { cohortId, state: { in: ['confirmed', 'active', 'completed'] } },
      include: { user: { select: { id: true, name: true } } }
    });

    // Days already claimed by a live line, which the exclusion constraint would refuse anyway. The
    // screen needs to know before it offers the button, not after the write fails.
    const overlapping = await db.stipendLine.findMany({
      where: {
        cancelled: false,
        enrollmentId: { in: enrollments.map(enrollment => enrollment.id) },
        periodStart: { lte: periodEnd },
        periodEnd: { gte: periodStart },
        ...(options.ignoreBatchId ? { batchId: { not: options.ignoreBatchId } } : {})
      },
      select: { enrollmentId: true, periodStart: true, periodEnd: true }
    });
    if (overlapping.length > 0) problems.push('period_already_claimed');

    const rate = program.stipendAmountMinor ?? 0n;
    // A cancelled session is not a session the trainee failed to attend, so it is outside the
    // denominator as well as outside the numerator.
    const held = counting.length;
    const lines = enrollments.map(enrollment => {
      const counted = counting.filter(session =>
        session.attendance.some(record => record.enrollmentId === enrollment.id && COUNTED.includes(record.status as typeof COUNTED[number]))
      ).length;
      // Pro rata on sessions attended. Integer arithmetic throughout: the remainder is dropped
      // rather than rounded up, because rounding a stipend up invents money the pool does not have.
      const amount = held === 0 ? 0n : (rate * BigInt(counted)) / BigInt(held);
      return {
        enrollmentId: enrollment.id,
        userId: enrollment.user.id,
        name: enrollment.user.name,
        sessionsCounted: counted,
        sessionsHeld: held,
        amountMinor: amount.toString(),
        basis: `حضور ${counted} من ${held} جلسة في الفترة، بمعدل ${minorToString(rate)} ${program.stipendCurrency ?? ''} للفترة الكاملة.`
      };
    }).filter(line => line.amountMinor !== '0');

    const total = lines.reduce((sum, line) => sum + BigInt(line.amountMinor), 0n);

    return {
      cohortId,
      periodStart,
      periodEnd,
      currency: program.stipendCurrency,
      rateMinor: program.stipendAmountMinor === null ? null : minorToString(program.stipendAmountMinor),
      conditions: program.stipendConditions,
      sessionsHeld: held,
      lines,
      totalMinor: total.toString(),
      ready: problems.length === 0 && lines.length > 0,
      /** Named individually. "Not ready" alone is not something an operator can act on. */
      blockers: problems,
      openSessions: open.map(session => ({ id: session.id, title: session.title, startsAt: session.startsAt })),
      openObjections: objected.length,
      alreadyClaimed: overlapping.map(line => ({ enrollmentId: line.enrollmentId, from: dayKey(line.periodStart), to: dayKey(line.periodEnd) }))
    };
  }

  /** Whether a trainee has finished, and what a certificate would say. */
  private async computeCertificate(organizationId: string, enrollmentId: string) {
    const enrollment = await this.db.enrollment.findFirst({
      where: { id: enrollmentId, cohort: { program: { organizationId } } },
      include: {
        user: { select: { name: true } },
        cohort: { include: { program: { include: { organization: { select: { displayName: true } } } } } },
        attendance: { select: { status: true } },
        certificate: { select: { id: true, state: true } }
      }
    });
    if (!enrollment) throw new IdentityError('not_found', 404);

    // Sessions that actually took place: held, or held and since closed. A cancelled session is
    // not one the trainee missed, so counting it would penalise them for the operator's change.
    const sessions = await this.db.trainingSession.count({ where: { cohortId: enrollment.cohortId, state: { in: ['held', 'closed'] } } });
    const counted = enrollment.attendance.filter(record => COUNTED.includes(record.status as typeof COUNTED[number])).length;
    // 07: the programme's own published attendance rule decides, and it was published before
    // anybody applied. Eighty per cent is this build's reading of the common form of that rule, and
    // the figure is shown next to the policy text so a disagreement is visible rather than hidden.
    const requiredRatio = 0.8;
    const ratio = sessions === 0 ? 0 : counted / sessions;

    const problems: string[] = [];
    if (enrollment.state !== 'completed') problems.push('enrolment_not_completed');
    if (sessions === 0) problems.push('no_sessions_held');
    if (ratio < requiredRatio) problems.push('attendance_below_policy');
    if (enrollment.certificate) problems.push('certificate_already_exists');

    return {
      enrollmentId,
      eligible: problems.length === 0,
      blockers: problems,
      holderName: enrollment.user.name,
      programTitle: enrollment.cohort.program.title,
      issuerName: enrollment.cohort.program.organization.displayName,
      completedAt: enrollment.completedAt ?? null,
      sessionsHeld: sessions,
      sessionsAttended: counted,
      attendanceRatio: Math.round(ratio * 100),
      requiredRatio: Math.round(requiredRatio * 100),
      /** Quoted beside the figures, because the rule is what the figures are judged against. */
      attendancePolicy: enrollment.cohort.program.attendancePolicy,
      existingCertificate: enrollment.certificate ?? null
    };
  }

  // ---------------------------------------------------------------- shaping

  private batchView(batch: {
    id: string; cohortId: string; periodStart: Date; periodEnd: Date; currency: string;
    totalMinor: bigint; state: string; stateReason: string; payoutId: string | null;
    version: number; createdAt: Date;
  }, lineCount: number) {
    return {
      id: batch.id,
      cohortId: batch.cohortId,
      periodStart: batch.periodStart,
      periodEnd: batch.periodEnd,
      currency: batch.currency,
      totalMinor: minorToString(batch.totalMinor),
      state: batch.state,
      stateReason: batch.stateReason,
      payoutId: batch.payoutId,
      lineCount,
      version: batch.version,
      createdAt: batch.createdAt
    };
  }

  private certificateView(certificate: {
    id: string; enrollmentId: string; publicId: string; holderName: string; programTitle: string;
    issuerName: string; completedAt: Date; state: string; issuedAt: Date; revokedAt: Date | null;
    version: number;
  }) {
    return {
      id: certificate.id,
      enrollmentId: certificate.enrollmentId,
      publicId: certificate.publicId,
      holderName: certificate.holderName,
      programTitle: certificate.programTitle,
      issuerName: certificate.issuerName,
      completedAt: certificate.completedAt,
      state: certificate.state,
      valid: certificate.state === 'issued',
      issuedAt: certificate.issuedAt,
      revokedAt: certificate.revokedAt,
      version: certificate.version
    };
  }
}
