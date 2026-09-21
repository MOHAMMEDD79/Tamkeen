import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { CURRENT_TERMS_VERSION, loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { createApp } from '../apps/api/dist/app.js';
import { createAuth } from '../apps/api/dist/modules/identity/auth.js';
import { IdentityService } from '../apps/api/dist/modules/identity/identity.service.js';

/**
 * Admin-controlled site content over real HTTP: the seeded public copy, the PlatformAdmin gate,
 * image upload with type sniffing, optimistic versions, the last-hero-slide rule, project covers in
 * the public card, and the session-less, rate-limited contact form.
 */

const config = loadConfig(process.env);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

type Item = { id: string; slot: string; sortOrder: number; imageUrl: string; imageKey?: string | null; active?: boolean; version?: number; cta: { href: string } | null };

test('site content, media, project covers and the contact inbox over HTTP', async () => {
  const db = createDatabase(config.databaseUrl);
  const auth = createAuth(config, db);
  const app = await createApp(config);
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api/v1`;
  const prefix = randomUUID();
  const users: string[] = [];
  const organizations: string[] = [];
  const projects: string[] = [];
  const createdItems: string[] = [];
  const uploadedIds: string[] = [];
  const heroesBefore = await db.siteMediaItem.findMany({ where: { slot: 'hero' } });

  const call = async (method: string, path: string, options: { cookie?: string; body?: unknown; raw?: Buffer; contentType?: string; origin?: string | null; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (options.origin !== null) headers.origin = options.origin ?? config.appBaseUrl;
    if (options.cookie) headers.cookie = options.cookie;
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.raw) headers['content-type'] = options.contentType ?? 'image/png';
    const response = await fetch(`${base}${path}`, { method, headers, ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : options.raw ? { body: options.raw } : {}) });
    const text = await response.text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* binary or empty */ }
    return { status: response.status, headers: response.headers, body: json, data: json.data as never };
  };
  /** A real Better Auth session, signed in before MFA is switched on so no second factor is asked. */
  const signedIn = async (suffix: string, platformAdmin: boolean) => {
    const email = `${prefix}-${suffix}@example.test`;
    const password = `${randomBytes(18).toString('base64url')}Aa1!`;
    await auth.api.signUpEmail({ body: { email, password, name: `Site ${suffix}`, termsVersion: CURRENT_TERMS_VERSION } as never });
    const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
    users.push(user.id);
    const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
    const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    assert.ok(cookie.includes('session_token'));
    if (platformAdmin) {
      await db.platformGrant.create({ data: { userId: user.id, role: 'PlatformAdmin', grantedBy: user.id } });
      await db.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
    }
    return { user, cookie };
  };

  try {
    // --- The seeded copy is public before anyone edits it ------------------------------------
    const initial = await call('GET', '/site-content', { origin: null });
    assert.equal(initial.status, 200);
    const content = initial.data as { hero: Item[]; tracks: Record<string, Item | null>; about: Item | null; contact: Item | null };
    assert.ok(content.hero.length >= 4, 'four seeded hero slides');
    assert.ok(content.hero.some(item => item.imageUrl === '/media/defaults/hero-charity.jpg'));
    assert.deepEqual(content.hero.map(item => item.sortOrder), [...content.hero.map(item => item.sortOrder)].sort((a, b) => a - b), 'hero slides arrive in order');
    assert.equal(content.tracks.charity?.imageUrl, '/media/defaults/track-charity.jpg');
    assert.equal(content.tracks.charity?.cta?.href, '/explore?type=charity');
    assert.equal(content.tracks.invest?.imageUrl, '/media/defaults/track-invest.jpg');
    assert.equal(content.tracks.work?.imageUrl, '/media/defaults/track-work.jpg');
    assert.equal(content.about?.imageUrl, '/media/defaults/about-village.jpg');
    assert.equal(content.contact?.imageUrl, '/media/defaults/contact-team.jpg');
    assert.equal(Object.hasOwn(content.hero[0] ?? {}, 'version'), false, 'the public item carries no admin fields');

    // --- Only a PlatformAdmin with MFA reaches the admin routes -------------------------------
    const admin = await signedIn('admin', true);
    const visitor = await signedIn('visitor', false);
    assert.equal((await call('GET', '/admin/site-content')).status, 401);
    for (const [method, path, extra] of [['GET', '/admin/site-content', {}], ['GET', '/admin/projects/covers', {}], ['GET', '/admin/contact-messages', {}], ['POST', '/admin/site-content/items', { body: { titleAr: 'x', titleEn: 'x' } }], ['PUT', '/admin/site-media/images', { raw: PNG }]] as const) {
      assert.equal((await call(method, path, { cookie: visitor.cookie, ...extra })).status, 403, `${method} ${path} is refused to a non-admin`);
    }
    await db.platformGrant.create({ data: { userId: visitor.user.id, role: 'PlatformAdmin', grantedBy: admin.user.id } });
    assert.equal((await call('GET', '/admin/site-content', { cookie: visitor.cookie })).status, 403, 'the grant without enrolled MFA is not enough');
    await db.platformGrant.deleteMany({ where: { userId: visitor.user.id } });

    // --- Upload: the bytes decide the type, not the header ------------------------------------
    const upload = await call('PUT', '/admin/site-media/images', { cookie: admin.cookie, raw: PNG });
    assert.equal(upload.status, 200, JSON.stringify(upload.body));
    const uploaded = upload.data as { imageKey: string; imageUrl: string; width: number; height: number };
    assert.match(uploaded.imageKey, /^site\/[0-9a-f-]{36}\.bin$/);
    uploadedIds.push(uploaded.imageKey.slice(5, 41));
    assert.equal(uploaded.imageUrl, `/api/v1/site-media/${uploaded.imageKey.slice(5, 41)}`);
    assert.deepEqual([uploaded.width, uploaded.height], [1, 1]);
    assert.equal((await call('PUT', '/admin/site-media/images', { cookie: admin.cookie, raw: Buffer.from('this is plainly not a png file, whatever it says') })).status, 422, 'a spoofed PNG is refused');
    assert.equal((await call('PUT', '/admin/site-media/images', { cookie: admin.cookie, raw: PNG, contentType: 'image/jpeg' })).status, 422, 'a PNG declared as JPEG is refused');
    assert.equal((await call('PUT', '/admin/site-media/images', { cookie: admin.cookie, raw: Buffer.concat([PNG, Buffer.from('<script>alert(1)</script>')]) })).status, 422, 'active content is refused');
    assert.equal((await call('PUT', '/admin/site-media/images', { cookie: admin.cookie, raw: PNG, contentType: 'image/svg+xml' })).status, 422);

    // --- Set it on a hero slide; the public read then serves it --------------------------------
    const adminContent = (await call('GET', '/admin/site-content', { cookie: admin.cookie })).data as { items: Item[] };
    const firstHero = adminContent.items.find(item => item.slot === 'hero' && item.active);
    assert.ok(firstHero?.version);
    const patched = await call('PATCH', `/admin/site-content/items/${firstHero.id}`, { cookie: admin.cookie, body: { imageKey: uploaded.imageKey, titleEn: 'Edited slide', version: firstHero.version } });
    assert.equal(patched.status, 200, JSON.stringify(patched.body));
    assert.equal((patched.data as Item).version, firstHero.version + 1);
    const publicHero = ((await call('GET', '/site-content')).data as { hero: Item[] }).hero.find(item => item.id === firstHero.id);
    assert.equal(publicHero?.imageUrl, uploaded.imageUrl);
    const media = await fetch(`${base}${uploaded.imageUrl.replace('/api/v1', '')}`);
    assert.equal(media.status, 200);
    assert.equal(media.headers.get('content-type'), 'image/png');
    assert.equal(media.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(media.headers.get('cache-control'), 'public, max-age=86400');
    assert.deepEqual(Buffer.from(await media.arrayBuffer()), PNG);
    const etag = media.headers.get('etag') ?? '';
    assert.match(etag, /^"[0-9a-f]{64}"$/);
    assert.equal((await fetch(`${base}${uploaded.imageUrl.replace('/api/v1', '')}`, { headers: { 'if-none-match': etag } })).status, 304);
    assert.equal((await fetch(`${base}/site-media/${randomUUID()}`)).status, 404);
    assert.equal((await fetch(`${base}/site-media/..%2F..%2Fetc`)).status, 404);

    // --- Versions, link rules and unknown image keys -------------------------------------------
    assert.equal((await call('PATCH', `/admin/site-content/items/${firstHero.id}`, { cookie: admin.cookie, body: { titleEn: 'Stale', version: firstHero.version } })).status, 409);
    for (const ctaHref of ['//evil.com', 'https://x', '/\\evil.com', 'javascript:alert(1)']) {
      assert.equal((await call('PATCH', `/admin/site-content/items/${firstHero.id}`, { cookie: admin.cookie, body: { ctaHref, version: firstHero.version + 1 } })).status, 422, `${ctaHref} is not a site path`);
    }
    await assert.rejects(() => db.siteMediaItem.update({ where: { id: firstHero.id }, data: { ctaHref: '/\\evil.com' } }), 'the database refuses an off-site link too');
    assert.equal((await call('PATCH', `/admin/site-content/items/${firstHero.id}`, { cookie: admin.cookie, body: { imageKey: `site/${randomUUID()}.bin`, version: firstHero.version + 1 } })).status, 422, 'a key naming no upload is refused');
    const reverted = await call('PATCH', `/admin/site-content/items/${firstHero.id}`, { cookie: admin.cookie, body: { imageKey: null, ctaHref: '/explore?type=charity', version: firstHero.version + 1 } });
    assert.equal(reverted.status, 200);
    assert.equal((reverted.data as Item).imageUrl, heroesBefore.find(item => item.id === firstHero.id)?.defaultImage, 'null reverts to the default photo');

    // --- Hero slides: only heroes are created or deleted, and one always stays visible --------
    const created = await call('POST', '/admin/site-content/items', { cookie: admin.cookie, body: { titleAr: 'شريحة', titleEn: 'Slide', ctaHref: '/invest', ctaLabelAr: 'استثمر', ctaLabelEn: 'Invest', imageKey: uploaded.imageKey } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const slide = created.data as Item;
    createdItems.push(slide.id);
    assert.equal(slide.slot, 'hero');
    const about = adminContent.items.find(item => item.slot === 'about');
    assert.ok(about);
    assert.equal((await call('DELETE', `/admin/site-content/items/${about.id}`, { cookie: admin.cookie })).status, 403, 'a fixed slot cannot be deleted');
    await db.siteMediaItem.updateMany({ where: { slot: 'hero', id: { not: slide.id } }, data: { active: false } });
    assert.equal((await call('DELETE', `/admin/site-content/items/${slide.id}`, { cookie: admin.cookie })).status, 409, 'the last visible slide cannot be deleted');
    assert.equal((await call('PATCH', `/admin/site-content/items/${slide.id}`, { cookie: admin.cookie, body: { active: false, version: slide.version } })).status, 409, 'nor hidden');
    for (const hero of heroesBefore) await db.siteMediaItem.update({ where: { id: hero.id }, data: { active: hero.active } });
    assert.equal((await call('DELETE', `/admin/site-content/items/${slide.id}`, { cookie: admin.cookie })).status, 200);
    createdItems.pop();

    // --- A project cover appears in the public card and detail ---------------------------------
    const owner = await db.user.create({ data: { email: `${prefix}-owner@example.test`, name: 'Site owner', emailVerified: true, termsVersion: CURRENT_TERMS_VERSION, termsAcceptedAt: new Date() } });
    users.push(owner.id);
    const organization = await new IdentityService(db).createOrganization(owner.id, { legalName: `Legal ${prefix}`, displayName: `Org ${prefix}`, type: 'NGO', country: 'PS', city: 'Nablus' });
    organizations.push(organization.id);
    const nablus = await db.city.findFirstOrThrow({ where: { country: 'PS', nameEn: 'Nablus' } });
    const project = await db.project.create({ data: { organizationId: organization.id, type: 'charity', slug: `cover-${prefix.slice(0, 8)}`, title: 'Cover test project', summary: 'A project that gets a cover photo.', cityId: nablus.id, managerId: owner.id, createdBy: owner.id, state: 'published', publishedAt: new Date() } });
    projects.push(project.id);
    const cardCover = async () => ((await call('GET', `/projects?organization=${organization.slug}`)).data as Array<{ slug: string; coverUrl: string | null }>).find(card => card.slug === project.slug)?.coverUrl;
    assert.equal(await cardCover(), null);
    assert.equal((await call('PUT', `/admin/projects/${project.id}/cover`, { cookie: visitor.cookie, body: { imageKey: uploaded.imageKey } })).status, 403);
    const setCover = await call('PUT', `/admin/projects/${project.id}/cover`, { cookie: admin.cookie, body: { imageKey: uploaded.imageKey } });
    assert.equal(setCover.status, 200, JSON.stringify(setCover.body));
    assert.equal(await cardCover(), uploaded.imageUrl);
    assert.equal(((await call('GET', `/projects/${project.slug}`)).data as { coverUrl: string | null }).coverUrl, uploaded.imageUrl);
    const covers = (await call('GET', '/admin/projects/covers', { cookie: admin.cookie })).data as Array<{ id: string; coverUrl: string | null; organization: { displayName: string } }>;
    assert.equal(covers.find(row => row.id === project.id)?.coverUrl, uploaded.imageUrl);
    assert.equal((await call('PUT', `/admin/projects/${randomUUID()}/cover`, { cookie: admin.cookie, body: { imageKey: uploaded.imageKey } })).status, 404);
    assert.equal((await call('DELETE', `/admin/projects/${project.id}/cover`, { cookie: admin.cookie })).status, 200);
    assert.equal(await cardCover(), null);
    assert.equal((await call('DELETE', `/admin/projects/${project.id}/cover`, { cookie: admin.cookie })).status, 404);

    // --- The contact form works without a session and lands in the admin inbox -----------------
    const client = (n: number) => ({ 'x-forwarded-for': `198.51.100.${n}` });
    const seed = Math.floor(Math.random() * 200);
    const message = { name: 'Visitor', email: `${prefix}-contact@example.test`, subject: 'A question', body: 'How do I register my organisation?', locale: 'en' };
    assert.equal((await call('POST', '/contact-messages', { body: message, origin: 'http://evil.example', headers: client(seed) })).status, 403, 'the origin rule still applies');
    assert.equal((await call('POST', '/contact-messages', { body: { ...message, email: 'not-an-email' }, headers: client(seed + 1) })).status, 422);
    const sent = await call('POST', '/contact-messages', { body: message, headers: client(seed + 2) });
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    const messageId = (sent.data as { id: string }).id;
    const inbox = (await call('GET', '/admin/contact-messages?state=new', { cookie: admin.cookie })).data as Array<{ id: string; state: string }>;
    assert.ok(inbox.some(entry => entry.id === messageId));
    assert.equal((await call('GET', '/admin/contact-messages?state=bogus', { cookie: admin.cookie })).status, 422);
    const read = await call('POST', `/admin/contact-messages/${messageId}/state`, { cookie: admin.cookie, body: { state: 'read' } });
    assert.equal(read.status, 200);
    assert.equal((read.data as { state: string; readAt: string | null }).state, 'read');
    assert.ok((read.data as { readAt: string | null }).readAt);
    assert.ok(((await call('GET', '/admin/contact-messages?state=read', { cookie: admin.cookie })).data as Array<{ id: string }>).some(entry => entry.id === messageId));

    // --- Five per client per ten minutes ---------------------------------------------------------
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) statuses.push((await call('POST', '/contact-messages', { body: message, headers: client(seed + 3) })).status);
    assert.deepEqual(statuses, [201, 201, 201, 201, 201, 429]);
    const limited = await call('POST', '/contact-messages', { body: message, headers: client(seed + 3) });
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    assert.equal((await call('POST', '/contact-messages', { body: message, headers: client(seed + 4) })).status, 201, 'another client is unaffected');

    // --- Every admin change left an audit row ---------------------------------------------------
    const actions = (await db.identityAuditEvent.findMany({ where: { actorId: admin.user.id }, select: { action: true } })).map(row => row.action);
    for (const action of ['site_media.uploaded', 'site_content.item.updated', 'site_content.item.created', 'site_content.item.deleted', 'project_cover.set', 'project_cover.removed', 'contact_message.read']) {
      assert.ok(actions.includes(action), `${action} is audited`);
    }
  } finally {
    for (const hero of heroesBefore) {
      const { id, ...original } = hero;
      await db.siteMediaItem.update({ where: { id }, data: original });
    }
    await db.siteMediaItem.deleteMany({ where: { id: { in: createdItems } } });
    await db.contactMessage.deleteMany({ where: { email: `${prefix}-contact@example.test` } });
    await db.$transaction(async tx => {
      await tx.project.deleteMany({ where: { id: { in: projects } } });
      await tx.membership.deleteMany({ where: { organizationId: { in: organizations } } });
      await tx.party.deleteMany({ where: { OR: [{ userId: { in: users } }, { organizationId: { in: organizations } }] } });
      await tx.organization.deleteMany({ where: { id: { in: organizations } } });
      await tx.$executeRawUnsafe('ALTER TABLE identity_audit_events DISABLE TRIGGER USER');
      await tx.identityAuditEvent.deleteMany({ where: { actorId: { in: users } } });
      await tx.$executeRawUnsafe('ALTER TABLE identity_audit_events ENABLE TRIGGER USER');
      await tx.platformGrant.deleteMany({ where: { userId: { in: users } } });
      await tx.individualProfile.deleteMany({ where: { userId: { in: users } } });
      await tx.session.deleteMany({ where: { userId: { in: users } } });
      await tx.account.deleteMany({ where: { userId: { in: users } } });
      await tx.user.deleteMany({ where: { id: { in: users } } });
    });
    await db.localAuthMail.deleteMany({ where: { recipient: { startsWith: prefix } } });
    for (const id of uploadedIds) await rm(resolve(process.cwd(), '.local', 'site-media', 'public', 'site', `${id}.bin`), { force: true });
    await db.$disconnect();
    await app.close();
  }
});
