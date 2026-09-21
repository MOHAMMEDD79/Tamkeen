import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, HttpException, HttpStatus, Inject, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { IDENTITY_RUNTIME, type IdentityRuntime } from '../identity/identity.controller.js';
import { sessionFrom } from '../identity/session.js';
import { IdentityError } from '../identity/policy.js';
import { SiteContentService, type StoredImage } from './site-content.service.js';
import { isSiteMediaId, isSiteMediaKey, SITE_MEDIA_MAX_BYTES, siteMediaIdOf, siteMediaKey, siteMediaUrl, SiteMediaStorage } from './site-media-storage.js';

const uuid = z.string().uuid();
const text = (max: number) => z.string().trim().max(max);
// A path on this site or nothing: "//host" and "/\host" are protocol-relative to a browser, and an
// absolute URL would make the home page an open redirect for whoever can edit it.
const ctaHref = text(300).refine(value => value === '' || (/^\/(?![/\\])/.test(value) && !/[\s\\]/.test(value)));
const defaultImage = z.string().regex(/^\/media\/defaults\/[a-z0-9-]+\.(?:jpg|jpeg|png|webp)$/);
const imageKey = z.string().refine(isSiteMediaKey);
const itemFields = { sortOrder: z.number().int().min(0).max(1000).optional(), titleAr: text(200).optional(), titleEn: text(200).optional(), bodyAr: text(600).optional(), bodyEn: text(600).optional(), ctaLabelAr: text(60).optional(), ctaLabelEn: text(60).optional(), ctaHref: ctaHref.optional(), defaultImage: defaultImage.optional(), active: z.boolean().optional() };
const createItem = z.object({ ...itemFields, titleAr: text(200).min(1), titleEn: text(200).min(1), imageKey: imageKey.nullable().optional() }).strict();
const updateItem = z.object({ ...itemFields, imageKey: imageKey.nullable().optional(), version: z.number().int().positive() }).strict();
const contactMessage = z.object({ name: z.string().trim().min(2).max(120), email: z.email().max(254), subject: z.string().trim().min(2).max(200), body: z.string().trim().min(10).max(4000), locale: z.enum(['ar', 'en']).default('ar') }).strict();

/**
 * Five contact messages per client per ten minutes, in memory.
 *
 * The form is the one write a visitor can make without an account, so it is the obvious flood
 * target. A per-process window is enough for a single API instance; it resets on restart, which
 * costs a spammer nothing they could not get by waiting.
 */
class ContactRateLimit {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly max = 5, private readonly windowMs = 10 * 60_000) {}
  take(client: string) {
    const now = Date.now();
    if (this.hits.size > 10_000) for (const [key, times] of this.hits) if (times.every(time => time <= now - this.windowMs)) this.hits.delete(key);
    const recent = (this.hits.get(client) ?? []).filter(time => time > now - this.windowMs);
    if (recent.length >= this.max) { this.hits.set(client, recent); return Math.ceil(((recent[0] ?? now) + this.windowMs - now) / 1000); }
    recent.push(now);
    this.hits.set(client, recent);
    return 0;
  }
}

/**
 * The address the limit is keyed on. Behind the local Next rewrite every request arrives from
 * loopback, so only then is the proxy's X-Forwarded-For consulted, and only its last entry: the
 * one the proxy itself appended. Anything earlier in the header was written by the client.
 */
function clientAddress(req: IncomingMessage) {
  const peer = req.socket.remoteAddress ?? 'unknown';
  const forwarded = req.headers['x-forwarded-for'];
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer) || typeof forwarded !== 'string') return peer;
  return forwarded.split(',').at(-1)?.trim() || peer;
}

@Controller()
export class SiteContentController {
  private readonly service: SiteContentService;
  private readonly storage = new SiteMediaStorage();
  private readonly contactLimit = new ContactRateLimit();
  constructor(@Inject(IDENTITY_RUNTIME) private readonly runtime: IdentityRuntime) { this.service = new SiteContentService(runtime.db); }

  private session(req: IncomingMessage) { return sessionFrom(this.runtime, req); }
  private localStorageOnly() { if (!['demo', 'test'].includes(this.runtime.config.environment)) throw new ForbiddenException('Local storage is disabled'); }

  /**
   * Re-derives type and checksum from the stored bytes; a key naming no upload is refused. The grant
   * is checked first so that a non-admin cannot use the 422 to probe which image keys exist.
   */
  private async storedImage(actorId: string, key: string): Promise<StoredImage> {
    await this.service.admin(actorId);
    const details = await this.storage.describe(key).catch(() => { throw new IdentityError('invalid_input', 422); });
    return { imageKey: key, contentType: details.contentType, checksum: details.checksum };
  }

  // ---------------------------------------------------------------- public

  @Get('site-content') async content() { return { data: await this.service.publicContent() }; }

  @Get('site-media/:id') async media(@Req() req: IncomingMessage, @Res() res: ServerResponse, @Param('id') id: string) {
    this.localStorageOnly();
    if (!isSiteMediaId(id)) throw new IdentityError('not_found', 404);
    const key = siteMediaKey(id);
    const known = await this.storage.describe(key);
    const etag = `"${known.checksum}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': 'public, max-age=86400' }); res.end(); return; }
    const file = await this.storage.read(key);
    res.writeHead(200, { 'Content-Type': file.contentType, 'Content-Length': file.bytes.length, 'Cache-Control': 'public, max-age=86400', ETag: `"${file.checksum}"`, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    res.end(file.bytes);
  }

  /** No session: the form is for visitors. The origin rule every other write follows still applies. */
  @Post('contact-messages') async contact(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse, @Body() body: unknown) {
    if (req.headers.origin !== this.runtime.config.appBaseUrl) throw new ForbiddenException();
    const retryAfter = this.contactLimit.take(clientAddress(req));
    if (retryAfter) { res.setHeader('Retry-After', String(retryAfter)); throw new HttpException('Too many messages', HttpStatus.TOO_MANY_REQUESTS); }
    return { data: await this.service.createContactMessage(contactMessage.parse(body)) };
  }

  // ---------------------------------------------------------------- admin: content

  @Get('admin/site-content') async adminContent(@Req() req: IncomingMessage) {
    const session = await this.session(req);
    return { data: await this.service.adminContent(session.user.id) };
  }

  @Post('admin/site-content/items') async createItem(@Req() req: IncomingMessage, @Body() body: unknown) {
    const session = await this.session(req);
    const { imageKey: key, ...input } = createItem.parse(body);
    return { data: await this.service.createHeroSlide(session.user.id, input, key ? await this.storedImage(session.user.id, key) : null) };
  }

  @Patch('admin/site-content/items/:id') async updateItem(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const { imageKey: key, ...input } = updateItem.parse(body);
    return { data: await this.service.updateItem(session.user.id, uuid.parse(id), input, key === undefined ? undefined : key === null ? null : await this.storedImage(session.user.id, key)) };
  }

  @Delete('admin/site-content/items/:id') async deleteItem(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.service.deleteHeroSlide(session.user.id, uuid.parse(id)) };
  }

  /** Raw bytes in the body. Stored but unused until an item or a project cover names the key. */
  @Put('admin/site-media/images') async upload(@Req() req: IncomingMessage) {
    this.localStorageOnly();
    const session = await this.session(req);
    await this.service.admin(session.user.id);
    const contentLength = Number(req.headers['content-length']);
    const contentType = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!req.headers['content-length'] || !Number.isSafeInteger(contentLength) || contentLength > SITE_MEDIA_MAX_BYTES) throw new IdentityError('invalid_input', 422);
    const stored = await this.storage.store(req, contentType, contentLength);
    await this.service.recordUpload(session.user.id, siteMediaIdOf(stored.imageKey));
    return { data: { imageKey: stored.imageKey, imageUrl: siteMediaUrl(stored.imageKey), contentType: stored.contentType, width: stored.width, height: stored.height } };
  }

  // ---------------------------------------------------------------- admin: project covers

  @Get('admin/projects/covers') async covers(@Req() req: IncomingMessage) {
    const session = await this.session(req);
    return { data: await this.service.projectCovers(session.user.id) };
  }

  @Put('admin/projects/:id/cover') async setCover(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const { imageKey: key } = z.object({ imageKey }).strict().parse(body);
    return { data: await this.service.setProjectCover(session.user.id, uuid.parse(id), await this.storedImage(session.user.id, key)) };
  }

  @Delete('admin/projects/:id/cover') async removeCover(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.service.removeProjectCover(session.user.id, uuid.parse(id)) };
  }

  // ---------------------------------------------------------------- admin: contact inbox

  @Get('admin/contact-messages') async contactMessages(@Req() req: IncomingMessage, @Query('state') state: unknown) {
    const session = await this.session(req);
    return { data: await this.service.contactMessages(session.user.id, z.enum(['new', 'read', 'archived']).optional().parse(state)) };
  }

  @Post('admin/contact-messages/:id/state') @HttpCode(200) async contactMessageState(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const { state } = z.object({ state: z.enum(['read', 'archived']) }).strict().parse(body);
    return { data: await this.service.setContactMessageState(session.user.id, uuid.parse(id), state) };
  }
}
