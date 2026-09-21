import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { CURRENT_TERMS_VERSION, loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { IdentityService } from '../apps/api/dist/modules/identity/identity.service.js';
import { ProgramsService } from '../apps/api/dist/modules/programs/programs.service.js';
import { ApplicationsService } from '../apps/api/dist/modules/programs/applications.service.js';
import { OperationsService } from '../apps/api/dist/modules/operations/operations.service.js';
import { processExportBatch } from '../apps/worker/dist/exports.js';
import { TrainingService } from '../apps/api/dist/modules/programs/training.service.js';
import { ProjectsService } from '../apps/api/dist/modules/projects/projects.service.js';

/**
 * PART-10 acceptance:
 *
 *   PRG-01/02/03  the operator's dashboard, editor and screening, end to end;
 *   seat concurrency  two acceptances cannot both take the last seat;
 *   time and appointments  every appointment carries its zone, a deadline is enforced server side,
 *                          and a reschedule is a request rather than a silent move;
 *   trainer scope  a trainer reaches their own cohort and nothing else;
 *   file sharing with permission  an operator sees a candidate's profile only where they consented,
 *                                 and revoking the consent takes it back.
 *
 * Plus 07's stage limit throughout: being accepted onto training is not being hired.
 */

const config = loadConfig(process.env);

const answersFor = (note: string) => ({ whyThisProgram: note, priorExperience: 'none' });

test('programmes, applications, seats, attendance and trainer scope on real PostgreSQL', async () => {
  const db = createDatabase(config.databaseUrl);
  const identity = new IdentityService(db);
  const programs = new ProgramsService(db);
  const applications = new ApplicationsService(db);
  const operations = new OperationsService(db);
  const training = new TrainingService(db);
  const projects = new ProjectsService(db);

  const prefix = randomUUID();
  const users: string[] = [];
  const organizations: string[] = [];

  const createUser = async (suffix: string, twoFactor = false) => {
    const user = await db.user.create({ data: { email: `${prefix}-${suffix}@example.test`, name: `Prg ${suffix}`, emailVerified: true, twoFactorEnabled: twoFactor, termsVersion: CURRENT_TERMS_VERSION, termsAcceptedAt: new Date() } });
    users.push(user.id);
    return user;
  };

  const day = 86_400_000;
  const programFields = {
    title: `Smart farming ${prefix.slice(0, 8)}`,
    summary: 'A demonstration training programme in smart farming, used to verify the application, seat and attendance chain end to end.',
    skills: ['irrigation', 'sensors'],
    capacity: 2,
    applyClosesAt: new Date(Date.now() + 7 * day).toISOString(),
    durationWeeks: 8,
    hoursPerWeek: 15,
    attendancePolicy: 'Attendance below 80% of sessions ends eligibility for completion; an excused absence needs a stated reason.',
    assessmentPolicy: 'A practical rubric is scored at the end of each module, and the pass mark is published before the module starts.',
    selectionMethod: 'Applications are scored against a published rubric; ties are broken by the order the applications were submitted.',
    withdrawalPolicy: 'A trainee may ask to withdraw at any time; the operator assesses it against the published policy within five days.',
    complaintsContact: 'complaints@example.test'
  };

  try {
    const founder = await createUser('founder');
    const trainer = await createUser('trainer');
    const otherTrainer = await createUser('trainer-two');
    const reviewer = await createUser('reviewer', true);
    const candidateA = await createUser('candidate-a');
    const candidateB = await createUser('candidate-b');
    const candidateC = await createUser('candidate-c');

    await db.platformGrant.create({ data: { userId: reviewer.id, role: 'ContentReviewer', grantedBy: reviewer.id } });

    const org = await identity.createOrganization(founder.id, { legalName: `Operator ${prefix}`, displayName: `Operator ${prefix}`, type: 'Company', country: 'PS', city: 'Jenin' });
    organizations.push(org.id);
    await db.organization.update({ where: { id: org.id }, data: { verification: 'verified' } });
    await db.membership.update({ where: { userId_organizationId: { userId: founder.id, organizationId: org.id } }, data: { roles: ['Owner', 'ProgramManager'] } });
    for (const person of [trainer, otherTrainer]) {
      await db.membership.create({ data: { userId: person.id, organizationId: org.id, roles: ['Trainer'], status: 'active' } });
    }

    // --- PRG-02: the editor ---------------------------------------------------------------------------
    // 07: a claim about jobs is qualified or it is not made. A count with no kind is refused.
    await assert.rejects(
      () => programs.create(founder.id, org.id, { ...programFields, jobCount: 10 }),
      /invalid_input/, 'an unqualified "10 jobs" is exactly what 07 forbids'
    );
    // And a committed number of jobs has to carry the terms it is committed under.
    await assert.rejects(
      () => programs.create(founder.id, org.id, { ...programFields, jobCommitmentKind: 'committed', jobCount: 10, jobCommitmentTerms: 'soon' }),
      /invalid_input/
    );

    const program = await programs.create(founder.id, org.id, {
      ...programFields,
      jobCommitmentKind: 'expected',
      jobCount: 5,
      jobCommitmentTerms: 'Five roles are hoped for with partner farms; none is contractually committed.'
    });
    assert.equal(program.state, 'draft');
    assert.equal(program.jobCommitmentKind, 'expected');
    assert.equal(program.completionGuaranteesJob, false, '07: completing training entitles nobody to a job');
    assert.equal(program.stipendPayable, false, 'no stipend is paid by this build, and the DTO says so');

    // A programme with no cohort is not one anybody can sit in, and the submit path says so.
    let current = await programs.getForOrganization(founder.id, org.id, program.id);
    assert.equal(current.readiness.ready, false);
    assert.equal(current.readiness.blockers.includes('no_cohort'), true);
    await assert.rejects(() => programs.submit(founder.id, org.id, program.id, current.version), /conflict/);

    // A cohort that starts before applications close would recruit for a group already running.
    await assert.rejects(
      () => programs.addCohort(founder.id, org.id, program.id, { name: 'Too soon', capacity: 2, startAt: new Date(Date.now() + 2 * day).toISOString(), endAt: new Date(Date.now() + 40 * day).toISOString() }),
      /invalid_input/
    );

    const cohort = await programs.addCohort(founder.id, org.id, program.id, {
      name: 'Cohort A', capacity: 2,
      startAt: new Date(Date.now() + 14 * day).toISOString(),
      endAt: new Date(Date.now() + 70 * day).toISOString(),
      acceptanceWindowHours: 48
    });
    assert.equal(cohort.capacity, 2);
    assert.equal(cohort.seatsRemaining, 2);

    current = await programs.getForOrganization(founder.id, org.id, program.id);
    assert.equal(current.readiness.ready, true);

    // --- Independent review -----------------------------------------------------------------------
    await programs.submit(founder.id, org.id, program.id, current.version);
    // A programme in review is frozen, exactly as an offering is in PART-08.
    current = await programs.getForOrganization(founder.id, org.id, program.id);
    await assert.rejects(() => programs.update(founder.id, org.id, program.id, { ...programFields, version: current.version }), /conflict/);
    // The operator cannot review its own programme, whatever grant it holds.
    await assert.rejects(() => programs.decide(founder.id, program.id, { outcome: 'approved', publicReason: '', version: current.version }), /forbidden/);

    await programs.claim(reviewer.id, program.id);
    current = await programs.getForOrganization(founder.id, org.id, program.id);
    const approved = await programs.decide(reviewer.id, program.id, { outcome: 'approved', publicReason: '', version: current.version });
    assert.equal(approved.state, 'approved', 'approving is not publishing');
    // Still absent from the public index: the operator decides when applications open.
    assert.equal((await programs.browse({})).some(row => row.slug === program.slug), false);

    current = await programs.getForOrganization(founder.id, org.id, program.id);
    const published = await programs.publish(founder.id, org.id, program.id, current.version);
    assert.equal(published.state, 'recruiting');

    const publicView = await programs.publicProgram(program.slug);
    assert.equal(publicView.acceptsApplications, true);
    assert.equal(publicView.applicationsUnavailableReason, '');
    assert.equal(publicView.jobCommitmentKind, 'expected');
    assert.equal(publicView.completionGuaranteesJob, false);
    assert.equal(publicView.cohorts[0]!.seatsRemaining, 2);
    // A decision-relevant fact is on the public page, not only in the operator's own record.
    assert.ok(publicView.attendancePolicy.length > 20);
    assert.ok(publicView.withdrawalPolicy.length > 20);

    // --- PUB-09.A04: saving is not applying ----------------------------------------------------------
    // One saved list for both kinds of target, so this goes through the projects service that owns it.
    const saved = await projects.addBookmark(candidateA.id, { programSlug: program.slug });
    assert.equal(saved.kind, 'program');
    assert.equal(saved.createsApplication, false);
    assert.equal((await projects.bookmarks(candidateA.id)).filter(row => row.kind === 'program').length, 1);
    assert.equal((await db.application.count({ where: { userId: candidateA.id } })), 0, 'saving an opportunity creates no application');

    // --- PER-10: the profile, and consent ------------------------------------------------------------
    for (const person of [candidateA, candidateB, candidateC]) {
      await applications.saveProfile(person.id, {
        headline: 'Agriculture graduate', summary: 'Looking for practical training in irrigation.',
        city: 'Jenin', skills: ['irrigation'], shareWithOperators: true, shareContact: true
      });
    }
    const preview = await applications.employerPreview(candidateA.id);
    assert.equal(preview.shared, true);
    assert.equal(preview.profile.email, `${prefix}-candidate-a@example.test`);
    // The preview names what is withheld rather than leaving the absence to be guessed at.
    assert.equal(preview.withheld.includes('nationalId'), true);
    assert.equal(Object.hasOwn(preview.profile, 'dateOfBirth'), false);

    // Sharing contact is a second, narrower decision and cannot outlive the first.
    const narrowed = await applications.saveProfile(candidateA.id, {
      headline: 'Agriculture graduate', summary: 'Looking for practical training in irrigation.',
      city: 'Jenin', skills: ['irrigation'], shareWithOperators: false, shareContact: true,
      version: (await db.candidateProfile.findUniqueOrThrow({ where: { userId: candidateA.id } })).version
    });
    assert.equal(narrowed.shareContact, false, 'contact cannot be shared when the profile is not');
    await applications.saveProfile(candidateA.id, {
      headline: 'Agriculture graduate', summary: 'Looking for practical training in irrigation.',
      city: 'Jenin', skills: ['irrigation'], shareWithOperators: true, shareContact: true,
      version: narrowed.version
    });

    // --- PER-11: applying ------------------------------------------------------------------------------
    const draftA = await applications.saveDraft(candidateA.id, { cohortId: cohort.id, answers: answersFor('I farm with my family.'), motivation: 'I want to learn modern irrigation and take it back to our land.' });
    assert.equal(draftA.state, 'draft');
    assert.ok(draftA.reference.startsWith('APP-'));
    // 07: one application per person per cohort.
    await assert.rejects(() => applications.saveDraft(candidateA.id, { cohortId: cohort.id, motivation: 'again' }), /conflict/);
    // Consent is what makes the application readable at all, so it cannot be submitted without it.
    await assert.rejects(() => applications.submit(candidateA.id, draftA.id, { sharingConsent: false, version: draftA.version }), /invalid_input/);

    const submittedA = await applications.submit(candidateA.id, draftA.id, { sharingConsent: true, version: draftA.version });
    assert.equal(submittedA.state, 'submitted');
    assert.ok(submittedA.submittedAt);

    const draftB = await applications.saveDraft(candidateB.id, { cohortId: cohort.id, motivation: 'I have worked on greenhouses and want the formal training.' });
    await applications.submit(candidateB.id, draftB.id, { sharingConsent: true, version: draftB.version });
    const draftC = await applications.saveDraft(candidateC.id, { cohortId: cohort.id, motivation: 'I am starting a smallholding and need the irrigation module.' });
    await applications.submit(candidateC.id, draftC.id, { sharingConsent: true, version: draftC.version });

    // --- The deadline is enforced when the form is submitted, not when it was opened -------------------
    const lateDraft = await applications.saveDraft(candidateA.id, { cohortId: cohort.id, motivation: 'x' }).catch(() => null);
    assert.equal(lateDraft, null, 'the duplicate guard also covers a second draft');
    await db.program.update({ where: { id: program.id }, data: { applyClosesAt: new Date(Date.now() - 1000) } });
    const lateUser = await createUser('late');
    await applications.saveProfile(lateUser.id, { headline: 'Late', summary: 'Applying after the window closed.', shareWithOperators: true });
    const lateApplication = await applications.saveDraft(lateUser.id, { cohortId: cohort.id, motivation: 'I saw the programme after the deadline had already passed.' });
    await assert.rejects(
      () => applications.submit(lateUser.id, lateApplication.id, { sharingConsent: true, version: lateApplication.version }),
      /conflict/, 'a deadline is checked at submission, not when the page was opened'
    );
    assert.equal((await programs.publicProgram(program.slug)).applicationsUnavailableReason, 'deadline_passed');
    await db.program.update({ where: { id: program.id }, data: { applyClosesAt: new Date(Date.now() + 7 * day) } });

    // --- PRG-03: screening, and the consent gate on the operator's read ---------------------------------
    const queue = await applications.listForOrganization(founder.id, org.id, { pending: true });
    assert.equal(queue.length, 3);
    const rowA = queue.find(row => row.reference === submittedA.reference)!;
    assert.equal(rowA.profileShared, true);
    assert.equal(rowA.candidate?.headline, 'Agriculture graduate');

    // Revoking the profile consent takes it back from the operator immediately, everywhere.
    const profileA = await db.candidateProfile.findUniqueOrThrow({ where: { userId: candidateA.id } });
    await db.candidateProfile.update({ where: { userId: candidateA.id }, data: { shareWithOperators: false } });
    const afterRevoke = (await applications.listForOrganization(founder.id, org.id, { pending: true })).find(row => row.reference === submittedA.reference)!;
    assert.equal(afterRevoke.profileShared, false);
    assert.equal(afterRevoke.candidate, null, 'a revoked consent hides the profile, not just the contact detail');
    assert.equal(afterRevoke.profileWithheldReason, 'consent_revoked');
    await db.candidateProfile.update({ where: { userId: candidateA.id }, data: { shareWithOperators: true, version: profileA.version } });

    // Another operator cannot read this queue at all.
    const outsider = await createUser('outsider');
    const otherOrg = await identity.createOrganization(outsider.id, { legalName: `Other ${prefix}`, displayName: `Other ${prefix}`, type: 'Company', country: 'PS', city: 'Nablus' });
    organizations.push(otherOrg.id);
    await db.membership.update({ where: { userId_organizationId: { userId: outsider.id, organizationId: otherOrg.id } }, data: { roles: ['Owner', 'ProgramManager'] } });
    await assert.rejects(() => applications.getForOrganization(outsider.id, otherOrg.id, submittedA.id), /not_found/, "another organisation's candidate is absent, not forbidden");

    // PRG-03.A02: a score against a rubric, with the note kept inside the operator.
    const review = await applications.review(founder.id, org.id, submittedA.id, { scores: { motivation: 4, relevance: 5 }, note: 'Strong practical background and a clear reason for applying.' });
    const candidateExport = await operations.requestApplicationExport(founder.id, org.id, submittedA.id);
    assert.equal(await processExportBatch(db), 1);
    const candidateCsv = (await operations.downloadExport(founder.id, candidateExport.id)).content ?? '';
    assert.match(candidateCsv, new RegExp(submittedA.reference));
    assert.equal(candidateCsv.includes('Strong practical background'), false, 'private reviewer notes never enter candidate exports');
    await assert.rejects(() => operations.requestApplicationExport(candidateA.id, org.id, submittedA.id), /forbidden/);
    assert.equal(review.total, 9);
    const candidateSeesIt = await applications.one(candidateA.id, submittedA.id);
    assert.equal(JSON.stringify(candidateSeesIt).includes('Strong practical background'), false, "the reviewer's private note never reaches the candidate");

    // --- Appointments: a zone, a deadline, and a reschedule that does not move anything ----------------
    await assert.rejects(
      () => applications.scheduleInterview(founder.id, org.id, submittedA.id, { scheduledAt: new Date(Date.now() - day).toISOString(), location: 'Office' }),
      /invalid_input/, 'an appointment in the past is not an appointment'
    );
    await assert.rejects(
      () => applications.scheduleInterview(founder.id, org.id, submittedA.id, { scheduledAt: new Date(Date.now() + 3 * day).toISOString(), mode: 'in_person' }),
      /invalid_input/, 'an in-person appointment needs somewhere to be'
    );
    const interview = await applications.scheduleInterview(founder.id, org.id, submittedA.id, {
      scheduledAt: new Date(Date.now() + 3 * day).toISOString(), timezone: 'Asia/Hebron', mode: 'in_person', location: 'Jenin training centre'
    });
    assert.equal(interview.timezone, 'Asia/Hebron', 'every appointment carries the zone it was set in');
    assert.equal(interview.state, 'proposed');

    // Nobody else confirms somebody's appointment.
    await assert.rejects(() => applications.confirmInterview(candidateB.id, interview.id, interview.version), /not_found/);
    const confirmed = await applications.confirmInterview(candidateA.id, interview.id, interview.version);
    assert.equal(confirmed.state, 'confirmed');

    const reschedule = await applications.requestReschedule(candidateA.id, interview.id, { reason: 'I have an exam that morning and cannot attend.', alternatives: 'Any afternoon that week.' });
    assert.equal(reschedule.appointmentMoved, false, 'a reschedule is a request; the original time stands until somebody acts');
    assert.equal(new Date(reschedule.scheduledAt).getTime(), new Date(interview.scheduledAt).getTime());

    // --- Seat concurrency: two acceptances cannot both take the last seat ------------------------------
    const currentA = await db.application.findUniqueOrThrow({ where: { id: submittedA.id } });
    const acceptedA = await applications.decide(founder.id, org.id, submittedA.id, { outcome: 'accepted', reason: '', version: currentA.version });
    assert.equal(acceptedA.application.state, 'accepted');
    assert.ok(acceptedA.enrollment);
    assert.equal(acceptedA.trainingIsNotEmployment, true, "07's stage limit, in the reply that grants the seat");
    assert.equal(acceptedA.enrollment!.state, 'invited', 'an acceptance is an invitation, not a confirmed seat');

    // The last seat. Two operators deciding at the same instant must not both get it.
    const [appB, appC] = await Promise.all([
      db.application.findUniqueOrThrow({ where: { id: draftB.id } }),
      db.application.findUniqueOrThrow({ where: { id: draftC.id } })
    ]);
    const race = await Promise.allSettled([
      applications.decide(founder.id, org.id, appB.id, { outcome: 'accepted', reason: '', version: appB.version }),
      applications.decide(founder.id, org.id, appC.id, { outcome: 'accepted', reason: '', version: appC.version })
    ]);
    assert.equal(race.filter(result => result.status === 'fulfilled').length, 1, 'only one of two simultaneous acceptances may take the last seat');
    const loser = race.findIndex(result => result.status === 'rejected');
    const loserId = loser === 0 ? appB.id : appC.id;
    const winnerId = loser === 0 ? appC.id : appB.id;

    let capacity = await applications.cohortCapacity(founder.id, org.id, cohort.id);
    assert.equal(capacity.seatsTaken, 2);
    assert.equal(capacity.seatsRemaining, 0);

    // A full cohort refuses a third acceptance rather than quietly overbooking.
    const loserRow = await db.application.findUniqueOrThrow({ where: { id: loserId } });
    await assert.rejects(
      () => applications.decide(founder.id, org.id, loserId, { outcome: 'accepted', reason: '', version: loserRow.version }),
      /conflict/, 'a full cohort cannot accept anybody else'
    );

    // --- The waitlist is a documented queue ------------------------------------------------------------
    const waitlisted = await applications.decide(founder.id, org.id, loserId, { outcome: 'waitlisted', reason: 'The cohort is full; you are first in line if a seat is freed.', version: loserRow.version });
    assert.equal(waitlisted.waitlistPosition, 1);
    // Nobody can be invited from the waitlist while every seat is held.
    await assert.rejects(() => training.inviteNextFromWaitlist(founder.id, cohort.id), /conflict/, 'there is no seat to invite anybody into');

    // --- An invitation that lapses frees its seat, with nobody running a job ---------------------------
    const winnerEnrollment = await db.enrollment.findFirstOrThrow({ where: { applicationId: winnerId } });
    // Both dates move, because the invitation window is a real interval and the database says so:
    // an expiry before the invitation was issued is refused outright.
    await db.enrollment.update({ where: { id: winnerEnrollment.id }, data: { invitedAt: new Date(Date.now() - 3 * day), invitationExpiresAt: new Date(Date.now() - 1000) } });
    capacity = await applications.cohortCapacity(founder.id, org.id, cohort.id);
    assert.equal(capacity.seatsRemaining, 1, 'a lapsed invitation stops holding a seat by itself');
    // And the person whose invitation lapsed cannot accept it late.
    const lapsed = await db.enrollment.findUniqueOrThrow({ where: { id: winnerEnrollment.id } });
    const lapsedUser = lapsed.userId;
    await assert.rejects(() => applications.acceptSeat(lapsedUser, lapsed.id, lapsed.version), /conflict/);

    const invited = await training.inviteNextFromWaitlist(founder.id, cohort.id);
    assert.equal(invited.invitedFromPosition, 1, 'the queue is walked in its documented order');

    // --- PER-12.A05: accepting a seat ------------------------------------------------------------------
    const enrollmentA = await db.enrollment.findFirstOrThrow({ where: { applicationId: submittedA.id } });
    // Nobody accepts somebody else's seat.
    await assert.rejects(() => applications.acceptSeat(candidateB.id, enrollmentA.id, enrollmentA.version), /not_found/);
    const confirmedSeat = await applications.acceptSeat(candidateA.id, enrollmentA.id, enrollmentA.version);
    assert.equal(confirmedSeat.state, 'confirmed');
    assert.equal(confirmedSeat.trainingIsNotEmployment, true);

    // --- Trainer scope --------------------------------------------------------------------------------
    // A trainer with no assignment reaches nothing, even holding the Trainer role in this operator.
    await assert.rejects(() => training.cohortBoard(trainer.id, cohort.id), /forbidden/, 'the role is the floor; the assignment is what grants the scope');
    await training.assignTrainer(founder.id, cohort.id, trainer.id);
    const board = await training.cohortBoard(trainer.id, cohort.id);
    assert.equal(board.canManage, false, 'a trainer runs sessions; they do not change who is in the room');
    await assert.rejects(() => training.assignTrainer(trainer.id, cohort.id, otherTrainer.id), /forbidden/);
    // And still nothing in a cohort they were not assigned to.
    const secondCohort = await programs.addCohort(founder.id, org.id, program.id, {
      name: 'Cohort B', capacity: 1,
      startAt: new Date(Date.now() + 20 * day).toISOString(),
      endAt: new Date(Date.now() + 80 * day).toISOString()
    });
    await assert.rejects(() => training.cohortBoard(trainer.id, secondCohort.id), /forbidden/, 'a trainer sees their own cohorts, not the organisation’s');

    // --- PRG-05: attendance, revisions and objections ---------------------------------------------------
    await assert.rejects(
      () => training.createSession(founder.id, cohort.id, { title: 'Before the cohort', startsAt: new Date(Date.now() + day).toISOString(), endsAt: new Date(Date.now() + day + 3_600_000).toISOString(), location: 'Room 1' }),
      /invalid_input/, 'a session outside the cohort’s dates belongs to a cohort that is not running'
    );
    const session = await training.createSession(founder.id, cohort.id, {
      title: 'Irrigation basics',
      startsAt: new Date(Date.now() + 15 * day).toISOString(),
      endsAt: new Date(Date.now() + 15 * day + 3 * 3_600_000).toISOString(),
      location: 'Jenin training centre'
    });
    assert.equal(session.timezone, 'Asia/Hebron');

    // A trainer in another cohort cannot take this register.
    await assert.rejects(() => training.sessionRegister(otherTrainer.id, session.id), /forbidden/);
    // The programme manager can read the register of their own cohort: they may have to correct an
    // entry, and they cannot correct what they cannot see.
    const managerView = await training.sessionRegister(founder.id, session.id);
    assert.equal(managerView.canReviewObjections, true, 'a manager rules on disputes');
    const register = await training.sessionRegister(trainer.id, session.id);
    assert.equal(register.rows.length, 1, 'only confirmed members are on the register');
    assert.equal(register.canReviewObjections, false, 'the trainer records; somebody else rules on a dispute');

    // An excused absence without a reason is an absence somebody decided to be kind about.
    await assert.rejects(
      () => training.saveAttendance(trainer.id, session.id, { entries: [{ enrollmentId: register.rows[0]!.enrollmentId, status: 'excused' }] }),
      /invalid_input/
    );
    const saveResult = await training.saveAttendance(trainer.id, session.id, { entries: [{ enrollmentId: register.rows[0]!.enrollmentId, status: 'absent' }] });
    assert.equal(saveResult.written, 1);

    // Taking the register moved the session from `scheduled` to `held`, so the version the caller
    // holds is stale — which is the point of carrying one.
    await assert.rejects(() => training.closeSession(trainer.id, session.id, session.version), /conflict/);
    const heldSession = await db.trainingSession.findUniqueOrThrow({ where: { id: session.id } });
    assert.equal(heldSession.state, 'held');
    const closedSession = await training.closeSession(trainer.id, session.id, heldSession.version);
    assert.equal(closedSession.state, 'closed');

    // After the register is closed a change is a revision, and it must say why.
    const afterClose = await training.sessionRegister(trainer.id, session.id);
    const row = afterClose.rows[0]!;
    await assert.rejects(
      () => training.saveAttendance(trainer.id, session.id, { entries: [{ enrollmentId: row.enrollmentId, status: 'present', version: row.version! }] }),
      /invalid_input/, 'a correction after close carries a reason or it does not happen'
    );

    // The trainee disputes it. The record does not move.
    const attendanceId = row.attendanceId!;
    const objection = await training.objectToAttendance(candidateA.id, attendanceId, { reason: 'I was there and signed the sheet at the door.' });
    assert.equal(objection.recordChanged, false);
    assert.equal((await db.attendance.findUniqueOrThrow({ where: { id: attendanceId } })).status, 'absent');
    // Only one open objection at a time, so a screen never offers a second conflicting one.
    await assert.rejects(() => training.objectToAttendance(candidateA.id, attendanceId, { reason: 'Saying it again does not help.' }), /conflict/);

    // Whoever recorded it does not get to rule on the objection to it.
    const objectionRow = await db.attendanceObjection.findUniqueOrThrow({ where: { id: objection.id } });
    await assert.rejects(
      () => training.decideObjection(trainer.id, objection.id, { outcome: 'rejected', reason: 'I am sure the record is right.', version: objectionRow.version }),
      /forbidden/, 'the recorder cannot rule on a dispute about their own record'
    );
    // Nor does the person disputing it.
    await assert.rejects(
      () => training.decideObjection(candidateA.id, objection.id, { outcome: 'upheld', reason: 'I know I was there.', correctedStatus: 'present', version: objectionRow.version }),
      /forbidden/
    );

    const decided = await training.decideObjection(founder.id, objection.id, { outcome: 'upheld', reason: 'The door sheet confirms the trainee attended.', correctedStatus: 'present', version: objectionRow.version });
    assert.equal(decided.recordCorrected, true);
    assert.equal((await db.attendance.findUniqueOrThrow({ where: { id: attendanceId } })).status, 'present');
    // The correction left a revision that says what changed, by whom and why.
    const revisions = await db.attendanceRevision.findMany({ where: { attendanceId } });
    assert.equal(revisions.length, 1);
    assert.equal(revisions[0]!.fromStatus, 'absent');
    assert.equal(revisions[0]!.toStatus, 'present');
    assert.equal(revisions[0]!.afterClose, true);
    // And that revision cannot be rewritten.
    await assert.rejects(
      () => db.attendanceRevision.update({ where: { id: revisions[0]!.id }, data: { reason: 'something else' } }),
      /append-only|23514/, 'a revision is evidence, not a draft'
    );

    // --- Assessment ------------------------------------------------------------------------------------
    // Defining the criteria is running the programme; scoring somebody against them is the assigned
    // trainer's job. Two different permissions, so a trainer cannot invent the rubric they are
    // then measured by.
    await assert.rejects(
      () => training.createAssessment(trainer.id, cohort.id, { title: 'Trainer-written rubric', rubric: { setup: 1 } }),
      /forbidden/, 'a trainer scores against a rubric; they do not write it'
    );
    const assessment = await training.createAssessment(founder.id, cohort.id, { title: 'Irrigation practical', rubric: { setup: 2, safety: 1 }, scaleMax: 5, passMark: 6 });
    // Scored only against criteria the rubric names.
    await assert.rejects(
      () => training.recordResult(trainer.id, assessment.id, { enrollmentId: row.enrollmentId, scores: { improvisation: 5 } }),
      /invalid_input/
    );
    const result = await training.recordResult(trainer.id, assessment.id, { enrollmentId: row.enrollmentId, scores: { setup: 4, safety: 3 } });
    assert.equal(result.total, 7);
    assert.equal(result.passed, true);
    // A trainer cannot record a result for a trainee in a cohort that is not theirs.
    await assert.rejects(() => training.recordResult(otherTrainer.id, assessment.id, { enrollmentId: row.enrollmentId, scores: { setup: 5, safety: 5 } }), /forbidden/);

    // --- PER-13: the trainee's own record ---------------------------------------------------------------
    const mine = await training.myTraining(candidateA.id, enrollmentA.id);
    assert.equal(mine.attendanceSummary.present, 1);
    assert.ok(mine.attendanceSummary.policy.length > 20, 'the rule the counts are read against sits next to them');
    assert.equal(mine.results[0]!.passed, true);
    // PART-12 owns both, and the screen is told so rather than left to render an empty section.
    assert.equal(mine.stipends.available, false);
    assert.equal(mine.stipends.reason, 'not_implemented');
    assert.equal(mine.certificate.available, false);
    // Somebody else's training record is absent.
    await assert.rejects(() => training.myTraining(candidateB.id, enrollmentA.id), /not_found/);

    const withdrawal = await training.requestWithdrawal(candidateA.id, enrollmentA.id, { reason: 'I have been offered work that clashes with the session times.' });
    assert.equal(withdrawal.enrollmentChanged, false, 'asking to leave is assessed against the policy, not applied');
    assert.equal((await db.enrollment.findUniqueOrThrow({ where: { id: enrollmentA.id } })).state, 'confirmed');

    // --- The database holds the seat rule on its own ------------------------------------------------------
    // Bypassing the service entirely still cannot overbook the cohort: the deferred constraint
    // trigger counts the seats actually held at COMMIT and refuses the transaction.
    const overbooker = await createUser('overbooker');
    await assert.rejects(
      () => db.$transaction(async tx => {
        const spare = await tx.application.create({
          data: { programId: program.id, cohortId: cohort.id, userId: overbooker.id, reference: `APP-${prefix.slice(0, 8).toUpperCase()}`, state: 'accepted', motivation: 'direct write' }
        });
        await tx.enrollment.create({
          data: { cohortId: cohort.id, userId: overbooker.id, applicationId: spare.id, state: 'confirmed', invitationExpiresAt: new Date(Date.now() + day) }
        });
      }),
      /capacity exceeded/, 'the seat rule survives a path that never took the lock'
    );

    // --- PRG-01: the dashboard --------------------------------------------------------------------------
    const dashboard = await programs.listForOrganization(founder.id, org.id);
    const listed = dashboard.find(entry => entry.id === program.id)!;
    assert.equal(listed.cohorts.length, 2);
    assert.equal(listed.applicationCount >= 4, true);
    assert.equal(typeof listed.awaitingDecision, 'number');
    // A programme from another organisation never appears in this list.
    assert.equal((await programs.listForOrganization(outsider.id, otherOrg.id)).length, 0);
  } finally {
    await db.$transaction(async tx => {
      const programIds = (await tx.program.findMany({ where: { organizationId: { in: organizations } }, select: { id: true } })).map(row => row.id);
      await tx.exportJob.deleteMany({ where: { ownerId: { in: users } } });
      const cohortIds = (await tx.cohort.findMany({ where: { programId: { in: programIds } }, select: { id: true } })).map(row => row.id);
      for (const table of ['attendance_revisions', 'application_decisions', 'application_reviews', 'program_review_decisions', 'identity_audit_events']) {
        await tx.$executeRawUnsafe(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
      }
      await tx.assessmentResult.deleteMany({ where: { assessment: { cohortId: { in: cohortIds } } } });
      await tx.assessment.deleteMany({ where: { cohortId: { in: cohortIds } } });
      await tx.attendanceRevision.deleteMany({ where: { attendance: { session: { cohortId: { in: cohortIds } } } } });
      await tx.attendanceObjection.deleteMany({ where: { attendance: { session: { cohortId: { in: cohortIds } } } } });
      await tx.attendance.deleteMany({ where: { session: { cohortId: { in: cohortIds } } } });
      await tx.trainingSession.deleteMany({ where: { cohortId: { in: cohortIds } } });
      await tx.enrollmentWithdrawalRequest.deleteMany({ where: { enrollment: { cohortId: { in: cohortIds } } } });
      await tx.waitlistEntry.deleteMany({ where: { cohortId: { in: cohortIds } } });
      // The capacity trigger is deferred to COMMIT, so emptying the cohort has to happen before
      // anything it counts is gone; deleting enrolments first keeps the final count at zero.
      await tx.enrollment.deleteMany({ where: { cohortId: { in: cohortIds } } });
      await tx.interviewRescheduleRequest.deleteMany({ where: { interview: { application: { programId: { in: programIds } } } } });
      await tx.interview.deleteMany({ where: { application: { programId: { in: programIds } } } });
      await tx.applicationDecision.deleteMany({ where: { application: { programId: { in: programIds } } } });
      await tx.applicationReview.deleteMany({ where: { application: { programId: { in: programIds } } } });
      await tx.application.deleteMany({ where: { programId: { in: programIds } } });
      await tx.cohortTrainer.deleteMany({ where: { cohortId: { in: cohortIds } } });
      await tx.cohort.deleteMany({ where: { id: { in: cohortIds } } });
      await tx.programReviewDecision.deleteMany({ where: { programId: { in: programIds } } });
      await tx.bookmark.deleteMany({ where: { OR: [{ programId: { in: programIds } }, { userId: { in: users } }] } });
      await tx.program.deleteMany({ where: { id: { in: programIds } } });
      await tx.candidateProfile.deleteMany({ where: { userId: { in: users } } });
      await tx.outboxEvent.deleteMany({});
      await tx.identityAuditEvent.deleteMany({ where: { actorId: { in: users } } });
      for (const table of ['identity_audit_events', 'program_review_decisions', 'application_reviews', 'application_decisions', 'attendance_revisions']) {
        await tx.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
      }
      await tx.membership.deleteMany({ where: { organizationId: { in: organizations } } });
      await tx.party.deleteMany({ where: { OR: [{ userId: { in: users } }, { organizationId: { in: organizations } }] } });
      await tx.organization.deleteMany({ where: { id: { in: organizations } } });
      await tx.platformGrant.deleteMany({ where: { userId: { in: users } } });
      await tx.individualProfile.deleteMany({ where: { userId: { in: users } } });
      await tx.session.deleteMany({ where: { userId: { in: users } } });
      await tx.user.deleteMany({ where: { id: { in: users } } });
    });
    await db.$disconnect();
  }
});
