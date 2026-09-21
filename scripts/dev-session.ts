/**
 * Mints a browser session for a throwaway fixture account, for the visual acceptance gate.
 *
 * The gate has to drive real screens as a real signed-in person, and doing that by hand means
 * handling a password. This script keeps that off the screen entirely: it creates the account
 * through Better Auth's own API with a random secret it never reuses, marks the address verified,
 * signs in, and prints the session cookie Better Auth itself produced — correctly signed, with no
 * credential typed into a form and none stored anywhere afterwards.
 *
 * It refuses to run outside demo/test/development, and `--remove` deletes everything it created.
 *
 *   pnpm dev:session gate-candidate@example.test "اسم الحساب"
 *   pnpm dev:session gate-operator@example.test "اسم الحساب" --roles Recruiter,ProgramManager
 *   pnpm dev:session gate-candidate@example.test --remove
 */

import { randomBytes } from 'node:crypto';
import { CURRENT_TERMS_VERSION, loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { createAuth } from '../apps/api/dist/modules/identity/auth.js';

const config = loadConfig(process.env);
if (!['demo', 'test', 'development'].includes(config.environment)) {
  throw new Error(`dev:session refuses to run in ${config.environment}.`);
}

const [email, ...rest] = process.argv.slice(2);
if (!email) throw new Error('usage: dev:session <email> [name] [--roles A,B] [--remove]');
const remove = rest.includes('--remove');
const rolesIndex = rest.indexOf('--roles');
const roles = rolesIndex >= 0 ? (rest[rolesIndex + 1] ?? '').split(',').filter(Boolean) : [];
const name = rest.find(arg => !arg.startsWith('--') && arg !== rest[rolesIndex + 1]) ?? 'حساب فحص بصري';

const SEED_TAG = 'seed-demo-2026';
const db = createDatabase(config.databaseUrl);
const auth = createAuth(config, db);

try {
  if (remove) {
    const user = await db.user.findUnique({ where: { email } });
    if (!user) {
      console.log('nothing to remove');
    } else {
      await db.session.deleteMany({ where: { userId: user.id } });
      await db.account.deleteMany({ where: { userId: user.id } });
      await db.membership.deleteMany({ where: { userId: user.id } });
      await db.party.deleteMany({ where: { userId: user.id } });
      await db.individualProfile.deleteMany({ where: { userId: user.id } });
      await db.user.delete({ where: { id: user.id } });
      console.log(`removed ${email}`);
    }
  } else {
    // A password this process invents, uses once and forgets. It is never printed.
    const password = `${randomBytes(24).toString('base64url')}Aa1!`;

    let user = await db.user.findUnique({ where: { email } });
    if (!user) {
      await auth.api.signUpEmail({ body: { email, password, name, termsVersion: CURRENT_TERMS_VERSION } as never });
      user = await db.user.findUniqueOrThrow({ where: { email } });
    } else {
      // An account that already exists gets its credential replaced, so a re-run always works.
      await db.account.deleteMany({ where: { userId: user.id, providerId: 'credential' } });
      const ctx = await auth.$context;
      const hash = await ctx.password.hash(password);
      await db.account.create({ data: { userId: user.id, accountId: user.id, providerId: 'credential', password: hash } });
    }

    await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });

    if (roles.length > 0) {
      const org = await db.organization.findFirstOrThrow({ where: { slug: `${SEED_TAG}-nabta` } });
      await db.party.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id, kind: 'individual' } }).catch(() => undefined);
      const existing = await db.membership.findUnique({ where: { userId_organizationId: { userId: user.id, organizationId: org.id } } });
      if (existing) {
        await db.membership.update({ where: { userId_organizationId: { userId: user.id, organizationId: org.id } }, data: { roles, status: 'active' } });
      } else {
        await db.membership.create({ data: { userId: user.id, organizationId: org.id, roles, status: 'active' } });
      }
      console.log(`organization: ${org.id} (${roles.join(', ')})`);
    }

    const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
    const cookie = response.headers.getSetCookie().find(value => value.startsWith('better-auth.session_token='));
    if (!cookie) throw new Error(`sign-in produced no session cookie (status ${response.status})`);
    console.log(`user: ${user.id}`);
    console.log(`cookie: ${cookie.split(';')[0]}`);
  }
} finally {
  await db.$disconnect();
}
