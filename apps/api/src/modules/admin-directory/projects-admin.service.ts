import type { DatabaseClient, FundingPolicy, LocationPrecision, ProjectState, ProjectType } from '@tamkeen/database';
import { IdentityError } from '../identity/policy.js';
import { IdentityService } from '../identity/identity.service.js';

/**
 * The platform admin's control of every project, in all three tracks (charity, venture,
 * enablement): its text, track, place, state and visibility; its funding goal and dates; its
 * budget and stages; its published updates; and deleting it.
 *
 * The admin goes around the organisation's workflow, not around the platform's financial rules:
 * a budget change still leaves a revision with a reason, stages that carry evidence cannot be
 * replaced, the funding policy and currency a contributor relied on cannot change after
 * publication, and a project that ever touched money cannot be deleted — it can be removed from
 * the site instead, which keeps every record. Every change leaves an audit row.
 */

const ADMIN_STATES: ProjectState[] = ['draft', 'published', 'paused', 'funding_closed', 'executing', 'impact_review', 'completed', 'archived', 'cancelled'];
/** The states that carry a publication date (projects_published_at_matches_state). */
const PUBLISHED_STATES: ProjectState[] = ['published', 'funding_closed', 'executing', 'impact_review', 'completed', 'archived', 'paused'];
const TYPES: ProjectType[] = ['charity', 'venture', 'enablement'];
const PRECISIONS: LocationPrecision[] = ['exact', 'approximate', 'city'];
const POLICIES: FundingPolicy[] = ['flexible', 'all_or_nothing'];

const minor = (value: string) => {
  if (!/^[1-9][0-9]{0,15}$/.test(value)) throw new IdentityError('invalid_input', 422);
  return BigInt(value);
};
const text = (value: string, min: number, max: number) => {
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw new IdentityError('invalid_input', 422);
  return trimmed;
};
const sum = (values: bigint[]) => values.reduce((total, value) => total + value, BigInt(0));
const CONFIRMED = ['succeeded', 'partially_refunded'] as const;

export interface ProjectChanges {
  title?: string | undefined; summary?: string | undefined; story?: string | undefined; type?: ProjectType | undefined;
  cityId?: string | undefined; publicLocationPrecision?: LocationPrecision | undefined;
  state?: ProjectState | undefined; stateReason?: string | undefined; visibility?: 'visible' | 'hidden' | 'removed' | undefined;
}

export class ProjectsAdminService {
  constructor(private readonly db: DatabaseClient) {}

  private gate(db: DatabaseClient, actorId: string) { return new IdentityService(db).platformAdministratorUser(actorId); }

  admin(actorId: string) { return this.gate(this.db, actorId); }

  /** Money-bearing records: any of these fixes a project's track and makes it undeletable. */
  private async moneyTies(db: DatabaseClient, projectId: string) {
    const [contributions, payouts, pools, agreements, programs] = await Promise.all([
      db.contribution.count({ where: { projectId } }), db.payout.count({ where: { projectId } }), db.fundingPool.count({ where: { projectId } }),
      db.agreement.count({ where: { projectId } }), db.program.count({ where: { projectId } })
    ]);
    return { contributions, payouts, pools, agreements, programs };
  }

  /**
   * Everything that stops a permanent delete: the money above, and the history the database keeps
   * append-only — review versions, budget revisions and published reports.
   */
  private async deleteBlockers(db: DatabaseClient, projectId: string) {
    const [reviewVersions, budgetRevisions, publishedReports] = await Promise.all([
      db.projectVersion.count({ where: { projectId } }),
      db.budgetRevision.count({ where: { projectId } }),
      db.projectReport.count({ where: { projectId, state: 'published' } })
    ]);
    return { ...await this.moneyTies(db, projectId), reviewVersions, budgetRevisions, publishedReports };
  }

  async list(actorId: string, filters: { type?: ProjectType | undefined; query?: string | undefined }) {
    await this.gate(this.db, actorId);
    const rows = await this.db.project.findMany({
      where: {
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.query ? { OR: [{ title: { contains: filters.query, mode: 'insensitive' } }, { slug: { contains: filters.query, mode: 'insensitive' } }, { organization: { displayName: { contains: filters.query, mode: 'insensitive' } } }] } : {})
      },
      select: {
        id: true, slug: true, title: true, summary: true, type: true, state: true, adminVisibility: true, version: true, createdAt: true, publishedAt: true,
        organization: { select: { id: true, displayName: true, status: true } }, city: { select: { nameAr: true } },
        campaign: { select: { goalMinor: true, currency: true, endsAt: true } }, cover: { select: { imageKey: true } },
        _count: { select: { contributions: true, milestones: true, updates: true } }
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 500
    });
    const raised = await this.db.contribution.groupBy({ by: ['projectId'], where: { projectId: { in: rows.map(row => row.id) }, state: { in: [...CONFIRMED] } }, _sum: { amountMinor: true, refundedMinor: true } });
    return rows.map(({ campaign, cover, _count, city, ...row }) => {
      const money = raised.find(entry => entry.projectId === row.id);
      return {
        ...row, city: city.nameAr,
        coverUrl: cover ? `/api/v1/site-media/${cover.imageKey.slice(5, 41)}` : null,
        campaign: campaign ? { goalMinor: campaign.goalMinor.toString(), currency: campaign.currency, endsAt: campaign.endsAt } : null,
        raisedMinor: ((money?._sum.amountMinor ?? BigInt(0)) - (money?._sum.refundedMinor ?? BigInt(0))).toString(),
        counts: { contributions: _count.contributions, milestones: _count.milestones, updates: _count.updates }
      };
    });
  }

  async detail(actorId: string, projectId: string) {
    await this.gate(this.db, actorId);
    const project = await this.db.project.findUnique({
      where: { id: projectId },
      select: {
        id: true, slug: true, title: true, summary: true, story: true, type: true, state: true, stateReason: true, adminVisibility: true, version: true,
        cityId: true, publicLocationPrecision: true, createdAt: true, publishedAt: true, updatedAt: true,
        organization: { select: { id: true, slug: true, displayName: true, status: true } },
        manager: { select: { name: true, email: true } },
        campaign: { select: { goalMinor: true, currency: true, policy: true, endsAt: true } },
        budgetLines: { select: { id: true, label: true, amountMinor: true }, orderBy: { sortOrder: 'asc' } },
        milestones: { select: { id: true, sequence: true, title: true, budgetMinor: true, weight: true, state: true }, orderBy: { sequence: 'asc' } },
        updates: { select: { id: true, title: true, body: true, publishedAt: true }, orderBy: { publishedAt: 'desc' } },
        cover: { select: { imageKey: true } }
      }
    });
    if (!project) throw new IdentityError('not_found', 404);
    const ties = await this.deleteBlockers(this.db, projectId);
    const raised = await this.db.contribution.aggregate({ where: { projectId, state: { in: [...CONFIRMED] } }, _sum: { amountMinor: true, refundedMinor: true } });
    const { campaign, budgetLines, milestones, cover, ...rest } = project;
    return {
      ...rest,
      coverUrl: cover ? `/api/v1/site-media/${cover.imageKey.slice(5, 41)}` : null,
      campaign: campaign ? { goalMinor: campaign.goalMinor.toString(), currency: campaign.currency, policy: campaign.policy, endsAt: campaign.endsAt } : null,
      budgetLines: budgetLines.map(line => ({ ...line, amountMinor: line.amountMinor.toString() })),
      milestones: milestones.map(stage => ({ ...stage, budgetMinor: stage.budgetMinor.toString() })),
      raisedMinor: ((raised._sum.amountMinor ?? BigInt(0)) - (raised._sum.refundedMinor ?? BigInt(0))).toString(),
      ties,
      deletable: Object.values(ties).every(count => count === 0),
      allowedStates: ADMIN_STATES
    };
  }

  async update(actorId: string, projectId: string, input: ProjectChanges & { version: number }) {
    return this.db.$transaction(async tx => {
      await this.gate(tx as DatabaseClient, actorId);
      const current = await tx.project.findUnique({ where: { id: projectId }, select: { version: true, type: true, publishedAt: true } });
      if (!current) throw new IdentityError('not_found', 404);
      if (current.version !== input.version) throw new IdentityError('conflict', 409);
      if (input.type && !TYPES.includes(input.type)) throw new IdentityError('invalid_input', 422);
      if (input.state && !ADMIN_STATES.includes(input.state)) throw new IdentityError('invalid_input', 422);
      if (input.publicLocationPrecision && !PRECISIONS.includes(input.publicLocationPrecision)) throw new IdentityError('invalid_input', 422);
      // A published project keeps its track (a database trigger enforces it), and moving one to
      // another track once money is attached would re-label that money.
      if (input.type && input.type !== current.type && (current.publishedAt || Object.values(await this.moneyTies(tx as DatabaseClient, projectId)).some(count => count > 0))) throw new IdentityError('conflict', 409);
      if (input.cityId && !await tx.city.findUnique({ where: { id: input.cityId }, select: { id: true } })) throw new IdentityError('invalid_input', 422);
      const data = {
        ...(input.title !== undefined ? { title: text(input.title, 3, 140) } : {}),
        ...(input.summary !== undefined ? { summary: text(input.summary, 0, 300) } : {}),
        ...(input.story !== undefined ? { story: text(input.story, 0, 20000) } : {}),
        ...(input.type ? { type: input.type } : {}),
        ...(input.cityId ? { cityId: input.cityId } : {}),
        ...(input.publicLocationPrecision ? { publicLocationPrecision: input.publicLocationPrecision } : {}),
        // The publication date follows the state: set on the first published-family state, kept
        // while it stays in that family, cleared for draft and cancelled.
        ...(input.state ? { state: input.state, publishedAt: PUBLISHED_STATES.includes(input.state) ? current.publishedAt ?? new Date() : null } : {}),
        ...(input.stateReason !== undefined ? { stateReason: text(input.stateReason, 0, 1000) } : {}),
        ...(input.visibility ? { adminVisibility: input.visibility } : {})
      };
      const updated = await tx.project.updateMany({ where: { id: projectId, version: input.version }, data: { ...data, version: { increment: 1 } } });
      if (updated.count !== 1) throw new IdentityError('conflict', 409);
      const action = input.visibility ? `project.admin_${input.visibility === 'visible' ? 'shown' : input.visibility}` : input.state ? `project.admin_state_${input.state}` : 'project.admin_edited';
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: projectId, action } });
    }).then(() => this.detail(actorId, projectId));
  }

  async saveCampaign(actorId: string, projectId: string, input: { version: number; goalMinor: string; currency?: string | undefined; policy?: FundingPolicy | undefined; endsAt: string }) {
    const goalMinor = minor(input.goalMinor);
    const endsAt = new Date(input.endsAt);
    if (Number.isNaN(endsAt.getTime())) throw new IdentityError('invalid_input', 422);
    if (input.policy && !POLICIES.includes(input.policy)) throw new IdentityError('invalid_input', 422);
    if (input.currency && !/^[A-Z]{3}$/.test(input.currency)) throw new IdentityError('invalid_input', 422);
    return this.db.$transaction(async tx => {
      await this.gate(tx as DatabaseClient, actorId);
      const project = await tx.project.findUnique({ where: { id: projectId }, select: { version: true, publishedAt: true } });
      if (!project) throw new IdentityError('not_found', 404);
      if (project.version !== input.version) throw new IdentityError('conflict', 409);
      const existing = await tx.campaign.findUnique({ where: { projectId } });
      // The terms a contributor relied on do not move under them.
      if (existing && project.publishedAt && ((input.policy && input.policy !== existing.policy) || (input.currency && input.currency !== existing.currency))) throw new IdentityError('conflict', 409);
      if (existing) await tx.campaign.update({ where: { projectId }, data: { goalMinor, endsAt, ...(input.policy ? { policy: input.policy } : {}), ...(input.currency ? { currency: input.currency } : {}), version: { increment: 1 } } });
      else await tx.campaign.create({ data: { projectId, goalMinor, endsAt, currency: input.currency ?? 'ILS', policy: input.policy ?? 'flexible' } });
      await tx.project.update({ where: { id: projectId }, data: { version: { increment: 1 } } });
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: projectId, action: 'campaign.admin_saved' } });
    }).then(() => this.detail(actorId, projectId));
  }

  async saveBudget(actorId: string, projectId: string, input: { version: number; reason: string; lines: Array<{ label: string; amountMinor: string }> }) {
    if (!input.lines.length || input.lines.length > 60) throw new IdentityError('invalid_input', 422);
    const lines = input.lines.map((line, index) => ({ label: text(line.label, 2, 140), amountMinor: minor(line.amountMinor), sortOrder: index }));
    return this.db.$transaction(async tx => {
      await this.gate(tx as DatabaseClient, actorId);
      const project = await tx.project.findUnique({ where: { id: projectId }, select: { version: true, publishedAt: true } });
      if (!project) throw new IdentityError('not_found', 404);
      if (project.version !== input.version) throw new IdentityError('conflict', 409);
      const reason = text(input.reason, project.publishedAt ? 10 : 0, 1000);
      const previous = await tx.budgetLine.findMany({ where: { projectId }, orderBy: { sortOrder: 'asc' } });
      if (previous.length) {
        const last = await tx.budgetRevision.findFirst({ where: { projectId }, orderBy: { sequence: 'desc' } });
        await tx.budgetRevision.create({ data: {
          projectId, sequence: (last?.sequence ?? 0) + 1, reason: `[admin] ${reason}`.slice(0, 1000), createdBy: actorId,
          totalMinor: sum(previous.map(line => line.amountMinor)),
          snapshot: previous.map(line => ({ label: line.label, amountMinor: line.amountMinor.toString(), sortOrder: line.sortOrder }))
        } });
      }
      await tx.budgetLine.deleteMany({ where: { projectId } });
      await tx.budgetLine.createMany({ data: lines.map(line => ({ ...line, projectId })) });
      await tx.project.update({ where: { id: projectId }, data: { version: { increment: 1 } } });
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: projectId, action: 'budget.admin_revised' } });
    }).then(() => this.detail(actorId, projectId));
  }

  async saveMilestones(actorId: string, projectId: string, input: { version: number; milestones: Array<{ title: string; budgetMinor: string; weight: number }> }) {
    if (!input.milestones.length || input.milestones.length > 40) throw new IdentityError('invalid_input', 422);
    const milestones = input.milestones.map((stage, index) => {
      if (!Number.isInteger(stage.weight) || stage.weight <= 0 || stage.weight > 100) throw new IdentityError('invalid_input', 422);
      return { sequence: index + 1, title: text(stage.title, 2, 140), budgetMinor: minor(stage.budgetMinor), weight: stage.weight };
    });
    // Completion is measured by weight, so the weights must describe the whole project.
    if (milestones.reduce((total, stage) => total + stage.weight, 0) !== 100) throw new IdentityError('invalid_input', 422);
    return this.db.$transaction(async tx => {
      await this.gate(tx as DatabaseClient, actorId);
      const project = await tx.project.findUnique({ where: { id: projectId }, select: { version: true } });
      if (!project) throw new IdentityError('not_found', 404);
      if (project.version !== input.version) throw new IdentityError('conflict', 409);
      // Replacing a stage that carries evidence or money would erase that evidence.
      const locked = await tx.milestone.count({ where: { projectId, OR: [{ state: { in: ['evidence_submitted', 'verified'] } }, { payouts: { some: {} } }] } });
      if (locked) throw new IdentityError('conflict', 409);
      await tx.milestone.deleteMany({ where: { projectId } });
      await tx.milestone.createMany({ data: milestones.map(stage => ({ ...stage, projectId })) });
      await tx.project.update({ where: { id: projectId }, data: { version: { increment: 1 } } });
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: projectId, action: 'milestones.admin_saved' } });
    }).then(() => this.detail(actorId, projectId));
  }

  async editUpdate(actorId: string, projectId: string, updateId: string, input: { title: string; body: string }) {
    return this.db.$transaction(async tx => {
      await this.gate(tx as DatabaseClient, actorId);
      const changed = await tx.projectUpdate.updateMany({ where: { id: updateId, projectId }, data: { title: text(input.title, 2, 140), body: text(input.body, 2, 20000) } });
      if (!changed.count) throw new IdentityError('not_found', 404);
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: updateId, action: 'project_update.admin_edited' } });
    }).then(() => this.detail(actorId, projectId));
  }

  async deleteUpdate(actorId: string, projectId: string, updateId: string) {
    return this.db.$transaction(async tx => {
      await this.gate(tx as DatabaseClient, actorId);
      const removed = await tx.projectUpdate.deleteMany({ where: { id: updateId, projectId } });
      if (!removed.count) throw new IdentityError('not_found', 404);
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: updateId, action: 'project_update.admin_deleted' } });
    }).then(() => this.detail(actorId, projectId));
  }

  /**
   * Deletes a project that never touched money and was never submitted for review, with its
   * budget, stages, updates and reports. Anything else refuses with 409: remove it from the site
   * instead, which hides it everywhere and keeps its records.
   */
  async remove(actorId: string, projectId: string) {
    try {
      return await this.db.$transaction(async tx => {
        await this.gate(tx as DatabaseClient, actorId);
        const project = await tx.project.findUnique({ where: { id: projectId }, select: { id: true } });
        if (!project) throw new IdentityError('not_found', 404);
        if (Object.values(await this.deleteBlockers(tx as DatabaseClient, projectId)).some(count => count > 0)) throw new IdentityError('conflict', 409);
        await tx.projectReport.deleteMany({ where: { projectId } });
        await tx.projectUpdate.deleteMany({ where: { projectId } });
        await tx.milestone.deleteMany({ where: { projectId } });
        await tx.budgetLine.deleteMany({ where: { projectId } });
        await tx.campaign.deleteMany({ where: { projectId } });
        await tx.project.delete({ where: { id: projectId } });
        await tx.identityAuditEvent.create({ data: { actorId, resourceId: projectId, action: 'project.admin_deleted' } });
        return { id: projectId, deleted: true as const };
      });
    } catch (error) {
      if (error instanceof IdentityError) throw error;
      // A record this service does not know about still points at the project (or a table is
      // append-only by trigger): refuse rather than half-delete.
      throw new IdentityError('conflict', 409);
    }
  }
}
