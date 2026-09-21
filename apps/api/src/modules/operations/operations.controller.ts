import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { IDENTITY_RUNTIME, type IdentityRuntime } from '../identity/identity.controller.js';
import { sessionFrom } from '../identity/session.js';
import { IdentityError } from '../identity/policy.js';
import { OperationsService } from './operations.service.js';

const uuid = z.string().uuid();
const version = z.number().int().positive();
const reason = z.string().trim().min(10).max(2000);
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => { const result = schema.safeParse(value); if (!result.success) throw new IdentityError('invalid_input', 422); return result.data; };

@Controller()
export class OperationsController {
  private readonly operations: OperationsService;
  constructor(@Inject(IDENTITY_RUNTIME) private readonly runtime: IdentityRuntime) { this.operations = new OperationsService(runtime.db); }
  private session(req: IncomingMessage) { return sessionFrom(this.runtime, req); }

  @Post('tickets') async create(@Req() req: IncomingMessage, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ organizationId: uuid.optional(), subjectType: z.string().trim().min(2).max(40), subjectId: uuid.optional(), category: z.string().trim().min(2).max(40), title: z.string().trim().min(5).max(200), body: reason }).strict(), body);
    return { data: await this.operations.createTicket(session.user.id, input) };
  }
  @Get('me/tickets') async mine(@Req() req: IncomingMessage) { const s = await this.session(req); return { data: await this.operations.mine(s.user.id) }; }
  @Get('tickets/:id') async get(@Req() req: IncomingMessage, @Param('id') id: string) { const s = await this.session(req); return { data: await this.operations.get(s.user.id, uuid.parse(id)) }; }
  @Post('tickets/:id/replies') async reply(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) { const s = await this.session(req); const input = parse(z.object({ body: z.string().trim().min(2).max(4000) }).strict(), body); return { data: await this.operations.reply(s.user.id, uuid.parse(id), input.body) }; }
  @Post('tickets/:id/reopen') @HttpCode(200) async reopen(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) { const s = await this.session(req); const input = parse(z.object({ reason, version }).strict(), body); return { data: await this.operations.reopen(s.user.id, uuid.parse(id), input.reason, input.version) }; }
  @Post('tickets/:id/confirm-resolution') @HttpCode(200) async confirm(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) { const s = await this.session(req); const input = parse(z.object({ version }).strict(), body); return { data: await this.operations.confirmResolution(s.user.id, uuid.parse(id), input.version) }; }

  @Get('me/notifications') async notifications(@Req() req: IncomingMessage) { const s = await this.session(req); return { data: await this.operations.notifications(s.user.id) }; }
  @Get('me/notification-preferences') async notificationPreferences(@Req() req: IncomingMessage) { const s = await this.session(req); return { data: await this.operations.notificationPreferences(s.user.id) }; }
  @Post('me/notification-preferences') @HttpCode(200) async updateNotificationPreferences(@Req() req: IncomingMessage, @Body() body: unknown) { const s = await this.session(req); const input = parse(z.object({ emailReminders: z.boolean(), emailFollowUpdates: z.boolean(), version }).strict(), body); return { data: await this.operations.updateNotificationPreferences(s.user.id, input) }; }
  @Post('notifications/:id/read') @HttpCode(200) async read(@Req() req: IncomingMessage, @Param('id') id: string) { const s = await this.session(req); return { data: await this.operations.readNotification(s.user.id, uuid.parse(id)) }; }
  @Post('me/notifications/read-all') @HttpCode(200) async readAll(@Req() req: IncomingMessage, @Body() body: unknown) { const s = await this.session(req); const input = parse(z.object({ through: z.coerce.date() }).strict(), body); return { data: await this.operations.readAll(s.user.id, input.through) }; }
  @Post('follows') async follow(@Req() req: IncomingMessage, @Body() body: unknown) { const s = await this.session(req); const input = parse(z.object({ subjectType: z.enum(['organization', 'project']), subjectId: uuid.optional(), subjectSlug: z.string().trim().min(1).max(90).optional() }).strict().refine(value => Boolean(value.subjectId) !== Boolean(value.subjectSlug)), body); return { data: await this.operations.follow(s.user.id, input) }; }
  @Get('me/follows') async follows(@Req() req: IncomingMessage) { const s = await this.session(req); return { data: await this.operations.follows(s.user.id) }; }
  @Delete('follows/:id') async unfollow(@Req() req: IncomingMessage, @Param('id') id: string) { const s = await this.session(req); return { data: await this.operations.unfollow(s.user.id, uuid.parse(id)) }; }

  @Get('admin/tickets') async queue(@Req() req: IncomingMessage) { const s = await this.session(req); return { data: await this.operations.queue(s.user.id) }; }
  @Post('admin/tickets/:id/claim') @HttpCode(200) async claim(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) { const s = await this.session(req); const input = parse(z.object({ version }).strict(), body); return { data: await this.operations.claim(s.user.id, uuid.parse(id), input.version) }; }
  @Post('admin/tickets/:id/escalate') @HttpCode(200) async escalate(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) { const s = await this.session(req); const input = parse(z.object({ priority: z.enum(['high', 'urgent']), nextActionAt: z.coerce.date(), version }).strict(), body); return { data: await this.operations.escalate(s.user.id, uuid.parse(id), input) }; }
  @Post('admin/tickets/:id/resolve') @HttpCode(200) async resolve(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) { const s = await this.session(req); const input = parse(z.object({ resolutionCode: z.string().trim().min(2).max(50), resolution: reason, version }).strict(), body); return { data: await this.operations.resolve(s.user.id, uuid.parse(id), input) }; }
  @Get('admin/audit') async audit(@Req() req: IncomingMessage, @Query('organizationId') organizationId?: string, @Query('action') action?: string, @Query('take') take?: string) { const s = await this.session(req); const input = parse(z.object({ organizationId: uuid.optional(), action: z.string().max(64).optional(), take: z.coerce.number().int().min(1).max(200).default(50) }).strict(), { organizationId: organizationId || undefined, action: action || undefined, take: take || 50 }); return { data: await this.operations.audit(s.user.id, input) }; }
  @Get('admin/audit/:id') async auditEvent(@Req() req: IncomingMessage, @Param('id') id: string) { const s = await this.session(req); return { data: await this.operations.auditEvent(s.user.id, uuid.parse(id)) }; }
  @Post('admin/audit-exports') async auditExport(@Req() req: IncomingMessage, @Body() body: unknown) { const s = await this.session(req); const input = parse(z.object({ reason, organizationId: uuid.optional(), action: z.string().trim().max(64).optional() }).strict(), body); return { data: await this.operations.requestAuditExport(s.user.id, input) }; }
  @Post('me/contribution-exports') async contributionExport(@Req() req: IncomingMessage) { const s = await this.session(req); return { data: await this.operations.requestPersonalExport(s.user.id, 'contributions_csv') }; }
  @Post('me/investment-exports') async investmentExport(@Req() req: IncomingMessage) { const s = await this.session(req); return { data: await this.operations.requestPersonalExport(s.user.id, 'investments_csv') }; }
  @Post('me/data-exports/challenge') async dataExportChallenge(@Req() req: IncomingMessage) { const s = await this.session(req); return { data: await this.operations.createDataExportChallenge(s.user.id, s.session.id) }; }
  @Post('me/data-exports') async dataExport(@Req() req: IncomingMessage, @Body() body: unknown) { const s = await this.session(req); const input = parse(z.object({ mfaChallengeId: uuid }).strict(), body); return { data: await this.operations.requestDataExport(s.user.id, s.session.id, input.mfaChallengeId) }; }
  @Post('orgs/:id/contribution-exports') async organizationContributionExport(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) { const s = await this.session(req); const input = parse(z.object({ projectId: uuid }).strict(), body); return { data: await this.operations.requestOrganizationExport(s.user.id, uuid.parse(id), input.projectId, 'organization_contributions_csv') }; }
  @Post('orgs/:id/ledger-exports') async organizationLedgerExport(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) { const s = await this.session(req); const input = parse(z.object({ projectId: uuid }).strict(), body); return { data: await this.operations.requestOrganizationExport(s.user.id, uuid.parse(id), input.projectId, 'organization_ledger_csv') }; }
  @Post('orgs/:id/offerings/:oid/allocation-exports') async allocationExport(@Req() req: IncomingMessage, @Param('id') id: string, @Param('oid') oid: string) { const s = await this.session(req); return { data: await this.operations.requestAllocationExport(s.user.id, uuid.parse(id), uuid.parse(oid)) }; }
  @Post('orgs/:id/application-exports') async applicationExport(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) { const s = await this.session(req); const input = parse(z.object({ applicationId: uuid.optional() }).strict(), body ?? {}); return { data: await this.operations.requestApplicationExport(s.user.id, uuid.parse(id), input.applicationId) }; }
  @Get('exports/:id') async exportJob(@Req() req: IncomingMessage, @Param('id') id: string) { const s = await this.session(req); return { data: await this.operations.exportJob(s.user.id, uuid.parse(id)) }; }
  @Get('exports/:id/download') async downloadExport(@Req() req: IncomingMessage, @Param('id') id: string) { const s = await this.session(req); return { data: await this.operations.downloadExport(s.user.id, uuid.parse(id)) }; }
  @Post('exports/:id/regenerate') async regenerateExport(@Req() req: IncomingMessage, @Param('id') id: string) { const s = await this.session(req); return { data: await this.operations.regenerateExport(s.user.id, uuid.parse(id)) }; }
  @Post('exports/:id/revoke') @HttpCode(200) async revokeExport(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) { const s = await this.session(req); const input = parse(z.object({ version }).strict(), body); return { data: await this.operations.revokeExport(s.user.id, uuid.parse(id), input.version) }; }
  @Get('public-reports') async publicReports(@Query('organizationSlug') organizationSlug?: string) {
    const slug = organizationSlug ? parse(z.string().trim().min(1).max(90).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), organizationSlug) : undefined;
    return { data: await this.operations.publicReports(slug) };
  }
  @Get('public-reports/:id') async publicReport(@Param('id') id: string) { return { data: await this.operations.publicReport(uuid.parse(id)) }; }
  @Get('public-reports/:id/download') async publicReportDownload(@Param('id') id: string) { const report = await this.operations.publicReport(uuid.parse(id)); return { data: { filename: `impact-report-${report.id}.json`, mimeType: 'application/json', content: JSON.stringify(report.snapshot), publishedAt: report.publishedAt } }; }
  @Get('policies/:slug/versions/:version') async policyVersion(@Param('slug') slug: string, @Param('version') policyVersion: string) { return { data: this.operations.policyVersion(slug, policyVersion) }; }
  @Get('admin/operations') async operationsOverview(@Req() req: IncomingMessage) { const s = await this.session(req); return { data: await this.operations.operationsOverview(s.user.id) }; }
  @Post('admin/jobs/:id/retry') @HttpCode(200) async retryJob(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) { const s = await this.session(req); const input = parse(z.object({ kind: z.enum(['notification', 'export']) }).strict(), body); return { data: await this.operations.retryOperationalJob(s.user.id, uuid.parse(id), input.kind) }; }
  @Get('admin/incidents/:id') async incident(@Req() req: IncomingMessage, @Param('id') id: string) { const s = await this.session(req); return { data: await this.operations.incident(s.user.id, uuid.parse(id)) }; }
  @Post('admin/feature-flags/:id/change-requests') async flagChange(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) { const s = await this.session(req); const input = parse(z.object({ desired: z.boolean(), reason }).strict(), body); return { data: await this.operations.requestFlagChange(s.user.id, id, input.desired, input.reason) }; }
  @Post('admin/restore-drills') async restoreDrill(@Req() req: IncomingMessage, @Body() body: unknown) { const s = await this.session(req); const input = parse(z.object({ environment: z.string().trim().min(2).max(40), evidenceRef: z.string().trim().min(3).max(500), measuredRpoMins: z.number().int().nonnegative(), measuredRtoMins: z.number().int().nonnegative(), outcome: z.enum(['passed', 'failed', 'partial']), notes: z.string().trim().max(2000).default(''), performedAt: z.coerce.date() }).strict(), body); return { data: await this.operations.recordRestoreDrill(s.user.id, input) }; }
  @Post('admin/subjects/:id/freeze') async freeze(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) { const s = await this.session(req); const input = parse(z.object({ subjectType: z.string().trim().min(2).max(40), scope: z.enum(['collect', 'payout', 'publish']), reason }).strict(), body); return { data: await this.operations.freeze(s.user.id, uuid.parse(id), input) }; }
  @Post('admin/subjects/:id/unfreeze') @HttpCode(200) async unfreeze(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) { const s = await this.session(req); const input = parse(z.object({ freezeId: uuid, reason, version }).strict(), body); return { data: await this.operations.unfreeze(s.user.id, uuid.parse(id), input) }; }
}
