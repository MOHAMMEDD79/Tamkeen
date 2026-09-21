import { createHash } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { twoFactor } from 'better-auth/plugins';
import { APIError } from 'better-auth/api';
import { createAuthMiddleware } from 'better-auth/api';
import { jwtVerify } from 'jose';
import { CURRENT_TERMS_VERSION, type RuntimeConfig } from '@tamkeen/config';
import type { DatabaseClient } from '@tamkeen/database';
import { hashedSessionAdapter } from './session-adapter.js';

export function createAuth(config: RuntimeConfig, db: DatabaseClient) {
  const usedVerificationMarker = (token: string) => {
    const hash = createHash('sha256').update(token).digest('hex');
    return { id: `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`, identifier: `used-email-verification:${hash}` };
  };
  const deliver = async (recipient: string, url: string, purpose: string) => {
    if (config.emailMode !== 'local-outbox' || !['demo', 'test'].includes(config.environment)) throw new APIError('SERVICE_UNAVAILABLE', { message: 'Local mail adapter is not configured' });
    await db.localAuthMail.create({ data: { recipient, url, purpose } });
  };
  return betterAuth({
    appName: 'Tamkeen', baseURL: config.apiBaseUrl, basePath: '/api/v1/auth',
    secret: config.sessionSecret, trustedOrigins: [config.appBaseUrl],
    plugins: [twoFactor({ issuer: 'Tamkeen', twoFactorCookieMaxAge: 600, trustDeviceMaxAge: 0 })],
    database: hashedSessionAdapter(db),
    user: { additionalFields: {
      termsVersion: { type: 'string', required: true, input: true, returned: false },
      termsAcceptedAt: { type: 'date', required: false, input: false, returned: false }
    } },
    advanced: { database: { generateId: 'uuid' }, ipAddress: { ipAddressHeaders: ['x-tamkeen-client-ip'] }, defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: config.environment === 'production' } },
    session: { expiresIn: 60 * 60 * 24, updateAge: 60 * 60, cookieCache: { enabled: false } },
    verification: { storeIdentifier: 'hashed' },
    emailAndPassword: { enabled: true, requireEmailVerification: true, minPasswordLength: 12, revokeSessionsOnPasswordReset: true, sendResetPassword: async ({ user, token }) => deliver(user.email, `${config.appBaseUrl}/reset?token=${encodeURIComponent(token)}`, 'reset') },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => deliver(user.email, url, 'verify')
    },
    hooks: { before: createAuthMiddleware(async context => {
        if (context.path !== '/verify-email') return;
        const token = typeof context.query?.token === 'string' ? context.query.token : '';
        if (!token) return;
        try { await jwtVerify(token, new TextEncoder().encode(config.sessionSecret), { algorithms: ['HS256'] }); } catch { return; }
        const marker = usedVerificationMarker(token);
        try {
          await db.verification.create({ data: { ...marker, value: 'consumed', expiresAt: new Date(Date.now() + 30 * 24 * 3600_000) } });
          return;
        } catch (error) {
          if ((error as { code?: string }).code !== 'P2002') throw error;
        }
        const callback = typeof context.query?.callbackURL === 'string' ? context.query.callbackURL : undefined;
        if (callback) {
          const redirect = new URL(callback);
          redirect.searchParams.delete('success');
          redirect.searchParams.set('error', 'TOKEN_REPLAYED');
          throw context.redirect(redirect.toString());
        }
        throw new APIError('UNAUTHORIZED', { message: 'Verification token was already used' });
      }) },
    rateLimit: { enabled: true, window: 60, max: 30, customRules: { '/sign-in/email': { window: 60, max: 10 }, '/request-password-reset': { window: 60, max: 3 } } },
    databaseHooks: {
      user: { create: { before: async user => {
        const name = user.name.trim();
        if (name.length < 2 || name.length > 100) throw new APIError('BAD_REQUEST', { message: 'Invalid display name' });
        if (user.termsVersion !== CURRENT_TERMS_VERSION) throw new APIError('BAD_REQUEST', { message: 'Terms acceptance is required' });
        return { data: { ...user, name, email: user.email.trim().toLowerCase(), termsVersion: CURRENT_TERMS_VERSION, termsAcceptedAt: new Date() } };
      } } },
      session: { create: { before: async session => {
        const user = await db.user.findUnique({ where: { id: session.userId } });
        if (user?.status !== 'active') throw new APIError('UNAUTHORIZED', { message: 'Account is unavailable' });
        return { data: session };
      } } }
    }
  });
}
export type Auth = ReturnType<typeof createAuth>;
