import { Body, Controller, Get, Inject, Param, Post, Put, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { IDENTITY_RUNTIME, type IdentityRuntime } from '../identity/identity.controller.js';
import { sessionFrom } from '../identity/session.js';
import { CharityService } from './charity.service.js';

const uuid = z.string().uuid();
/** Amounts arrive as decimal strings of minor units, never as JSON numbers (08-FINANCIAL-SYSTEM). */
const minor = z.string().regex(/^[0-9]{1,16}$/);
const version = z.number().int().positive();

@Controller()
export class CharityController {
  private readonly service: CharityService;
  constructor(@Inject(IDENTITY_RUNTIME) private readonly runtime: IdentityRuntime) { this.service = new CharityService(runtime.db); }

  private session(req: IncomingMessage) { return sessionFrom(this.runtime, req); }

  // ---- organisation: plan ----------------------------------------------------------------------

  @Get('orgs/:id/projects/:projectId/plan') async plan(@Req() req: IncomingMessage, @Param('id') id: string, @Param('projectId') projectId: string) {
    const session = await this.session(req);
    return { data: await this.service.plan(session.user.id, uuid.parse(id), uuid.parse(projectId)) };
  }

  @Put('orgs/:id/projects/:projectId/campaign') async saveCampaign(@Req() req: IncomingMessage, @Param('id') id: string, @Param('projectId') projectId: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ goalMinor: minor, currency: z.string().regex(/^[A-Za-z]{3}$/), policy: z.enum(['flexible', 'all_or_nothing']), endsAt: z.iso.datetime(), version }).strict().parse(body);
    return { data: await this.service.saveCampaign(session.user.id, uuid.parse(id), uuid.parse(projectId), input) };
  }

  @Put('orgs/:id/projects/:projectId/budget') async reviseBudget(@Req() req: IncomingMessage, @Param('id') id: string, @Param('projectId') projectId: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({
      lines: z.array(z.object({ label: z.string().trim().min(2).max(140), amountMinor: minor }).strict()).min(1).max(60),
      reason: z.string().trim().max(1000),
      version
    }).strict().parse(body);
    return { data: await this.service.reviseBudget(session.user.id, uuid.parse(id), uuid.parse(projectId), input) };
  }

  @Put('orgs/:id/projects/:projectId/milestones') async saveMilestones(@Req() req: IncomingMessage, @Param('id') id: string, @Param('projectId') projectId: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({
      milestones: z.array(z.object({ title: z.string().trim().min(2).max(140), budgetMinor: minor, weight: z.number().int().min(1).max(100) }).strict()).min(1).max(40),
      version
    }).strict().parse(body);
    return { data: await this.service.saveMilestones(session.user.id, uuid.parse(id), uuid.parse(projectId), input) };
  }

  // ---- organisation: lifecycle -------------------------------------------------------------------

  @Post('orgs/:id/projects/:projectId/pause') async pause(@Req() req: IncomingMessage, @Param('id') id: string, @Param('projectId') projectId: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ reason: z.string().trim().min(10).max(1000), version }).strict().parse(body);
    return { data: await this.service.pause(session.user.id, uuid.parse(id), uuid.parse(projectId), input) };
  }

  @Post('orgs/:id/projects/:projectId/resume') async resume(@Req() req: IncomingMessage, @Param('id') id: string, @Param('projectId') projectId: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ version }).strict().parse(body);
    return { data: await this.service.resume(session.user.id, uuid.parse(id), uuid.parse(projectId), input.version) };
  }

  @Post('orgs/:id/projects/:projectId/close') async close(@Req() req: IncomingMessage, @Param('id') id: string, @Param('projectId') projectId: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ reason: z.string().trim().min(10).max(1000), version }).strict().parse(body);
    return { data: await this.service.requestClose(session.user.id, uuid.parse(id), uuid.parse(projectId), input) };
  }

  @Post('orgs/:id/projects/:projectId/milestones/:milestoneId/evidence') async milestoneEvidence(@Req() req: IncomingMessage, @Param('id') id: string, @Param('projectId') projectId: string, @Param('milestoneId') milestoneId: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ note: z.string().trim().min(10).max(2000) }).strict().parse(body);
    return { data: await this.service.submitMilestoneEvidence(session.user.id, uuid.parse(id), uuid.parse(projectId), uuid.parse(milestoneId), input) };
  }

  @Post('orgs/:id/projects/:projectId/updates') async publishUpdate(@Req() req: IncomingMessage, @Param('id') id: string, @Param('projectId') projectId: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ title: z.string().trim().min(5).max(140), body: z.string().trim().min(20).max(20000) }).strict().parse(body);
    return { data: await this.service.publishUpdate(session.user.id, uuid.parse(id), uuid.parse(projectId), input) };
  }

  // ---- organisation: reports ---------------------------------------------------------------------

  @Get('orgs/:id/projects/:projectId/report-metrics') async reportMetrics(@Req() req: IncomingMessage, @Param('id') id: string, @Param('projectId') projectId: string) {
    const session = await this.session(req);
    return { data: await this.service.reportMetrics(session.user.id, uuid.parse(id), uuid.parse(projectId)) };
  }

  @Post('orgs/:id/projects/:projectId/reports') async createReport(@Req() req: IncomingMessage, @Param('id') id: string, @Param('projectId') projectId: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ title: z.string().trim().min(5).max(140), periodStart: z.iso.date(), periodEnd: z.iso.date(), body: z.string().trim().max(40000) }).strict().parse(body);
    return { data: await this.service.createReport(session.user.id, uuid.parse(id), uuid.parse(projectId), input) };
  }

  @Post('orgs/:id/reports/:reportId/submit') async submitReport(@Req() req: IncomingMessage, @Param('id') id: string, @Param('reportId') reportId: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ version }).strict().parse(body);
    return { data: await this.service.submitReport(session.user.id, uuid.parse(id), uuid.parse(reportId), input.version) };
  }

  @Post('orgs/:id/reports/:reportId/publish') async publishReport(@Req() req: IncomingMessage, @Param('id') id: string, @Param('reportId') reportId: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ version }).strict().parse(body);
    return { data: await this.service.publishReport(session.user.id, uuid.parse(id), uuid.parse(reportId), input.version) };
  }

  // ---- content review (ADM-03) --------------------------------------------------------------------

  @Get('admin/reviews/project') async reviewQueue(@Req() req: IncomingMessage) {
    const session = await this.session(req);
    return { data: await this.service.reviewQueue(session.user.id) };
  }

  @Get('admin/reviews/project/:versionId') async review(@Req() req: IncomingMessage, @Param('versionId') versionId: string) {
    const session = await this.session(req);
    return { data: await this.service.review(session.user.id, uuid.parse(versionId)) };
  }

  @Post('admin/reviews/project/:versionId/claim') async claim(@Req() req: IncomingMessage, @Param('versionId') versionId: string) {
    const session = await this.session(req);
    return { data: await this.service.claim(session.user.id, uuid.parse(versionId)) };
  }

  @Post('admin/tasks/:id/assign') async assign(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ assigneeId: uuid, version }).strict().parse(body);
    return { data: await this.service.assignReviewTask(session.user.id, uuid.parse(id), input) };
  }

  @Post('admin/reviews/project/:versionId/decision') async decide(@Req() req: IncomingMessage, @Param('versionId') versionId: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ outcome: z.enum(['approved', 'changes_requested', 'rejected']), publicReason: z.string().trim().max(1000), version }).strict().parse(body);
    return { data: await this.service.decide(session.user.id, uuid.parse(versionId), input) };
  }

  @Post('admin/projects/:projectId/publish') async publish(@Req() req: IncomingMessage, @Param('projectId') projectId: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ version }).strict().parse(body);
    return { data: await this.service.publish(session.user.id, uuid.parse(projectId), input.version) };
  }
}
