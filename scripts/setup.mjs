import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const envPath = new URL('../.env', import.meta.url);
if (!existsSync(envPath)) {
  const template = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  writeFileSync(envPath, template.replace('REPLACE_LOCAL_PASSWORD', randomBytes(24).toString('hex')).replace('REPLACE_WITH_GENERATED_SECRET', randomBytes(48).toString('hex')), { mode: 0o600 });
  console.log('Created .env with generated local credentials; values are not printed.');
} else { console.log('Preserved existing .env.'); }
mkdirSync(`${root}/.local`, { recursive: true });
console.log('Next: pnpm build, pnpm db:local (keep running), pnpm db:migrate, pnpm db:seed, pnpm dev.');
