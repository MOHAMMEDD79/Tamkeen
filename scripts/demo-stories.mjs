import { spawn } from 'node:child_process';
import { loadConfig } from '../packages/config/dist/index.js';

const config = loadConfig(process.env);
const url = new URL(config.databaseUrl);
if (!['demo', 'test'].includes(config.environment) || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Demo stories are restricted to a local demo/test database');
if (!process.env.npm_execpath) throw new Error('Run demo:stories through pnpm');

const commands = ['db:seed', 'demo:money', 'demo:offering', 'demo:subscription', 'demo:program', 'demo:employment', 'demo:enablement'];
for (const command of commands) {
  console.log(`\n[demo:stories] ${command}`);
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [process.env.npm_execpath, command], { stdio: 'inherit', shell: false, windowsHide: true });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code ?? 1}`)));
  });
}
console.log('\nAll charity, investment, programme, employment and enablement demo stories completed.');
