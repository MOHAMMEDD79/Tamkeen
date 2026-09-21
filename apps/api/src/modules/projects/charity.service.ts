import type { DatabaseClient, FundingPolicy, ProjectState, ReviewOutcome } from '@tamkeen/database';
import { IdentityError } from '../identity/policy.js';
import { IdentityService } from '../identity/identity.service.js';
import { minorToString, parseCurrency, parseMinor, sumMinor } from './money.js';

/**
 * The charity lifecycle (05-CHARITY-LIFECYCLE): a budgeted, staged project goes to an independent
 * content reviewer and only becomes public by that reviewer's decision.
 *
 * No money moves here. The amounts this module writes are planning figures: a budget is what the
 * organisation intends to spend, not what it holds. Confirmed money is read back from the
 * contributions the ledger recorded (PART-06), and the two are reported side by side rather than
 * merged, so a plan can never be mistaken for a balance.
 */

const EDITABLE_STATES: readonly ProjectState[] = ['draft', 'changes_requested'];
/** States in which a reviewer may act on a submission. */
const REVIEWABLE_STATES: readonly ProjectState[] = ['submitted', 'in_review'];
const FUNDING_POLICIES: readonly FundingPolicy[] = ['flexible', 'all_or_nothing'];

/** Only confirmed money counts. A pending checkout holds capacity but has not been paid. */
const CONFIRMED_CONTRIBUTION_STATES = ['succeeded', 'partially_refunded'] as const;

/** Gross and refunded totals over a set of confirmed contributions, as integer minor units. */
function totals(rows: ReadonlyArray<{ amountMinor: bigint; refundedMinor: bigint }>) {
  return {
    gross: sumMinor(rows.map(row => row.amountMinor)),
    refunded: sumMinor(rows.map(row => row.refundedMinor))
  };
}

function text(value: unknown, min: number, max: number): string {
  if (typeof value !== 'string') throw new IdentityError('invalid_input', 422);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw new IdentityError('invalid_input', 422);
  return trimmed;
}

export interface BudgetLineInput { label: string; amountMinor: string }
export interface MilestoneInput { title: string; budgetMinor: string; weight: number }

export class CharityService {
  private readonly identity: IdentityService;
  constructor(private readonly db: DatabaseClient) { this.identity = new IdentityService(db); }

  // ---------------------------------------------------------------- reading

  /** The organisation-side plan: campaign, budget, milestones and revision history. */
  async plan(actorId: string, organizationId: string, projectId: string) {
    await this.identity.access(actorId, organizationId, 'project.read');
    const project = await this.db.project.findFirst({
      where: { id: projectId, organizationId },
      include: {
        campaign: true,
        budgetLines: { orderBy: { sortOrder: 'asc' } },
        budgetRevisions: { select: { id: true, sequence: true, reason: true, totalMinor: true, createdAt: true }, orderBy: { sequence: 'desc' } },
        milestones: { orderBy: { sequence: 'asc' } },
        versions: { select: { id: true, sequence: true, submittedAt: true, decision: { select: { outcome: true, publicReason: true, decidedAt: true } } }, orderBy: { sequence: 'desc' } },
        updates: { select: { id: true, title: true, publishedAt: true }, orderBy: { publishedAt: 'desc' } },
        reports: { select: { id: true, sequence: true, title: true, state: true, version: true, periodStart: true, periodEnd: true, publishedAt: true }, orderBy: { sequence: 'desc' } }
      }
    });
    if (!project) throw new IdentityError('not_found', 404);
    const budgetTotal = sumMinor(project.budgetLines.map(line => line.amountMinor));
    const milestoneTotal = sumMinor(project.milestones.map(milestone => milestone.budgetMinor));
    const confirmed = await this.db.contribution.findMany({
      where: { projectId: project.id, state: { in: [...CONFIRMED_CONTRIBUTION_STATES] } },
      select: { amountMinor: true, refundedMinor: true }
    });
    const planTotals = totals(confirmed);
    const fundingSummary = project.campaign
      ? {
          available: true as const,
          currency: project.campaign.currency,
          goalMinor: minorToString(project.campaign.goalMinor),
          grossMinor: minorToString(planTotals.gross),
          refundedMinor: minorToString(planTotals.refunded),
          netMinor: minorToString(planTotals.gross - planTotals.refunded),
          contributionCount: confirmed.length,
          // Every figure comes from the simulated payment path; no provider or money is real here.
          simulated: true as const
        }
      : { available: false as const, reason: 'no_campaign' as const };
    return {
      id: project.id, slug: project.slug, title: project.title, state: project.state,
      stateReason: project.stateReason, version: project.version, publishedAt: project.publishedAt,
      campaign: project.campaign && {
        goalMinor: minorToString(project.campaign.goalMinor), currency: project.campaign.currency,
        policy: project.campaign.policy, endsAt: project.campaign.endsAt, version: project.campaign.version
      },
      budget: {
        lines: project.budgetLines.map(line => ({ id: line.id, label: line.label, amountMinor: minorToString(line.amountMinor), sortOrder: line.sortOrder })),
        totalMinor: minorToString(budgetTotal),
        revisions: project.budgetRevisions.map(revision => ({ ...revision, totalMinor: minorToString(revision.totalMinor) }))
      },
      milestones: project.milestones.map(milestone => ({
        id: milestone.id, sequence: milestone.sequence, title: milestone.title,
        budgetMinor: minorToString(milestone.budgetMinor), weight: milestone.weight,
        state: milestone.state, evidenceNote: milestone.evidenceNote,
        evidenceSubmittedAt: milestone.evidenceSubmittedAt, verifiedAt: milestone.verifiedAt
      })),
      milestoneTotalMinor: minorToString(milestoneTotal),
      // Surfaced so the editor can show why submission is blocked before the person tries.
      readiness: this.readiness({
        summary: project.summary, campaign: project.campaign, lineCount: project.budgetLines.length,
        budgetTotal, milestones: project.milestones, milestoneTotal
      }),
      versions: project.versions,
      updates: project.updates,
      reports: project.reports,
      // A plan is not a balance: the budget above is what was planned, this is what actually arrived.
      funding: fundingSummary
    };
  }

  /**
   * Everything 05-CHARITY-LIFECYCLE requires before a project may go to review, as a list of
   * explicit reasons rather than a single opaque boolean.
   */
  private readiness(input: {
    summary: string;
    campaign: { goalMinor: bigint; currency: string; endsAt: Date } | null;
    lineCount: number; budgetTotal: bigint;
    milestones: Array<{ weight: number; budgetMinor: bigint }>; milestoneTotal: bigint;
  }) {
    const blockers: string[] = [];
    if (input.summary.trim().length < 30) blockers.push('summary_too_short');
    if (!input.campaign) blockers.push('campaign_missing');
    if (input.campaign && input.campaign.endsAt <= new Date()) blockers.push('campaign_end_in_past');
    if (!input.lineCount) blockers.push('budget_missing');
    if (!input.milestones.length) blockers.push('milestones_missing');
    // The staged budget must equal the whole budget: an unexplained gap is a hole in the plan.
    if (input.lineCount && input.milestones.length && input.budgetTotal !== input.milestoneTotal) blockers.push('milestone_budget_mismatch');
    // Completion is measured by weight, so the weights must describe the whole project.
    if (input.milestones.length && input.milestones.reduce((total, milestone) => total + milestone.weight, 0) !== 100) blockers.push('milestone_weights_not_100');
    if (input.campaign && input.lineCount && input.campaign.goalMinor !== input.budgetTotal) blockers.push('goal_budget_mismatch');
    return { ready: blockers.length === 0, blockers };
  }

  // ---------------------------------------------------------------- campaign and budget

  async saveCampaign(actorId: string, organizationId: string, projectId: string, input: { goalMinor: string; currency: string; policy: FundingPolicy; endsAt: string; version: number }) {
    const goalMinor = parseMinor(input.goalMinor);
    const currency = parseCurrency(input.currency);
    const endsAt = new Date(input.endsAt);
    if (!FUNDING_POLICIES.includes(input.policy) || Number.isNaN(endsAt.getTime())) throw new IdentityError('invalid_input', 422);
    return this.db.$transaction(async tx => {
      const project = await this.editableProject(tx as DatabaseClient, actorId, organizationId, projectId, 'project.update', input.version);
      if (project.type !== 'charity') throw new IdentityError('invalid_input', 422);
      const existing = await tx.campaign.findUnique({ where: { projectId } });
      // The policy a contributor relied on cannot change under them; SQL enforces this too.
      if (existing && project.publishedAt && (existing.policy !== input.policy || existing.currency !== currency)) throw new IdentityError('conflict', 409);
      const campaign = existing
        ? await tx.campaign.update({ where: { projectId }, data: { goalMinor, currency, policy: input.policy, endsAt, version: { increment: 1 } } })
        : await tx.campaign.create({ data: { projectId, goalMinor, currency, policy: input.policy, endsAt } });
      await tx.project.update({ where: { id: projectId }, data: { version: { increment: 1 } } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: projectId, action: 'campaign.saved' } });
      return { goalMinor: minorToString(campaign.goalMinor), currency: campaign.currency, policy: campaign.policy, endsAt: campaign.endsAt, version: campaign.version };
    });
  }

  /**
   * Replaces the budget, recording the previous state as an immutable revision first.
   * ORG-08.A05: a budget change is a new version with a reason, never an overwrite.
   */
  async reviseBudget(actorId: string, organizationId: string, projectId: string, input: { lines: BudgetLineInput[]; reason: string; version: number }) {
    if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > 60) throw new IdentityError('invalid_input', 422);
    const lines = input.lines.map((line, index) => ({ label: text(line.label, 2, 140), amountMinor: parseMinor(line.amountMinor), sortOrder: index }));
    const total = sumMinor(lines.map(line => line.amountMinor));
    return this.db.$transaction(async tx => {
      const project = await this.editableProject(tx as DatabaseClient, actorId, organizationId, projectId, 'project.update', input.version, { allowPublished: true });
      // Changing the budget of a published project needs a stated reason: the money already has a
      // declared purpose, and using it differently is not an ordinary text edit (05-CHARITY).
      const reason = text(input.reason, project.publishedAt ? 10 : 0, 1000);
      const previous = await tx.budgetLine.findMany({ where: { projectId }, orderBy: { sortOrder: 'asc' } });
      if (previous.length) {
        const last = await tx.budgetRevision.findFirst({ where: { projectId }, orderBy: { sequence: 'desc' } });
        await tx.budgetRevision.create({
          data: {
            projectId, sequence: (last?.sequence ?? 0) + 1, reason, createdBy: actorId,
            totalMinor: sumMinor(previous.map(line => line.amountMinor)),
            snapshot: previous.map(line => ({ label: line.label, amountMinor: minorToString(line.amountMinor), sortOrder: line.sortOrder }))
          }
        });
      }
      await tx.budgetLine.deleteMany({ where: { projectId } });
      await tx.budgetLine.createMany({ data: lines.map(line => ({ ...line, projectId })) });
      await tx.project.update({ where: { id: projectId }, data: { version: { increment: 1 } } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: projectId, action: 'budget.revised' } });
      return { totalMinor: minorToString(total), lineCount: lines.length };
    });
  }

  async saveMilestones(actorId: string, organizationId: string, projectId: string, input: { milestones: MilestoneInput[]; version: number }) {
    if (!Array.isArray(input.milestones) || input.milestones.length === 0 || input.milestones.length > 40) throw new IdentityError('invalid_input', 422);
    const milestones = input.milestones.map((milestone, index) => {
      const weight = milestone.weight;
      if (!Number.isInteger(weight) || weight <= 0 || weight > 100) throw new IdentityError('invalid_input', 422);
      return { sequence: index + 1, title: text(milestone.title, 2, 140), budgetMinor: parseMinor(milestone.budgetMinor), weight };
    });
    if (milestones.reduce((total, milestone) => total + milestone.weight, 0) !== 100) throw new IdentityError('invalid_input', 422);
    return this.db.$transaction(async tx => {
      await this.editableProject(tx as DatabaseClient, actorId, organizationId, projectId, 'project.update', input.version);
      // Replacing a milestone that already carries evidence would erase that evidence.
      const evidenced = await tx.milestone.count({ where: { projectId, state: { in: ['evidence_submitted', 'verified'] } } });
      if (evidenced) throw new IdentityError('conflict', 409);
      await tx.milestone.deleteMany({ where: { projectId } });
      await tx.milestone.createMany({ data: milestones.map(milestone => ({ ...milestone, projectId })) });
      await tx.project.update({ where: { id: projectId }, data: { version: { increment: 1 } } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: projectId, action: 'milestones.saved' } });
      return { count: milestones.length, totalMinor: minorToString(sumMinor(milestones.map(milestone => milestone.budgetMinor))) };
    });
  }

  // ---------------------------------------------------------------- lifecycle transitions

  /** ORG-08.A03. Stops new contributions without touching money already committed. */
  async pause(actorId: string, organizationId: string, projectId: string, input: { reason: string; version: number }) {
    const reason = text(input.reason, 10, 1000);
    return this.db.$transaction(async tx => {
      const scoped = new CharityService(tx as DatabaseClient);
      await scoped.identity.access(actorId, organizationId, 'project.pause');
      const project = await tx.project.findFirst({ where: { id: projectId, organizationId } });
      if (!project) throw new IdentityError('not_found', 404);
      if (project.version !== input.version) throw new IdentityError('conflict', 409);
      // Only something already public can be paused; a draft is simply not published.
      if (!['published', 'funding_closed', 'executing'].includes(project.state)) throw new IdentityError('conflict', 409);
      const updated = await tx.project.update({ where: { id: projectId }, data: { state: 'paused', stateReason: reason, version: { increment: 1 } } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: projectId, action: 'project.paused' } });
      return { state: updated.state, version: updated.version };
    });
  }

  async resume(actorId: string, organizationId: string, projectId: string, version: number) {
    return this.db.$transaction(async tx => {
      const scoped = new CharityService(tx as DatabaseClient);
      await scoped.identity.access(actorId, organizationId, 'project.pause');
      const project = await tx.project.findFirst({ where: { id: projectId, organizationId } });
      if (!project) throw new IdentityError('not_found', 404);
      if (project.version !== version || project.state !== 'paused') throw new IdentityError('conflict', 409);
      const updated = await tx.project.update({ where: { id: projectId }, data: { state: 'published', stateReason: '', version: { increment: 1 } } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: projectId, action: 'project.resumed' } });
      return { state: updated.state, version: updated.version };
    });
  }

  /**
   * ORG-08.A04. A close request moves to impact review; it does not complete the project.
   * 05-CHARITY-LIFECYCLE is explicit that completion follows a reviewer, not the manager's click.
   */
  async requestClose(actorId: string, organizationId: string, projectId: string, input: { reason: string; version: number }) {
    const reason = text(input.reason, 10, 1000);
    return this.db.$transaction(async tx => {
      const scoped = new CharityService(tx as DatabaseClient);
      await scoped.identity.access(actorId, organizationId, 'project.close');
      const project = await tx.project.findFirst({ where: { id: projectId, organizationId }, include: { milestones: true } });
      if (!project) throw new IdentityError('not_found', 404);
      if (project.version !== input.version) throw new IdentityError('conflict', 409);
      if (!['published', 'funding_closed', 'executing', 'paused'].includes(project.state)) throw new IdentityError('conflict', 409);
      const updated = await tx.project.update({ where: { id: projectId }, data: { state: 'impact_review', stateReason: reason, version: { increment: 1 } } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: projectId, action: 'project.close_requested' } });
      // Saying so explicitly: this is a request for review, not a completed project.
      return { state: updated.state, version: updated.version, completed: false };
    });
  }

  /** ORG-08.A02. Evidence moves a milestone to review; the organisation cannot verify its own. */
  async submitMilestoneEvidence(actorId: string, organizationId: string, projectId: string, milestoneId: string, input: { note: string }) {
    const note = text(input.note, 10, 2000);
    return this.db.$transaction(async tx => {
      const scoped = new CharityService(tx as DatabaseClient);
      await scoped.identity.access(actorId, organizationId, 'project.update');
      const milestone = await tx.milestone.findFirst({ where: { id: milestoneId, project: { id: projectId, organizationId } } });
      if (!milestone) throw new IdentityError('not_found', 404);
      if (!['planned', 'active'].includes(milestone.state)) throw new IdentityError('conflict', 409);
      const updated = await tx.milestone.update({ where: { id: milestoneId }, data: { state: 'evidence_submitted', evidenceNote: note, evidenceSubmittedAt: new Date() } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: milestoneId, action: 'milestone.evidence_submitted' } });
      return { id: updated.id, state: updated.state, evidenceSubmittedAt: updated.evidenceSubmittedAt };
    });
  }

  /** ORG-08.A01. A public update on a published project. */
  async publishUpdate(actorId: string, organizationId: string, projectId: string, input: { title: string; body: string }) {
    const title = text(input.title, 5, 140);
    const body = text(input.body, 20, 20000);
    return this.db.$transaction(async tx => {
      const scoped = new CharityService(tx as DatabaseClient);
      await scoped.identity.access(actorId, organizationId, 'report.publish');
      const project = await tx.project.findFirst({ where: { id: projectId, organizationId } });
      if (!project) throw new IdentityError('not_found', 404);
      if (!project.publishedAt) throw new IdentityError('conflict', 409);
      const update = await tx.projectUpdate.create({ data: { projectId, title, body, publishedBy: actorId } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: update.id, action: 'project.update_published' } });
      return { id: update.id, publishedAt: update.publishedAt };
    });
  }

  // ---------------------------------------------------------------- reports (ORG-13)

  async createReport(actorId: string, organizationId: string, projectId: string, input: { title: string; periodStart: string; periodEnd: string; body: string }) {
    const title = text(input.title, 5, 140);
    const body = text(input.body, 0, 40000);
    const periodStart = new Date(input.periodStart);
    const periodEnd = new Date(input.periodEnd);
    if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime()) || periodEnd < periodStart) throw new IdentityError('invalid_input', 422);
    return this.db.$transaction(async tx => {
      const scoped = new CharityService(tx as DatabaseClient);
      await scoped.identity.access(actorId, organizationId, 'report.create');
      const project = await tx.project.findFirst({ where: { id: projectId, organizationId } });
      if (!project) throw new IdentityError('not_found', 404);
      const last = await tx.projectReport.findFirst({ where: { projectId }, orderBy: { sequence: 'desc' } });
      const report = await tx.projectReport.create({ data: { projectId, sequence: (last?.sequence ?? 0) + 1, title, periodStart, periodEnd, body, createdBy: actorId } });
      return { id: report.id, sequence: report.sequence, state: report.state, version: report.version };
    });
  }

  /**
   * ORG-13.A02. The figures a report may state, each with its definition and its source.
   * Nothing is invented: what no module can produce is returned as unavailable.
   */
  async reportMetrics(actorId: string, organizationId: string, projectId: string) {
    await this.identity.access(actorId, organizationId, 'report.create');
    const project = await this.db.project.findFirst({
      where: { id: projectId, organizationId },
      include: { milestones: true, budgetLines: true, campaign: true }
    });
    if (!project) throw new IdentityError('not_found', 404);
    const verified = project.milestones.filter(milestone => milestone.state === 'verified');
    const weightDone = verified.reduce((total, milestone) => total + milestone.weight, 0);
    const confirmed = await this.db.contribution.findMany({
      where: { projectId: project.id, state: { in: [...CONFIRMED_CONTRIBUTION_STATES] } },
      select: { amountMinor: true, refundedMinor: true }
    });
    const { gross, refunded } = totals(confirmed);
    return {
      counted: [
        { key: 'milestones_verified', value: String(verified.length), definition: 'Milestones an impact reviewer marked verified.' },
        { key: 'milestones_total', value: String(project.milestones.length), definition: 'Milestones in the current plan.' },
        { key: 'completion_percent', value: String(weightDone), definition: 'Sum of verified milestone weights. It does not track the share of money raised.' },
        { key: 'planned_budget_minor', value: minorToString(sumMinor(project.budgetLines.map(line => line.amountMinor))), definition: 'Planned budget in minor units. A plan, not a balance.' },
        { key: 'gross_contributions_minor', value: minorToString(gross), definition: 'Confirmed contributions in minor units, before refunds. Simulated payments in this build.' },
        { key: 'net_funding_minor', value: minorToString(gross - refunded), definition: 'Confirmed contributions minus confirmed refunds. Not the cash available, which is settled cash less commitments.' },
        { key: 'contributions_confirmed', value: String(confirmed.length), definition: 'Confirmed contributions counted. One person may contribute more than once.' }
      ],
      unavailable: [
        { key: 'disbursed', reason: 'not_implemented', part: 'PART-07' },
        { key: 'verified_beneficiaries', reason: 'not_implemented', part: 'PART-07' }
      ]
    };
  }

  async submitReport(actorId: string, organizationId: string, reportId: string, version: number) {
    return this.db.$transaction(async tx => {
      const scoped = new CharityService(tx as DatabaseClient);
      await scoped.identity.access(actorId, organizationId, 'report.submit');
      const report = await tx.projectReport.findFirst({ where: { id: reportId, project: { organizationId } } });
      if (!report) throw new IdentityError('not_found', 404);
      if (report.version !== version || report.state !== 'draft') throw new IdentityError('conflict', 409);
      if (report.body.trim().length < 50) throw new IdentityError('invalid_input', 422);
      const updated = await tx.projectReport.update({ where: { id: reportId }, data: { state: 'submitted', submittedAt: new Date(), version: { increment: 1 } } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: reportId, action: 'report.submitted' } });
      return { id: updated.id, state: updated.state, version: updated.version };
    });
  }

  /**
   * ORG-13.A05. Publishing freezes a snapshot of the figures as they stood. Separation of duties:
   * the person who submitted the report may not be the one who publishes it.
   */
  async publishReport(actorId: string, organizationId: string, reportId: string, version: number) {
    return this.db.$transaction(async tx => {
      const scoped = new CharityService(tx as DatabaseClient);
      await scoped.identity.access(actorId, organizationId, 'report.publish');
      const report = await tx.projectReport.findFirst({ where: { id: reportId, project: { organizationId } }, include: { project: { include: { milestones: true, budgetLines: true, campaign: true } } } });
      if (!report) throw new IdentityError('not_found', 404);
      if (report.version !== version || report.state !== 'submitted') throw new IdentityError('conflict', 409);
      if (report.createdBy === actorId) throw new IdentityError('forbidden', 403);
      const verified = report.project.milestones.filter(milestone => milestone.state === 'verified');
      const reportConfirmed = await tx.contribution.findMany({
        where: { projectId: report.projectId, state: { in: [...CONFIRMED_CONTRIBUTION_STATES] } },
        select: { amountMinor: true, refundedMinor: true }
      });
      const { gross: reportGross, refunded: reportRefunded } = totals(reportConfirmed);
      const snapshot = {
        asOf: new Date().toISOString(),
        milestonesVerified: verified.length,
        milestonesTotal: report.project.milestones.length,
        completionPercent: verified.reduce((total, milestone) => total + milestone.weight, 0),
        plannedBudgetMinor: minorToString(sumMinor(report.project.budgetLines.map(line => line.amountMinor))),
        grossContributionsMinor: minorToString(reportGross),
        netFundingMinor: minorToString(reportGross - reportRefunded),
        // Recorded in the snapshot so a future reader knows these were unavailable, not zero.
        unavailable: ['disbursed', 'verified_beneficiaries']
      };
      const updated = await tx.projectReport.update({ where: { id: reportId }, data: { state: 'published', publishedAt: new Date(), snapshot, version: { increment: 1 } } });
      await tx.publicReport.create({ data: {
        title: report.project.title,
        sourceType: 'project_report', sourceId: report.id, version: report.version,
        snapshot, currency: report.project.campaign?.currency ?? null,
        periodStart: report.periodStart, periodEnd: report.periodEnd,
        filterDefinition: 'Project report period; confirmed contributions net of confirmed refunds; independently verified milestone weights.',
        createdBy: actorId
      } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: reportId, action: 'report.published' } });
      return { id: updated.id, state: updated.state, publishedAt: updated.publishedAt };
    });
  }

  // ---------------------------------------------------------------- helpers

  private async editableProject(tx: DatabaseClient, actorId: string, organizationId: string, projectId: string, permission: 'project.update', version: number, options: { allowPublished?: boolean } = {}) {
    await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
    const scoped = new CharityService(tx);
    await scoped.identity.access(actorId, organizationId, permission);
    const project = await tx.project.findFirst({ where: { id: projectId, organizationId } });
    if (!project) throw new IdentityError('not_found', 404);
    if (project.version !== version) throw new IdentityError('conflict', 409);
    const editable = EDITABLE_STATES.includes(project.state) || (options.allowPublished === true && Boolean(project.publishedAt));
    // Under review the plan is frozen: the reviewer is reading the snapshot that was submitted.
    if (!editable) throw new IdentityError('conflict', 409);
    return project;
  }

  // ---------------------------------------------------------------- content review (ADM-03)

  /** A content reviewer is a platform grant, separate from any organisation membership. */
  private async contentReviewer(actorId: string) {
    const user = await this.identity.activeUser(actorId);
    const grant = await this.db.platformGrant.findFirst({
      where: { userId: actorId, role: 'ContentReviewer', revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }
    });
    // 12-SECURITY requires MFA for reviewers, matching how verification review already works.
    if (!grant || !user.twoFactorEnabled) throw new IdentityError('forbidden', 403);
    return user;
  }

  async reviewQueue(actorId: string) {
    await this.contentReviewer(actorId);
    const versions = await this.db.projectVersion.findMany({
      where: { decision: null, project: { state: { in: [...REVIEWABLE_STATES] }, OR: [{ assignedReviewerId: null }, { assignedReviewerId: actorId }] } },
      select: {
        id: true, sequence: true, submittedAt: true,
        project: { select: { id: true, title: true, type: true, state: true, version: true, assignedReviewerId: true, organization: { select: { displayName: true, verification: true } } } }
      },
      orderBy: { submittedAt: 'asc' }, take: 100
    });
    return versions;
  }

  async review(actorId: string, versionId: string) {
    await this.contentReviewer(actorId);
    const version = await this.db.projectVersion.findUnique({
      where: { id: versionId },
      select: {
        id: true, sequence: true, snapshot: true, submittedAt: true, submittedBy: true,
        decision: { select: { outcome: true, publicReason: true, decidedAt: true } },
        project: {
          select: {
            id: true, title: true, summary: true, story: true, type: true, state: true, version: true,
            assignedReviewerId: true, publicLocationPrecision: true,
            organization: { select: { displayName: true, verification: true, type: true } },
            city: { select: { nameAr: true, nameEn: true } },
            campaign: true,
            budgetLines: { orderBy: { sortOrder: 'asc' } },
            milestones: { orderBy: { sequence: 'asc' } }
          }
        }
      }
    });
    if (!version || (version.project.assignedReviewerId && version.project.assignedReviewerId !== actorId)) throw new IdentityError('not_found', 404);
    const budgetTotal = sumMinor(version.project.budgetLines.map(line => line.amountMinor));
    const milestoneTotal = sumMinor(version.project.milestones.map(milestone => milestone.budgetMinor));
    return {
      ...version,
      project: {
        ...version.project,
        campaign: version.project.campaign && { ...version.project.campaign, goalMinor: minorToString(version.project.campaign.goalMinor) },
        budgetLines: version.project.budgetLines.map(line => ({ ...line, amountMinor: minorToString(line.amountMinor) })),
        milestones: version.project.milestones.map(milestone => ({ ...milestone, budgetMinor: minorToString(milestone.budgetMinor) })),
        // Totals are computed here, not in the browser: money arithmetic belongs on the server
        // (08-FINANCIAL-SYSTEM), and a client must never be the authority on whether a plan adds up.
        budgetTotalMinor: minorToString(budgetTotal),
        milestoneTotalMinor: minorToString(milestoneTotal),
        weightTotal: version.project.milestones.reduce((total, milestone) => total + milestone.weight, 0),
        planConsistent: budgetTotal === milestoneTotal && version.project.milestones.reduce((total, milestone) => total + milestone.weight, 0) === 100
      }
    };
  }

  /** Claiming is atomic, so two reviewers cannot decide the same submission. */
  async claim(actorId: string, versionId: string) {
    await this.contentReviewer(actorId);
    return this.db.$transaction(async tx => {
      const version = await tx.projectVersion.findUnique({ where: { id: versionId }, include: { decision: true } });
      if (!version) throw new IdentityError('not_found', 404);
      await tx.$queryRaw`SELECT id FROM projects WHERE id = ${version.projectId}::uuid FOR UPDATE`;
      const project = await tx.project.findUniqueOrThrow({ where: { id: version.projectId } });
      if (version.decision || !REVIEWABLE_STATES.includes(project.state)) throw new IdentityError('conflict', 409);
      if (project.assignedReviewerId && project.assignedReviewerId !== actorId) throw new IdentityError('conflict', 409);
      if (project.assignedReviewerId === actorId) return { versionId, state: project.state, version: project.version };
      const claimed = await tx.project.update({ where: { id: project.id }, data: { assignedReviewerId: actorId, claimedAt: new Date(), state: 'in_review', version: { increment: 1 } } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId: project.organizationId, resourceId: versionId, action: 'project.review_claimed' } });
      return { versionId, state: claimed.state, version: claimed.version };
    });
  }

  async assignReviewTask(actorId: string, versionId: string, input: { assigneeId: string; version: number }) {
    return this.db.$transaction(async tx => {
      const now = new Date();
      const [actor, actorGrant, assignee, assigneeGrant, reviewVersion] = await Promise.all([
        tx.user.findUnique({ where: { id: actorId } }),
        tx.platformGrant.findFirst({ where: { userId: actorId, role: 'PlatformAdmin', revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
        tx.user.findUnique({ where: { id: input.assigneeId } }),
        tx.platformGrant.findFirst({ where: { userId: input.assigneeId, role: 'ContentReviewer', revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
        tx.projectVersion.findUnique({ where: { id: versionId }, include: { project: true, decision: true } })
      ]);
      if (!actor || actor.status !== 'active' || !actor.twoFactorEnabled || !actorGrant) throw new IdentityError('forbidden', 403);
      if (!assignee || assignee.status !== 'active' || !assignee.twoFactorEnabled || !assigneeGrant) throw new IdentityError('invalid_input', 422);
      if (!reviewVersion || reviewVersion.decision || !REVIEWABLE_STATES.includes(reviewVersion.project.state) || reviewVersion.project.version !== input.version) throw new IdentityError('conflict', 409);
      const updated = await tx.project.updateMany({ where: { id: reviewVersion.projectId, version: input.version }, data: { assignedReviewerId: input.assigneeId, claimedAt: new Date(), state: 'in_review', version: { increment: 1 } } });
      if (updated.count !== 1) throw new IdentityError('conflict', 409);
      await tx.identityAuditEvent.create({ data: { actorId, organizationId: reviewVersion.project.organizationId, resourceId: versionId, action: 'review_task.assigned' } });
      return { id: versionId, assigneeId: input.assigneeId, projectId: reviewVersion.projectId, version: input.version + 1 };
    });
  }

  /**
   * ADM-03.A01–A03. The decision is append-only and the reviewer must be independent of the
   * organisation that submitted it: a member of the owning organisation cannot approve its work,
   * even if they also hold the platform grant.
   */
  async decide(actorId: string, versionId: string, input: { outcome: ReviewOutcome; publicReason: string; version: number }) {
    await this.contentReviewer(actorId);
    if (!['approved', 'changes_requested', 'rejected'].includes(input.outcome)) throw new IdentityError('invalid_input', 422);
    // Approving needs no public reason; refusing or returning work always does.
    const publicReason = text(input.publicReason, input.outcome === 'approved' ? 0 : 10, 1000);
    return this.db.$transaction(async tx => {
      const version = await tx.projectVersion.findUnique({ where: { id: versionId }, include: { decision: true } });
      if (!version) throw new IdentityError('not_found', 404);
      await tx.$queryRaw`SELECT id FROM projects WHERE id = ${version.projectId}::uuid FOR UPDATE`;
      const project = await tx.project.findUniqueOrThrow({ where: { id: version.projectId } });
      if (version.decision) throw new IdentityError('conflict', 409);
      if (project.state !== 'in_review' || project.assignedReviewerId !== actorId || project.version !== input.version) throw new IdentityError('conflict', 409);
      // Separation of duties on the human, not the role name (02-IDENTITY).
      const membership = await tx.membership.findUnique({ where: { userId_organizationId: { userId: actorId, organizationId: project.organizationId } } });
      if (membership) throw new IdentityError('forbidden', 403);
      if (version.submittedBy === actorId) throw new IdentityError('forbidden', 403);

      const decision = await tx.projectReviewDecision.create({ data: { projectVersionId: versionId, outcome: input.outcome, publicReason, reviewerId: actorId } });
      // Approval permits publication; it is not publication. The project is still not public.
      const nextState: ProjectState = input.outcome === 'approved' ? 'approved' : input.outcome === 'changes_requested' ? 'changes_requested' : 'rejected';
      await tx.project.update({
        where: { id: project.id },
        data: { state: nextState, stateReason: publicReason, assignedReviewerId: null, claimedAt: null, version: { increment: 1 } }
      });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId: project.organizationId, resourceId: decision.id, action: `project.${input.outcome}` } });
      return { id: decision.id, outcome: decision.outcome, publicReason: decision.publicReason, decidedAt: decision.decidedAt, state: nextState };
    });
  }

  /**
   * 05-CHARITY-LIFECYCLE: publication is the content reviewer's act, and it requires a currently
   * verified organisation, a complete plan and a funding policy. Approval alone is not enough,
   * because an organisation's verification can lapse between approval and publication.
   */
  async publish(actorId: string, projectId: string, version: number) {
    await this.contentReviewer(actorId);
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId}::uuid FOR UPDATE`;
      const project = await tx.project.findUnique({
        where: { id: projectId },
        include: { organization: true, campaign: true, budgetLines: true, milestones: true }
      });
      if (!project) throw new IdentityError('not_found', 404);
      if (project.state !== 'approved' || project.version !== version) throw new IdentityError('conflict', 409);
      const membership = await tx.membership.findUnique({ where: { userId_organizationId: { userId: actorId, organizationId: project.organizationId } } });
      if (membership) throw new IdentityError('forbidden', 403);
      if (project.organization.status !== 'active' || project.organization.verification !== 'verified') throw new IdentityError('conflict', 409);
      const readiness = new CharityService(tx as DatabaseClient).readiness({
        summary: project.summary, campaign: project.campaign,
        lineCount: project.budgetLines.length, budgetTotal: sumMinor(project.budgetLines.map(line => line.amountMinor)),
        milestones: project.milestones, milestoneTotal: sumMinor(project.milestones.map(milestone => milestone.budgetMinor))
      });
      if (!readiness.ready) throw new IdentityError('invalid_input', 422);
      const published = await tx.project.update({ where: { id: projectId }, data: { state: 'published', publishedAt: new Date(), stateReason: '', version: { increment: 1 } } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId: project.organizationId, resourceId: projectId, action: 'project.published' } });
      return { id: published.id, slug: published.slug, state: published.state, publishedAt: published.publishedAt };
    });
  }
}
