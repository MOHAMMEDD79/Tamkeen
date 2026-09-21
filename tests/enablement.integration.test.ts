import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { CURRENT_TERMS_VERSION, loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { IdentityService } from '../apps/api/dist/modules/identity/identity.service.js';
import { ProgramsService } from '../apps/api/dist/modules/programs/programs.service.js';
import { TrainingService } from '../apps/api/dist/modules/programs/training.service.js';
import { AgreementsService } from '../apps/api/dist/modules/enablement/agreements.service.js';
import { StipendsService } from '../apps/api/dist/modules/enablement/stipends.service.js';
import { IncubationService } from '../apps/api/dist/modules/enablement/incubation.service.js';
import { AssistanceService } from '../apps/api/dist/modules/enablement/assistance.service.js';
import { VolunteeringService } from '../apps/api/dist/modules/enablement/volunteering.service.js';

/**
 * PART-12 acceptance, proved against real PostgreSQL:
 *
 *   grant ≠ equity    funding an agreement and accepting incubation terms create no offering, no
 *                     commitment and no holding, and the database refuses the columns that could
 *                     ever say otherwise.
 *   stipend once      a period cannot be claimed twice. Refused by the service, and refused by an
 *                     exclusion constraint when the service is bypassed entirely.
 *   certificate       revoking keeps the public reference resolving and says it is no longer valid;
 *                     the reason stays private and no identifier is published.
 *   consent           withdrawing it stops every operator action at once and retains the record of
 *                     what already happened.
 *   LOOP-INC          idea → decision → agreement → mentor → milestone → the founder's own company,
 *                     with no account created for anybody and no grant becoming capital.
 *   volunteering      nobody approves their own hours, enforced by a trigger.
 */

const config = loadConfig(process.env);
const day = 86_400_000;
const dayKey = (date: Date) => date.toISOString().slice(0, 10);

test('agreements, stipends, certificates, incubation, assistance and volunteering on real PostgreSQL', async () => {
  const db = createDatabase(config.databaseUrl);
  const identity = new IdentityService(db);
  const programs = new ProgramsService(db);
  const training = new TrainingService(db);
  const agreements = new AgreementsService(db);
  const stipends = new StipendsService(db);
  const incubation = new IncubationService(db);
  const assistance = new AssistanceService(db);
  const volunteering = new VolunteeringService(db);

  const prefix = randomUUID();
  const users: string[] = [];
  const organizations: string[] = [];

  const createUser = async (suffix: string, twoFactor = false) => {
    const user = await db.user.create({ data: { email: `${prefix}-${suffix}@example.test`, name: `Enb ${suffix}`, emailVerified: true, twoFactorEnabled: twoFactor, termsVersion: CURRENT_TERMS_VERSION, termsAcceptedAt: new Date() } });
    users.push(user.id);
    return user;
  };

  try {
    const operator = await createUser('operator');
    const sponsorLead = await createUser('sponsor');
    const trainer = await createUser('trainer');
    const trainee = await createUser('trainee');
    const founder = await createUser('founder');
    const mentor = await createUser('mentor');
    const caseWorker = await createUser('caseworker');
    const applicant = await createUser('applicant');
    const coordinator = await createUser('coordinator');
    const volunteer = await createUser('volunteer');
    const reviewer = await createUser('reviewer', true);

    await db.platformGrant.create({ data: { userId: reviewer.id, role: 'ContentReviewer', grantedBy: reviewer.id } });

    const org = await identity.createOrganization(operator.id, { legalName: `Operator ${prefix}`, displayName: `Operator ${prefix}`, type: 'Company', country: 'PS', city: 'Jenin' });
    organizations.push(org.id);
    await db.organization.update({ where: { id: org.id }, data: { verification: 'verified' } });
    await db.membership.update({
      where: { userId_organizationId: { userId: operator.id, organizationId: org.id } },
      data: { roles: ['Owner', 'ProgramManager', 'FinanceMaker', 'CaseWorker', 'VolunteerCoordinator'] }
    });
    for (const [person, roles] of [[trainer, ['Trainer']], [mentor, ['Mentor']], [caseWorker, ['CaseWorker']], [coordinator, ['VolunteerCoordinator']]] as const) {
      await db.membership.create({ data: { userId: person.id, organizationId: org.id, roles: [...roles], status: 'active' } });
    }

    const sponsorOrg = await identity.createOrganization(sponsorLead.id, { legalName: `Sponsor ${prefix}`, displayName: `Sponsor ${prefix}`, type: 'Company', country: 'PS', city: 'Ramallah' });
    organizations.push(sponsorOrg.id);
    await db.organization.update({ where: { id: sponsorOrg.id }, data: { verification: 'verified' } });
    await db.membership.update({
      where: { userId_organizationId: { userId: sponsorLead.id, organizationId: sponsorOrg.id } },
      data: { roles: ['Owner', 'FinanceMaker'] }
    });

    // ================================================================================================
    // BUS-06 / PRG-11 — an agreement, and the grant that is not equity
    // ================================================================================================

    // An agreement with itself is refused: one side's signature would stand for both.
    await assert.rejects(
      agreements.create(sponsorLead.id, sponsorOrg.id, {
        operatorOrgId: sponsorOrg.id, title: 'Self deal', purpose: 'A deal with nobody but ourselves, which is not a deal.',
        amountMinor: '100000', currency: 'ILS'
      }),
      /invalid_input/
    );
    // Cash without a currency is a number nobody can act on.
    await assert.rejects(
      agreements.create(sponsorLead.id, sponsorOrg.id, { operatorOrgId: org.id, title: 'No currency', purpose: 'A grant with an amount and no currency at all.', amountMinor: '100000' }),
      /invalid_input/
    );

    const agreement = await agreements.create(sponsorLead.id, sponsorOrg.id, {
      operatorOrgId: org.id,
      title: `Training grant ${prefix.slice(0, 8)}`,
      kind: 'cash',
      amountMinor: '5000000',
      currency: 'ILS',
      purpose: 'Funding one cohort of smart irrigation training, including trainee stipends and equipment.',
      obligations: 'The operator runs the cohort, reports quarterly and returns any unspent balance.',
      reportingTerms: 'Aggregate counts only. No trainee is named in any report to the sponsor.',
      surplusTerms: 'Any unspent balance returns to the sponsor within sixty days of close.'
    });
    assert.equal(agreement.state, 'draft');
    assert.equal(agreement.createsEquity, false);

    const sent = await agreements.send(sponsorLead.id, sponsorOrg.id, agreement.id, {
      terms: 'The sponsor funds one cohort of smart irrigation training. The operator runs it, reports quarterly against agreed counts, and returns any unspent balance within sixty days of close. No share of either organisation passes in either direction.',
      version: agreement.version
    });
    assert.equal(sent.state, 'pending_acceptance');
    assert.equal(sent.termsChecksum.length, 64);

    // Accepting a text other than the one on the table is agreeing to a document nobody sent.
    await assert.rejects(agreements.accept(sponsorLead.id, sponsorOrg.id, agreement.id, { checksum: 'a'.repeat(64), version: sent.version }), /conflict/);
    // The operator cannot accept as the sponsor: the permission is checked against the party claimed.
    await assert.rejects(agreements.accept(operator.id, sponsorOrg.id, agreement.id, { checksum: sent.termsChecksum, version: sent.version }), /forbidden/);

    const firstAccept = await agreements.accept(sponsorLead.id, sponsorOrg.id, agreement.id, { checksum: sent.termsChecksum, version: sent.version });
    assert.equal(firstAccept.active, false, 'one party alone does not activate an agreement');
    assert.equal(firstAccept.awaiting, 'operator');

    const secondAccept = await agreements.accept(operator.id, org.id, agreement.id, { checksum: sent.termsChecksum, version: firstAccept.version });
    assert.equal(secondAccept.active, true);
    assert.equal(secondAccept.state, 'active');
    assert.equal(secondAccept.createsEquity, false);

    // --- grant ≠ equity -----------------------------------------------------------------------------
    const funded = await agreements.fund(sponsorLead.id, sponsorOrg.id, agreement.id, { amountMinor: '2000000', currency: 'ILS', note: 'First tranche.' });
    assert.equal(funded.createsEquity, false);
    assert.equal(funded.createsHolding, false);
    assert.equal(funded.moneyMoved, false);
    // Nothing on the investment path exists for either organisation because of this.
    assert.equal(await db.offering.count({ where: { venture: { organizationId: { in: [org.id, sponsorOrg.id] } } } }), 0);
    assert.equal(await db.commitment.count({ where: { userId: { in: users } } }), 0);
    assert.equal(await db.holding.count({ where: { userId: { in: users } } }), 0);
    // And it survives the service being bypassed: the column cannot be edited into a claim of ownership.
    await assert.rejects(
      db.agreement.update({ where: { id: agreement.id }, data: { createsEquity: true } }),
      /agreements_grant_is_not_equity/,
      'a grant cannot be turned into equity by a direct write'
    );
    // Funding beyond what was agreed is money outside the obligation it was meant to carry.
    await assert.rejects(agreements.fund(sponsorLead.id, sponsorOrg.id, agreement.id, { amountMinor: '9000000', currency: 'ILS' }), /conflict/);

    // A milestone decision releases nothing, and is made by the party that did not submit it.
    const milestone = await agreements.addMilestone(sponsorLead.id, sponsorOrg.id, agreement.id, {
      title: 'Cohort recruited', dueAt: dayKey(new Date(Date.now() + 30 * day)), amountMinor: '1000000'
    });
    const evidenced = await agreements.submitMilestoneEvidence(operator.id, org.id, milestone.id, { evidenceRef: 'enrolment register', version: milestone.version });
    await assert.rejects(
      agreements.decideMilestone(operator.id, org.id, milestone.id, { outcome: 'approved', reason: 'We say our own work is done.', version: evidenced.version }),
      /not_found/, 'the party that produced the evidence does not also certify it'
    );
    const decided = await agreements.decideMilestone(sponsorLead.id, sponsorOrg.id, milestone.id, { outcome: 'approved', reason: 'The register matches the agreed count.', version: evidenced.version });
    assert.equal(decided.releasedFunds, false, 'approving a deliverable is not paying for it');
    const decisionRow = await db.agreementMilestoneDecision.findFirstOrThrow({ where: { milestoneId: milestone.id } });
    await assert.rejects(db.agreementMilestoneDecision.update({ where: { id: decisionRow.id }, data: { releasedFunds: true } }), /append-only|released_funds/i);

    // ================================================================================================
    // PRG-06 — the stipend that cannot be paid twice, and the certificate that can be revoked
    // ================================================================================================

    const programFields = {
      title: `Irrigation ${prefix.slice(0, 8)}`,
      summary: 'A demonstration training programme used to verify the stipend and certificate chain end to end.',
      skills: ['irrigation'],
      capacity: 2,
      // Applications closed before the cohort started, which is the order the service requires:
      // a cohort recruiting for a group already running is how somebody joins training without it.
      applyClosesAt: new Date(Date.now() - 25 * day).toISOString(),
      durationWeeks: 4,
      hoursPerWeek: 10,
      attendancePolicy: 'Attendance below 80% of sessions ends eligibility for completion; an excused absence needs a stated reason.',
      assessmentPolicy: 'A practical rubric is scored at the end of each module, and the pass mark is published beforehand.',
      selectionMethod: 'Applications are scored against a published rubric; ties break by submission order.',
      withdrawalPolicy: 'A trainee may ask to withdraw at any time; the operator assesses it within five days.',
      complaintsContact: 'complaints@example.test',
      stipendOffered: true,
      stipendAmountMinor: '60000',
      stipendCurrency: 'ILS',
      stipendConditions: 'Paid pro rata against attended sessions for each fortnightly period.'
    };
    const program = await programs.create(operator.id, org.id, programFields);
    const cohort = await programs.addCohort(operator.id, org.id, program.id, {
      name: 'Cohort one', capacity: 2,
      startAt: new Date(Date.now() - 20 * day).toISOString(),
      endAt: new Date(Date.now() + 20 * day).toISOString()
    });

    const enrollment = await db.enrollment.create({
      data: {
        cohortId: cohort.id, userId: trainee.id,
        applicationId: (await db.application.create({
          data: { programId: program.id, cohortId: cohort.id, userId: trainee.id, reference: `APP-${prefix.slice(0, 8)}`, state: 'accepted', sharingConsent: true, submittedAt: new Date() }
        })).id,
        state: 'active', invitationExpiresAt: new Date(Date.now() + day), confirmedAt: new Date()
      }
    });
    await db.cohortTrainer.create({ data: { cohortId: cohort.id, userId: trainer.id, assignedBy: operator.id } });

    // Two sessions inside the period, both held and closed, with attendance recorded.
    const periodStart = dayKey(new Date(Date.now() - 14 * day));
    const periodEnd = dayKey(new Date(Date.now() - day));
    const sessions = [];
    for (const offset of [10, 5]) {
      const session = await training.createSession(operator.id, cohort.id, {
        title: `Session ${offset}`,
        startsAt: new Date(Date.now() - offset * day).toISOString(),
        endsAt: new Date(Date.now() - offset * day + 3_600_000).toISOString(),
        location: 'Field site'
      });
      await training.saveAttendance(trainer.id, session.id, { entries: [{ enrollmentId: enrollment.id, status: 'present' }] });
      const current = await db.trainingSession.findUniqueOrThrow({ where: { id: session.id } });
      await training.closeSession(operator.id, session.id, current.version);
      sessions.push(session.id);
    }

    const preview = await stipends.preview(operator.id, org.id, cohort.id, { periodStart, periodEnd });
    assert.equal(preview.ready, true, `expected a payable period, blockers: ${preview.blockers.join(', ')}`);
    assert.equal(preview.lines.length, 1);
    assert.equal(preview.totalMinor, '60000', 'two of two sessions attended pays the full period rate');

    const batch = await stipends.createBatch(operator.id, org.id, cohort.id, { periodStart, periodEnd });
    assert.equal(batch.state, 'draft');
    assert.equal(batch.totalMinor, '60000');

    // --- a period is never paid twice ----------------------------------------------------------------
    await assert.rejects(
      stipends.createBatch(operator.id, org.id, cohort.id, { periodStart, periodEnd }),
      /conflict/, 'the same period cannot be claimed twice'
    );
    // An overlapping, differently-shaped period is refused too — the rule is about days, not labels.
    const overlapPreview = await stipends.preview(operator.id, org.id, cohort.id, {
      periodStart: dayKey(new Date(Date.now() - 8 * day)), periodEnd: dayKey(new Date(Date.now() - 2 * day))
    });
    assert.equal(overlapPreview.ready, false);
    assert.equal(overlapPreview.blockers.includes('period_already_claimed'), true);
    // And it survives the service being bypassed entirely.
    await assert.rejects(
      db.stipendLine.create({
        data: {
          batchId: batch.id, enrollmentId: enrollment.id,
          periodStart: new Date(`${dayKey(new Date(Date.now() - 8 * day))}T00:00:00.000Z`),
          periodEnd: new Date(`${dayKey(new Date(Date.now() - 2 * day))}T00:00:00.000Z`),
          sessionsCounted: 1, sessionsHeld: 1, amountMinor: 30000n, currency: 'ILS'
        }
      }),
      /stipend_lines_no_overlapping_period/,
      'the database refuses an overlapping stipend period whatever wrote it'
    );

    // Sending it for payment raises no payout and moves no money: PART-07's chain does that.
    const requested = await stipends.requestPayout(operator.id, org.id, batch.id, {
      projectId: randomUUID(), reason: 'Fortnightly stipend for the cohort.', version: batch.version
    });
    assert.equal(requested.payoutRaised, false);
    assert.equal(requested.moneyMoved, false);
    assert.equal(requested.state, 'requested');

    // Cancelling frees the days again, and the same period becomes claimable.
    const current = await db.stipendBatch.findUniqueOrThrow({ where: { id: batch.id } });
    const cancelled = await stipends.cancelBatch(operator.id, org.id, batch.id, { reason: 'Replaced by a corrected period.', version: current.version });
    assert.equal(cancelled.periodReleased, true);
    const afterCancel = await stipends.preview(operator.id, org.id, cohort.id, { periodStart, periodEnd });
    assert.equal(afterCancel.blockers.includes('period_already_claimed'), false);

    // --- certificates ---------------------------------------------------------------------------------
    let readiness = await stipends.certificateReadiness(operator.id, org.id, enrollment.id);
    assert.equal(readiness.eligible, false);
    assert.equal(readiness.blockers.includes('enrolment_not_completed'), true);
    await assert.rejects(stipends.issueCertificate(operator.id, org.id, enrollment.id), /conflict/);

    await db.enrollment.update({ where: { id: enrollment.id }, data: { state: 'completed', completedAt: new Date() } });
    readiness = await stipends.certificateReadiness(operator.id, org.id, enrollment.id);
    assert.equal(readiness.eligible, true, `blockers: ${readiness.blockers.join(', ')}`);
    assert.equal(readiness.attendanceRatio, 100);

    const certificate = await stipends.issueCertificate(operator.id, org.id, enrollment.id);
    assert.equal(certificate.state, 'issued');
    assert.equal(certificate.guaranteesEmployment, false);
    assert.equal(certificate.paysAnything, false);
    // One per enrolment.
    await assert.rejects(stipends.issueCertificate(operator.id, org.id, enrollment.id), /conflict/);

    const checkBefore = await stipends.verifyCertificate(certificate.publicId);
    assert.equal(checkBefore.valid, true);
    assert.equal(Object.hasOwn(checkBefore, 'revocationReason'), false);
    assert.equal(checkBefore.withheld.includes('nationalId'), true);

    const revoked = await stipends.revokeCertificate(operator.id, org.id, certificate.id, {
      reason: 'The attendance record it rested on was corrected after an upheld objection.',
      evidenceRef: 'objection 12', version: certificate.version
    });
    assert.equal(revoked.state, 'revoked');
    assert.equal(revoked.publicReferenceStillResolves, true);

    const checkAfter = await stipends.verifyCertificate(certificate.publicId);
    assert.equal(checkAfter.valid, false, 'a revoked certificate answers that it is not valid');
    assert.equal(checkAfter.state, 'revoked');
    assert.notEqual(checkAfter.revokedAt, null);
    // The reason is private: it is nowhere in the public answer.
    assert.equal(JSON.stringify(checkAfter).includes('objection 12'), false);
    assert.equal(JSON.stringify(checkAfter).includes('upheld objection'), false);
    // The holder is told.
    const holderView = await stipends.myCertificates(trainee.id);
    assert.equal(holderView[0]!.revokeReason.length > 10, true);
    // A revocation with no reason is refused by the database.
    await assert.rejects(
      db.certificate.update({ where: { id: certificate.id }, data: { revokeReason: '' } }),
      /certificates_revoke_is_explained/
    );

    // ================================================================================================
    // LOOP-INC — idea to company, with no equity and no account created
    // ================================================================================================

    const draft = await incubation.saveDraft(founder.id, {
      title: `Sensor kit ${prefix.slice(0, 6)}`,
      summary: 'A low-cost soil sensor kit assembled locally, sold to smallholders with a maintenance plan attached.',
      problem: 'Imported sensors cost more than a season of yield and cannot be repaired locally.',
      stage: 'prototype', sector: 'agritech', city: 'Jenin',
      supportSought: 'Workshop space, a mentor and a small equipment grant.'
    });
    assert.equal(draft.state, 'draft');
    // A private draft belongs to nobody else: the incubator's pipeline does not contain it.
    assert.equal((await incubation.listForOrganization(operator.id, org.id, {})).length, 0);

    await assert.rejects(incubation.submit(founder.id, draft.id, { organizationId: org.id, sharingConsent: false, version: draft.version }), /invalid_input/);
    const submitted = await incubation.submit(founder.id, draft.id, { organizationId: org.id, sharingConsent: true, version: draft.version });
    assert.equal(submitted.equityTaken, 0);
    assert.equal(submitted.platformTakesNoStake, true);

    // A mentor comments; they do not decide. 08 is explicit, and the policy has no such permission.
    await assert.rejects(
      incubation.decide(mentor.id, org.id, submitted.id, { outcome: 'accepted', reason: 'I like it and I will say so myself.', version: submitted.version }),
      /forbidden/, 'a mentor holds no decision on a proposal'
    );
    const accepted = await incubation.decide(operator.id, org.id, submitted.id, {
      outcome: 'accepted', reason: 'Clear problem, a working prototype and a local supply chain.',
      criteria: 'Scored against the published incubation rubric.', version: submitted.version
    });
    assert.equal(accepted.equityTaken, 0);
    assert.equal(accepted.incubatorHoldsNoStake, true);

    // Before the assignment a mentor reaches nothing; afterwards, only this one idea.
    assert.equal((await incubation.listForOrganization(mentor.id, org.id, {})).length, 0);
    const assignment = await incubation.assignMentor(operator.id, org.id, submitted.id, { mentorId: mentor.id, note: 'Hardware and supply chain.' });
    assert.equal(assignment.grantsDecisionRights, false);
    assert.equal((await incubation.listForOrganization(mentor.id, org.id, {})).length, 1);

    const terms = await incubation.proposeAgreement(operator.id, org.id, submitted.id, {
      title: 'Incubation terms',
      terms: 'Six months of workshop access, a mentor, and a grant against agreed milestones.',
      ipTerms: 'The founder owns everything they make, before, during and after this programme. The incubator receives no licence and no share.',
      grantMinor: '1500000', currency: 'ILS',
      grantConditions: 'Released against approved milestones.',
      durationMonths: 6
    });
    assert.equal(terms.grantsEquity, false);
    assert.equal(terms.equityPercent, 0);
    // A stake cannot be written in, by any path.
    await assert.rejects(
      db.incubationAgreement.update({ where: { id: terms.id }, data: { grantsEquity: true } }),
      /incubation_agreement_grants_no_equity/
    );

    const offered = await incubation.offerAgreement(operator.id, org.id, terms.id, terms.version);
    // Once offered the text is frozen: a change is a new version with its own sequence.
    await assert.rejects(
      db.incubationAgreement.update({ where: { id: terms.id }, data: { terms: 'Entirely different terms agreed by nobody.' } }),
      /offered incubation agreement cannot be edited/
    );
    const acceptedTerms = await incubation.acceptAgreement(founder.id, terms.id, { checksum: offered.checksum, version: offered.version });
    assert.equal(acceptedTerms.grantsEquity, false);
    assert.equal(acceptedTerms.createsOrganization, false, 'LOOP-INC: accepting terms creates no company');
    assert.equal(acceptedTerms.moneyMoved, false);
    assert.equal(acceptedTerms.proposal.state, 'active');
    // And no account was created for anybody along the way.
    assert.equal(await db.user.count({ where: { email: { contains: prefix } } }), users.length);

    const incMilestone = await incubation.addMilestone(operator.id, org.id, submitted.id, { title: 'Working prototype', dueAt: dayKey(new Date(Date.now() + 60 * day)) });
    // Approving a milestone nobody has evidenced approves nothing.
    await assert.rejects(
      incubation.decideMilestone(operator.id, org.id, incMilestone.id, { outcome: 'approved', reason: 'It is probably fine.', version: incMilestone.version }),
      /conflict/
    );
    const incEvidenced = await incubation.submitMilestoneEvidence(founder.id, incMilestone.id, { evidenceRef: 'demo video', version: incMilestone.version });
    const incDecided = await incubation.decideMilestone(operator.id, org.id, incMilestone.id, { outcome: 'approved', reason: 'The prototype does what the plan said it would.', version: incEvidenced.version });
    assert.equal(incDecided.releasedFunds, false);

    // The founder creates the company themselves, then links it.
    const startup = await identity.createOrganization(founder.id, { legalName: `Startup ${prefix}`, displayName: `Startup ${prefix}`, type: 'Company', country: 'PS', city: 'Jenin' });
    organizations.push(startup.id);
    const proposalNow = await db.proposal.findUniqueOrThrow({ where: { id: submitted.id } });
    // Somebody else's company cannot be attached to this idea.
    await assert.rejects(incubation.linkStartup(founder.id, submitted.id, { organizationId: org.id, version: proposalNow.version }), /forbidden/);
    const linked = await incubation.linkStartup(founder.id, submitted.id, { organizationId: startup.id, version: proposalNow.version });
    assert.equal(linked.sharesIssued, 0);
    assert.equal(linked.incubatorHoldsNoStake, true);
    // No holding exists in the new company for the incubator or for anybody else.
    assert.equal(await db.holding.count({ where: { venture: { organizationId: startup.id } } }), 0, 'the incubator holds nothing in the company the founder created');

    // ================================================================================================
    // PRG-12 / PER-15 — consent, and what withdrawing it does
    // ================================================================================================

    const supportCase = await assistance.create(applicant.id, {
      organizationId: org.id, category: 'winter-heating',
      needSummary: 'The household heater failed and the family has three children under six in an unheated room.',
      householdSize: 5, submit: true
    });
    assert.equal(supportCase.state, 'submitted');
    assert.equal(supportCase.consentGiven, true);
    assert.equal(supportCase.private, true);

    // Consent is on the case; the operator sees the applicant while it stands.
    const beforeRevoke = await assistance.listForOrganization(caseWorker.id, org.id, {});
    const listed = beforeRevoke.find(row => row.id === supportCase.id)!;
    assert.equal(listed.consentGiven, true);
    assert.equal(listed.applicantName, applicant.name);
    assert.equal(listed.unassigned, true);

    const claimed = await assistance.claim(caseWorker.id, org.id, supportCase.id, listed.version);
    assert.equal(claimed.state, 'in_review');
    // A case somebody else holds is not reachable.
    await assert.rejects(
      assistance.requestClarification(operator.id, org.id, supportCase.id, { body: 'Please send the meter reading.', version: claimed.version }),
      /forbidden/
    );

    const clarified = await assistance.requestClarification(caseWorker.id, org.id, supportCase.id, { body: 'Please send a photograph of the heater and last month’s bill.', version: claimed.version });
    assert.equal(clarified.private, true);
    await assistance.reply(applicant.id, supportCase.id, { body: 'Attached.', documentRef: 'photo-1' });

    const inReview = await db.assistanceCase.findUniqueOrThrow({ where: { id: supportCase.id } });
    const approved = await assistance.decide(caseWorker.id, org.id, supportCase.id, {
      outcome: 'approved', reason: 'Eligible under the winter heating criteria for households with young children.',
      criteria: 'Internal scoring band B.', version: inReview.version
    });
    assert.equal(approved.published, false);
    assert.equal(approved.sharedWithSponsor, false);

    const approvedRow = await db.assistanceCase.findUniqueOrThrow({ where: { id: supportCase.id } });
    // A delivery with no stated source is refused: no support arrives from nowhere.
    await assert.rejects(
      assistance.recordDelivery(caseWorker.id, org.id, supportCase.id, {
        description: 'One heater', fundingSource: '', deliveredAt: dayKey(new Date()), version: approvedRow.version
      }),
      /invalid_input/
    );
    const delivery = await assistance.recordDelivery(caseWorker.id, org.id, supportCase.id, {
      description: 'One replacement heater and a month of fuel.',
      fundingSource: `winter appeal ${prefix.slice(0, 6)}`,
      deliveredAt: dayKey(new Date()), version: approvedRow.version
    });
    assert.equal(delivery.awaitingApplicantConfirmation, true);
    assert.equal(delivery.countsAsDelivered, false, 'an operator recording a delivery is a claim, not a fact');

    // Closing over an unconfirmed delivery is refused.
    const beforeClose = await db.assistanceCase.findUniqueOrThrow({ where: { id: supportCase.id } });
    await assert.rejects(assistance.close(caseWorker.id, org.id, supportCase.id, { note: 'All done as far as we know.', version: beforeClose.version }), /conflict/);

    const confirmed = await assistance.confirmDelivery(applicant.id, delivery.id, { confirmed: true, version: delivery.version });
    assert.equal(confirmed.countsAsDelivered, true);
    assert.equal(confirmed.moneyReceivedThroughPlatform, false);

    // --- withdrawing the consent ------------------------------------------------------------------------
    const beforeConsentRevoke = await db.assistanceCase.findUniqueOrThrow({ where: { id: supportCase.id } });
    const revocation = await assistance.revokeConsent(applicant.id, supportCase.id, { reason: 'I would rather this were not held any more.', version: beforeConsentRevoke.version });
    assert.equal(revocation.processingStopped, true);
    assert.equal(revocation.operatorAccessEnded, true);
    assert.equal(revocation.recordRetained, true, '12 keeps the record of what already happened');
    assert.equal(revocation.retainedItems.deliveries, 1);

    // Every operator write is refused from here.
    const afterRevoke = await db.assistanceCase.findUniqueOrThrow({ where: { id: supportCase.id } });
    await assert.rejects(
      assistance.requestClarification(caseWorker.id, org.id, supportCase.id, { body: 'One more question about the bill.', version: afterRevoke.version }),
      /forbidden/, 'consent withdrawn stops the processing'
    );
    await assert.rejects(
      assistance.recordDelivery(caseWorker.id, org.id, supportCase.id, { description: 'More fuel', fundingSource: 'winter appeal', deliveredAt: dayKey(new Date()), version: afterRevoke.version }),
      /forbidden/
    );
    // And the contents are gone from the operator's view while the shape of the case remains.
    const hidden = await assistance.get(caseWorker.id, org.id, supportCase.id);
    assert.equal(hidden.consentGiven, false);
    assert.equal(hidden.applicantName, null);
    assert.equal(hidden.needSummary, '');
    assert.equal(hidden.messages.length, 0);
    assert.equal(hidden.withheldReason, 'consent_revoked');
    assert.equal(hidden.reference, supportCase.reference, 'the case still exists; it is its contents that are closed');
    // The consent history is append-only: it cannot be rewritten to say they never objected.
    const consentRow = await db.assistanceConsent.findFirstOrThrow({ where: { caseId: supportCase.id, action: 'revoked' } });
    await assert.rejects(db.assistanceConsent.update({ where: { id: consentRow.id }, data: { action: 'granted' } }), /append-only/i);
    // The applicant keeps their own record in full. It is theirs.
    const applicantView = await assistance.mine(applicant.id);
    assert.equal(applicantView[0]!.needSummary.length > 20, true);
    assert.equal(applicantView[0]!.consentHistory.length, 2);

    // ================================================================================================
    // PRG-13 / PER-17 — volunteering, and the hours nobody signs off for themselves
    // ================================================================================================

    const opportunity = await volunteering.createOpportunity(coordinator.id, org.id, {
      title: `Field support ${prefix.slice(0, 6)}`,
      summary: 'Helping trainees set up sensors at the demonstration plots on weekday mornings.',
      tasks: 'Carry and place equipment, record readings, and help pack up.',
      supervisorId: operator.id,
      capacity: 1, hoursPerWeek: 6, city: 'Jenin'
    });
    // Publishing is refused until the withdrawal policy is stated, and the blocker is named.
    const notReady = await volunteering.validateOpportunity(coordinator.id, org.id, opportunity.id);
    assert.equal(notReady.ready, false);
    assert.equal(notReady.blockers.includes('withdrawal_policy_missing'), true);
    await assert.rejects(volunteering.publishOpportunity(coordinator.id, org.id, opportunity.id, opportunity.version), /conflict/);

    const completed = await volunteering.updateOpportunity(coordinator.id, org.id, opportunity.id, {
      title: opportunity.title, summary: opportunity.summary, tasks: opportunity.tasks,
      supervisorId: operator.id, capacity: 1, hoursPerWeek: 6, city: 'Jenin',
      withdrawalPolicy: 'A volunteer may stop at any time by telling the supervisor; nothing is owed either way.',
      version: opportunity.version
    });
    const published = await volunteering.publishOpportunity(coordinator.id, org.id, opportunity.id, completed.version);
    assert.equal(published.state, 'open');
    assert.equal(published.isPaid, false);

    const application = await volunteering.apply(volunteer.id, { opportunityId: opportunity.id, motivation: 'I live nearby and have mornings free.' });
    await assert.rejects(volunteering.apply(volunteer.id, { opportunityId: opportunity.id }), /conflict/);

    // Assigning somebody the organisation has not accepted is a placement nobody agreed to.
    await assert.rejects(
      volunteering.assign(coordinator.id, org.id, { opportunityId: opportunity.id, userId: trainee.id, task: 'Carry equipment', startsAt: dayKey(new Date(Date.now() - day)) }),
      /conflict/
    );
    const acceptedApplication = await volunteering.decideApplication(coordinator.id, org.id, application.id, { outcome: 'accepted', reason: '', version: application.version });
    assert.equal(acceptedApplication.assignmentCreated, false, 'accepting an application is not an assignment');

    const task = await volunteering.assign(coordinator.id, org.id, {
      opportunityId: opportunity.id, userId: volunteer.id,
      task: 'Carry and place equipment at the north plot.',
      startsAt: dayKey(new Date(Date.now() - 3 * day))
    });
    assert.equal(task.awaitingVolunteerAcceptance, true);
    // Hours cannot be logged against a task nobody accepted.
    await assert.rejects(volunteering.logHours(volunteer.id, { assignmentId: task.id, workedOn: dayKey(new Date(Date.now() - day)), minutes: 120 }), /conflict/);

    const acceptedTask = await volunteering.respondToAssignment(volunteer.id, task.id, { accept: true, version: task.version });
    assert.equal(acceptedTask.state, 'accepted');
    const hours = await volunteering.logHours(volunteer.id, { assignmentId: task.id, workedOn: dayKey(new Date(Date.now() - day)), minutes: 180, note: 'North plot.' });
    assert.equal(hours.counted, false);
    assert.equal(hours.awaitingApproval, true);

    // --- nobody approves their own hours ------------------------------------------------------------
    await db.membership.create({ data: { userId: volunteer.id, organizationId: org.id, roles: ['VolunteerCoordinator'], status: 'active' } });
    await assert.rejects(
      volunteering.decideHours(volunteer.id, org.id, hours.id, { outcome: 'approved', version: hours.version }),
      /forbidden/, 'a volunteer cannot approve their own hours even holding the coordinator role'
    );
    // And the database refuses it whatever wrote the row.
    await assert.rejects(
      db.volunteerHours.update({ where: { id: hours.id }, data: { state: 'approved', approvedBy: volunteer.id, approvedAt: new Date() } }),
      /volunteer cannot approve their own hours/
    );

    const approvedHours = await volunteering.decideHours(coordinator.id, org.id, hours.id, { outcome: 'approved', version: hours.version });
    assert.equal(approvedHours.counted, true);
    assert.equal(approvedHours.approvedBySomeoneElse, true);

    const myVolunteering = await volunteering.mine(volunteer.id);
    assert.equal(myVolunteering.assignments[0]!.minutesApproved, 180);
    assert.equal(myVolunteering.assignments[0]!.minutesAwaiting, 0);

    // ================================================================================================
    // The sponsor export names nobody
    // ================================================================================================
    const report = await agreements.createReport(operator.id, org.id, agreement.id, {
      periodStart: dayKey(new Date(Date.now() - 30 * day)), periodEnd: dayKey(new Date()),
      narrative: 'One cohort recruited and running, with two sessions held in the reporting period and attendance recorded for every trainee on the register.',
      spentMinor: '60000', participantsReached: 1
    });
    const submittedReport = await agreements.submitReport(operator.id, org.id, report.id, report.version);
    const decidedReport = await agreements.decideReport(sponsorLead.id, sponsorOrg.id, submittedReport.id, { outcome: 'approved', reason: 'Figures match the register we were shown.', version: submittedReport.version });
    assert.equal(decidedReport.releasedFunds, false);

    const exported = await agreements.exportForSponsor(sponsorLead.id, sponsorOrg.id);
    assert.equal(exported.containsPersonalData, false);
    assert.equal(exported.equityHeld, 0);
    assert.equal(exported.agreements[0]!.participantsReached, 1);
    const serialised = JSON.stringify(exported);
    for (const name of [trainee.name, applicant.name, volunteer.name, founder.name, trainee.email, applicant.email]) {
      assert.equal(serialised.includes(name), false, `the sponsor export must not contain ${name}`);
    }
    // And an assistance case reaches no sponsor projection at all.
    assert.equal(serialised.includes(supportCase.reference), false);
  } finally {
    await db.$transaction(async tx => {
      const orgIds = organizations;
      const agreementIds = (await tx.agreement.findMany({ where: { OR: [{ sponsorOrgId: { in: orgIds } }, { operatorOrgId: { in: orgIds } }] }, select: { id: true } })).map(row => row.id);
      const proposalIds = (await tx.proposal.findMany({ where: { OR: [{ organizationId: { in: orgIds } }, { ownerId: { in: users } }] }, select: { id: true } })).map(row => row.id);
      const caseIds = (await tx.assistanceCase.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true } })).map(row => row.id);
      const opportunityIds = (await tx.volunteerOpportunity.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true } })).map(row => row.id);
      const programIds = (await tx.program.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true } })).map(row => row.id);
      const cohortIds = (await tx.cohort.findMany({ where: { programId: { in: programIds } }, select: { id: true } })).map(row => row.id);

      const appendOnly = [
        'agreement_revisions', 'agreement_acceptances', 'agreement_milestone_decisions',
        'proposal_decisions', 'incubation_milestone_decisions', 'assistance_consents',
        'assistance_decisions', 'attendance_revisions', 'application_decisions',
        'application_reviews', 'program_review_decisions', 'identity_audit_events'
      ];
      for (const table of appendOnly) await tx.$executeRawUnsafe(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
      await tx.$executeRawUnsafe('ALTER TABLE volunteer_hours DISABLE TRIGGER USER');
      await tx.$executeRawUnsafe('ALTER TABLE incubation_agreements DISABLE TRIGGER USER');

      await tx.volunteerHours.deleteMany({ where: { assignment: { opportunityId: { in: opportunityIds } } } });
      await tx.volunteerAssignment.deleteMany({ where: { opportunityId: { in: opportunityIds } } });
      await tx.volunteerApplication.deleteMany({ where: { opportunityId: { in: opportunityIds } } });
      await tx.volunteerOpportunity.deleteMany({ where: { id: { in: opportunityIds } } });

      await tx.assistanceDelivery.deleteMany({ where: { caseId: { in: caseIds } } });
      await tx.assistanceDecision.deleteMany({ where: { caseId: { in: caseIds } } });
      await tx.assistanceMessage.deleteMany({ where: { caseId: { in: caseIds } } });
      await tx.assistanceConsent.deleteMany({ where: { caseId: { in: caseIds } } });
      await tx.assistanceCase.deleteMany({ where: { id: { in: caseIds } } });

      await tx.incubationMilestoneDecision.deleteMany({ where: { milestone: { proposalId: { in: proposalIds } } } });
      await tx.incubationMilestone.deleteMany({ where: { proposalId: { in: proposalIds } } });
      await tx.incubationAgreement.deleteMany({ where: { proposalId: { in: proposalIds } } });
      await tx.mentorAssignment.deleteMany({ where: { proposalId: { in: proposalIds } } });
      await tx.proposalDecision.deleteMany({ where: { proposalId: { in: proposalIds } } });
      await tx.proposal.deleteMany({ where: { id: { in: proposalIds } } });

      await tx.certificate.deleteMany({ where: { enrollment: { cohortId: { in: cohortIds } } } });
      await tx.stipendLine.deleteMany({ where: { batch: { cohortId: { in: cohortIds } } } });
      await tx.stipendBatch.deleteMany({ where: { cohortId: { in: cohortIds } } });

      await tx.agreementFundingIntent.deleteMany({ where: { agreementId: { in: agreementIds } } });
      await tx.agreementReport.deleteMany({ where: { agreementId: { in: agreementIds } } });
      await tx.agreementMilestoneDecision.deleteMany({ where: { milestone: { agreementId: { in: agreementIds } } } });
      await tx.agreementMilestone.deleteMany({ where: { agreementId: { in: agreementIds } } });
      await tx.agreementAcceptance.deleteMany({ where: { agreementId: { in: agreementIds } } });
      await tx.agreementRevision.deleteMany({ where: { agreementId: { in: agreementIds } } });
      await tx.agreement.deleteMany({ where: { id: { in: agreementIds } } });

      await tx.attendanceRevision.deleteMany({ where: { attendance: { session: { cohortId: { in: cohortIds } } } } });
      await tx.attendanceObjection.deleteMany({ where: { attendance: { session: { cohortId: { in: cohortIds } } } } });
      await tx.attendance.deleteMany({ where: { session: { cohortId: { in: cohortIds } } } });
      await tx.trainingSession.deleteMany({ where: { cohortId: { in: cohortIds } } });
      await tx.enrollment.deleteMany({ where: { cohortId: { in: cohortIds } } });
      await tx.cohortTrainer.deleteMany({ where: { cohortId: { in: cohortIds } } });
      await tx.applicationDecision.deleteMany({ where: { application: { programId: { in: programIds } } } });
      await tx.applicationReview.deleteMany({ where: { application: { programId: { in: programIds } } } });
      await tx.application.deleteMany({ where: { programId: { in: programIds } } });
      await tx.cohort.deleteMany({ where: { id: { in: cohortIds } } });
      await tx.programReviewDecision.deleteMany({ where: { programId: { in: programIds } } });
      await tx.program.deleteMany({ where: { id: { in: programIds } } });

      await tx.outboxEvent.deleteMany({});
      await tx.identityAuditEvent.deleteMany({ where: { actorId: { in: users } } });
      for (const table of appendOnly) await tx.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
      await tx.$executeRawUnsafe('ALTER TABLE volunteer_hours ENABLE TRIGGER USER');
      await tx.$executeRawUnsafe('ALTER TABLE incubation_agreements ENABLE TRIGGER USER');

      await tx.membership.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.party.deleteMany({ where: { OR: [{ userId: { in: users } }, { organizationId: { in: orgIds } }] } });
      await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
      await tx.platformGrant.deleteMany({ where: { userId: { in: users } } });
      await tx.individualProfile.deleteMany({ where: { userId: { in: users } } });
      await tx.session.deleteMany({ where: { userId: { in: users } } });
      await tx.user.deleteMany({ where: { id: { in: users } } });
    });
    await db.$disconnect();
  }
});
