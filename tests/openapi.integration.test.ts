import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '@tamkeen/config';
import { documentedOperations, openapi } from '@tamkeen/contracts';
import { createApp } from '../apps/api/dist/app.js';
import { AUTH_ROUTES } from '../apps/api/dist/modules/identity/auth-routes.js';

const config = loadConfig(process.env);

interface ExpressLayer { route?: { path: string; methods: Record<string, boolean> }; handle?: { stack?: ExpressLayer[] } }

/** Walks the Express router the Nest app registered and yields `METHOD /path` for every real route. */
function registeredRoutes(stack: ExpressLayer[]): Array<{ method: string; path: string }> {
  const found: Array<{ method: string; path: string }> = [];
  for (const layer of stack) {
    if (layer.route) {
      for (const [method, enabled] of Object.entries(layer.route.methods)) {
        if (enabled && method !== '_all') found.push({ method, path: layer.route.path });
      }
    } else if (layer.handle?.stack) {
      found.push(...registeredRoutes(layer.handle.stack));
    }
  }
  return found;
}

const normalise = (path: string) => path.replace(/^\/api\/v1/, '').replace(/:([A-Za-z0-9_]+)/g, '{$1}');
const key = (entry: { method: string; path: string }) => `${entry.method.toUpperCase()} ${entry.path}`;

test('the OpenAPI document matches the routes the API actually registers, in both directions', async () => {
  const app = await createApp(config);
  await app.init();
  try {
    const router = app.getHttpAdapter().getInstance()._router ?? app.getHttpAdapter().getInstance().router;
    const raw = registeredRoutes(router.stack as ExpressLayer[]);

    // Better Auth is mounted behind one wildcard route; the allowlist is the real surface.
    const wildcard = raw.filter(entry => entry.path.includes('*'));
    assert.equal(wildcard.length > 0, true, 'the Better Auth mount should be present as a wildcard');
    assert.equal(wildcard.every(entry => entry.path === '/api/v1/auth/*splat'), true, 'no wildcard route other than the Better Auth mount may exist');

    const implemented = new Set([
      ...raw.filter(entry => !entry.path.includes('*')).map(entry => key({ method: entry.method, path: normalise(entry.path) })),
      ...AUTH_ROUTES.map(route => key({ method: route.method, path: `/auth${route.path}` }))
    ]);
    const documented = new Map(documentedOperations().map(entry => [key(entry), entry.operationId]));

    const undocumented = [...implemented].filter(entry => !documented.has(entry)).sort();
    const unimplemented = [...documented.keys()].filter(entry => !implemented.has(entry)).sort();
    assert.deepEqual(undocumented, [], 'every registered route must appear in the OpenAPI document');
    assert.deepEqual(unimplemented, [], 'the OpenAPI document must not promise routes that do not exist');

    // Operation identifiers are the client-generation key, so duplicates would silently collide.
    const operationIds = [...documented.values()];
    assert.equal(new Set(operationIds).size, operationIds.length, 'operationIds must be unique');
    assert.equal(operationIds.every(id => /^[a-z][A-Za-z0-9]+$/.test(id)), true, 'operationIds must be lowerCamelCase');

    // Auth operationIds are declared in two places; they must agree.
    const documentedAuthIds = documentedOperations().filter(entry => entry.path.startsWith('/auth/') && !entry.path.startsWith('/auth/mfa/')).map(entry => entry.operationId).sort();
    assert.deepEqual(documentedAuthIds, AUTH_ROUTES.map(route => route.operationId).sort());
  } finally {
    await app.close();
  }
});

test('every documented operation declares a permission, a success response and the standard error envelope', () => {
  const items = Object.entries(openapi.paths as Record<string, Record<string, Record<string, unknown>>>);
  assert.equal(items.length > 0, true);
  for (const [path, item] of items) {
    for (const [method, op] of Object.entries(item)) {
      const where = `${method.toUpperCase()} ${path}`;
      const responses = op.responses as Record<string, unknown>;
      assert.equal(typeof op['x-permission'], 'string', `${where} must declare the permission it asserts`);
      assert.equal(String(op['x-permission']).length > 0, true, `${where} must declare a non-empty permission`);
      assert.equal(typeof op.summary === 'string' && (op.summary as string).length > 10, true, `${where} needs a meaningful summary`);
      // 403 and 409 are the two answers a permission- and version-checked API must always be able to give.
      for (const status of ['401', '403', '409']) {
        assert.equal(Object.hasOwn(responses, status), true, `${where} must document ${status}`);
      }
      const success = Object.keys(responses).filter(status => Number(status) >= 200 && Number(status) < 400);
      assert.equal(success.length >= 1, true, `${where} must document a success response`);
    }
  }
});

test('path parameters declared in the document match the placeholders in the path', () => {
  for (const [path, item] of Object.entries(openapi.paths as Record<string, Record<string, { parameters?: Array<{ name: string; in: string }> }>>)) {
    const placeholders = [...path.matchAll(/\{([^}]+)\}/g)].map(match => match[1]).sort();
    for (const [method, op] of Object.entries(item)) {
      const declared = (op.parameters ?? []).filter(parameter => parameter.in === 'path').map(parameter => parameter.name).sort();
      assert.deepEqual(declared, placeholders, `${method.toUpperCase()} ${path} must declare exactly its path parameters`);
    }
  }
});
