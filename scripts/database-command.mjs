import { spawn } from 'node:child_process';
import { loadConfig } from '../packages/config/dist/index.js';

loadConfig(process.env);
if (process.argv[2] !== 'migrate') throw new Error('Only non-destructive migration deployment is supported');
// Use the pnpm runtime path supplied by pnpm itself; never interpolate shell strings.
if (!process.env.npm_execpath) throw new Error('Run using pnpm db:migrate');
const child = spawn(process.execPath, [process.env.npm_execpath, '--filter', '@tamkeen/database', 'exec', 'prisma', 'migrate', 'deploy'], { stdio: 'inherit', shell: false, windowsHide: true });
child.on('error', () => { console.error('Unable to launch migration command'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
