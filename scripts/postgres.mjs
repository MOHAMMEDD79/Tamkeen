import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../packages/config/dist/index.js';

// Node 24 can surface uv_os_get_passwd ENOMEM on locked-down Windows hosts. embedded-postgres only
// needs the uid to decide whether Unix root guards apply; Windows has no uid, so a non-root fallback
// is safe and remains process-local. Other platforms and healthy Windows calls retain native data.
const nativeUserInfo = os.userInfo;
if (process.platform === 'win32') os.userInfo = (...args) => {
  try { return nativeUserInfo(...args); }
  catch (error) { if (error?.info?.syscall !== 'uv_os_get_passwd') throw error; return { uid: -1, gid: -1, username: process.env.USERNAME ?? 'tamkeen-local', homedir: process.env.USERPROFILE ?? process.cwd(), shell: null }; }
};
syncBuiltinESMExports();
const { default: EmbeddedPostgres } = await import('embedded-postgres');

const config = loadConfig(process.env);
if (!['demo', 'test'].includes(config.environment)) throw new Error('Embedded PostgreSQL is for local development only');
const url = new URL(config.databaseUrl);
if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Embedded PostgreSQL requires loopback');
const directory = fileURLToPath(new URL('../.local/postgres', import.meta.url));
const pg = new EmbeddedPostgres({
  databaseDir: directory,
  user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
  port: Number(url.port || 55432), persistent: true, authMethod: 'scram-sha-256',
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  postgresFlags: ['-c', 'listen_addresses=127.0.0.1'],
  onLog: () => {}, onError: () => {}
});
if (!existsSync(`${directory}/PG_VERSION`)) await pg.initialise();
await pg.start();
try {
  const admin = pg.getPgClient();
  await admin.connect();
  try {
    const name = url.pathname.slice(1);
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (existing.rowCount === 0) await pg.createDatabase(name);
  } finally { await admin.end(); }
} catch (error) { await pg.stop(); throw error; }
console.log(`Local PostgreSQL ready on 127.0.0.1:${url.port || '55432'}. Data persists in .local/postgres. Ctrl+C stops it.`);
let stopping = false;
async function stop() { if (stopping) return; stopping = true; await pg.stop(); }
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
