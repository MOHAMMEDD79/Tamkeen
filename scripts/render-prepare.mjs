/**
 * Builds the demo database during Render's build step, so a cold start serves a full site rather
 * than spending minutes seeding while the health check waits.
 *
 * Runs the same scripts a local machine runs, in the same order, through the same services.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
  child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited ${code}`))));
  child.on('error', reject);
});

await run(process.execPath, ['scripts/render-env.mjs']);

const postgres = spawn(process.execPath, ['--env-file=.env', 'scripts/postgres.mjs'], { cwd: root, stdio: 'inherit' });
const { createConnection } = await import('node:net');
let up = false;
for (let attempt = 0; attempt < 90 && !up; attempt += 1) {
  try {
    await new Promise((resolve, reject) => {
      const socket = createConnection({ host: '127.0.0.1', port: 55432 }, () => { socket.end(); resolve(); });
      socket.on('error', reject);
    });
    up = true;
  } catch { await new Promise(done => setTimeout(done, 1000)); }
}
if (!up) throw new Error('PostgreSQL did not start during the build');

try {
  for (const script of ['db:migrate', 'db:seed', 'demo:accounts', 'orgs:real', 'demo:jerusalem', 'demo:invest']) {
    console.log(`\n--- ${script} ---`);
    await run('pnpm', ['run', script]);
  }
  // Covers last: it needs the projects, offerings, programmes and jobs to exist.
  console.log('\n--- demo:covers ---');
  await run('pnpm', ['run', 'demo:covers', '--', '--replace']);
} finally {
  postgres.kill('SIGTERM');
  // Give PostgreSQL a moment to shut down cleanly, so the data directory is consistent.
  await new Promise(done => setTimeout(done, 6000));
}
console.log('\ndemo data prepared');
