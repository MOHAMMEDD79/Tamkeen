import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeReturnTo } from '../apps/web/lib/return-to.js';

test('login redirects are restricted to known internal routes', () => {
  for (const input of ['https://evil.test', '//evil.test', '/\\evil.test', '/%2fevil.test', '/app?next=https://evil.test', '/login', null]) assert.equal(safeReturnTo(input), '/app');
  const invite = `/invitations/${'a'.repeat(43)}`;
  assert.equal(safeReturnTo(invite), invite);
  const ownership = `/ownership-transfers/${'b'.repeat(43)}`;
  assert.equal(safeReturnTo(ownership), ownership);
  const platformInvite = `/platform-invitations/${'b'.repeat(43)}`;
  assert.equal(safeReturnTo(platformInvite), platformInvite);
  assert.equal(safeReturnTo('/onboarding'), '/onboarding');
  assert.equal(safeReturnTo('/app/settings'), '/app/settings');
  const settings = `/org/${'a'.repeat(8)}-${'a'.repeat(4)}-${'a'.repeat(4)}-${'a'.repeat(4)}-${'a'.repeat(12)}/settings`;
  assert.equal(safeReturnTo(settings), settings);
});

test('a route parameter is encoded correctly for an API path, whichever form Next hands over', async () => {
  const { pathSegment } = await import('../apps/web/lib/path-segment.js');
  /*
   * Found in the PART-08 visual pass, and it had been latent since PART-04. Next hands a dynamic
   * segment **still percent-encoded**, so `encodeURIComponent` encoded the percent signs again and
   * the API was asked for a slug that does not exist. Every ASCII slug survives that unharmed,
   * which is why it stayed hidden until the first Arabic slug appeared — in an Arabic-first
   * product, where the public project and organisation pages had the same bug waiting.
   */
  const arabic = 'جولة-توسعة-خط-الإنتاج-41c180';
  const encoded = encodeURIComponent(arabic);
  // Both forms must produce the same, singly-encoded segment.
  assert.equal(pathSegment(arabic), encoded);
  assert.equal(pathSegment(encoded), encoded);
  // Which is to say: it is idempotent, unlike encodeURIComponent.
  assert.equal(pathSegment(pathSegment(arabic)), encoded);
  assert.notEqual(encodeURIComponent(encoded), encoded);
  // ASCII is unchanged, so nothing that worked before changes.
  assert.equal(pathSegment('seed-demo-2026-training-centre'), 'seed-demo-2026-training-centre');
  // A malformed escape is passed through rather than throwing: the API answers "not found", which
  // is the right answer for a bad URL, and a 500 would not be.
  assert.equal(typeof pathSegment('%E0%A4%A'), 'string');
});
