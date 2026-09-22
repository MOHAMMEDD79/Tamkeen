import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { IDENTITY_RUNTIME, type IdentityRuntime } from '../identity/identity.controller.js';
import { ProjectsService } from './projects.service.js';
import { sessionFrom } from '../identity/session.js';

const uuid = z.string().uuid();
const projectType = z.enum(['charity', 'venture', 'enablement']);
const precision = z.enum(['city', 'approximate', 'exact']);
const optionalNumber = z.union([z.number(), z.null()]);

/** Filters are an allowlist: anything not named here is ignored rather than passed to the database. */
const browseQuery = z.object({
  type: projectType.optional(),
  cityId: uuid.optional(),
  country: z.string().regex(/^[A-Za-z]{2}$/).optional(),
  organization: z.string().max(90).optional(),
  verified: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(120).optional(),
  cursor: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
}).strip();

const projectBody = {
  title: z.string().trim().min(5).max(140),
  summary: z.string().trim().max(300),
  story: z.string().trim().max(20000),
  cityId: uuid,
  managerId: uuid,
  publicLocationPrecision: precision,
  latitude: optionalNumber,
  longitude: optionalNumber
};

@Controller()
export class ProjectsController {
  private readonly service: ProjectsService;
  constructor(@Inject(IDENTITY_RUNTIME) private readonly runtime: IdentityRuntime) { this.service = new ProjectsService(runtime.db); }

  private session(req: IncomingMessage) { return sessionFrom(this.runtime, req); }

  // ---- public ---------------------------------------------------------------------------------

  @Get('cities') async cities() {
    return { data: await this.service.cities() };
  }

  @Get('projects') async projects(@Query() query: unknown) {
    const parsed = browseQuery.parse(query);
    const page = await this.service.browse({
      ...(parsed.type ? { type: parsed.type } : {}),
      ...(parsed.cityId ? { cityId: parsed.cityId } : {}),
      ...(parsed.country ? { country: parsed.country.toUpperCase() } : {}),
      ...(parsed.organization ? { organizationSlug: parsed.organization } : {}),
      ...(parsed.verified === 'true' ? { verifiedOnly: true } : {}),
      ...(parsed.q ? { query: parsed.q } : {}),
      ...(parsed.cursor ? { cursor: parsed.cursor } : {}),
      ...(parsed.limit ? { limit: parsed.limit } : {})
    });
    return { data: page.items, page: { nextCursor: page.nextCursor, hasMore: page.hasMore } };
  }

  @Get('projects/:slug') async project(@Param('slug') slug: string) {
    return { data: await this.service.publicProject(slug) };
  }

  @Get('map/projects') async mapProjects(@Query() query: unknown) {
    const parsed = browseQuery.extend({ bbox: z.string().max(80).optional() }).parse(query);
    const raw = parsed.bbox?.split(',').map(Number);
    const bbox = raw?.length === 4 && raw.every(Number.isFinite) ? (raw as [number, number, number, number]) : undefined;
    const result = await this.service.mapProjects({
      ...(parsed.type ? { type: parsed.type } : {}),
      ...(parsed.cityId ? { cityId: parsed.cityId } : {}),
      ...(parsed.country ? { country: parsed.country.toUpperCase() } : {}),
      ...(parsed.verified === 'true' ? { verifiedOnly: true } : {}),
      ...(parsed.q ? { query: parsed.q } : {}),
      ...(bbox ? { bbox } : {})
    });
    return { data: result.items, meta: { total: result.total } };
  }

  @Get('organizations') async organizations(@Query() query: unknown) {
    const parsed = browseQuery.parse(query);
    return { data: await this.service.publicOrganizations({
      ...(parsed.country ? { country: parsed.country.toUpperCase() } : {}),
      ...(parsed.verified === 'true' ? { verifiedOnly: true } : {}),
      ...(parsed.q ? { query: parsed.q } : {}),
      ...(parsed.limit ? { limit: parsed.limit } : {})
    }) };
  }

  @Get('organizations/:slug/profile') async organizationProfile(@Param('slug') slug: string) {
    return { data: await this.service.publicOrganization(slug) };
  }

  @Get('impact') async impact() {
    return { data: await this.service.impact() };
  }

  // ---- personal -------------------------------------------------------------------------------

  @Get('me/bookmarks') async listBookmarks(@Req() req: IncomingMessage) {
    const session = await this.session(req);
    return { data: await this.service.bookmarks(session.user.id) };
  }

  @Post('bookmarks') async addBookmark(@Req() req: IncomingMessage, @Body() body: unknown) {
    const session = await this.session(req);
    // Exactly one target. PART-10 added programmes to the same list rather than a second one, and
    // the shape says so: two slugs, or neither, is a request nobody could act on.
    const input = z.object({
      projectSlug: z.string().trim().min(1).max(120).optional(),
      programSlug: z.string().trim().min(1).max(120).optional()
    }).strict().parse(body);
    return { data: await this.service.addBookmark(session.user.id, input) };
  }

  @Delete('bookmarks/:id') async removeBookmark(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.service.removeBookmark(session.user.id, uuid.parse(id)) };
  }

  // ---- organisation ---------------------------------------------------------------------------

  @Get('orgs/:id/projects') async organizationProjects(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.service.listForOrganization(session.user.id, uuid.parse(id)) };
  }

  @Post('orgs/:id/projects') async createProject(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ type: projectType, ...projectBody }).strict().parse(body);
    return { data: await this.service.create(session.user.id, uuid.parse(id), input) };
  }

  @Get('orgs/:id/projects/:projectId') async organizationProject(@Req() req: IncomingMessage, @Param('id') id: string, @Param('projectId') projectId: string) {
    const session = await this.session(req);
    return { data: await this.service.readForOrganization(session.user.id, uuid.parse(id), uuid.parse(projectId)) };
  }

  @Put('orgs/:id/projects/:projectId/location') async updateLocation(@Req() req: IncomingMessage, @Param('id') id: string, @Param('projectId') projectId: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ publicLocationPrecision: precision, latitude: optionalNumber, longitude: optionalNumber, version: z.number().int().positive() }).strict().parse(body);
    return { data: await this.service.updateLocation(session.user.id, uuid.parse(id), uuid.parse(projectId), input) };
  }

  @Patch('orgs/:id/projects/:projectId') async updateProject(@Req() req: IncomingMessage, @Param('id') id: string, @Param('projectId') projectId: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ ...projectBody, version: z.number().int().positive() }).strict().parse(body);
    return { data: await this.service.update(session.user.id, uuid.parse(id), uuid.parse(projectId), input) };
  }

  @Get('orgs/:id/projects/:projectId/public-preview') async projectPreview(@Req() req: IncomingMessage, @Param('id') id: string, @Param('projectId') projectId: string) {
    const session = await this.session(req);
    return { data: await this.service.publicPreview(session.user.id, uuid.parse(id), uuid.parse(projectId)) };
  }

  @Post('orgs/:id/projects/:projectId/submit') async submitProject(@Req() req: IncomingMessage, @Param('id') id: string, @Param('projectId') projectId: string, @Body() body: unknown) {
    const session = await this.session(req);
    const { version } = z.object({ version: z.number().int().positive() }).strict().parse(body);
    return { data: await this.service.submit(session.user.id, uuid.parse(id), uuid.parse(projectId), version) };
  }

  @Post('orgs/:id/projects/:projectId/duplicate') async duplicateProject(@Req() req: IncomingMessage, @Param('id') id: string, @Param('projectId') projectId: string) {
    const session = await this.session(req);
    return { data: await this.service.duplicate(session.user.id, uuid.parse(id), uuid.parse(projectId)) };
  }
}
