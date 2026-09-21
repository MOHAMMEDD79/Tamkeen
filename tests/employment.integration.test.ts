import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { CURRENT_TERMS_VERSION, loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { IdentityService } from '../apps/api/dist/modules/identity/identity.service.js';
import { ApplicationsService } from '../apps/api/dist/modules/programs/applications.service.js';
import { JobsService } from '../apps/api/dist/modules/employment/jobs.service.js';
import { OffersService } from '../apps/api/dist/modules/employment/offers.service.js';
import { PlacementsService } from '../apps/api/dist/modules/employment/placements.service.js';

/**
 * PART-11 acceptance, proved against real PostgreSQL:
 *
 *   JOB-01  accepting an offer and then not turning up leaves the placement at `start_pending`.
 *           It is never `started`, it is counted nowhere, and the database refuses a `started` row
 *           without an actual, verified start date even when the service is bypassed.
 *   JOB-02  a follow-up nobody answered stays `unknown`. It does not become `retained`, and a
 *           `working` row with no source is refused by a CHECK constraint.
 *   confirmed start  one party's word is a claim; two parties naming the same day is a start; two
 *                    parties naming different days is a recorded disagreement, not a coin toss.
 *   follow-up dated from the actual start  the 30- and 90-day checkpoints are counted from the day
 *                                          work began, not from the offer's proposed date.
 *   limited recruiter access  a recruiter may verify, but may not settle a disagreement or export
 *                             the impact figures, and reaches nothing in another organisation.
 *
 * Plus 07's stage limit: a training candidacy grants nothing here, and a job listing is refused
 * unless its pay is either stated or its absence explained.
 */

const config = loadConfig(process.env);
const day = 86_400_000;

test('jobs, offers, confirmed starts and follow-up on real PostgreSQL', async () => {
  const db = createDatabase(config.databaseUrl);
  const identity = new IdentityService(db);
  const applications = new ApplicationsService(db);
  const jobs = new JobsService(db);
  const offers = new OffersService(db);
  const placements = new PlacementsService(db);

  const prefix = randomUUID();
  const users: string[] = [];
  const organizations: string[] = [];

  const createUser = async (suffix: string) => {
    const user = await db.user.create({ data: { email: `${prefix}-${suffix}@example.test`, name: `Emp ${suffix}`, emailVerified: true, termsVersion: CURRENT_TERMS_VERSION, termsAcceptedAt: new Date() } });
    users.push(user.id);
    return user;
  };

  const jobFields = {
    title: `Field technician ${prefix.slice(0, 8)}`,
    summary: 'A demonstration job used to verify the offer, start-confirmation and follow-up chain end to end against a real database.',
    requirements: 'Able to read a sensor log and keep a maintenance record.',
    responsibilities: 'Install and service irrigation sensors across three sites.',
    skills: ['sensors'],
    contractType: 'full_time' as const,
    deliveryMode: 'in_person' as const,
    city: 'Jenin',
    hoursPerWeek: 40,
    salaryDisclosed: true,
    salaryMinMinor: '400000',
    salaryCurrency: 'ILS',
    salaryPeriod: 'monthly',
    closesAt: new Date(Date.now() + 14 * day).toISOString(),
    openings: 1
  };

  try {
    const employer = await createUser('employer');
    const recruiter = await createUser('recruiter');
    const manager = await createUser('manager');
    const candidate = await createUser('candidate');
    const second = await createUser('second');
    const outsider = await createUser('outsider');

    const org = await identity.createOrganization(employer.id, { legalName: `Employer ${prefix}`, displayName: `Employer ${prefix}`, type: 'Company', country: 'PS', city: 'Jenin' });
    organizations.push(org.id);
    await db.organization.update({ where: { id: org.id }, data: { verification: 'verified' } });
    await db.membership.update({ where: { userId_organizationId: { userId: employer.id, organizationId: org.id } }, data: { roles: ['Owner', 'Recruiter'] } });
    await db.membership.create({ data: { userId: recruiter.id, organizationId: org.id, roles: ['Recruiter'], status: 'active' } });
    await db.membership.create({ data: { userId: manager.id, organizationId: org.id, roles: ['ProgramManager'], status: 'active' } });

    const otherOrg = await identity.createOrganization(outsider.id, { legalName: `Other ${prefix}`, displayName: `Other ${prefix}`, type: 'Company', country: 'PS', city: 'Nablus' });
    organizations.push(otherOrg.id);
    await db.organization.update({ where: { id: otherOrg.id }, data: { verification: 'verified' } });

    // --- PRG-07.A01: a job, and what a listing must say about pay ---------------------------------
    await assert.rejects(
      jobs.create(recruiter.id, org.id, { ...jobFields, salaryDisclosed: false, salaryMinMinor: null, salaryCurrency: null, salaryUndisclosedReason: 'tbd' }),
      /invalid_input/, 'a listing that neither states the pay nor explains the silence is refused'
    );
    // Not disclosing is allowed; not explaining is not. The same rule, from the other side.
    const quiet = await jobs.create(recruiter.id, org.id, {
      ...jobFields, title: `Quiet pay ${prefix.slice(0, 6)}`, salaryDisclosed: false,
      salaryMinMinor: null, salaryCurrency: null,
      salaryUndisclosedReason: 'the band is set by the donor contract and is not final yet'
    });
    assert.equal(quiet.salaryDisclosed, false);
    assert.equal(quiet.salaryUndisclosedReason.length >= 10, true);

    const job = await jobs.create(recruiter.id, org.id, jobFields);
    assert.equal(job.state, 'draft');
    // A draft reaches nobody: the public browse is a different question from the operator's list.
    assert.equal((await jobs.browse({})).some(card => card.slug === job.slug), false);

    // --- PRG-07.A03: publishing, and what it refuses ----------------------------------------------
    const short = await jobs.create(recruiter.id, org.id, { ...jobFields, title: `Short ${prefix.slice(0, 6)}`, summary: 'Too short to decide from.', requirements: '' });
    const readiness = await jobs.validate(recruiter.id, org.id, short.id);
    assert.equal(readiness.ready, false);
    assert.deepEqual([...readiness.blockers].sort(), ['requirements_missing', 'summary_too_short']);
    await assert.rejects(jobs.publish(recruiter.id, org.id, short.id, short.version), /conflict/, 'an incomplete listing cannot be published');

    const published = await jobs.publish(recruiter.id, org.id, job.id, job.version);
    assert.equal(published.state, 'open');
    const publicJob = await jobs.publicJob(job.slug);
    assert.equal(publicJob.acceptsApplications, true);
    assert.equal(publicJob.programDidNotPromiseThisJob, true);
    // Editing an open job is refused: it would move the goalposts under the people who applied.
    await assert.rejects(jobs.update(recruiter.id, org.id, job.id, { ...jobFields, version: published.version }), /conflict/);

    // --- the candidate ------------------------------------------------------------------------------
    await assert.rejects(jobs.saveDraft(candidate.id, { jobId: job.id, coverNote: 'x' }).then(draft =>
      jobs.submit(candidate.id, draft.id, { sharingConsent: true, version: draft.version })
    ), /conflict/, 'an application cannot be submitted before a candidate profile exists');
    await db.jobApplication.deleteMany({ where: { jobId: job.id, userId: candidate.id } });

    for (const person of [candidate, second]) {
      await applications.saveProfile(person.id, {
        headline: 'Technician', summary: 'Two years maintaining irrigation equipment across the north.',
        city: 'Jenin', availability: 'immediately', education: 'Technical diploma',
        experience: 'Two years of field maintenance.', skills: ['sensors'],
        shareWithOperators: true, shareContact: false
      });
    }

    const draft = await jobs.saveDraft(candidate.id, { jobId: job.id, coverNote: 'I have maintained the same sensors for two seasons.' });
    assert.equal(draft.state, 'draft');
    assert.equal(draft.kind, 'job');
    // Consent is not optional: without it nothing about the person reaches the employer.
    await assert.rejects(jobs.submit(candidate.id, draft.id, { sharingConsent: false, version: draft.version }), /invalid_input/);
    const submitted = await jobs.submit(candidate.id, draft.id, { sharingConsent: true, version: draft.version });
    assert.equal(submitted.state, 'submitted');
    // 07: one candidacy per person per job, enforced by a unique index rather than by a check.
    await assert.rejects(jobs.saveDraft(candidate.id, { jobId: job.id }), /conflict/);

    // --- PRG-07.A05: a referral shares nothing until the person agrees ------------------------------
    const referral = await jobs.refer(recruiter.id, org.id, job.id, { userId: second.id, note: 'Finished our sensors cohort.' });
    assert.equal(referral.profileShared, false);
    assert.equal(referral.awaitingCandidateConsent, true);
    const waiting = await jobs.myReferrals(second.id);
    assert.equal(waiting.length, 1);
    assert.equal(waiting[0]!.profileShared, false);
    // Until they agree, the employer's queue does not contain them at all.
    assert.equal((await jobs.listApplications(recruiter.id, org.id, {})).some(row => row.reference === waiting[0]!.id), false);
    const agreed = await jobs.respondToReferral(second.id, referral.id, { accept: true, version: waiting[0]!.version });
    assert.equal(agreed.profileShared, true);
    assert.equal(typeof agreed.applicationId, 'string');

    // --- limited recruiter access -------------------------------------------------------------------
    await assert.rejects(jobs.listApplications(outsider.id, org.id, {}), /forbidden/, 'an outsider reaches nothing in this organisation');
    await assert.rejects(jobs.create(outsider.id, org.id, jobFields), /forbidden/);

    const queue = await jobs.listApplications(recruiter.id, org.id, { pending: true });
    const mine = queue.find(row => row.id === submitted.id)!;
    assert.equal(mine.profileShared, true);
    assert.equal(mine.candidate?.name, candidate.name);
    // Contact sharing is a second consent, and it was off.
    assert.equal(mine.candidate?.email, null);

    // Revoking the profile consent takes it back immediately, including on a candidacy already sent.
    await applications.saveProfile(candidate.id, { shareWithOperators: false, version: 1 });
    const afterRevoke = (await jobs.listApplications(recruiter.id, org.id, {})).find(row => row.id === submitted.id)!;
    assert.equal(afterRevoke.profileShared, false);
    assert.equal(afterRevoke.candidate, null);
    assert.equal(afterRevoke.profileWithheldReason, 'consent_revoked');
    await applications.saveProfile(candidate.id, { shareWithOperators: true, version: 2 });

    // --- PRG-08: the offer ---------------------------------------------------------------------------
    const shortlisted = await jobs.decide(recruiter.id, org.id, submitted.id, { outcome: 'shortlisted', reason: '', version: submitted.version });
    // Stated on every decision, because this is where a hiring count is most often invented.
    assert.equal(shortlisted.hiredCount, 0);

    // Far enough back that both checkpoints fall due on their own: the retention figure is then
    // exercised by the real dates rather than by a row somebody moved.
    const startDate = new Date(Date.now() - 100 * day).toISOString().slice(0, 10);
    const offerInput = {
      jobApplicationId: submitted.id,
      title: 'Field technician',
      terms: 'Full time from the agreed start date, three months probation, equipment provided.',
      contractType: 'full_time' as const,
      salaryMinor: '400000',
      salaryCurrency: 'ILS',
      salaryPeriod: 'monthly',
      proposedStartDate: new Date(Date.now() + 5 * day).toISOString().slice(0, 10),
      respondByAt: new Date(Date.now() + 2 * day).toISOString()
    };
    // A deadline after the first day of work answers nothing.
    await assert.rejects(offers.createOffer(recruiter.id, org.id, { ...offerInput, respondByAt: new Date(Date.now() + 30 * day).toISOString() }), /invalid_input/);

    const offer = await offers.createOffer(recruiter.id, org.id, offerInput);
    assert.equal(offer.state, 'draft');
    assert.equal(offer.sequence, 1);
    // A draft has not been sent, so to the candidate it does not exist.
    await assert.rejects(offers.offerForCandidate(candidate.id, offer.id), /not_found/);

    const sent = await offers.sendOffer(recruiter.id, org.id, offer.id, offer.version);
    assert.equal(sent.state, 'sent');
    // Sent means frozen. The trigger refuses an edit even through a direct write.
    await assert.rejects(
      db.jobOffer.update({ where: { id: offer.id }, data: { terms: 'Different terms entirely, agreed by nobody.' } }),
      /sent offer cannot be edited/, 'a sent offer is frozen by the database, not only by the service'
    );

    const asCandidate = await offers.offerForCandidate(candidate.id, offer.id);
    assert.equal(asCandidate.canRespond, true);
    assert.equal(asCandidate.acceptanceIsNotAStart, true);
    // Another person cannot read somebody else's offer.
    await assert.rejects(offers.offerForCandidate(second.id, offer.id), /not_found/);
    // Acceptance names the exact text: a checksum that is not the one sent is refused.
    await assert.rejects(offers.acceptOffer(candidate.id, offer.id, { termsChecksum: 'f'.repeat(64), version: sent.version }), /conflict/);

    // --- JOB-01 -------------------------------------------------------------------------------------
    const accepted = await offers.acceptOffer(candidate.id, offer.id, { termsChecksum: asCandidate.termsChecksum, version: sent.version });
    assert.equal(accepted.employmentStarted, false);
    assert.equal(accepted.countedAsEmployment, false);
    assert.equal(accepted.awaitingStartConfirmation, true);
    assert.equal(accepted.placement.state, 'start_pending', 'JOB-01: accepting an offer creates a pending placement, never a started one');
    assert.equal(accepted.placement.actualStartDate, null);
    const placementId = accepted.placement.id;

    // The figures agree with the states: one acceptance, zero starts.
    const beforeStart = await placements.exportSummary(employer.id, org.id);
    assert.equal(beforeStart.offersAccepted, 1);
    assert.equal(beforeStart.startsConfirmed, 0, 'JOB-01: an accepted offer is not in the started figure');
    assert.equal(beforeStart.startsPending, 1);

    // And the rule survives the service being bypassed entirely.
    await assert.rejects(
      db.placement.update({ where: { id: placementId }, data: { state: 'started' } }),
      /placements_started_needs_an_actual_start_date/,
      'JOB-01: the database refuses a started placement with no confirmed start date'
    );

    // --- a confirmed start needs both sides, and the same day ---------------------------------------
    const claimed = await placements.confirmStart(recruiter.id, placementId, { startDate, evidenceRef: 'signed timesheet 1', asEmployer: true });
    assert.equal(claimed.started, false, 'one party alone is a claim, not a start');
    assert.equal(claimed.awaiting, 'candidate');
    // Nobody confirms twice, and the employer confirming does not stand in for the candidate.
    await assert.rejects(placements.confirmStart(employer.id, placementId, { startDate, asEmployer: true }), /conflict/);
    // A start that has not happened yet is refused whoever says it has.
    await assert.rejects(
      placements.confirmStart(candidate.id, placementId, { startDate: new Date(Date.now() + day).toISOString().slice(0, 10) }),
      /invalid_input/
    );

    const disagreed = await placements.confirmStart(candidate.id, placementId, { startDate: new Date(Date.now() - 103 * day).toISOString().slice(0, 10) });
    assert.equal(disagreed.started, false);
    assert.equal(disagreed.reason, 'dates_disagree');
    assert.equal(disagreed.state, 'disputed', 'two different dates is a recorded disagreement, not a coin toss');

    // --- limited recruiter access, again: verifying is not settling ----------------------------------
    await assert.rejects(
      placements.review(recruiter.id, placementId, { outcome: 'confirm_start', reason: 'The timesheet settles it.', startDate, evidenceRef: 'signed timesheet 1', version: disagreed.version }),
      /forbidden/, 'a recruiter may verify a start but may not settle a disagreement about one'
    );
    await assert.rejects(placements.exportSummary(recruiter.id, org.id), /forbidden/, 'the impact export is report.read, which a recruiter does not hold');

    // The reviewer may not be the person whose confirmation is in dispute. `manager` confirmed
    // nothing, so they may decide; a reviewer who had confirmed would be refused.
    const settled = await placements.review(manager.id, placementId, {
      outcome: 'confirm_start', reason: 'The countersigned timesheet gives the earlier date.',
      startDate, evidenceRef: 'signed timesheet 1', version: disagreed.version
    });
    assert.equal(settled.state, 'started');
    assert.equal(settled.startConfirmed, true);
    assert.equal(settled.countsAsEmployment, true);
    assert.equal(new Date(settled.actualStartDate!).toISOString().slice(0, 10), startDate);
    // Append-only: a decision cannot be quietly rewritten afterwards.
    const decision = await db.placementReviewDecision.findFirstOrThrow({ where: { placementId } });
    await assert.rejects(db.placementReviewDecision.update({ where: { id: decision.id }, data: { reason: 'something else entirely' } }), /append-only|cannot be/i);

    // --- the follow-ups are dated from the actual start, not from the offer ---------------------------
    const followups = await db.placementFollowup.findMany({ where: { placementId }, orderBy: { dayOffset: 'asc' } });
    assert.deepEqual(followups.map(row => row.dayOffset), [30, 90]);
    for (const followup of followups) {
      const expected = new Date(`${startDate}T00:00:00.000Z`).getTime() + followup.dayOffset * day;
      assert.equal(followup.dueAt.toISOString().slice(0, 10), new Date(expected).toISOString().slice(0, 10),
        'a checkpoint is counted from the day work began, not from the date the offer proposed');
      assert.equal(followup.result, 'unknown');
      assert.equal(followup.recordedAt, null);
    }

    // A checkpoint that is not due yet cannot be answered. Pushed forward and put straight back,
    // so every later assertion still runs against the dates the actual start produced.
    const trueDue = followups[0]!.dueAt;
    await db.placementFollowup.update({ where: { id: followups[0]!.id }, data: { dueAt: new Date(Date.now() + 5 * day) } });
    const notYet = await db.placementFollowup.findUniqueOrThrow({ where: { id: followups[0]!.id } });
    await assert.rejects(
      placements.recordFollowup(recruiter.id, placementId, { dayOffset: 30, result: 'working', source: 'a call', version: notYet.version }),
      /conflict/
    );
    await db.placementFollowup.update({ where: { id: followups[0]!.id }, data: { dueAt: trueDue } });

    // --- JOB-02 --------------------------------------------------------------------------------------
    const dueRow = await db.placementFollowup.findUniqueOrThrow({ where: { id: followups[0]!.id } });

    const silence = await placements.recordFollowup(recruiter.id, placementId, { dayOffset: 30, result: 'unknown', version: dueRow.version });
    assert.equal(silence.result, 'unknown');
    assert.equal(silence.answered, false, 'JOB-02: no answer means no recorder and no source, not a quiet success');
    assert.equal(silence.countedAsRetained, false);
    assert.equal(silence.placementState, 'started', 'JOB-02: silence does not advance the placement');

    // And the database refuses the shortcut: a result other than `unknown` needs a real source.
    await assert.rejects(
      db.placementFollowup.update({ where: { id: dueRow.id }, data: { result: 'working' } }),
      /placement_followups_answer_has_a_source/,
      'JOB-02: a working row with no recorder and no source is refused by the database'
    );

    // Asking is not answering: the request writes no result.
    const asked = await placements.requestFollowup(recruiter.id, placementId, 30);
    assert.equal(asked.resultRecorded, false);
    assert.equal(asked.result, 'unknown');
    assert.equal((await db.placementFollowup.findUniqueOrThrow({ where: { id: dueRow.id } })).result, 'unknown');

    // A real answer carries its source, and thirty days working is still not retention.
    const answered = await placements.recordFollowup(candidate.id, placementId, { dayOffset: 30, result: 'working', source: 'the person, by phone', version: dueRow.version });
    assert.equal(answered.answered, true);
    assert.equal(answered.placementState, 'started');
    assert.equal(answered.countedAsRetained, false, '14 counts retention at ninety days, not thirty');

    // Ninety days working is retention. The checkpoint is due because the start really was that
    // long ago, which is the thing 14 counts.
    const ninetyDue = await db.placementFollowup.findFirstOrThrow({ where: { placementId, dayOffset: 90 } });
    assert.equal(ninetyDue.dueAt.getTime() <= Date.now(), true);
    const retained = await placements.recordFollowup(recruiter.id, placementId, { dayOffset: 90, result: 'working', source: 'the employer, in writing', version: ninetyDue.version });
    assert.equal(retained.placementState, 'retained');
    assert.equal(retained.countedAsRetained, true);

    // --- the figures, with the denominator stated ------------------------------------------------------
    const summary = await placements.exportSummary(manager.id, org.id);
    assert.equal(summary.startsConfirmed, 1);
    assert.equal(summary.startsPending, 0);
    assert.equal(summary.containsPersonalData, false);
    assert.equal(summary.redacted, true);
    assert.equal(typeof summary.retention.denominatorDefinition, 'string');
    assert.equal(summary.retention.denominator, 1);
    assert.equal(summary.retention.answered, 1);
    assert.equal(summary.retention.working, 1);
    assert.equal(summary.retention.unknown, 0);
    // No name or contact detail is anywhere in the exported object.
    assert.equal(JSON.stringify(summary).includes(candidate.name), false);
    assert.equal(JSON.stringify(summary).includes(candidate.email), false);

    // --- the openings the employer advertised are the openings they have --------------------------------
    const secondApplication = (await jobs.listApplications(recruiter.id, org.id, {})).find(row => row.id === agreed.applicationId)!;
    await jobs.decide(recruiter.id, org.id, secondApplication.id, { outcome: 'shortlisted', reason: '', version: secondApplication.version });
    await assert.rejects(
      offers.createOffer(recruiter.id, org.id, { ...offerInput, jobApplicationId: secondApplication.id }),
      /conflict/, 'the one advertised opening is taken, so a second offer would promise work that does not exist'
    );

    // --- PER-14.A05: the objection stops the placement counting ------------------------------------------
    const current = await db.placement.findUniqueOrThrow({ where: { id: placementId } });
    const disputed = await placements.dispute(candidate.id, placementId, { reason: 'The employer recorded a start date a week before I actually began.', version: current.version });
    assert.equal(disputed.state, 'disputed');
    assert.equal(disputed.countsAsEmployment, false, 'a disputed placement counts as nothing until it is settled');
    // Only the person themselves may object to their own record.
    await assert.rejects(placements.dispute(second.id, placementId, { reason: 'Not my placement at all.', version: disputed.version }), /not_found/);
  } finally {
    await db.$transaction(async tx => {
      const jobIds = (await tx.job.findMany({ where: { organizationId: { in: organizations } }, select: { id: true } })).map(row => row.id);
      const placementIds = (await tx.placement.findMany({ where: { jobId: { in: jobIds } }, select: { id: true } })).map(row => row.id);
      for (const table of ['placement_review_decisions', 'placement_start_confirmations', 'identity_audit_events']) {
        await tx.$executeRawUnsafe(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
      }
      await tx.placementReviewDecision.deleteMany({ where: { placementId: { in: placementIds } } });
      await tx.placementStartConfirmation.deleteMany({ where: { placementId: { in: placementIds } } });
      await tx.placementFollowup.deleteMany({ where: { placementId: { in: placementIds } } });
      await tx.placement.deleteMany({ where: { id: { in: placementIds } } });
      await tx.jobOffer.deleteMany({ where: { jobApplication: { jobId: { in: jobIds } } } });
      await tx.interview.deleteMany({ where: { jobApplication: { jobId: { in: jobIds } } } });
      // The application points at its referral, so the link is cleared before the referral goes.
      await tx.jobApplication.updateMany({ where: { jobId: { in: jobIds } }, data: { referralId: null } });
      await tx.jobApplication.deleteMany({ where: { jobId: { in: jobIds } } });
      await tx.jobReferral.deleteMany({ where: { jobId: { in: jobIds } } });
      await tx.job.deleteMany({ where: { id: { in: jobIds } } });
      await tx.candidateProfile.deleteMany({ where: { userId: { in: users } } });
      await tx.outboxEvent.deleteMany({});
      await tx.identityAuditEvent.deleteMany({ where: { actorId: { in: users } } });
      for (const table of ['identity_audit_events', 'placement_start_confirmations', 'placement_review_decisions']) {
        await tx.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
      }
      await tx.membership.deleteMany({ where: { organizationId: { in: organizations } } });
      await tx.party.deleteMany({ where: { OR: [{ userId: { in: users } }, { organizationId: { in: organizations } }] } });
      await tx.organization.deleteMany({ where: { id: { in: organizations } } });
      await tx.individualProfile.deleteMany({ where: { userId: { in: users } } });
      await tx.session.deleteMany({ where: { userId: { in: users } } });
      await tx.user.deleteMany({ where: { id: { in: users } } });
    });
    await db.$disconnect();
  }
});
