import { spawn } from 'node:child_process';
import { loadConfig } from '../packages/config/dist/index.js';

const config = loadConfig(process.env);
const url = new URL(config.databaseUrl);
const databaseName = url.pathname.slice(1).toLowerCase();
if (!['demo', 'test'].includes(config.environment)) throw new Error('demo:reset is restricted to demo/test environments');
if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('demo:reset requires a loopback PostgreSQL server');
if (!databaseName.includes('demo') && !databaseName.includes('test')) throw new Error('demo:reset refuses a database whose name does not contain demo or test');
if (!process.env.npm_execpath) throw new Error('Run demo:reset through pnpm');

const run = args => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [process.env.npm_execpath, ...args], { stdio: 'inherit', shell: false, windowsHide: true });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${args.join(' ')} exited with ${code ?? 1}`)));
});

console.log(`Resetting guarded local database ${databaseName}. No remote database is allowed.`);
await run(['--filter', '@tamkeen/database', 'exec', 'prisma', 'migrate', 'reset', '--force', '--skip-seed']);
await run(['db:seed']);
console.log('Demo database reset and public seed completed. Run pnpm demo:stories for all scenario data.');
