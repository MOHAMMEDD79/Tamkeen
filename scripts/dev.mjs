import { spawn } from 'node:child_process';
import { loadConfig } from '../packages/config/dist/index.js';

loadConfig(process.env);
const pnpmPath = process.env.npm_execpath;
if (!pnpmPath) throw new Error('Run with pnpm dev');
const child = spawn(process.execPath, [pnpmPath, '--parallel', '--filter', '@tamkeen/api', '--filter', '@tamkeen/worker', '--filter', '@tamkeen/web', 'dev'], { stdio: 'inherit', shell: false, windowsHide: true });
child.on('error', () => { console.error('Unable to start development processes'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
