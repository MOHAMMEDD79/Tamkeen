import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { CURRENT_TERMS_VERSION, loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { createApp } from '../apps/api/dist/app.js';
import { createAuth } from '../apps/api/dist/modules/identity/auth.js';

/**
 * The admin directory over real HTTP: the PlatformAdmin gate, editing an organisation with
 * optimistic versions, approval, listing and suspension, an admin logo upload through the logo
 * checks, account lookup, and suspension that ends sign-in — with the guards that stop an admin
 * locking themselves or the platform out.
 */

const config = loadConfig(process.env);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test('admin directory: organisations and accounts over HTTP', async () => {
  const db = createDatabase(config.databaseUrl);
  const auth = createAuth(config, db);
  const app = await createApp(config);
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api/v1`;
  const prefix = randomUUID();
  const users: string[] = [];
  const organizations: string[] = [];
  const passwords = new Map<string, string>();

  const call = async (method: string, path: string, options: { cookie?: string; body?: unknown; raw?: Buffer; contentType?: string } = {}) => {
    const headers: Record<string, string> = { origin: config.appBaseUrl };
    if (options.cookie) headers.cookie = options.cookie;
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.raw) headers['content-type'] = options.contentType ?? 'image/png';
    const response = await fetch(`${base}${path}`, { method, headers, ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : options.raw ? { body: options.raw } : {}) });
    const json = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { status: response.status, body: json, data: json.data as never };
  };
  const signUp = async (suffix: string, platformAdmin: boolean) => {
    const email = `${prefix}-${suffix}@example.test`;
    const password = `${randomBytes(18).toString('base64url')}Aa1!`;
    passwords.set(email, password);
    await auth.api.signUpEmail({ body: { email, password, name: `Directory ${suffix}`, termsVersion: CURRENT_TERMS_VERSION } as never });
    const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
    users.push(user.id);
    const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
    const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    if (platformAdmin) {
      await db.platformGrant.create({ data: { userId: user.id, role: 'PlatformAdmin', grantedBy: user.id } });
      await db.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
    }
    return { user, cookie, email };
  };

  try {
    const admin = await signUp('admin', true);
    const visitor = await signUp('visitor', false);
    const organization = await db.$transaction(async tx => {
      const created = await tx.organization.create({ data: { legalName: `${prefix} Legal`, displayName: `${prefix} Org`, slug: `${prefix}-org`, type: 'NGO', country: 'PS', city: 'نابلس', createdBy: visitor.user.id } });
      await tx.party.create({ data: { organizationId: created.id } });
      await tx.membership.create({ data: { userId: visitor.user.id, organizationId: created.id, roles: ['Owner'] } });
      return created;
    });
    organizations.push(organization.id);

    // --- The gate ----------------------------------------------------------------------------------
    for (const [method, path] of [['GET', '/admin/organizations'], ['GET', '/admin/users'], ['PATCH', `/admin/organizations/${organization.id}`], ['POST', `/admin/users/${admin.user.id}/status`]] as const) {
      assert.equal((await call(method, path, { cookie: visitor.cookie, body: method === 'GET' ? undefined : { version: 1, status: 'active' } })).status, 403, `${method} ${path} is admin-only`);
    }

    // --- Organisations --------------------------------------------------------------------------------
    const listed = (await call('GET', `/admin/organizations?q=${prefix}`, { cookie: admin.cookie })).data as Array<{ id: string; version: number; counts: { members: number }; verification: string }>;
    const row = listed.find(entry => entry.id === organization.id);
    assert.ok(row, 'the search finds the organisation');
    assert.equal(row.counts.members, 1);
    const edited = await call('PATCH', `/admin/organizations/${organization.id}`, { cookie: admin.cookie, body: { version: row.version, displayName: `${prefix} Renamed`, sectors: ['التعليم', 'الصحة'], websiteUrl: 'https://example.org', contactEmail: '' } });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    const afterEdit = edited.data as { version: number; displayName: string; sectors: string[]; contactEmail: string | null };
    assert.equal(afterEdit.displayName, `${prefix} Renamed`);
    assert.deepEqual(afterEdit.sectors, ['التعليم', 'الصحة']);
    assert.equal(afterEdit.contactEmail, null, 'an empty string clears a field');
    assert.equal((await call('PATCH', `/admin/organizations/${organization.id}`, { cookie: admin.cookie, body: { version: row.version, city: 'x' } })).status, 409, 'a stale version is refused');
    assert.equal((await call('PATCH', `/admin/organizations/${organization.id}`, { cookie: admin.cookie, body: { version: afterEdit.version, websiteUrl: 'javascript:alert(1)' } })).status, 422);
    const approved = (await call('PATCH', `/admin/organizations/${organization.id}`, { cookie: admin.cookie, body: { version: afterEdit.version, approved: true } })).data as { version: number; verification: string };
    assert.equal(approved.verification, 'verified');
    const publicCard = ((await call('GET', `/organizations?q=${encodeURIComponent(`${prefix} Renamed`)}`)).data as Array<{ slug: string; verified: boolean }>).find(entry => entry.slug === organization.slug);
    assert.equal(publicCard?.verified, true, 'approval shows on the public directory');
    const hidden = (await call('PATCH', `/admin/organizations/${organization.id}`, { cookie: admin.cookie, body: { version: approved.version, publiclyListed: false } })).data as { version: number };
    assert.equal(((await call('GET', `/organizations?q=${encodeURIComponent(`${prefix} Renamed`)}`)).data as unknown[]).length, 0, 'a hidden organisation leaves the directory');
    const suspended = (await call('PATCH', `/admin/organizations/${organization.id}`, { cookie: admin.cookie, body: { version: hidden.version, status: 'suspended' } })).data as { version: number; status: string };
    assert.equal(suspended.status, 'suspended');
    assert.equal((await call('GET', `/organizations/${organization.slug}/profile`)).status, 404, 'a suspended organisation has no public page');

    // --- Logo -------------------------------------------------------------------------------------------
    assert.equal((await call('PUT', `/admin/organizations/${organization.id}/logo`, { cookie: admin.cookie, raw: Buffer.from('not an image at all, just text') })).status, 422, 'a spoofed PNG is refused');
    const logo = await call('PUT', `/admin/organizations/${organization.id}/logo`, { cookie: admin.cookie, raw: PNG });
    assert.equal(logo.status, 200, JSON.stringify(logo.body));
    assert.match((logo.data as { logoUrl: string }).logoUrl, /\/logo$/);

    // --- Accounts ---------------------------------------------------------------------------------------
    const found = (await call('GET', `/admin/users?q=${prefix}`, { cookie: admin.cookie })).data as Array<{ id: string; platformRoles: string[]; organizations: number }>;
    assert.equal(found.length, 2);
    assert.deepEqual(found.find(entry => entry.id === admin.user.id)?.platformRoles, ['PlatformAdmin']);
    const detail = (await call('GET', `/admin/users/${visitor.user.id}`, { cookie: admin.cookie })).data as { memberships: Array<{ roles: string[] }>; lastSignInAt: string | null };
    assert.deepEqual(detail.memberships[0]?.roles, ['Owner']);
    assert.ok(detail.lastSignInAt);
    assert.equal((await call('POST', `/admin/users/${admin.user.id}/status`, { cookie: admin.cookie, body: { status: 'suspended' } })).status, 403, 'an admin cannot suspend themselves');
    assert.equal((await call('POST', `/admin/users/${visitor.user.id}/status`, { cookie: admin.cookie, body: { status: 'suspended' } })).status, 200);
    assert.equal((await call('GET', '/me', { cookie: visitor.cookie })).status, 401, 'the suspended session stops at once');
    await assert.rejects(auth.api.signInEmail({ body: { email: visitor.email, password: passwords.get(visitor.email)! } }), 'a suspended account cannot sign in');
    assert.equal(((await call('GET', `/admin/users?q=${prefix}&status=suspended`, { cookie: admin.cookie })).data as unknown[]).length, 1);
    assert.equal((await call('POST', `/admin/users/${visitor.user.id}/status`, { cookie: admin.cookie, body: { status: 'active' } })).status, 200);
    await auth.api.signInEmail({ body: { email: visitor.email, password: passwords.get(visitor.email)! } });

    const actions = (await db.identityAuditEvent.findMany({ where: { actorId: admin.user.id }, select: { action: true } })).map(entry => entry.action);
    for (const action of ['organization.admin_edited', 'organization.admin_approved', 'organization.admin_unlisted', 'organization.admin_suspended', 'organization.logo_published', 'user.admin_suspended', 'user.admin_reactivated']) {
      assert.ok(actions.includes(action), `${action} is audited`);
    }
  } finally {
    await db.$transaction(async tx => {
      await tx.organization.updateMany({ where: { id: { in: organizations } }, data: { currentLogoId: null } });
      await tx.organizationLogoAsset.deleteMany({ where: { organizationId: { in: organizations } } });
      await tx.membership.deleteMany({ where: { organizationId: { in: organizations } } });
      await tx.party.deleteMany({ where: { OR: [{ userId: { in: users } }, { organizationId: { in: organizations } }] } });
      await tx.$executeRawUnsafe('ALTER TABLE identity_audit_events DISABLE TRIGGER USER');
      await tx.identityAuditEvent.deleteMany({ where: { OR: [{ actorId: { in: users } }, { organizationId: { in: organizations } }] } });
      await tx.$executeRawUnsafe('ALTER TABLE identity_audit_events ENABLE TRIGGER USER');
      await tx.organization.deleteMany({ where: { id: { in: organizations } } });
      await tx.platformGrant.deleteMany({ where: { userId: { in: users } } });
      await tx.individualProfile.deleteMany({ where: { userId: { in: users } } });
      await tx.session.deleteMany({ where: { userId: { in: users } } });
      await tx.account.deleteMany({ where: { userId: { in: users } } });
      await tx.user.deleteMany({ where: { id: { in: users } } });
    });
    await db.localAuthMail.deleteMany({ where: { recipient: { startsWith: prefix } } });
    await db.$disconnect();
    await app.close();
  }
});
