import type { DatabaseClient } from '@tamkeen/database';
import { IdentityError } from '../identity/policy.js';
import { IdentityService } from '../identity/identity.service.js';
import { CURRENT_TERMS_VERSION } from '@tamkeen/config';

const activeGrant = (now = new Date()) => ({ revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] });

export class OperationsService {
  private readonly identity: IdentityService;
  constructor(private readonly db: DatabaseClient) { this.identity = new IdentityService(db); }

  private async platform(actorId: string, roles: Array<'Support' | 'RiskReviewer' | 'PlatformAdmin' | 'Auditor' | 'Operations'>) {
    const grant = await this.db.platformGrant.findFirst({ where: { userId: actorId, role: { in: roles }, ...activeGrant() } });
    if (!grant) throw new IdentityError('forbidden', 403);
  }

  async createTicket(actorId: string | null, input: { requesterEmail?: string | undefined; organizationId?: string | undefined; subjectType: string; subjectId?: string | undefined; category: string; title: string; body: string }) {
    if (!actorId && !input.requesterEmail) throw new IdentityError('invalid_input', 422);
    const reference = `TKT-${crypto.randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
    return this.db.$transaction(async tx => {
      const ticket = await tx.supportTicket.create({ data: {
        reference, requesterId: actorId, requesterEmail: input.requesterEmail ?? null,
        organizationId: input.organizationId ?? null, subjectType: input.subjectType,
        subjectId: input.subjectId ?? null, category: input.category, title: input.title
      } });
      if (actorId) await tx.supportTicketReply.create({ data: { ticketId: ticket.id, authorId: actorId, authorKind: 'requester', body: input.body } });
      return { ...ticket, private: true, financialRightsChanged: false };
    });
  }

  async mine(actorId: string) {
    return this.db.supportTicket.findMany({ where: { requesterId: actorId }, select: { id: true, reference: true, category: true, title: true, state: true, priority: true, nextActionAt: true, updatedAt: true, version: true }, orderBy: { updatedAt: 'desc' } });
  }

  async get(actorId: string, id: string) {
    const support = await this.db.platformGrant.count({ where: { userId: actorId, role: { in: ['Support', 'RiskReviewer', 'PlatformAdmin'] }, ...activeGrant() } });
    const ticket = await this.db.supportTicket.findUnique({ where: { id }, include: { replies: { where: support ? {} : { internal: false }, orderBy: { createdAt: 'asc' } } } });
    if (!ticket || (!support && ticket.requesterId !== actorId)) throw new IdentityError('not_found', 404);
    return ticket;
  }

  async reply(actorId: string, id: string, body: string) {
    const ticket = await this.get(actorId, id);
    if (ticket.state === 'closed') throw new IdentityError('conflict', 409);
    const isRequester = ticket.requesterId === actorId;
    if (!isRequester) await this.platform(actorId, ['Support', 'RiskReviewer', 'PlatformAdmin']);
    return this.db.$transaction(async tx => {
      const reply = await tx.supportTicketReply.create({ data: { ticketId: id, authorId: actorId, authorKind: isRequester ? 'requester' : 'staff', body } });
      await tx.supportTicket.update({ where: { id }, data: { state: isRequester ? 'awaiting_internal' : 'awaiting_user', version: { increment: 1 } } });
      return reply;
    });
  }

  async reopen(actorId: string, id: string, reason: string, version: number) {
    const ticket = await this.get(actorId, id);
    if (ticket.requesterId !== actorId || !['resolved', 'closed'].includes(ticket.state) || ticket.version !== version) throw new IdentityError('conflict', 409);
    return this.db.$transaction(async tx => {
      await tx.supportTicketReply.create({ data: { ticketId: id, authorId: actorId, authorKind: 'requester', body: reason } });
      return tx.supportTicket.update({ where: { id }, data: { state: 'open', resolutionCode: '', resolution: '', resolvedAt: null, closedAt: null, version: { increment: 1 } } });
    });
  }

  async confirmResolution(actorId: string, id: string, version: number) {
    const ticket = await this.get(actorId, id);
    if (ticket.requesterId !== actorId || ticket.state !== 'resolved' || ticket.version !== version) throw new IdentityError('conflict', 409);
    return this.db.supportTicket.update({ where: { id }, data: { state: 'closed', closedAt: new Date(), version: { increment: 1 } } });
  }

  async queue(actorId: string) {
    await this.platform(actorId, ['Support', 'RiskReviewer', 'PlatformAdmin']);
    return this.db.supportTicket.findMany({ where: { state: { not: 'closed' } }, select: { id: true, reference: true, category: true, subjectType: true, state: true, priority: true, assigneeId: true, nextActionAt: true, createdAt: true, version: true }, orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }] });
  }

  async claim(actorId: string, id: string, version: number) {
    await this.platform(actorId, ['Support', 'RiskReviewer', 'PlatformAdmin']);
    const updated = await this.db.supportTicket.updateMany({ where: { id, assigneeId: null, version }, data: { assigneeId: actorId, state: 'assigned', version: { increment: 1 } } });
    if (updated.count !== 1) throw new IdentityError('conflict', 409);
    return this.db.supportTicket.findUniqueOrThrow({ where: { id } });
  }

  async escalate(actorId: string, id: string, input: { priority: 'high' | 'urgent'; nextActionAt: Date; version: number }) {
    await this.platform(actorId, ['Support', 'RiskReviewer', 'PlatformAdmin']);
    const ticket = await this.db.supportTicket.findUnique({ where: { id } });
    if (!ticket || ticket.version !== input.version) throw new IdentityError('conflict', 409);
    return this.db.supportTicket.update({ where: { id }, data: { priority: input.priority, nextActionAt: input.nextActionAt, state: 'awaiting_internal', version: { increment: 1 } } });
  }

  async resolve(actorId: string, id: string, input: { resolutionCode: string; resolution: string; version: number }) {
    await this.platform(actorId, ['Support', 'RiskReviewer', 'PlatformAdmin']);
    const ticket = await this.db.supportTicket.findUnique({ where: { id } });
    if (!ticket || ticket.version !== input.version || ticket.state === 'closed') throw new IdentityError('conflict', 409);
    return this.db.supportTicket.update({ where: { id }, data: { ...input, state: 'resolved', resolvedAt: new Date(), version: { increment: 1 } } });
  }

  async notifications(actorId: string) {
    return this.db.userNotification.findMany({ where: { recipientId: actorId }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  async notificationPreferences(actorId: string) {
    return this.db.notificationPreference.upsert({
      where: { userId: actorId }, create: { userId: actorId }, update: {},
      select: { emailReminders: true, emailFollowUpdates: true, version: true, updatedAt: true }
    });
  }

  async updateNotificationPreferences(actorId: string, input: { emailReminders: boolean; emailFollowUpdates: boolean; version: number }) {
    await this.notificationPreferences(actorId);
    const updated = await this.db.notificationPreference.updateMany({ where: { userId: actorId, version: input.version }, data: { emailReminders: input.emailReminders, emailFollowUpdates: input.emailFollowUpdates, version: { increment: 1 } } });
    if (!updated.count) throw new IdentityError('conflict', 409);
    return this.notificationPreferences(actorId);
  }

  async follow(actorId: string, input: { subjectType: 'organization' | 'project'; subjectId?: string | undefined; subjectSlug?: string | undefined }) {
    const subjectId = input.subjectId ?? (input.subjectType === 'organization'
      ? (await this.db.organization.findFirst({ where: { slug: input.subjectSlug!, status: 'active' }, select: { id: true } }))?.id
      : (await this.db.project.findFirst({ where: { slug: input.subjectSlug!, state: { in: ['published', 'funding_closed', 'executing', 'impact_review', 'completed', 'paused'] } }, select: { id: true } }))?.id);
    if (!subjectId) throw new IdentityError('not_found', 404);
    const key = { followerId: actorId, subjectType: input.subjectType, subjectId };
    return this.db.follow.upsert({
      where: { followerId_subjectType_subjectId: key }, create: key, update: {}
    });
  }

  async follows(actorId: string) {
    return this.db.follow.findMany({ where: { followerId: actorId }, orderBy: { createdAt: 'desc' } });
  }

  async unfollow(actorId: string, id: string) {
    const removed = await this.db.follow.deleteMany({ where: { id, followerId: actorId } });
    if (!removed.count) throw new IdentityError('not_found', 404);
    return { id, removed: true };
  }

  async readNotification(actorId: string, id: string) {
    const updated = await this.db.userNotification.updateMany({ where: { id, recipientId: actorId }, data: { readAt: new Date() } });
    if (!updated.count) throw new IdentityError('not_found', 404);
    return this.db.userNotification.findUniqueOrThrow({ where: { id } });
  }

  async readAll(actorId: string, through: Date) {
    const result = await this.db.userNotification.updateMany({ where: { recipientId: actorId, readAt: null, createdAt: { lte: through } }, data: { readAt: new Date() } });
    return { read: result.count, through };
  }

  async audit(actorId: string, input: { organizationId?: string | undefined; action?: string | undefined; take: number }) {
    await this.platform(actorId, ['Auditor', 'PlatformAdmin']);
    const where = { ...(input.organizationId ? { organizationId: input.organizationId } : {}), ...(input.action ? { action: input.action } : {}) };
    const rows = await this.db.identityAuditEvent.findMany({ where, orderBy: { createdAt: 'desc' }, take: input.take });
    return rows.map(row => ({ id: row.id, actorId: row.actorId, organizationId: row.organizationId, action: row.action, resourceId: row.resourceId, createdAt: row.createdAt, redacted: true }));
  }

  async auditEvent(actorId: string, id: string) {
    await this.platform(actorId, ['Auditor', 'PlatformAdmin']);
    const row = await this.db.identityAuditEvent.findUnique({ where: { id } });
    if (!row) throw new IdentityError('not_found', 404);
    return { id: row.id, actorId: row.actorId, organizationId: row.organizationId, action: row.action, resourceId: row.resourceId, createdAt: row.createdAt, redacted: true };
  }

  async requestAuditExport(actorId: string, input: { reason: string; organizationId?: string | undefined; action?: string | undefined }) {
    await this.platform(actorId, ['Auditor', 'PlatformAdmin']);
    return this.db.exportJob.create({ data: { ownerId: actorId, kind: 'audit_csv', reason: input.reason, scope: { organizationId: input.organizationId ?? null, action: input.action ?? null } } });
  }

  async requestPersonalExport(actorId: string, kind: 'contributions_csv' | 'investments_csv') {
    const user = await this.db.user.findFirst({ where: { id: actorId, status: 'active' }, select: { id: true } });
    if (!user) throw new IdentityError('forbidden', 403);
    return this.db.exportJob.create({
      data: { ownerId: actorId, kind, scope: { ownerId: actorId }, reason: 'User-requested private account statement.' }
    });
  }

  async createDataExportChallenge(actorId: string, sessionId: string) {
    const user = await this.db.user.findFirst({ where: { id: actorId, status: 'active', twoFactorEnabled: true }, select: { id: true, platformAccessVersion: true } });
    if (!user) throw new IdentityError('forbidden', 403);
    await this.db.mfaChallenge.updateMany({ where: { userId: actorId, sessionId, operation: 'account.data_export', state: { in: ['pending', 'verified'] } }, data: { state: 'cancelled' } });
    return this.db.mfaChallenge.create({ data: { userId: actorId, sessionId, operation: 'account.data_export', resourceId: actorId, resourceVersion: user.platformAccessVersion, expiresAt: new Date(Date.now() + 5 * 60_000) }, select: { id: true, state: true, expiresAt: true } });
  }

  async requestDataExport(actorId: string, sessionId: string, challengeId: string) {
    return this.db.$transaction(async tx => {
      const user = await tx.user.findFirst({ where: { id: actorId, status: 'active', twoFactorEnabled: true }, select: { platformAccessVersion: true } });
      if (!user) throw new IdentityError('forbidden', 403);
      const consumed = await tx.mfaChallenge.updateMany({ where: { id: challengeId, userId: actorId, sessionId, operation: 'account.data_export', resourceId: actorId, resourceVersion: user.platformAccessVersion, state: 'verified', consumedAt: null, expiresAt: { gt: new Date() } }, data: { state: 'consumed', consumedAt: new Date() } });
      if (!consumed.count) throw new IdentityError('mfa_unavailable', 409);
      return tx.exportJob.create({ data: { ownerId: actorId, kind: 'account_data_json', scope: { ownerId: actorId }, reason: 'Re-authenticated personal data export.' } });
    });
  }

  async requestOrganizationExport(actorId: string, organizationId: string, projectId: string, kind: 'organization_contributions_csv' | 'organization_ledger_csv') {
    await this.identity.access(actorId, organizationId, 'finance.export');
    const project = await this.db.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true } });
    if (!project) throw new IdentityError('not_found', 404);
    return this.db.exportJob.create({ data: { ownerId: actorId, kind, scope: { organizationId, projectId }, reason: 'Authorized organization finance snapshot.' } });
  }

  async requestAllocationExport(actorId: string, organizationId: string, offeringId: string) {
    await this.identity.access(actorId, organizationId, 'investment.export');
    const offering = await this.db.offering.count({ where: { id: offeringId, organizationId } });
    if (!offering) throw new IdentityError('not_found', 404);
    return this.db.exportJob.create({ data: { ownerId: actorId, kind: 'allocation_book_csv', scope: { organizationId, offeringId }, reason: 'Authorized allocation book snapshot.' } });
  }

  async requestApplicationExport(actorId: string, organizationId: string, applicationId?: string) {
    await this.identity.access(actorId, organizationId, 'candidate.export');
    if (applicationId) {
      const exists = await this.db.application.count({ where: { id: applicationId, program: { organizationId } } });
      if (!exists) throw new IdentityError('not_found', 404);
    }
    return this.db.exportJob.create({ data: { ownerId: actorId, kind: 'applications_csv', scope: { organizationId, applicationId: applicationId ?? null }, reason: 'Authorized consent-aware candidate snapshot.' } });
  }

  async exportJob(actorId: string, id: string) {
    const job = await this.db.exportJob.findFirst({ where: { id, ownerId: actorId } });
    if (!job) throw new IdentityError('not_found', 404);
    if (job.state === 'ready' && job.expiresAt && job.expiresAt <= new Date()) return this.db.exportJob.update({ where: { id }, data: { state: 'expired', version: { increment: 1 } } });
    return job;
  }

  async downloadExport(actorId: string, id: string) {
    const job = await this.exportJob(actorId, id);
    if (job.state !== 'ready' || !job.expiresAt || job.expiresAt <= new Date() || job.revokedAt) throw new IdentityError('conflict', 409);
    return { filename: job.filename, mimeType: job.mimeType, content: job.content, expiresAt: job.expiresAt };
  }

  async revokeExport(actorId: string, id: string, version: number) {
    const job = await this.exportJob(actorId, id);
    if (job.version !== version || !['ready', 'failed', 'expired'].includes(job.state)) throw new IdentityError('conflict', 409);
    return this.db.exportJob.update({ where: { id }, data: { state: 'revoked', revokedAt: new Date(), content: '', version: { increment: 1 } } });
  }

  async regenerateExport(actorId: string, id: string) {
    const job = await this.exportJob(actorId, id);
    if (!['failed', 'expired'].includes(job.state)) throw new IdentityError('conflict', 409);
    if (job.kind === 'audit_csv') await this.platform(actorId, ['Auditor', 'PlatformAdmin']);
    if (['contributions_csv', 'investments_csv'].includes(job.kind)) {
      const active = await this.db.user.count({ where: { id: actorId, status: 'active' } });
      if (!active) throw new IdentityError('forbidden', 403);
    }
    if (job.kind === 'account_data_json') throw new IdentityError('conflict', 409);
    if (['organization_contributions_csv', 'organization_ledger_csv'].includes(job.kind)) {
      const scope = job.scope as { organizationId?: string; projectId?: string };
      if (!scope.organizationId || !scope.projectId) throw new IdentityError('conflict', 409);
      await this.identity.access(actorId, scope.organizationId, 'finance.export');
    }
    if (job.kind === 'allocation_book_csv') {
      const scope = job.scope as { organizationId?: string };
      if (!scope.organizationId) throw new IdentityError('conflict', 409);
      await this.identity.access(actorId, scope.organizationId, 'investment.export');
    }
    if (job.kind === 'applications_csv') {
      const scope = job.scope as { organizationId?: string };
      if (!scope.organizationId) throw new IdentityError('conflict', 409);
      await this.identity.access(actorId, scope.organizationId, 'candidate.export');
    }
    return this.db.exportJob.create({ data: { ownerId: actorId, kind: job.kind, scope: job.scope as object, reason: job.reason } });
  }

  async publicReports(organizationSlug?: string) {
    let sourceIds: string[] | undefined;
    if (organizationSlug) {
      const sources = await this.db.projectReport.findMany({
        where: { project: { organization: { slug: organizationSlug, status: 'active' } }, state: 'published' },
        select: { id: true }
      });
      sourceIds = sources.map(source => source.id);
      if (!sourceIds.length) return [];
    }
    return this.db.publicReport.findMany({
      ...(sourceIds ? { where: { sourceType: 'project_report', sourceId: { in: sourceIds } } } : {}),
      select: { id: true, title: true, sourceType: true, sourceId: true, version: true, currency: true, periodStart: true, periodEnd: true, filterDefinition: true, publishedAt: true },
      orderBy: { publishedAt: 'desc' }, take: 100
    });
  }
  async publicReport(id: string) { const report = await this.db.publicReport.findUnique({ where: { id } }); if (!report) throw new IdentityError('not_found', 404); return report; }

  policyVersion(slug: string, version: string) {
    if (slug !== 'terms' || version !== CURRENT_TERMS_VERSION) throw new IdentityError('not_found', 404);
    const content = `# Tamkeen local preview terms\n\nVersion: ${CURRENT_TERMS_VERSION}\n\nThis local development build moves no real money, sends no external email, and creates no legal ownership. Financial and investment records are explicitly simulated. Operational notifications, audit history, and published snapshots may be retained to preserve accountability.`;
    return { slug, version, publishedAt: '2026-09-16T00:00:00.000Z', filename: `tamkeen-terms-${version}.md`, mimeType: 'text/markdown; charset=utf-8', content };
  }

  async operationsOverview(actorId: string) {
    await this.platform(actorId, ['Operations', 'PlatformAdmin']);
    const now = new Date();
    const [notificationsPending, notificationsDead, exportsPending, exportsFailed, incidentsOpen, heartbeat] = await Promise.all([
      this.db.notificationOutbox.count({ where: { state: { in: ['pending', 'failed'] } } }), this.db.notificationOutbox.count({ where: { state: 'dead_letter' } }),
      this.db.exportJob.count({ where: { state: { in: ['pending', 'processing'] } } }), this.db.exportJob.count({ where: { state: 'failed' } }),
      this.db.operationalIncident.count({ where: { state: 'open' } }), this.db.workerHeartbeat.findUnique({ where: { workerId: 'foundation-worker' } })
    ]);
    return { asOf: now, notificationsPending, notificationsDead, exportsPending, exportsFailed, incidentsOpen, workerLastSeen: heartbeat?.lastSeen ?? null };
  }

  async retryOperationalJob(actorId: string, id: string, kind: 'notification' | 'export') {
    await this.platform(actorId, ['Operations', 'PlatformAdmin']);
    if (kind === 'notification') {
      const row = await this.db.notificationOutbox.findUnique({ where: { id } });
      if (!row || !['failed', 'dead_letter'].includes(row.state)) throw new IdentityError('conflict', 409);
      return this.db.notificationOutbox.update({ where: { id }, data: { state: 'pending', nextAttemptAt: new Date(), lastErrorCode: '' } });
    }
    const row = await this.db.exportJob.findUnique({ where: { id } });
    if (!row || row.state !== 'failed') throw new IdentityError('conflict', 409);
    return this.db.exportJob.update({ where: { id }, data: { state: 'pending', nextAttemptAt: new Date(), lastErrorCode: '', version: { increment: 1 } } });
  }

  async incident(actorId: string, id: string) { await this.platform(actorId, ['Operations', 'PlatformAdmin']); const row = await this.db.operationalIncident.findUnique({ where: { id } }); if (!row) throw new IdentityError('not_found', 404); return row; }
  async requestFlagChange(actorId: string, flag: string, desired: boolean, reasonText: string) { await this.platform(actorId, ['PlatformAdmin']); if (!['MONEY_ENABLED', 'INVESTMENT_ENABLED'].includes(flag)) throw new IdentityError('invalid_input', 422); return this.db.featureFlagChangeRequest.create({ data: { flag, desired, reason: reasonText, requestedBy: actorId } }); }
  async recordRestoreDrill(actorId: string, input: { environment: string; evidenceRef: string; measuredRpoMins: number; measuredRtoMins: number; outcome: string; notes: string; performedAt: Date }) { await this.platform(actorId, ['Operations', 'PlatformAdmin']); return this.db.restoreDrill.create({ data: { ...input, performedBy: actorId } }); }

  async freeze(actorId: string, subjectId: string, input: { subjectType: string; scope: 'collect' | 'payout' | 'publish'; reason: string }) {
    await this.platform(actorId, ['RiskReviewer', 'PlatformAdmin']);
    return this.db.subjectFreeze.create({ data: { subjectId, ...input, frozenBy: actorId } });
  }

  async unfreeze(actorId: string, subjectId: string, input: { freezeId: string; reason: string; version: number }) {
    await this.platform(actorId, ['RiskReviewer', 'PlatformAdmin']);
    const freeze = await this.db.subjectFreeze.findUnique({ where: { id: input.freezeId } });
    if (!freeze || freeze.subjectId !== subjectId || freeze.unfrozenAt || freeze.version !== input.version || freeze.frozenBy === actorId) throw new IdentityError('conflict', 409);
    return this.db.subjectFreeze.update({ where: { id: freeze.id }, data: { unfrozenBy: actorId, unfrozenAt: new Date(), unfreezeReason: input.reason, version: { increment: 1 } } });
  }
}
