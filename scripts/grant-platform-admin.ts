/**
 * Makes an existing account the platform administrator on a local build.
 *
 * Every other PlatformAdmin grant is issued by an existing PlatformAdmin through /admin/team, so the
 * very first one needs a way in. This is that way, and it is deliberately narrow: it refuses to run
 * outside demo/test, only promotes an account that already exists and verified its email, and says
 * what is still missing (two-step verification) rather than switching it on behind the owner's back.
 *
 *   pnpm admin:grant you@example.com
 */

import { loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';

const config = loadConfig(process.env);
if (!['demo', 'test'].includes(config.environment)) throw new Error(`admin:grant refuses to run in ${config.environment}.`);

const email = process.argv[2]?.trim().toLowerCase();
if (!email) throw new Error('usage: pnpm admin:grant <email of an existing account>');

const db = createDatabase(config.databaseUrl);
try {
  const user = await db.user.findUnique({ where: { email }, select: { id: true, emailVerified: true, twoFactorEnabled: true } });
  if (!user) throw new Error('No account with that email. Sign up on the site first.');
  if (!user.emailVerified) throw new Error('Confirm the account email with its code first.');
  const held = await db.platformGrant.findFirst({ where: { userId: user.id, role: 'PlatformAdmin', revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
  if (held) console.log('This account is already a platform admin.');
  else {
    await db.platformGrant.create({ data: { userId: user.id, role: 'PlatformAdmin', grantedBy: user.id } });
    console.log('Granted PlatformAdmin.');
  }
  console.log(user.twoFactorEnabled
    ? 'Two-step verification is on. Open /ar/admin/site to manage the site.'
    : 'Next: turn on two-step verification at /ar/app/settings — admin pages require it — then open /ar/admin/site.');
} finally {
  await db.$disconnect();
}
