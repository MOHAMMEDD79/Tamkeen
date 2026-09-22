import type { IncomingMessage } from 'node:http';
import { Body, Controller, Delete, Get, Inject, Param, Patch, Put, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { IDENTITY_RUNTIME, type IdentityRuntime } from '../identity/identity.controller.js';
import { sessionFrom } from '../identity/session.js';
import { ProjectsAdminService } from './projects-admin.service.js';

const uuid = z.string().uuid();
const text = (max: number) => z.string().max(max);
const minor = z.string().regex(/^[1-9][0-9]{0,15}$/);
const version = z.number().int().positive();

const projectChanges = z.object({
  version,
  title: text(140).optional(), summary: text(300).optional(), story: text(20000).optional(),
  type: z.enum(['charity', 'venture', 'enablement']).optional(),
  cityId: uuid.optional(), publicLocationPrecision: z.enum(['exact', 'approximate', 'city']).optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(), longitude: z.number().min(-180).max(180).nullable().optional(),
  state: z.enum(['draft', 'published', 'paused', 'funding_closed', 'executing', 'impact_review', 'completed', 'archived', 'cancelled']).optional(),
  stateReason: text(1000).optional(),
  visibility: z.enum(['visible', 'hidden', 'removed']).optional()
}).strict();
const campaign = z.object({ version, goalMinor: minor, currency: z.string().regex(/^[A-Z]{3}$/).optional(), policy: z.enum(['flexible', 'all_or_nothing']).optional(), endsAt: z.iso.datetime({ offset: true }) }).strict();
const budget = z.object({ version, reason: text(1000), lines: z.array(z.object({ label: text(140), amountMinor: minor }).strict()).min(1).max(60) }).strict();
const milestones = z.object({ version, milestones: z.array(z.object({ title: text(140), budgetMinor: minor, weight: z.number().int().min(1).max(100) }).strict()).min(1).max(40) }).strict();
const updateBody = z.object({ title: text(140), body: text(20000) }).strict();

/** Every route checks the PlatformAdmin grant before judging the body (see ProjectsAdminService). */
@Controller()
export class ProjectsAdminController {
  private readonly service: ProjectsAdminService;
  constructor(@Inject(IDENTITY_RUNTIME) private readonly runtime: IdentityRuntime) { this.service = new ProjectsAdminService(runtime.db); }

  private async admin(req: IncomingMessage) {
    const session = await sessionFrom(this.runtime, req);
    await this.service.admin(session.user.id);
    return session.user.id;
  }

  @Get('admin/projects') async list(@Req() req: IncomingMessage, @Query() query: unknown) {
    const session = await sessionFrom(this.runtime, req);
    const { type, q } = z.object({ type: z.enum(['charity', 'venture', 'enablement']).optional(), q: z.string().trim().max(120).optional() }).parse(query);
    return { data: await this.service.list(session.user.id, { type, query: q || undefined }) };
  }

  @Get('admin/projects/:id') async detail(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await sessionFrom(this.runtime, req);
    return { data: await this.service.detail(session.user.id, uuid.parse(id)) };
  }

  @Patch('admin/projects/:id') async update(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const actor = await this.admin(req);
    return { data: await this.service.update(actor, uuid.parse(id), projectChanges.parse(body)) };
  }

  @Put('admin/projects/:id/campaign') async campaign(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const actor = await this.admin(req);
    return { data: await this.service.saveCampaign(actor, uuid.parse(id), campaign.parse(body)) };
  }

  @Put('admin/projects/:id/budget') async budget(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const actor = await this.admin(req);
    return { data: await this.service.saveBudget(actor, uuid.parse(id), budget.parse(body)) };
  }

  @Put('admin/projects/:id/milestones') async milestones(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const actor = await this.admin(req);
    return { data: await this.service.saveMilestones(actor, uuid.parse(id), milestones.parse(body)) };
  }

  @Patch('admin/projects/:id/updates/:updateId') async editUpdate(@Req() req: IncomingMessage, @Param('id') id: string, @Param('updateId') updateId: string, @Body() body: unknown) {
    const actor = await this.admin(req);
    return { data: await this.service.editUpdate(actor, uuid.parse(id), uuid.parse(updateId), updateBody.parse(body)) };
  }

  @Delete('admin/projects/:id/updates/:updateId') async deleteUpdate(@Req() req: IncomingMessage, @Param('id') id: string, @Param('updateId') updateId: string) {
    const actor = await this.admin(req);
    return { data: await this.service.deleteUpdate(actor, uuid.parse(id), uuid.parse(updateId)) };
  }

  @Delete('admin/projects/:id') async remove(@Req() req: IncomingMessage, @Param('id') id: string) {
    const actor = await this.admin(req);
    return { data: await this.service.remove(actor, uuid.parse(id)) };
  }
}
