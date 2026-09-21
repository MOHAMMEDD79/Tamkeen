/**
 * Prints the current 6-digit sign-in code for the staff test accounts, so testing a staff role on a
 * local build does not need an authenticator app. Reads the shared key from the gitignored file
 * `pnpm demo:accounts` writes; it has nothing to read on a machine where that never ran.
 *
 *   pnpm demo:code
 */

import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const file = await readFile('.local/demo-accounts.md', 'utf8').catch(() => { throw new Error('Run pnpm demo:accounts first.'); });
const secret = /`([A-Z2-7]{16,})`/.exec(file)?.[1];
if (!secret) throw new Error('No staff key found in .local/demo-accounts.md. Run pnpm demo:accounts again.');

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
let bits = '';
for (const character of secret) bits += alphabet.indexOf(character).toString(2).padStart(5, '0');
const key = Buffer.from(Array.from({ length: Math.floor(bits.length / 8) }, (_, index) => Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2)));
const step = Math.floor(Date.now() / 30_000);
const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
const digest = createHmac('sha1', key).update(counter).digest();
const offset = (digest.at(-1) ?? 0) & 0x0f;
const code = ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
const secondsLeft = 30 - Math.floor((Date.now() / 1000) % 30);
console.log(`Staff code: ${code}  (valid for ${secondsLeft} more seconds)`);
