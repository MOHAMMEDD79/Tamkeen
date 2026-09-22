import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { Body, Controller, ForbiddenException, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { IDENTITY_RUNTIME, type IdentityRuntime } from '../identity/identity.controller.js';
import { LocalLogoStorage } from '../identity/logo-storage.js';
import { IdentityError } from '../identity/policy.js';
import { sessionFrom } from '../identity/session.js';
import { DirectoryService } from './directory.service.js';

const uuid = z.string().uuid();
const text = (max: number) => z.string().trim().max(max);
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg'];

const organizationChanges = z.object({
  version: z.number().int().positive(),
  displayName: text(140).min(2).optional(),
  publicDescription: text(1200).optional(),
  sectors: z.array(text(40).min(1)).max(8).optional(),
  type: z.enum(['NGO', 'Company', 'Startup', 'Foundation', 'Institution']).optional(),
  city: text(100).min(1).optional(),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
  websiteUrl: z.union([z.literal('').transform(() => null), z.null(), z.url({ protocol: /^https?$/ }).max(500)]).optional(),
  contactEmail: z.union([z.literal('').transform(() => null), z.null(), z.email().max(254)]).optional(),
  contactAddress: z.union([z.literal('').transform(() => null), z.null(), text(300)]).optional(),
  publiclyListed: z.boolean().optional(),
  status: z.enum(['active', 'suspended']).optional(),
  approved: z.boolean().optional()
}).strict();
const userQuery = z.object({ q: text(120).optional(), status: z.enum(['active', 'suspended', 'closed']).optional() });

@Controller()
export class DirectoryController {
  private readonly service: DirectoryService;
  private readonly logos = new LocalLogoStorage();
  constructor(@Inject(IDENTITY_RUNTIME) private readonly runtime: IdentityRuntime) { this.service = new DirectoryService(runtime.db); }

  private session(req: IncomingMessage) { return sessionFrom(this.runtime, req); }

  // ---------------------------------------------------------------- organisations

  @Get('admin/organizations') async organizations(@Req() req: IncomingMessage, @Query('q') q: unknown) {
    const session = await this.session(req);
    return { data: await this.service.organizations(session.user.id, text(120).optional().parse(q) || undefined) };
  }

  @Patch('admin/organizations/:id') async updateOrganization(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    // The grant first, so a non-admin learns nothing from how their body is judged.
    await this.service.admin(session.user.id);
    return { data: await this.service.updateOrganization(session.user.id, uuid.parse(id), organizationChanges.parse(body)) };
  }

  /**
   * The logo as the raw request body. It goes through the same quarantine, type sniffing, dimension
   * and active-content checks as an organisation's own upload before it is published.
   */
  @Put('admin/organizations/:id/logo') async uploadLogo(@Req() req: IncomingMessage, @Param('id') id: string) {
    if (!['demo', 'test'].includes(this.runtime.config.environment)) throw new ForbiddenException('Local storage is disabled');
    const session = await this.session(req);
    await this.service.admin(session.user.id);
    const organizationId = uuid.parse(id);
    if (!await this.service.organizationExists(organizationId)) throw new IdentityError('not_found', 404);
    const size = Number(req.headers['content-length']);
    const contentType = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!Number.isSafeInteger(size) || size < 1 || size > LOGO_MAX_BYTES || !LOGO_TYPES.includes(contentType)) throw new IdentityError('invalid_input', 422);
    const assetId = randomUUID();
    const storageKey = `logos/${organizationId}/${assetId}.bin`;
    await this.logos.receive(storageKey, req, size);
    const result = await this.logos.inspectAndPublish(storageKey, contentType);
    if (!result.clean) throw new IdentityError('invalid_input', 422);
    return { data: await this.service.adoptLogo(session.user.id, organizationId, { id: assetId, storageKey, contentType, size: result.actualSize, checksum: result.checksum }) };
  }

  // ---------------------------------------------------------------- accounts

  @Get('admin/users') async users(@Req() req: IncomingMessage, @Query() query: unknown) {
    const session = await this.session(req);
    const { q, status } = userQuery.parse(query);
    return { data: await this.service.users(session.user.id, q || undefined, status) };
  }

  @Get('admin/users/:id') async user(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.service.user(session.user.id, uuid.parse(id)) };
  }

  @Post('admin/users/:id/status') @HttpCode(200) async userStatus(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    await this.service.admin(session.user.id);
    const { status } = z.object({ status: z.enum(['active', 'suspended']) }).strict().parse(body);
    return { data: await this.service.setUserStatus(session.user.id, uuid.parse(id), status) };
  }
}
