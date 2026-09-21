import type { AttendanceStatus, DatabaseClient } from '@tamkeen/database';
import { IdentityError } from '../identity/policy.js';
import { IdentityService } from '../identity/identity.service.js';
import { seatHoldingStates } from './programs.service.js';

/**
 * Running a cohort: trainers, sessions, attendance, objections and assessment
 * (07-INCUBATION-EMPLOYMENT, PRG-04/05, PER-13).
 *
 * Two rules shape everything here:
 *
 *  - **A trainer sees their own cohorts, not the organisation's.** The permission is the floor; the
 *    `CohortTrainer` row is what decides. Every trainer read and write goes through one scope check
 *    so there is a single place that can be right or wrong, rather than twelve.
 *  - **An attendance record can decide whether somebody is paid**, so it is never quietly
 *    overwritten. A change is a revision with a reason; a dispute is an objection somebody else
 *    rules on, and never the person whose record is being disputed.
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

const STATUSES: readonly AttendanceStatus[] = ['present', 'absent', 'excused', 'late'] as const;

export class TrainingService {
  private readonly identity: IdentityService;
  constructor(private readonly db: DatabaseClient) {
    this.identity = new IdentityService(db);
  }

  /**
   * The one scope check.
   *
   * A programme manager reaches every cohort their organisation runs; a trainer reaches only the
   * cohorts they were assigned, and only while that assignment stands. Both paths end here, so a
   * new screen cannot accidentally widen a trainer's reach by asking a different question.
   */
  private async cohortScope(actorId: string, cohortId: string, permission: 'program.read' | 'program.manage' | 'attendance.record' | 'attendance.correct' | 'attendance.review' | 'assessment.record') {
    const cohort = await this.db.cohort.findUnique({ where: { id: cohortId }, include: { program: true } });
    if (!cohort) throw new IdentityError('not_found', 404);

    const assignment = await this.db.cohortTrainer.findUnique({ where: { cohortId_userId: { cohortId, userId: actorId } } });
    const assigned = Boolean(assignment && !assignment.revokedAt);

    // The membership check also proves the actor is active in an active organisation, which is why
    // even an assigned trainer goes through it rather than being trusted on the assignment alone.
    const membership = await this.identity.access(actorId, cohort.program.organizationId, permission);
    const isManager = membership.roles.includes('ProgramManager') || membership.roles.includes('OrgAdmin') || membership.roles.includes('Owner');
    if (!isManager && !assigned) throw new IdentityError('forbidden', 403);

    return { cohort, program: cohort.program, assigned, isManager, organizationId: cohort.program.organizationId };
  }

  // ---------------------------------------------------------------- PRG-04: the cohort

  /** PRG-04. Members, seats, trainers and sessions — for whoever is allowed to see this cohort. */
  async cohortBoard(actorId: string, cohortId: string) {
    const scope = await this.cohortScope(actorId, cohortId, 'program.read');
    const [enrollments, sessions, trainers, waitlist] = await Promise.all([
      this.db.enrollment.findMany({
        where: { cohortId },
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' }
      }),
      this.db.trainingSession.findMany({ where: { cohortId }, orderBy: { startsAt: 'asc' } }),
      this.db.cohortTrainer.findMany({ where: { cohortId, revokedAt: null }, include: { user: { select: { id: true, name: true } } } }),
      this.db.waitlistEntry.findMany({
        where: { cohortId, state: 'waiting' },
        include: { application: { select: { id: true, reference: true, user: { select: { name: true } } } } },
        orderBy: { position: 'asc' }
      })
    ]);
    const held = enrollments.filter(row => ['confirmed', 'active', 'completed'].includes(row.state) || (row.state === 'invited' && row.invitationExpiresAt > new Date())).length;

    return {
      cohort: {
        id: scope.cohort.id, name: scope.cohort.name, capacity: scope.cohort.capacity,
        startAt: scope.cohort.startAt, endAt: scope.cohort.endAt, timezone: scope.cohort.timezone,
        state: scope.cohort.state, version: scope.cohort.version,
        seatsTaken: held, seatsRemaining: Math.max(0, scope.cohort.capacity - held)
      },
      program: { id: scope.program.id, title: scope.program.title, organizationId: scope.organizationId, attendancePolicy: scope.program.attendancePolicy },
      members: enrollments.map(row => ({
        id: row.id, name: row.user.name, state: row.state,
        invitationExpiresAt: row.invitationExpiresAt, confirmedAt: row.confirmedAt, exitReason: row.exitReason, version: row.version
      })),
      sessions: sessions.map(session => this.sessionView(session)),
      trainers: trainers.map(row => ({ id: row.id, userId: row.userId, name: row.user.name, assignedAt: row.createdAt })),
      // The queue, in its documented order, so "the next one" is checkable rather than implied.
      waitlist: waitlist.map(entry => ({ position: entry.position, applicationId: entry.applicationId, reference: entry.application.reference, name: entry.application.user.name })),
      /** True only for a manager: a trainer may run sessions but not change who is in the room. */
      canManage: scope.isManager
    };
  }

  /** PRG-04.A01. Assigning a trainer, which is the only thing that grants a trainer their scope. */
  async assignTrainer(actorId: string, cohortId: string, userId: string) {
    const scope = await this.cohortScope(actorId, cohortId, 'program.manage');
    // The trainer has to be an active member of the operator; a scope cannot be granted to somebody
    // the organisation has no relationship with.
    const membership = await this.db.membership.findUnique({ where: { userId_organizationId: { userId, organizationId: scope.organizationId } } });
    if (!membership || membership.status !== 'active') throw new IdentityError('invalid_input', 422);

    const existing = await this.db.cohortTrainer.findUnique({ where: { cohortId_userId: { cohortId, userId } } });
    if (existing) {
      if (!existing.revokedAt) throw new IdentityError('conflict', 409);
      const restored = await this.db.cohortTrainer.update({ where: { id: existing.id }, data: { revokedAt: null, assignedBy: actorId } });
      return { id: restored.id, userId, cohortId, assignedAt: restored.createdAt };
    }
    const created = await this.db.cohortTrainer.create({ data: { cohortId, userId, assignedBy: actorId } });
    await this.db.identityAuditEvent.create({ data: { actorId, organizationId: scope.organizationId, resourceId: created.id, action: 'cohort.trainer_assigned' } });
    return { id: created.id, userId, cohortId, assignedAt: created.createdAt };
  }

  /** Removing the assignment removes the scope, immediately and everywhere. */
  async revokeTrainer(actorId: string, cohortId: string, assignmentId: string) {
    const scope = await this.cohortScope(actorId, cohortId, 'program.manage');
    const updated = await this.db.cohortTrainer.updateMany({ where: { id: assignmentId, cohortId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (updated.count !== 1) throw new IdentityError('not_found', 404);
    await this.db.identityAuditEvent.create({ data: { actorId, organizationId: scope.organizationId, resourceId: assignmentId, action: 'cohort.trainer_revoked' } });
    return { id: assignmentId, revoked: true };
  }

  /** PRG-04.A02. A session, inside the cohort's own dates. */
  async createSession(actorId: string, cohortId: string, input: { title: string; startsAt: string; endsAt: string; mode?: 'in_person' | 'remote' | 'hybrid' | undefined; location?: string | undefined }) {
    const scope = await this.cohortScope(actorId, cohortId, 'program.manage');
    const title = text(input.title, 3, 200);
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) throw new IdentityError('invalid_input', 422);
    if (startsAt >= endsAt) throw new IdentityError('invalid_input', 422);
    // A session outside the cohort's dates belongs to a cohort that is not running yet or is over.
    if (startsAt < scope.cohort.startAt || endsAt > scope.cohort.endAt) throw new IdentityError('invalid_input', 422);
    const mode = input.mode ?? 'in_person';
    if (!['in_person', 'remote', 'hybrid'].includes(mode)) throw new IdentityError('invalid_input', 422);
    const location = optionalText(input.location, 300);
    if (mode !== 'remote' && !location) throw new IdentityError('invalid_input', 422);

    const session = await this.db.trainingSession.create({
      data: { cohortId, title, startsAt, endsAt, timezone: scope.cohort.timezone, mode, location, createdBy: actorId, state: 'scheduled' }
    });
    return this.sessionView(session);
  }

  /**
   * PRG-04.A03. Inviting the next person on the waitlist.
   *
   * The seat is taken under the cohort's lock, in the same transaction that writes the invitation,
   * and the queue is walked in its stored order so the choice is documented rather than arbitrary.
   */
  async inviteNextFromWaitlist(actorId: string, cohortId: string) {
    const scope = await this.cohortScope(actorId, cohortId, 'program.manage');

    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM cohorts WHERE id = ${cohortId}::uuid FOR UPDATE`;
      const taken = await tx.enrollment.count({ where: { cohortId, ...seatHoldingStates() } });
      // No free seat means nobody to invite — said as a conflict rather than a silent no-op, so the
      // operator is not left thinking an invitation went out.
      if (taken >= scope.cohort.capacity) throw new IdentityError('conflict', 409);

      const next = await tx.waitlistEntry.findFirst({
        where: { cohortId, state: 'waiting' },
        include: { application: true },
        orderBy: { position: 'asc' }
      });
      if (!next) throw new IdentityError('conflict', 409);

      const existing = await tx.enrollment.findUnique({ where: { cohortId_userId: { cohortId, userId: next.application.userId } } });
      if (existing) throw new IdentityError('conflict', 409);

      const enrollment = await tx.enrollment.create({
        data: {
          cohortId, userId: next.application.userId, applicationId: next.applicationId, state: 'invited',
          invitationExpiresAt: new Date(Date.now() + scope.cohort.acceptanceWindowHours * 3_600_000)
        }
      });
      await tx.waitlistEntry.update({ where: { id: next.id }, data: { state: 'invited' } });
      await tx.application.update({ where: { id: next.applicationId }, data: { state: 'accepted', decidedAt: new Date(), version: { increment: 1 } } });
      await tx.applicationDecision.create({ data: { applicationId: next.applicationId, deciderId: actorId, outcome: 'accepted', reason: '' } });
      await tx.outboxEvent.create({ data: { topic: 'application.decided', payload: { applicationId: next.applicationId, outcome: 'accepted' } } });
      return {
        enrollmentId: enrollment.id,
        applicationId: next.applicationId,
        invitedFromPosition: next.position,
        invitationExpiresAt: enrollment.invitationExpiresAt
      };
    });
  }

  /** PRG-04.A04. Recording an exit. The record stays; only the state moves. */
  async recordWithdrawal(actorId: string, enrollmentId: string, input: { reason: string; version: number; terminated?: boolean | undefined }) {
    const enrollment = await this.db.enrollment.findUnique({ where: { id: enrollmentId } });
    if (!enrollment) throw new IdentityError('not_found', 404);
    await this.cohortScope(actorId, enrollment.cohortId, 'program.manage');
    const reason = text(input.reason, 10, 1000);
    if (!['invited', 'confirmed', 'active'].includes(enrollment.state)) throw new IdentityError('conflict', 409);
    if (enrollment.version !== input.version) throw new IdentityError('conflict', 409);

    const updated = await this.db.enrollment.update({
      where: { id: enrollment.id },
      data: { state: input.terminated ? 'terminated' : 'dropped_out', exitReason: reason, version: { increment: 1 } }
    });
    return {
      id: updated.id, state: updated.state, exitReason: updated.exitReason, version: updated.version,
      /** The attendance and assessment records are untouched; an exit is not an erasure. */
      recordsRetained: true
    };
  }

  // ---------------------------------------------------------------- PRG-05: attendance

  /** The register for one session, with every confirmed member on it whether recorded or not. */
  async sessionRegister(actorId: string, sessionId: string) {
    const session = await this.db.trainingSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new IdentityError('not_found', 404);
    // Reading the register is part of reading the cohort, so it asks for `program.read`: a
    // programme manager who may correct an entry has to be able to see it first, and requiring the
    // recording permission to read locked them out of their own cohort entirely.
    const scope = await this.cohortScope(actorId, session.cohortId, 'program.read');

    const [members, records] = await Promise.all([
      this.db.enrollment.findMany({
        where: { cohortId: session.cohortId, state: { in: ['confirmed', 'active', 'completed'] } },
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: 'asc' }
      }),
      this.db.attendance.findMany({ where: { sessionId }, include: { revisions: { orderBy: { createdAt: 'desc' } }, objections: { orderBy: { createdAt: 'desc' } } } })
    ]);
    const byEnrollment = new Map(records.map(record => [record.enrollmentId, record]));

    return {
      session: this.sessionView(session),
      cohort: { id: scope.cohort.id, name: scope.cohort.name, timezone: scope.cohort.timezone },
      canCorrect: scope.isManager || scope.assigned,
      /** A manager rules on objections; the trainer who made the record does not. */
      canReviewObjections: scope.isManager,
      rows: members.map(member => {
        const record = byEnrollment.get(member.id);
        return {
          enrollmentId: member.id,
          name: member.user.name,
          status: record?.status ?? null,
          excuseNote: record?.excuseNote ?? '',
          attendanceId: record?.id ?? null,
          version: record?.version ?? null,
          revisions: (record?.revisions ?? []).map(revision => ({
            id: revision.id, from: revision.fromStatus, to: revision.toStatus,
            reason: revision.reason, afterClose: revision.afterClose, at: revision.createdAt
          })),
          openObjection: (record?.objections ?? []).find(objection => objection.state === 'open')?.id ?? null
        };
      })
    };
  }

  /**
   * PRG-05.A01/A02. Saving the register.
   *
   * One record per trainee per session, which the unique index guarantees. A first entry is a
   * write; a change is a revision that says what it changed and why. After the session is closed a
   * reason is mandatory, because by then the record may already have been counted for a stipend.
   */
  async saveAttendance(actorId: string, sessionId: string, input: { entries: Array<{ enrollmentId: string; status: string; excuseNote?: string | undefined; reason?: string | undefined; version?: number | undefined }> }) {
    const session = await this.db.trainingSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new IdentityError('not_found', 404);
    const scope = await this.cohortScope(actorId, session.cohortId, 'attendance.record');
    if (session.state === 'cancelled') throw new IdentityError('conflict', 409);
    if (!Array.isArray(input.entries) || !input.entries.length || input.entries.length > 500) throw new IdentityError('invalid_input', 422);

    const closed = session.state === 'closed';
    // Correcting a closed register is a different permission from taking one, and 07 requires the
    // reason on every such change.
    if (closed && !(scope.isManager || scope.assigned)) throw new IdentityError('forbidden', 403);

    return this.db.$transaction(async tx => {
      let written = 0;
      let revised = 0;
      for (const entry of input.entries) {
        if (!STATUSES.includes(entry.status as AttendanceStatus)) throw new IdentityError('invalid_input', 422);
        const status = entry.status as AttendanceStatus;
        const excuseNote = optionalText(entry.excuseNote, 1000);
        // An excused absence without a reason is an absence somebody decided to be kind about.
        if (status === 'excused' && !excuseNote) throw new IdentityError('invalid_input', 422);

        const member = await tx.enrollment.findUnique({ where: { id: entry.enrollmentId } });
        if (!member || member.cohortId !== session.cohortId) throw new IdentityError('not_found', 404);
        if (!['confirmed', 'active', 'completed'].includes(member.state)) throw new IdentityError('conflict', 409);

        const existing = await tx.attendance.findUnique({ where: { sessionId_enrollmentId: { sessionId, enrollmentId: member.id } } });
        if (!existing) {
          await tx.attendance.create({ data: { sessionId, enrollmentId: member.id, status, excuseNote, recordedBy: actorId } });
          written += 1;
          continue;
        }
        if (existing.status === status && existing.excuseNote === excuseNote) continue;
        if (entry.version !== existing.version) throw new IdentityError('conflict', 409);
        const reason = closed ? text(entry.reason, 10, 1000) : optionalText(entry.reason, 1000) || 'corrected during the session';
        if (existing.status !== status) {
          await tx.attendanceRevision.create({
            data: { attendanceId: existing.id, fromStatus: existing.status, toStatus: status, reason, revisedBy: actorId, afterClose: closed }
          });
          revised += 1;
        }
        await tx.attendance.update({ where: { id: existing.id }, data: { status, excuseNote, recordedBy: actorId, version: { increment: 1 } } });
      }
      if (session.state === 'scheduled') {
        await tx.trainingSession.update({ where: { id: session.id }, data: { state: 'held', version: { increment: 1 } } });
      }
      return { sessionId, written, revised, afterClose: closed };
    });
  }

  /** Closing the register. After this a change is a revision, and says so on its face. */
  async closeSession(actorId: string, sessionId: string, version: number) {
    const session = await this.db.trainingSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new IdentityError('not_found', 404);
    await this.cohortScope(actorId, session.cohortId, 'attendance.record');
    if (!['scheduled', 'held'].includes(session.state)) throw new IdentityError('conflict', 409);
    if (session.version !== version) throw new IdentityError('conflict', 409);
    const updated = await this.db.trainingSession.update({ where: { id: session.id }, data: { state: 'closed', closedAt: new Date(), version: { increment: 1 } } });
    return this.sessionView(updated);
  }

  /** PER-13.A02. The trainee disputes a record. It changes nothing by itself. */
  async objectToAttendance(actorId: string, attendanceId: string, input: { reason: string }) {
    const user = await this.identity.activeUser(actorId);
    const reason = text(input.reason, 10, 1000);
    const attendance = await this.db.attendance.findUnique({ where: { id: attendanceId }, include: { enrollment: true } });
    if (!attendance || attendance.enrollment.userId !== user.id) throw new IdentityError('not_found', 404);
    const open = await this.db.attendanceObjection.findFirst({ where: { attendanceId, state: 'open' } });
    if (open) throw new IdentityError('conflict', 409);

    const objection = await this.db.attendanceObjection.create({ data: { attendanceId, userId: user.id, reason, state: 'open' } });
    return {
      id: objection.id,
      attendanceId,
      state: objection.state,
      /** The record stands until somebody rules on it, and the reply does not pretend otherwise. */
      recordChanged: false,
      createdAt: objection.createdAt
    };
  }

  /**
   * PRG-05.A04. Ruling on an objection.
   *
   * Upholding it is what corrects the record, and the correction is a revision like any other. The
   * decider is never the person who made the record being disputed, nor the person disputing it —
   * checked here and again by a CHECK constraint in SQL.
   */
  async decideObjection(actorId: string, objectionId: string, input: { outcome: 'upheld' | 'rejected'; reason: string; correctedStatus?: string | undefined; version: number }) {
    const objection = await this.db.attendanceObjection.findUnique({
      where: { id: objectionId },
      include: { attendance: { include: { session: true } } }
    });
    if (!objection) throw new IdentityError('not_found', 404);
    const scope = await this.cohortScope(actorId, objection.attendance.session.cohortId, 'attendance.review');
    const reason = text(input.reason, 10, 1000);
    if (objection.state !== 'open') throw new IdentityError('conflict', 409);
    if (objection.version !== input.version) throw new IdentityError('conflict', 409);
    if (objection.userId === actorId) throw new IdentityError('forbidden', 403);
    // 08-PERMISSION-EXTENSIONS: whoever recorded it does not get to rule on the objection to it.
    if (objection.attendance.recordedBy === actorId) throw new IdentityError('forbidden', 403);

    return this.db.$transaction(async tx => {
      let corrected = false;
      if (input.outcome === 'upheld') {
        if (!STATUSES.includes(input.correctedStatus as AttendanceStatus)) throw new IdentityError('invalid_input', 422);
        const status = input.correctedStatus as AttendanceStatus;
        if (status !== objection.attendance.status) {
          await tx.attendanceRevision.create({
            data: {
              attendanceId: objection.attendanceId, fromStatus: objection.attendance.status, toStatus: status,
              reason, revisedBy: actorId, afterClose: objection.attendance.session.state === 'closed'
            }
          });
          await tx.attendance.update({ where: { id: objection.attendanceId }, data: { status, recordedBy: actorId, version: { increment: 1 } } });
          corrected = true;
        }
      }
      const updated = await tx.attendanceObjection.update({
        where: { id: objection.id },
        data: { state: input.outcome, decidedBy: actorId, decisionReason: reason, decidedAt: new Date(), version: { increment: 1 } }
      });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId: scope.organizationId, resourceId: objection.id, action: `attendance.objection_${input.outcome}` } });
      return { id: updated.id, state: updated.state, recordCorrected: corrected, decisionReason: updated.decisionReason };
    });
  }

  /** Objections waiting on a decision, for the manager who has to make them. */
  async openObjections(actorId: string, organizationId: string) {
    await this.identity.access(actorId, organizationId, 'attendance.review');
    const rows = await this.db.attendanceObjection.findMany({
      where: { state: 'open', attendance: { session: { cohort: { program: { organizationId } } } } },
      include: {
        user: { select: { name: true } },
        attendance: { include: { session: { include: { cohort: { select: { id: true, name: true } } } } } }
      },
      orderBy: { createdAt: 'asc' },
      take: 100
    });
    return rows.map(row => ({
      id: row.id,
      reason: row.reason,
      raisedBy: row.user.name,
      currentStatus: row.attendance.status,
      attendanceId: row.attendanceId,
      session: { id: row.attendance.session.id, title: row.attendance.session.title, startsAt: row.attendance.session.startsAt, closed: row.attendance.session.state === 'closed' },
      cohort: row.attendance.session.cohort,
      version: row.version,
      createdAt: row.createdAt,
      /** False where this reader made the record: the screen must not offer them the decision. */
      decidableByYou: row.attendance.recordedBy !== actorId && row.userId !== actorId
    }));
  }

  // ---------------------------------------------------------------- PRG-05: assessment

  /**
   * A rubric for the cohort.
   *
   * Defining the criteria is running the programme, so it asks for `program.manage`. Scoring
   * somebody against them is `assessment.record`, which 08 gives to the assigned trainer — the two
   * are different jobs and a manager usually does the first before anyone is assigned to the second.
   */
  async createAssessment(actorId: string, cohortId: string, input: { title: string; rubric: Record<string, number>; scaleMax?: number | undefined; passMark?: number | undefined }) {
    await this.cohortScope(actorId, cohortId, 'program.manage');
    const title = text(input.title, 3, 200);
    const scaleMax = input.scaleMax ?? 5;
    if (!Number.isInteger(scaleMax) || scaleMax < 1 || scaleMax > 100) throw new IdentityError('invalid_input', 422);
    const entries = Object.entries(input.rubric ?? {});
    if (!entries.length || entries.length > 20) throw new IdentityError('invalid_input', 422);
    for (const [criterion, weight] of entries) {
      if (typeof criterion !== 'string' || criterion.length > 60) throw new IdentityError('invalid_input', 422);
      if (!Number.isInteger(weight) || weight < 1 || weight > 100) throw new IdentityError('invalid_input', 422);
    }
    // The pass mark is a total across every criterion, not a per-criterion score, so its ceiling is
    // the scale times the number of criteria. A pass mark nobody could reach is not a pass mark.
    const passMark = input.passMark ?? 0;
    const maximumTotal = scaleMax * entries.length;
    if (!Number.isInteger(passMark) || passMark < 0 || passMark > maximumTotal) throw new IdentityError('invalid_input', 422);
    const assessment = await this.db.assessment.create({ data: { cohortId, title, rubric: input.rubric as object, scaleMax, passMark, createdBy: actorId } });
    return { id: assessment.id, title: assessment.title, rubric: assessment.rubric, scaleMax: assessment.scaleMax, passMark: assessment.passMark, version: assessment.version };
  }

  /** PRG-05.A03. A result against a rubric, for a trainee in the trainer's own cohort. */
  async recordResult(actorId: string, assessmentId: string, input: { enrollmentId: string; scores: Record<string, number>; note?: string | undefined }) {
    const assessment = await this.db.assessment.findUnique({ where: { id: assessmentId } });
    if (!assessment) throw new IdentityError('not_found', 404);
    await this.cohortScope(actorId, assessment.cohortId, 'assessment.record');

    const member = await this.db.enrollment.findUnique({ where: { id: input.enrollmentId } });
    // The trainee has to be in this cohort. A result recorded against somebody else's trainee is
    // the scope failure this check exists for.
    if (!member || member.cohortId !== assessment.cohortId) throw new IdentityError('not_found', 404);
    if (!['confirmed', 'active', 'completed'].includes(member.state)) throw new IdentityError('conflict', 409);

    const rubric = assessment.rubric as Record<string, number>;
    const entries = Object.entries(input.scores ?? {});
    if (!entries.length) throw new IdentityError('invalid_input', 422);
    let total = 0;
    for (const [criterion, score] of entries) {
      // Scored only against the criteria the rubric actually names.
      if (!Object.hasOwn(rubric, criterion)) throw new IdentityError('invalid_input', 422);
      if (!Number.isInteger(score) || score < 0 || score > assessment.scaleMax) throw new IdentityError('invalid_input', 422);
      total += score;
    }
    const note = optionalText(input.note, 2000);

    const result = await this.db.assessmentResult.upsert({
      where: { assessmentId_enrollmentId: { assessmentId, enrollmentId: member.id } },
      create: { assessmentId, enrollmentId: member.id, scores: input.scores as object, total, note, recordedBy: actorId },
      update: { scores: input.scores as object, total, note, recordedBy: actorId }
    });
    return { id: result.id, total: result.total, scaleMax: assessment.scaleMax, passMark: assessment.passMark, passed: result.total >= assessment.passMark };
  }

  // ---------------------------------------------------------------- PER-13: the trainee's view

  /** PER-13. One trainee's own training: the schedule, their record, and what it adds up to. */
  async myTraining(actorId: string, enrollmentId: string) {
    const user = await this.identity.activeUser(actorId);
    const enrollment = await this.db.enrollment.findUnique({
      where: { id: enrollmentId },
      include: {
        cohort: { include: { program: { select: { id: true, title: true, slug: true, attendancePolicy: true, assessmentPolicy: true, withdrawalPolicy: true, complaintsContact: true, stipendOffered: true, stipendConditions: true, organization: { select: { displayName: true } } } } } }
      }
    });
    if (!enrollment || enrollment.userId !== user.id) throw new IdentityError('not_found', 404);

    const [sessions, attendance, results, withdrawal] = await Promise.all([
      this.db.trainingSession.findMany({ where: { cohortId: enrollment.cohortId }, orderBy: { startsAt: 'asc' } }),
      this.db.attendance.findMany({ where: { enrollmentId }, include: { objections: { orderBy: { createdAt: 'desc' } } } }),
      this.db.assessmentResult.findMany({ where: { enrollmentId }, include: { assessment: true } }),
      this.db.enrollmentWithdrawalRequest.findMany({ where: { enrollmentId }, orderBy: { createdAt: 'desc' } })
    ]);
    const bySession = new Map(attendance.map(record => [record.sessionId, record]));
    const counted = attendance.filter(record => ['present', 'late', 'excused'].includes(record.status)).length;

    return {
      enrollment: { id: enrollment.id, state: enrollment.state, confirmedAt: enrollment.confirmedAt, exitReason: enrollment.exitReason, version: enrollment.version },
      cohort: { id: enrollment.cohort.id, name: enrollment.cohort.name, startAt: enrollment.cohort.startAt, endAt: enrollment.cohort.endAt, timezone: enrollment.cohort.timezone },
      program: { ...enrollment.cohort.program, operator: enrollment.cohort.program.organization.displayName },
      sessions: sessions.map(session => {
        const record = bySession.get(session.id);
        return {
          ...this.sessionView(session),
          attendance: record ? { id: record.id, status: record.status, excuseNote: record.excuseNote, recordedAt: record.updatedAt } : null,
          // Only one objection at a time, so a screen never offers a second one that would conflict.
          objection: record?.objections[0] ? { id: record.objections[0].id, state: record.objections[0].state, reason: record.objections[0].reason, decisionReason: record.objections[0].decisionReason } : null,
          canObject: Boolean(record) && !record?.objections.some(objection => objection.state === 'open')
        };
      }),
      attendanceSummary: {
        recorded: attendance.length,
        counted,
        present: attendance.filter(record => record.status === 'present').length,
        late: attendance.filter(record => record.status === 'late').length,
        excused: attendance.filter(record => record.status === 'excused').length,
        absent: attendance.filter(record => record.status === 'absent').length,
        /** The rule these counts will be read against, quoted next to them rather than elsewhere. */
        policy: enrollment.cohort.program.attendancePolicy
      },
      results: results.map(result => ({
        id: result.id, title: result.assessment.title, total: result.total,
        scaleMax: result.assessment.scaleMax, passMark: result.assessment.passMark,
        passed: result.total >= result.assessment.passMark, at: result.updatedAt
      })),
      withdrawalRequests: withdrawal.map(request => ({ id: request.id, reason: request.reason, state: request.state, decisionReason: request.decisionReason, createdAt: request.createdAt })),
      // PART-12 owns both. Declared here so the screen states the absence instead of hiding it.
      stipends: { available: false, reason: 'not_implemented', offeredByProgram: enrollment.cohort.program.stipendOffered, conditions: enrollment.cohort.program.stipendConditions },
      certificate: { available: false, reason: 'not_implemented' }
    };
  }

  /** PER-13.A05. Asking to leave, which is assessed against the programme's policy. */
  async requestWithdrawal(actorId: string, enrollmentId: string, input: { reason: string }) {
    const user = await this.identity.activeUser(actorId);
    const reason = text(input.reason, 10, 1000);
    const enrollment = await this.db.enrollment.findUnique({ where: { id: enrollmentId }, include: { cohort: { include: { program: { select: { withdrawalPolicy: true } } } } } });
    if (!enrollment || enrollment.userId !== user.id) throw new IdentityError('not_found', 404);
    if (!['confirmed', 'active'].includes(enrollment.state)) throw new IdentityError('conflict', 409);
    const open = await this.db.enrollmentWithdrawalRequest.findFirst({ where: { enrollmentId, state: 'open' } });
    if (open) throw new IdentityError('conflict', 409);

    const request = await this.db.enrollmentWithdrawalRequest.create({ data: { enrollmentId, reason, state: 'open' } });
    return {
      id: request.id,
      state: request.state,
      /** The seat is not freed yet: the operator assesses it against the policy first. */
      enrollmentChanged: false,
      policy: enrollment.cohort.program.withdrawalPolicy,
      createdAt: request.createdAt
    };
  }

  private sessionView(session: {
    id: string; cohortId: string; title: string; startsAt: Date; endsAt: Date; timezone: string;
    mode: string; location: string; state: string; closedAt: Date | null; version: number;
  }) {
    return {
      id: session.id,
      cohortId: session.cohortId,
      title: session.title,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      // Every time in this product carries its zone. A schedule without one is a schedule people
      // turn up an hour late to.
      timezone: session.timezone,
      mode: session.mode,
      location: session.location,
      state: session.state,
      closedAt: session.closedAt,
      version: session.version
    };
  }
}
