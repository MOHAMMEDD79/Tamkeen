import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { createApp } from '../apps/api/dist/app.js';
import type { AddressInfo } from 'node:net';

/**
 * The public surface over real HTTP.
 *
 * PART-04 acceptance: tenant and public privacy, filters that live in the URL, public location
 * only, and distinguishable empty and error states. These are checked against a running Nest app
 * rather than by calling the service directly, because a projection can be correct in the service
 * and still be widened by a controller.
 */

const config = loadConfig(process.env);

test('the public API exposes only published projects, allowlisted fields and validated filters', async () => {
  const app = await createApp(config);
  await app.listen(0, '127.0.0.1');
  const port = (app.getHttpServer().address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}/api/v1`;
  const db = createDatabase(config.databaseUrl);
  const get = async (path: string) => {
    const response = await fetch(`${base}${path}`);
    return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
  };

  try {
    // --- Every public read works without a session ------------------------------------------
    for (const path of ['/projects', '/organizations', '/map/projects', '/cities', '/impact']) {
      const result = await get(path);
      assert.equal(result.status, 200, `${path} must be readable by a visitor`);
      assert.equal(Array.isArray(result.body.data) || typeof result.body.data === 'object', true);
    }

    // --- A draft is absent from every public surface -------------------------------------------
    const drafts = await db.project.findMany({ where: { state: 'draft' }, select: { slug: true }, take: 5 });
    const browse = await get('/projects');
    const visibleSlugs = new Set((browse.body.data as Array<{ slug: string }>).map(item => item.slug));
    for (const draft of drafts) {
      assert.equal(visibleSlugs.has(draft.slug), false, `draft ${draft.slug} must not appear in the public list`);
      const direct = await get(`/projects/${encodeURIComponent(draft.slug)}`);
      // 404 rather than 403: a forbidden response would confirm the project exists.
      assert.equal(direct.status, 404, 'a draft must be reported absent, not forbidden');
      assert.equal((direct.body.error as { code: string } | undefined)?.code, 'not_found');
    }

    // --- No legal name reaches any public payload ----------------------------------------------
    const legalNames = (await db.organization.findMany({ select: { legalName: true, displayName: true } }))
      .filter(organization => organization.legalName !== organization.displayName)
      .map(organization => organization.legalName);
    for (const path of ['/projects', '/organizations', '/map/projects']) {
      const payload = JSON.stringify((await get(path)).body);
      for (const legalName of legalNames) {
        assert.equal(payload.includes(legalName), false, `${path} leaked a legal name`);
      }
    }

    // --- The card shape is exactly the allowlist -------------------------------------------------
    const cards = browse.body.data as Array<Record<string, unknown>>;
    if (cards.length) {
      const card = cards[0] as Record<string, unknown>;
      assert.deepEqual(Object.keys(card).sort(), ['coverUrl', 'location', 'organization', 'publishedAt', 'slug', 'state', 'summary', 'title', 'type']);
      const organization = card.organization as Record<string, unknown>;
      assert.deepEqual(Object.keys(organization).sort(), ['city', 'country', 'displayName', 'logoUrl', 'slug', 'type', 'verified']);
      // No internal identifier is published anywhere in the card.
      assert.equal(JSON.stringify(card).includes('"id"'), false, 'a public card must carry no internal id');
    }

    // --- A project that does not exist is a 404, not a 500 ---------------------------------------
    assert.equal((await get('/projects/definitely-not-a-real-slug')).status, 404);
    assert.equal((await get('/organizations/definitely-not-a-real-slug/profile')).status, 404);

    // --- Filters are an allowlist and are validated ----------------------------------------------
    assert.equal((await get('/projects?type=charity')).status, 200);
    assert.equal((await get('/projects?type=nonsense')).status, 422, 'an unknown track must be refused, not ignored');
    assert.equal((await get('/projects?cityId=not-a-uuid')).status, 422);
    assert.equal((await get('/projects?limit=0')).status, 422);
    assert.equal((await get('/projects?limit=9999')).status, 422, 'the page size ceiling is enforced server side');
    // An unknown parameter is stripped rather than passed through to the database.
    assert.equal((await get('/projects?state=draft&organizationId=1')).status, 200, 'unknown filters are ignored');
    const smuggled = await get('/projects?state=draft');
    for (const draft of drafts) {
      assert.equal((smuggled.body.data as Array<{ slug: string }>).some(item => item.slug === draft.slug), false, 'a client must not be able to ask for drafts');
    }

    // --- Published coordinates never exceed the declared precision --------------------------------
    for (const item of browse.body.data as Array<{ location: { precision: string; point: { latitude: number; longitude: number } | null } }>) {
      const point = item.location.point;
      if (!point) continue;
      if (item.location.precision === 'approximate') {
        // Two decimal places: a neighbourhood, never a building.
        assert.equal(Number(point.latitude.toFixed(2)), point.latitude, 'an approximate point must be rounded');
        assert.equal(Number(point.longitude.toFixed(2)), point.longitude);
      }
      assert.equal(Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180, true);
    }

    // --- Writes still require a session and a matching origin --------------------------------------
    const anonymousBookmark = await fetch(`${base}/bookmarks`, { method: 'POST', headers: { 'content-type': 'application/json', origin: config.appBaseUrl }, body: JSON.stringify({ projectSlug: 'anything' }) });
    assert.equal(anonymousBookmark.status, 401, 'saving a project requires a session');
    const foreignOrigin = await fetch(`${base}/bookmarks`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example' }, body: JSON.stringify({ projectSlug: 'anything' }) });
    assert.equal(foreignOrigin.status, 403, 'a cross-origin mutation is refused before authentication is considered');
    assert.equal((await fetch(`${base}/orgs/00000000-0000-4000-8000-000000000000/projects`)).status, 401);
    assert.equal((await fetch(`${base}/me/bookmarks`)).status, 401);

    // --- Impact declares what it cannot count -------------------------------------------------------
    const impact = (await get('/impact')).body.data as { counted: Array<{ definition: string }>; unavailable: Array<{ key: string; part: string }> };
    assert.equal(impact.counted.every(entry => entry.definition.length > 10), true, 'every counted figure carries its definition');
    assert.equal(impact.unavailable.length > 0, true, 'figures with no source are declared unavailable, not reported as zero');
    assert.equal(impact.unavailable.every(entry => /^PART-\d{2}$/.test(entry.part)), true, 'each unavailable figure names the part that will produce it');
  } finally {
    await db.$disconnect();
    await app.close();
  }
});
