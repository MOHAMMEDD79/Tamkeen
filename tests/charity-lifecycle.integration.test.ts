import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { CURRENT_TERMS_VERSION, loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { IdentityService } from '../apps/api/dist/modules/identity/identity.service.js';
import { ProjectsService } from '../apps/api/dist/modules/projects/projects.service.js';
import { CharityService } from '../apps/api/dist/modules/projects/charity.service.js';
import { OperationsService } from '../apps/api/dist/modules/operations/operations.service.js';

/**
 * PART-05 acceptance: correct and forbidden transitions, an independent reviewer, publication only
 * after conditions are met, and versions that cannot be erased.
 */

const config = loadConfig(process.env);

test('the charity lifecycle enforces transitions, an independent reviewer and non-destructive versions', async () => {
  const db = createDatabase(config.databaseUrl);
  const identity = new IdentityService(db);
  const projects = new ProjectsService(db);
  const charity = new CharityService(db);
  const operations = new OperationsService(db);
  const prefix = randomUUID();
  const users: string[] = [];
  const organizations: string[] = [];

  const createUser = async (suffix: string, twoFactor = false) => {
    const user = await db.user.create({ data: { email: `${prefix}-${suffix}@example.test`, name: `Charity ${suffix}`, emailVerified: true, twoFactorEnabled: twoFactor, termsVersion: CURRENT_TERMS_VERSION, termsAcceptedAt: new Date() } });
    users.push(user.id);
    return user;
  };

  try {
    const owner = await createUser('owner');
    const manager = await createUser('manager');
    const reviewer = await createUser('reviewer', true);
    const insiderReviewer = await createUser('insider-reviewer', true);
    const weakReviewer = await createUser('weak-reviewer');
    const secondReviewer = await createUser('second-reviewer', true);
    const platformAdmin = await createUser('platform-admin', true);

    const org = await identity.createOrganization(owner.id, { legalName: `Charity Legal ${prefix}`, displayName: `Charity Org ${prefix}`, type: 'NGO', country: 'PS', city: 'Nablus' });
    organizations.push(org.id);
    await db.membership.create({ data: { userId: manager.id, organizationId: org.id, roles: ['ProjectManager'] } });
    // The insider holds a genuine ContentReviewer grant *and* belongs to the organisation.
    await db.membership.create({ data: { userId: insiderReviewer.id, organizationId: org.id, roles: ['Viewer'] } });
    await db.platformGrant.createMany({ data: [
      { userId: reviewer.id, role: 'ContentReviewer', grantedBy: reviewer.id },
      { userId: insiderReviewer.id, role: 'ContentReviewer', grantedBy: reviewer.id },
      { userId: weakReviewer.id, role: 'ContentReviewer', grantedBy: reviewer.id },
      { userId: secondReviewer.id, role: 'ContentReviewer', grantedBy: platformAdmin.id },
      { userId: platformAdmin.id, role: 'PlatformAdmin', grantedBy: platformAdmin.id }
    ] });
    await db.organization.update({ where: { id: org.id }, data: { verification: 'verified' } });

    const city = await db.city.findFirstOrThrow({ where: { country: 'PS', nameEn: 'Nablus' } });
    const project = await projects.create(owner.id, org.id, {
      type: 'charity',
      title: `Community centre ${prefix.slice(0, 8)}`,
      summary: 'Fitting out two halls and a computer lab to run vocational training all year round.',
      story: 'Story.', cityId: city.id, managerId: manager.id,
      publicLocationPrecision: 'city', latitude: null, longitude: null
    });

    // --- Readiness names its blockers instead of failing opaquely ----------------------------
    let plan = await charity.plan(owner.id, org.id, project.id);
    assert.equal(plan.readiness.ready, false);
    assert.deepEqual(plan.readiness.blockers.sort(), ['budget_missing', 'campaign_missing', 'milestones_missing']);
    assert.equal(plan.funding.available, false, 'with no campaign there is nothing to report, which is not the same as zero');

    // --- Amounts are strings of minor units, never JSON numbers -------------------------------
    await assert.rejects(() => charity.saveCampaign(owner.id, org.id, project.id, { goalMinor: 10000000 as unknown as string, currency: 'ILS', policy: 'flexible', endsAt: '2026-12-31T00:00:00.000Z', version: plan.version }), /invalid_input/);
    await assert.rejects(() => charity.saveCampaign(owner.id, org.id, project.id, { goalMinor: '100.50', currency: 'ILS', policy: 'flexible', endsAt: '2026-12-31T00:00:00.000Z', version: plan.version }), /invalid_input/, 'a decimal point means the caller is not using minor units');
    await assert.rejects(() => charity.saveCampaign(owner.id, org.id, project.id, { goalMinor: '0', currency: 'ILS', policy: 'flexible', endsAt: '2026-12-31T00:00:00.000Z', version: plan.version }), /invalid_input/);

    const campaign = await charity.saveCampaign(owner.id, org.id, project.id, { goalMinor: '10000000', currency: 'ils', policy: 'flexible', endsAt: '2026-12-31T00:00:00.000Z', version: plan.version });
    assert.equal(campaign.goalMinor, '10000000');
    assert.equal(campaign.currency, 'ILS', 'the currency code is normalised to upper case');

    // --- Budget and milestones must describe the same plan ------------------------------------
    plan = await charity.plan(owner.id, org.id, project.id);
    await charity.reviseBudget(owner.id, org.id, project.id, { lines: [{ label: 'Hall fit-out', amountMinor: '4000000' }, { label: 'Computer lab', amountMinor: '6000000' }], reason: '', version: plan.version });
    plan = await charity.plan(owner.id, org.id, project.id);
    assert.equal(plan.budget.totalMinor, '10000000');

    // Weights must total 100, because completion is measured by weight.
    await assert.rejects(() => charity.saveMilestones(owner.id, org.id, project.id, { milestones: [{ title: 'Stage one', budgetMinor: '4000000', weight: 30 }, { title: 'Stage two', budgetMinor: '6000000', weight: 30 }], version: plan.version }), /invalid_input/);
    await charity.saveMilestones(owner.id, org.id, project.id, { milestones: [{ title: 'Stage one', budgetMinor: '4000000', weight: 40 }, { title: 'Stage two', budgetMinor: '6000000', weight: 60 }], version: plan.version });

    plan = await charity.plan(owner.id, org.id, project.id);
    assert.equal(plan.readiness.ready, true, `still blocked: ${plan.readiness.blockers.join(', ')}`);

    // A staged budget that does not add up to the whole budget is a hole in the plan.
    await charity.saveMilestones(owner.id, org.id, project.id, { milestones: [{ title: 'Stage one', budgetMinor: '4000000', weight: 100 }], version: plan.version });
    plan = await charity.plan(owner.id, org.id, project.id);
    assert.equal(plan.readiness.blockers.includes('milestone_budget_mismatch'), true);
    await charity.saveMilestones(owner.id, org.id, project.id, { milestones: [{ title: 'Stage one', budgetMinor: '4000000', weight: 40 }, { title: 'Stage two', budgetMinor: '6000000', weight: 60 }], version: plan.version });

    // --- Submission freezes the plan -----------------------------------------------------------
    plan = await charity.plan(owner.id, org.id, project.id);
    const submission = await projects.submit(owner.id, org.id, project.id, plan.version);
    plan = await charity.plan(owner.id, org.id, project.id);
    assert.equal(plan.state, 'submitted');
    await assert.rejects(() => charity.saveCampaign(owner.id, org.id, project.id, { goalMinor: '20000000', currency: 'ILS', policy: 'flexible', endsAt: '2026-12-31T00:00:00.000Z', version: plan.version }), /conflict/, 'a submitted plan is frozen while a reviewer reads it');

    // --- The reviewer must be independent -------------------------------------------------------
    await assert.rejects(() => charity.reviewQueue(weakReviewer.id), /forbidden/, 'a reviewer without MFA cannot open the queue');
    await assert.rejects(() => charity.reviewQueue(owner.id), /forbidden/, 'organisation membership is not a review grant');
    assert.equal((await charity.reviewQueue(reviewer.id)).some(item => item.id === submission.id), true);

    // Claiming is exclusive.
    await charity.claim(reviewer.id, submission.id);
    await assert.rejects(() => charity.claim(insiderReviewer.id, submission.id), /conflict/);
    await assert.rejects(() => charity.review(insiderReviewer.id, submission.id), /not_found/, 'a claimed submission is invisible to another reviewer');

    const claimedPlan = await charity.plan(owner.id, org.id, project.id);
    await assert.rejects(() => charity.assignReviewTask(reviewer.id, submission.id, { assigneeId: secondReviewer.id, version: claimedPlan.version }), /forbidden/, 'a reviewer is not their own supervisor');
    const transferred = await charity.assignReviewTask(platformAdmin.id, submission.id, { assigneeId: secondReviewer.id, version: claimedPlan.version });
    await assert.rejects(() => charity.assignReviewTask(platformAdmin.id, submission.id, { assigneeId: reviewer.id, version: claimedPlan.version }), /conflict/, 'a stale supervisor cannot overwrite the transfer');
    const transferredBack = await charity.assignReviewTask(platformAdmin.id, submission.id, { assigneeId: reviewer.id, version: transferred.version });
    assert.equal(transferredBack.assigneeId, reviewer.id);

    plan = await charity.plan(owner.id, org.id, project.id);
    assert.equal(plan.state, 'in_review');

    // A reviewer who belongs to the submitting organisation may not decide, grant or not.
    await db.project.update({ where: { id: project.id }, data: { assignedReviewerId: insiderReviewer.id } });
    await assert.rejects(() => charity.decide(insiderReviewer.id, submission.id, { outcome: 'approved', publicReason: '', version: plan.version }), /forbidden/, 'a member of the owning organisation cannot approve its own project');
    await db.project.update({ where: { id: project.id }, data: { assignedReviewerId: reviewer.id } });

    // Refusing or returning work always needs a stated reason.
    plan = await charity.plan(owner.id, org.id, project.id);
    await assert.rejects(() => charity.decide(reviewer.id, submission.id, { outcome: 'changes_requested', publicReason: 'no', version: plan.version }), /invalid_input/);

    const changes = await charity.decide(reviewer.id, submission.id, { outcome: 'changes_requested', publicReason: 'The stage two budget needs an itemised breakdown before publication.', version: plan.version });
    assert.equal(changes.state, 'changes_requested');
    // A decision is the record of a judgement and is never rewritten.
    await assert.rejects(() => db.projectReviewDecision.update({ where: { id: changes.id }, data: { outcome: 'approved' } }), /append-only/);
    await assert.rejects(() => db.projectReviewDecision.deleteMany({ where: { id: changes.id } }), /append-only/);
    // One decision per submission.
    plan = await charity.plan(owner.id, org.id, project.id);
    await assert.rejects(() => charity.decide(reviewer.id, submission.id, { outcome: 'approved', publicReason: '', version: plan.version }), /conflict/);

    // --- Resubmission chains to the previous version ---------------------------------------------
    assert.equal(plan.state, 'changes_requested', 'changes_requested reopens the draft for editing');
    await charity.reviseBudget(owner.id, org.id, project.id, { lines: [{ label: 'Hall fit-out', amountMinor: '4000000' }, { label: 'Computer lab, itemised', amountMinor: '6000000' }], reason: '', version: plan.version });
    plan = await charity.plan(owner.id, org.id, project.id);
    // The earlier budget survives as a revision rather than being overwritten.
    assert.equal(plan.budget.revisions.length >= 1, true);
    const revision = plan.budget.revisions[0]!;
    assert.equal(revision.totalMinor, '10000000');
    await assert.rejects(() => db.budgetRevision.deleteMany({ where: { id: revision.id } }), /append-only/);

    const second = await projects.submit(owner.id, org.id, project.id, plan.version);
    assert.equal(second.sequence, 2);

    // --- Publication requires conditions, not just approval ---------------------------------------
    await charity.claim(reviewer.id, second.id);
    plan = await charity.plan(owner.id, org.id, project.id);
    const approval = await charity.decide(reviewer.id, second.id, { outcome: 'approved', publicReason: '', version: plan.version });
    assert.equal(approval.state, 'approved');

    // Approved is not public.
    await assert.rejects(() => projects.publicProject(project.slug), /not_found/, 'approval permits publication; it is not publication');

    plan = await charity.plan(owner.id, org.id, project.id);
    await assert.rejects(() => charity.publish(weakReviewer.id, project.id, plan.version), /forbidden/);
    await assert.rejects(() => charity.publish(insiderReviewer.id, project.id, plan.version), /forbidden/, 'a member of the owning organisation cannot publish its project');

    // Verification can lapse between approval and publication, so it is re-checked at publication.
    await db.organization.update({ where: { id: org.id }, data: { verification: 'expired' } });
    await assert.rejects(() => charity.publish(reviewer.id, project.id, plan.version), /conflict/, 'an expired verification blocks publication even after approval');
    await db.organization.update({ where: { id: org.id }, data: { verification: 'verified' } });

    const published = await charity.publish(reviewer.id, project.id, plan.version);
    assert.equal(published.state, 'published');
    assert.ok(published.publishedAt);
    // Now, and only now, is it public.
    assert.equal((await projects.publicProject(project.slug)).slug, project.slug);

    // --- Policy and currency are fixed once published ----------------------------------------------
    plan = await charity.plan(owner.id, org.id, project.id);
    await assert.rejects(() => charity.saveCampaign(owner.id, org.id, project.id, { goalMinor: '10000000', currency: 'ILS', policy: 'all_or_nothing', endsAt: '2026-12-31T00:00:00.000Z', version: plan.version }), /conflict/);
    await assert.rejects(() => db.campaign.update({ where: { projectId: project.id }, data: { policy: 'all_or_nothing' } }), /fixed once the project is published/, 'SQL enforces this too, not only the service');

    // A published budget change needs a stated reason.
    await assert.rejects(() => charity.reviseBudget(owner.id, org.id, project.id, { lines: [{ label: 'Revised', amountMinor: '10000000' }], reason: '', version: plan.version }), /invalid_input/);
    await charity.reviseBudget(owner.id, org.id, project.id, { lines: [{ label: 'Revised scope after site survey', amountMinor: '10000000' }], reason: 'The site survey changed what the second hall needs.', version: plan.version });

    // --- Pause, close and evidence ------------------------------------------------------------------
    plan = await charity.plan(owner.id, org.id, project.id);
    const paused = await charity.pause(owner.id, org.id, project.id, { reason: 'Supplier delay pending a replacement quote.', version: plan.version });
    assert.equal(paused.state, 'paused');
    const resumed = await charity.resume(owner.id, org.id, project.id, paused.version);
    assert.equal(resumed.state, 'published');

    plan = await charity.plan(owner.id, org.id, project.id);
    const milestone = plan.milestones[0]!;
    const evidenced = await charity.submitMilestoneEvidence(owner.id, org.id, project.id, milestone.id, { note: 'Invoices and photographs of the completed hall are attached.' });
    assert.equal(evidenced.state, 'evidence_submitted');
    // A milestone carrying evidence cannot be silently replaced.
    plan = await charity.plan(owner.id, org.id, project.id);
    await assert.rejects(() => charity.saveMilestones(owner.id, org.id, project.id, { milestones: [{ title: 'Replaced', budgetMinor: '10000000', weight: 100 }], version: plan.version }), /conflict/);

    const closed = await charity.requestClose(owner.id, org.id, project.id, { reason: 'Delivery finished; requesting impact review and closure.', version: plan.version });
    assert.equal(closed.state, 'impact_review');
    assert.equal(closed.completed, false, 'a manager requests closure; they do not declare completion');

    // --- Reports: separation of duties and an immutable published snapshot ---------------------------
    const report = await charity.createReport(owner.id, org.id, project.id, { title: 'First quarter report', periodStart: '2026-07-01', periodEnd: '2026-09-30', body: 'A full description of what was delivered during the period, with its evidence.' });
    const metrics = await charity.reportMetrics(owner.id, org.id, project.id);
    assert.equal(metrics.counted.every(entry => entry.definition.length > 10), true);
    // PART-06 gave contributions a source, so they are counted — at zero, which is now a real
    // reading rather than a fabricated one, because this project genuinely received nothing.
    assert.equal(metrics.counted.find(entry => entry.key === 'gross_contributions_minor')?.value, '0');
    assert.equal(metrics.counted.find(entry => entry.key === 'net_funding_minor')?.value, '0');
    assert.equal(metrics.unavailable.some(entry => entry.key === 'disbursed'), true, 'a figure with no source is still declared unavailable, not reported as zero');

    const submitted = await charity.submitReport(owner.id, org.id, report.id, report.version);
    await assert.rejects(() => charity.publishReport(owner.id, org.id, report.id, submitted.version), /forbidden/, 'the author of a report may not publish it');
    const publishedReport = await charity.publishReport(manager.id, org.id, report.id, submitted.version);
    assert.equal(publishedReport.state, 'published');
    const publicSnapshot = await db.publicReport.findFirstOrThrow({ where: { sourceType: 'project_report', sourceId: report.id } });
    assert.equal(publicSnapshot.currency, 'ILS');
    assert.equal((publicSnapshot.snapshot as { netFundingMinor: string }).netFundingMinor, '0');
    const organizationReports = await operations.publicReports(org.slug);
    assert.equal(organizationReports.some(item => item.id === publicSnapshot.id), true, 'the public organisation profile can discover its published snapshots');
    assert.equal((await operations.publicReports(`missing-${prefix}`)).length, 0, 'another organisation slug cannot discover this snapshot');
    // A published report states figures publicly at a point in time; a correction is a new report.
    await assert.rejects(() => db.projectReport.update({ where: { id: report.id }, data: { body: 'rewritten' } }), /immutable/);
    await assert.rejects(() => db.projectReport.deleteMany({ where: { id: report.id } }), /cannot be deleted/);
  } finally {
    await db.$transaction(async tx => {
      const projectIds = (await tx.project.findMany({ where: { organizationId: { in: organizations } }, select: { id: true } })).map(row => row.id);
      for (const table of ['project_review_decisions', 'budget_revisions', 'project_versions', 'project_reports']) {
        await tx.$executeRawUnsafe(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
      }
      await tx.projectReviewDecision.deleteMany({ where: { projectVersion: { projectId: { in: projectIds } } } });
      await tx.projectVersion.deleteMany({ where: { projectId: { in: projectIds } } });
      await tx.budgetRevision.deleteMany({ where: { projectId: { in: projectIds } } });
      await tx.publicReport.deleteMany({ where: { OR: [{ sourceId: { in: projectIds } }, { createdBy: { in: users } }] } });
      await tx.projectReport.deleteMany({ where: { projectId: { in: projectIds } } });
      for (const table of ['project_reports', 'project_versions', 'budget_revisions', 'project_review_decisions']) {
        await tx.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
      }
      await tx.projectUpdate.deleteMany({ where: { projectId: { in: projectIds } } });
      await tx.milestone.deleteMany({ where: { projectId: { in: projectIds } } });
      await tx.budgetLine.deleteMany({ where: { projectId: { in: projectIds } } });
      await tx.campaign.deleteMany({ where: { projectId: { in: projectIds } } });
      await tx.bookmark.deleteMany({ where: { projectId: { in: projectIds } } });
      await tx.project.deleteMany({ where: { id: { in: projectIds } } });
      await tx.membership.deleteMany({ where: { organizationId: { in: organizations } } });
      await tx.party.deleteMany({ where: { OR: [{ userId: { in: users } }, { organizationId: { in: organizations } }] } });
      await tx.organization.deleteMany({ where: { id: { in: organizations } } });
      await tx.platformGrant.deleteMany({ where: { OR: [{ userId: { in: users } }, { grantedBy: { in: users } }] } });
      await tx.individualProfile.deleteMany({ where: { userId: { in: users } } });
      await tx.session.deleteMany({ where: { userId: { in: users } } });
      await tx.user.deleteMany({ where: { id: { in: users } } });
    });
    await db.$disconnect();
  }
});
