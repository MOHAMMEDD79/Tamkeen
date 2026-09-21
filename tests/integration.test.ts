import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { createApp } from '../apps/api/dist/app.js';

const config = loadConfig(process.env);
test('real PostgreSQL schema, health and controlled database outage', async () => {
  const db = createDatabase(config.databaseUrl);
  const app = await createApp(config);
  try {
    const version = await db.runtimeMetadata.findUnique({ where: { key: 'foundation_version' } });
    assert.equal(version?.value, '1');
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    assert.equal((await fetch(`${base}/api/v1/health/live`)).status, 200);
    const ready = await fetch(`${base}/api/v1/health/ready`);
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).status, 'ready');
    assert.equal((await fetch(`${base}/api/v1/not-implemented`)).status, 404);
  } finally { await app.close(); await db.$disconnect(); }

  const missingDatabase = new URL(config.databaseUrl);
  missingDatabase.pathname = '/tamkeen_test_database_absent';
  const unavailable = await createApp({ ...config, databaseUrl: missingDatabase.toString() });
  try {
    await unavailable.listen(0, '127.0.0.1');
    const base = await unavailable.getUrl();
    assert.equal((await fetch(`${base}/api/v1/health/live`)).status, 200);
    const result = await fetch(`${base}/api/v1/health/ready`);
    assert.equal(result.status, 503);
    const body = await result.text();
    assert.ok(!body.includes(missingDatabase.password));
    assert.ok(!body.includes('Prisma'));
  } finally { await unavailable.close(); }
});
