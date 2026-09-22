import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { CURRENT_TERMS_VERSION, loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { createApp } from '../apps/api/dist/app.js';
import { createAuth } from '../apps/api/dist/modules/identity/auth.js';

/**
 * The admin projects screen over real HTTP: the PlatformAdmin gate; editing text, track, state and
 * visibility with versions; a hidden project leaving the public site; funding, budget (with its
 * revision) and stages under the platform's rules; and delete, which works for a project that
 * never touched money and is refused for one that did.
 */

const config = loadConfig(process.env);

type Detail = { id: string; version: number; title: string; state: string; adminVisibility: string; type: string; deletable: boolean; campaign: { goalMinor: string } | null; budgetLines: unknown[]; milestones: Array<{ weight: number }> };

test('admin projects: edit everything, hide, and delete over HTTP', async () => {
  const db = createDatabase(config.databaseUrl);
  const auth = createAuth(config, db);
  const app = await createApp(config);
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api/v1`;
  const prefix = randomUUID();
  const users: string[] = [];
  const organizations: string[] = [];
  const projects: string[] = [];

  const call = async (method: string, path: string, options: { cookie?: string; body?: unknown } = {}) => {
    const headers: Record<string, string> = { origin: config.appBaseUrl };
    if (options.cookie) headers.cookie = options.cookie;
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(`${base}${path}`, { method, headers, ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}) });
    const json = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { status: response.status, body: json, data: json.data as never };
  };
  const signUp = async (suffix: string, platformAdmin: boolean) => {
    const email = `${prefix}-${suffix}@example.test`;
    const password = `${randomBytes(18).toString('base64url')}Aa1!`;
    await auth.api.signUpEmail({ body: { email, password, name: `Projects ${suffix}`, termsVersion: CURRENT_TERMS_VERSION } as never });
    const user = await db.user.update({ where: { email }, data: { emailVerified: true } });
    users.push(user.id);
    const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
    const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    if (platformAdmin) {
      await db.platformGrant.create({ data: { userId: user.id, role: 'PlatformAdmin', grantedBy: user.id } });
      await db.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
    }
    return { user, cookie };
  };

  try {
    const admin = await signUp('admin', true);
    const visitor = await signUp('visitor', false);
    const organization = await db.$transaction(async tx => {
      const created = await tx.organization.create({ data: { legalName: `${prefix} Legal`, displayName: `${prefix} Org`, slug: `${prefix}-org`, type: 'NGO', country: 'PS', city: 'نابلس', createdBy: visitor.user.id, verification: 'verified' } });
      await tx.party.create({ data: { organizationId: created.id } });
      await tx.membership.create({ data: { userId: visitor.user.id, organizationId: created.id, roles: ['Owner'] } });
      return created;
    });
    organizations.push(organization.id);
    const nablus = await db.city.findFirstOrThrow({ where: { country: 'PS', nameEn: 'Nablus' } });
    const ramallah = await db.city.findFirstOrThrow({ where: { country: 'PS', nameEn: 'Ramallah' } });
    const make = async (suffix: string) => {
      const project = await db.project.create({ data: { organizationId: organization.id, type: 'charity', slug: `${prefix.slice(0, 8)}-${suffix}`, title: `Project ${suffix}`, summary: 'A project the admin edits.', cityId: nablus.id, managerId: visitor.user.id, createdBy: visitor.user.id, state: 'published', publishedAt: new Date() } });
      projects.push(project.id);
      await db.campaign.create({ data: { projectId: project.id, goalMinor: BigInt(100000), currency: 'ILS', policy: 'flexible', endsAt: new Date(Date.now() + 30 * 86_400_000) } });
      return project;
    };
    const project = await make('main');
    const tied = await make('tied');
    const fresh = await make('fresh');
    await db.fundingPool.create({ data: { projectId: tied.id, currency: 'ILS' } });

    // --- The gate -----------------------------------------------------------------------------------
    assert.equal((await call('GET', '/admin/projects', { cookie: visitor.cookie })).status, 403);
    assert.equal((await call('PATCH', `/admin/projects/${project.id}`, { cookie: visitor.cookie, body: { version: 1, title: 'x' } })).status, 403);
    assert.equal((await call('DELETE', `/admin/projects/${project.id}`, { cookie: visitor.cookie })).status, 403);

    // --- List and detail -------------------------------------------------------------------------------
    const list = (await call('GET', `/admin/projects?type=charity&q=${prefix.slice(0, 8)}`, { cookie: admin.cookie })).data as Array<{ id: string; campaign: { goalMinor: string } | null }>;
    assert.equal(list.length, 3);
    assert.equal(list.find(row => row.id === project.id)?.campaign?.goalMinor, '100000');
    let detail = (await call('GET', `/admin/projects/${project.id}`, { cookie: admin.cookie })).data as Detail;
    assert.equal(detail.deletable, true);
    assert.equal(((await call('GET', `/admin/projects/${tied.id}`, { cookie: admin.cookie })).data as Detail).deletable, false, 'a project with a funding pool is tied to money');

    // --- Text, track, city, state --------------------------------------------------------------------------
    const edited = await call('PATCH', `/admin/projects/${project.id}`, { cookie: admin.cookie, body: { version: detail.version, title: 'Edited by the admin', cityId: ramallah.id, state: 'paused', stateReason: 'Checking documents' } });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    detail = edited.data as Detail;
    assert.equal(detail.title, 'Edited by the admin');
    assert.equal(detail.state, 'paused');
    assert.equal((await call('PATCH', `/admin/projects/${project.id}`, { cookie: admin.cookie, body: { version: 1, title: 'stale' } })).status, 409, 'a stale version is refused');
    assert.equal((await call('PATCH', `/admin/projects/${tied.id}`, { cookie: admin.cookie, body: { version: tied.version, type: 'venture' } })).status, 409, 'a published project keeps its track');
    const cancelled = (await call('PATCH', `/admin/projects/${project.id}`, { cookie: admin.cookie, body: { version: detail.version, state: 'cancelled' } })).data as Detail & { publishedAt: string | null };
    assert.equal(cancelled.publishedAt, null, 'the publication date follows the state');
    const draft = (await call('PATCH', `/admin/projects/${project.id}`, { cookie: admin.cookie, body: { version: cancelled.version, state: 'draft', type: 'enablement' } })).data as Detail;
    assert.equal(draft.type, 'enablement', 'an unpublished project can change track');
    detail = draft;
    detail = (await call('PATCH', `/admin/projects/${project.id}`, { cookie: admin.cookie, body: { version: detail.version, state: 'published' } })).data as Detail;

    // --- Visibility: hidden leaves the public site; restore brings it back --------------------------------
    const publicStatus = async () => (await call('GET', `/projects/${project.slug}`)).status;
    assert.equal(await publicStatus(), 200);
    detail = (await call('PATCH', `/admin/projects/${project.id}`, { cookie: admin.cookie, body: { version: detail.version, visibility: 'removed' } })).data as Detail;
    assert.equal(detail.adminVisibility, 'removed');
    assert.equal(await publicStatus(), 404, 'a removed project has no public page');
    assert.equal(((await call('GET', `/projects?organization=${organization.slug}`)).data as Array<{ slug: string }>).some(card => card.slug === project.slug), false, 'nor a card');
    detail = (await call('PATCH', `/admin/projects/${project.id}`, { cookie: admin.cookie, body: { version: detail.version, visibility: 'visible' } })).data as Detail;
    assert.equal(await publicStatus(), 200);

    // --- Funding, budget, stages ----------------------------------------------------------------------------
    detail = (await call('PUT', `/admin/projects/${project.id}/campaign`, { cookie: admin.cookie, body: { version: detail.version, goalMinor: '150000', endsAt: new Date(Date.now() + 60 * 86_400_000).toISOString() } })).data as Detail;
    assert.equal(detail.campaign?.goalMinor, '150000');
    assert.equal((await call('PUT', `/admin/projects/${project.id}/campaign`, { cookie: admin.cookie, body: { version: detail.version, goalMinor: '150000', policy: 'all_or_nothing', endsAt: new Date(Date.now() + 60 * 86_400_000).toISOString() } })).status, 409, 'the policy is fixed after publication');
    assert.equal((await call('PUT', `/admin/projects/${project.id}/budget`, { cookie: admin.cookie, body: { version: detail.version, reason: 'short', lines: [{ label: 'Materials', amountMinor: '150000' }] } })).status, 422, 'a published project needs a real reason');
    detail = (await call('PUT', `/admin/projects/${project.id}/budget`, { cookie: admin.cookie, body: { version: detail.version, reason: 'Corrected by the admin', lines: [{ label: 'Materials', amountMinor: '100000' }, { label: 'Labour', amountMinor: '50000' }] } })).data as Detail;
    assert.equal(detail.budgetLines.length, 2);
    detail = (await call('PUT', `/admin/projects/${project.id}/budget`, { cookie: admin.cookie, body: { version: detail.version, reason: 'Merged the two lines', lines: [{ label: 'Everything', amountMinor: '150000' }] } })).data as Detail;
    assert.equal(await db.budgetRevision.count({ where: { projectId: project.id } }), 1, 'the replaced budget is kept as a revision');
    assert.equal((await call('PUT', `/admin/projects/${project.id}/milestones`, { cookie: admin.cookie, body: { version: detail.version, milestones: [{ title: 'Stage one', budgetMinor: '150000', weight: 60 }] } })).status, 422, 'weights must total 100');
    detail = (await call('PUT', `/admin/projects/${project.id}/milestones`, { cookie: admin.cookie, body: { version: detail.version, milestones: [{ title: 'Stage one', budgetMinor: '100000', weight: 60 }, { title: 'Stage two', budgetMinor: '50000', weight: 40 }] } })).data as Detail;
    assert.deepEqual(detail.milestones.map(stage => stage.weight), [60, 40]);

    // --- The pin on the map: the organisation (any state, project.update) and the admin ------------------
    const outsider = await signUp('outsider', false);
    const version = (await db.project.findUniqueOrThrow({ where: { id: project.id }, select: { version: true } })).version;
    const pin = { publicLocationPrecision: 'exact', latitude: 32.2211, longitude: 35.2544, version };
    assert.equal((await call('PUT', `/orgs/${organization.id}/projects/${project.id}/location`, { cookie: outsider.cookie, body: pin })).status, 403, 'a non-member cannot move the pin');
    assert.equal((await call('PUT', `/orgs/${organization.id}/projects/${project.id}/location`, { cookie: visitor.cookie, body: { ...pin, publicLocationPrecision: 'city' } })).status, 422, 'city precision stores no point');
    const moved = await call('PUT', `/orgs/${organization.id}/projects/${project.id}/location`, { cookie: visitor.cookie, body: pin });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    const shown = (await call('GET', `/projects/${project.slug}`)).data as { location: { precision: string; point: { latitude: number; longitude: number } } };
    assert.deepEqual([shown.location.precision, shown.location.point.latitude], ['exact', 32.2211], 'the published project shows the new pin');
    detail = (await call('GET', `/admin/projects/${project.id}`, { cookie: admin.cookie })).data as Detail;
    detail = (await call('PATCH', `/admin/projects/${project.id}`, { cookie: admin.cookie, body: { version: detail.version, publicLocationPrecision: 'approximate', latitude: 32.23, longitude: 35.26 } })).data as Detail;
    assert.equal(((await call('GET', `/projects/${project.slug}`)).data as { location: { precision: string } }).location.precision, 'approximate');
    assert.equal((await call('PATCH', `/admin/projects/${project.id}`, { cookie: admin.cookie, body: { version: detail.version, publicLocationPrecision: 'exact', latitude: null, longitude: null } })).status, 422, 'exact needs a point');

    // --- Updates -------------------------------------------------------------------------------------------------
    const update = await db.projectUpdate.create({ data: { projectId: project.id, title: 'First update', body: 'Work started.', publishedBy: visitor.user.id } });
    assert.equal((await call('PATCH', `/admin/projects/${project.id}/updates/${update.id}`, { cookie: admin.cookie, body: { title: 'Corrected update', body: 'Work started on Monday.' } })).status, 200);
    assert.equal((await db.projectUpdate.findUniqueOrThrow({ where: { id: update.id } })).title, 'Corrected update');
    assert.equal((await call('DELETE', `/admin/projects/${project.id}/updates/${update.id}`, { cookie: admin.cookie })).status, 200);

    // --- Delete ---------------------------------------------------------------------------------------------------
    assert.equal((await call('DELETE', `/admin/projects/${tied.id}`, { cookie: admin.cookie })).status, 409, 'a project tied to money is not deleted');
    assert.ok(await db.project.findUnique({ where: { id: tied.id } }));
    assert.equal(((await call('GET', `/admin/projects/${project.id}`, { cookie: admin.cookie })).data as Detail).deletable, false, 'budget history is permanent');
    assert.equal((await call('DELETE', `/admin/projects/${project.id}`, { cookie: admin.cookie })).status, 409, 'so is the project that has it');
    await db.milestone.create({ data: { projectId: fresh.id, sequence: 1, title: 'Only stage', budgetMinor: BigInt(100000), weight: 100 } });
    assert.equal((await call('DELETE', `/admin/projects/${fresh.id}`, { cookie: admin.cookie })).status, 200);
    assert.equal(await db.project.findUnique({ where: { id: fresh.id } }), null);
    assert.equal(await db.milestone.count({ where: { projectId: fresh.id } }), 0, 'its stages went with it');
    assert.equal((await call('GET', `/admin/projects/${fresh.id}`, { cookie: admin.cookie })).status, 404);

    const actions = (await db.identityAuditEvent.findMany({ where: { actorId: admin.user.id }, select: { action: true } })).map(entry => entry.action);
    for (const action of ['project.admin_state_paused', 'project.admin_state_cancelled', 'project.admin_removed', 'project.admin_shown', 'campaign.admin_saved', 'budget.admin_revised', 'milestones.admin_saved', 'project_update.admin_edited', 'project_update.admin_deleted', 'project.admin_deleted']) {
      assert.ok(actions.includes(action), `${action} is audited`);
    }
  } finally {
    await db.$transaction(async tx => {
      await tx.fundingPool.deleteMany({ where: { projectId: { in: projects } } });
      await tx.projectUpdate.deleteMany({ where: { projectId: { in: projects } } });
      await tx.milestone.deleteMany({ where: { projectId: { in: projects } } });
      await tx.$executeRawUnsafe('ALTER TABLE budget_revisions DISABLE TRIGGER USER');
      await tx.budgetRevision.deleteMany({ where: { projectId: { in: projects } } });
      await tx.$executeRawUnsafe('ALTER TABLE budget_revisions ENABLE TRIGGER USER');
      await tx.budgetLine.deleteMany({ where: { projectId: { in: projects } } });
      await tx.campaign.deleteMany({ where: { projectId: { in: projects } } });
      await tx.project.deleteMany({ where: { id: { in: projects } } });
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
