/**
 * Runs the whole stack inside one Render web service.
 *
 * The demo profile refuses a remote database on purpose — packages/config insists the host is
 * loopback and the database is tamkeen_demo — so the database runs beside the app in this same
 * container rather than as a managed Render Postgres. Nothing about that guard is relaxed.
 *
 * Only one port is published, and the web app rewrites /api/v1/* to the API, so the browser only
 * ever talks to Next.js: the API stays on loopback and is never exposed.
 *
 * Layout: embedded PostgreSQL on 127.0.0.1:55432, the API on 127.0.0.1:4000, Next.js on $PORT.
 * The data is seeded at build time; this only fills it in if the build's copy did not survive.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options });
  child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited ${code}`))));
  child.on('error', reject);
});

await run(process.execPath, ['scripts/render-env.mjs']);

// --- database ---------------------------------------------------------------------------------
const directory = new URL('../.local/postgres', import.meta.url);
const seeded = existsSync(fileURLToPath(new URL('PG_VERSION', `${directory}/`)));
const postgres = spawn(process.execPath, ['--env-file=.env', 'scripts/postgres.mjs'], { cwd: root, stdio: 'inherit' });

const ready = async () => {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const { createConnection } = await import('node:net');
      await new Promise((resolve, reject) => {
        const socket = createConnection({ host: '127.0.0.1', port: 55432 }, () => { socket.end(); resolve(); });
        socket.on('error', reject);
      });
      return true;
    } catch { await new Promise(done => setTimeout(done, 1000)); }
  }
  return false;
};
if (!await ready()) throw new Error('PostgreSQL did not start');
console.log('database up');

// The build seeds this; if the build's filesystem did not carry over, do it now rather than serve
// an empty site.
if (!seeded) {
  console.log('no database found from the build — preparing it now, this takes a few minutes');
  await run('pnpm', ['run', 'render:prepare-data']);
}

// --- the two application processes ---------------------------------------------------------------
// The API runs from its own directory, exactly as `pnpm dev` starts it: it keeps uploaded logos
// and site media under apps/api/.local, which is where the cover images were published.
/**
 * Both processes are started directly rather than through pnpm, and both are given a heap ceiling.
 *
 * A `pnpm --filter ... exec` wrapper sits in memory for the lifetime of the service and cost 118MB
 * of the 512MB this plan allows — more than PostgreSQL and Next.js together. Spawning the binaries
 * directly removes it.
 */
const heap = ['--max-old-space-size=160'];
const api = spawn(process.execPath, [...heap, '--env-file=../../.env', 'dist/main.js'], {
  cwd: new URL('apps/api/', `file://${root}`).pathname, stdio: 'inherit'
});
const port = process.env.PORT ?? '3000';
// Render routes to 0.0.0.0; the repo's own start script binds loopback, which would be unreachable.
const web = spawn(process.execPath, [...heap, 'node_modules/next/dist/bin/next', 'start', '--hostname', '0.0.0.0', '--port', port], {
  cwd: new URL('apps/web/', `file://${root}`).pathname, stdio: 'inherit', env: { ...process.env, PORT: port }
});

const children = [postgres, api, web];
let stopping = false;
const stop = signal => {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) child.kill(signal);
  setTimeout(() => process.exit(0), 8000).unref();
};
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
for (const child of children) {
  child.on('exit', code => {
    if (stopping) return;
    console.error(`a process exited with ${code}; stopping the service so Render restarts it`);
    stop('SIGTERM');
    process.exitCode = code ?? 1;
  });
}
