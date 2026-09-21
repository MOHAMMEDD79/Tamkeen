import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTION_MANIFEST, implementedActions } from '@tamkeen/contracts';
import { isWorkspaceRoute } from '../apps/web/lib/routes.js';

/**
 * screens/09-ROUTE-AND-ACTION-RESOLUTION: a declared route must actually resolve.
 *
 * This exists because of a real failure. In PART-03 five screens were implemented, their components
 * handled the route, and the API tests all passed — but the catch-all router never listed them, so
 * every one of them 404'd. No test noticed, because nothing tested the router. This does.
 *
 * Templated action endpoints (`/checkout/{slug}`) are instantiated with a plausible value before
 * being matched, since the router's job is precisely to recognise the shape rather than the value.
 */

/** Substitutes a realistic value for each `{placeholder}` so the pattern is tested, not the literal. */
function instantiate(route: string): string {
  const uuid = '11111111-2222-3333-4444-555555555555';
  return route
    .replace('{id}', uuid)
    .replace('{projectId}', uuid)
    .replace('{intentId}', uuid)
    .replace('{payoutId}', uuid)
    .replace('{offeringId}', uuid)
    .replace('{programId}', uuid)
    .replace('{cohortId}', uuid)
    .replace('{sessionId}', uuid)
    .replace('{applicationId}', uuid)
    .replace('{jid}', uuid)
    .replace('{aid}', uuid)
    .replace('{pid}', uuid)
    .replace('{caseId}', uuid)
    .replace('{versionId}', uuid)
    .replace('{providerReference}', 'sim_0123456789abcdef01234567')
    .replace('{slug}', 'a-published-project-x7f2')
    .replace(/\{[a-zA-Z]+\}/g, 'token');
}

/** Routes rendered by their own file rather than by the catch-all, so the router must not claim them. */
const OWN_FILE_ROUTES = [
  '/', '/explore', '/map', '/organizations', '/impact', '/about', '/invest', '/opportunities', '/design',
  // PART-12. Volunteering's public list; the certificate check is reached by reference, not by a
  // listing, so only its family prefix appears below.
  '/volunteer'
];
const ownFile = (route: string) =>
  OWN_FILE_ROUTES.includes(route) || /^\/(projects|organizations|design|invest|programs|jobs|volunteer|verify)\//.test(route);

test('every route a screen action navigates to is one the web app can render', () => {
  const unreachable = implementedActions()
    .filter(entry => entry.method === 'NAV')
    .map(entry => instantiate(entry.endpoint))
    .filter(route => !ownFile(route) && !isWorkspaceRoute(route))
    .sort();
  // A NAV target that the router does not recognise is a 404 the component can never rescue.
  assert.deepEqual([...new Set(unreachable)], [], 'a NAV action must target a route the router resolves');
});

test('every page an implemented action lives on is itself reachable', () => {
  const unreachable = implementedActions()
    .map(entry => instantiate(entry.route))
    .filter(route => !ownFile(route) && !isWorkspaceRoute(route))
    .sort();
  assert.deepEqual([...new Set(unreachable)], [], 'a screen carrying a live control must resolve');
});

test('the PART-06 money routes resolve, including the ones that share a prefix', () => {
  const uuid = '11111111-2222-3333-4444-555555555555';
  for (const route of [
    '/app/contributions',
    '/checkout/a-published-project-x7f2',
    `/payments/${uuid}`,
    '/payments/simulate/sim_0123456789abcdef01234567',
    `/org/${uuid}/projects/${uuid}/finance`
  ]) {
    assert.equal(isWorkspaceRoute(route), true, `${route} must resolve`);
  }
  // The payment-result pattern is a UUID, so the simulate path cannot be swallowed by it, and the
  // project-detail pattern must not swallow its own /finance child.
  assert.equal(isWorkspaceRoute('/payments/simulate'), false, 'a simulate path with no reference is not a route');
  assert.equal(isWorkspaceRoute('/payments/not-a-uuid'), false, 'an intent id must look like one');
  assert.equal(isWorkspaceRoute(`/org/${uuid}/projects/${uuid}/finance/extra`), false);
});

test('an unavailable action still declares where it would live, so nothing is silently missing', () => {
  for (const entry of ACTION_MANIFEST) {
    assert.equal(typeof entry.route === 'string' && entry.route.startsWith('/'), true, `${entry.id} needs a route`);
    assert.equal(typeof entry.endpoint === 'string' && entry.endpoint.length > 0, true, `${entry.id} needs an endpoint`);
  }
});
