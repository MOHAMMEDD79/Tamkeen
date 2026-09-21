import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../packages/config/dist/index.js';
import { createDatabase } from '../database/dist/client.js';

const config = loadConfig(process.env);
const sourceUrl = new URL(config.databaseUrl);
const source = sourceUrl.pathname.slice(1);
if (!['demo', 'test'].includes(config.environment)) throw new Error('Restore rehearsal is restricted to demo/test');
if (!['127.0.0.1', 'localhost'].includes(sourceUrl.hostname)) throw new Error('Restore rehearsal requires loopback PostgreSQL');
if (!/^[a-zA-Z0-9_]+$/.test(source) || (!source.toLowerCase().includes('demo') && !source.toLowerCase().includes('test'))) throw new Error('Source database name must be a guarded demo/test name');

const backup = `${source}_backup_rehearsal`;
const restored = `${source}_restore_rehearsal`;
const quoted = value => `"${value.replaceAll('"', '""')}"`;
const adminUrl = new URL(sourceUrl); adminUrl.pathname = '/postgres';
const admin = createDatabase(adminUrl.toString());
const started = Date.now();

const snapshot = async client => {
  const counts = await client.$queryRawUnsafe(`
    SELECT
      (SELECT count(*)::int FROM users) users,
      (SELECT count(*)::int FROM organizations) organizations,
      (SELECT count(*)::int FROM projects) projects,
      (SELECT count(*)::int FROM contributions) contributions,
      (SELECT count(*)::int FROM ledger_entries) ledger_entries,
      (SELECT count(*)::int FROM data_room_documents) data_room_documents
  `);
  const unbalanced = await client.$queryRawUnsafe(`
    SELECT count(*)::int AS count FROM (
      SELECT transaction_id FROM ledger_entries GROUP BY transaction_id HAVING sum(debit_minor) <> sum(credit_minor)
    ) bad
  `);
  const dangling = await client.$queryRawUnsafe(`
    SELECT count(*)::int AS count
    FROM data_room_documents d LEFT JOIN offerings o ON o.id = d.offering_id
    WHERE o.id IS NULL
  `);
  return { ...counts[0], unbalancedJournals: unbalanced[0].count, danglingDataRoomDocuments: dangling[0].count };
};

try {
  for (const name of [backup, restored]) {
    await admin.$queryRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${name} AND pid <> pg_backend_pid()`;
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${quoted(name)}`);
  }
  await admin.$queryRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${source} AND pid <> pg_backend_pid()`;
  await admin.$executeRawUnsafe(`CREATE DATABASE ${quoted(backup)} WITH TEMPLATE ${quoted(source)}`);
  await admin.$executeRawUnsafe(`CREATE DATABASE ${quoted(restored)} WITH TEMPLATE ${quoted(backup)}`);

  const restoredUrl = new URL(sourceUrl); restoredUrl.pathname = `/${restored}`;
  const client = createDatabase(restoredUrl.toString());
  try {
    const result = await snapshot(client);
    if (result.unbalancedJournals !== 0 || result.danglingDataRoomDocuments !== 0) throw new Error(`Restore validation failed: ${JSON.stringify(result)}`);
    const cleanFiles = await client.$queryRawUnsafe("SELECT storage_key FROM data_room_documents WHERE scan_state = 'clean' AND storage_key IS NOT NULL");
    const missingFiles = cleanFiles.filter(row => !existsSync(resolve(process.cwd(), '.local', 'dataroom-files', 'clean', ...row.storage_key.split('/'))));
    if (missingFiles.length) throw new Error(`${missingFiles.length} clean data-room file reference(s) are missing from local storage`);
    console.log(JSON.stringify({ event: 'restore_rehearsal_passed', source, backup, restored, rpoMinutes: 0, elapsedSeconds: Math.ceil((Date.now() - started) / 1000), counts: result, cleanFileReferences: cleanFiles.length }, null, 2));
  } finally { await client.$disconnect(); }
} finally {
  for (const name of [restored, backup]) {
    await admin.$queryRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${name} AND pid <> pg_backend_pid()`;
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${quoted(name)}`);
  }
  await admin.$disconnect();
}
