import { betterAuth } from 'better-auth';
import { emailOTP, twoFactor } from 'better-auth/plugins';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { CURRENT_TERMS_VERSION, trustedOrigins, type RuntimeConfig } from '@tamkeen/config';
import type { DatabaseClient } from '@tamkeen/database';
import { hashedSessionAdapter } from './session-adapter.js';

export function createAuth(config: RuntimeConfig, db: DatabaseClient) {
  // Verification and password reset send a 6-digit code rather than a link: a link to the local
  // preview only opens on this machine, while a code can be read on a phone and typed here.
  // The row is the outbox: the worker relays it by email, or under local-outbox it stays local.
  const deliverCode = async (recipient: string, code: string, purpose: 'verify-code' | 'reset-code') => {
    if (config.emailMode === 'mailpit' || !['demo', 'test'].includes(config.environment)) throw new APIError('SERVICE_UNAVAILABLE', { message: 'Mail adapter is not configured' });
    await db.localAuthMail.create({ data: { recipient, code, purpose } });
  };
  return betterAuth({
    appName: 'Tamkeen', baseURL: config.apiBaseUrl, basePath: '/api/v1/auth',
    secret: config.sessionSecret, trustedOrigins: trustedOrigins(config),
    plugins: [
      // A remembered device skips the sign-in code for 30 days, but only on a local build: in staging
      // and production every sign-in asks for the code. Sensitive operations re-ask either way.
      twoFactor({ issuer: 'Tamkeen', twoFactorCookieMaxAge: 600, trustDeviceMaxAge: ['demo', 'test'].includes(config.environment) ? 30 * 24 * 3600 : 0 }),
      emailOTP({
        otpLength: 6, expiresIn: 600, allowedAttempts: 5, storeOTP: 'hashed',
        // Sign-up sends a code instead of a link; OTP sign-in is off and its route is not exposed.
        overrideDefaultEmailVerification: true, disableSignUp: true,
        rateLimit: { window: 60, max: 5 },
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type === 'email-verification') await deliverCode(email, otp, 'verify-code');
          else if (type === 'forget-password') await deliverCode(email, otp, 'reset-code');
          // sign-in and change-email codes are never sent: neither flow is enabled.
        }
      })
    ],
    database: hashedSessionAdapter(db),
    user: { additionalFields: {
      termsVersion: { type: 'string', required: true, input: true, returned: false },
      termsAcceptedAt: { type: 'date', required: false, input: false, returned: false }
    } },
    advanced: { database: { generateId: 'uuid' }, ipAddress: { ipAddressHeaders: ['x-tamkeen-client-ip'] }, defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: config.environment === 'production' } },
    session: { expiresIn: 60 * 60 * 24, updateAge: 60 * 60, cookieCache: { enabled: false } },
    verification: { storeIdentifier: 'hashed' },
    emailAndPassword: { enabled: true, requireEmailVerification: true, minPasswordLength: 12, revokeSessionsOnPasswordReset: true },
    // The email-otp plugin replaces sendVerificationEmail with a code; sign-up still triggers it.
    emailVerification: { sendOnSignUp: true, autoSignInAfterVerification: false },
    /**
     * The demo test accounts (`pnpm demo:accounts`) sign in without the six-digit code, on a local
     * build only. They keep two-step verification switched on in the database, so the staff pages
     * that require it still accept them and sensitive actions still ask for a code; only the
     * sign-in prompt is skipped. `.test` is a reserved domain no real person can hold, and in
     * staging or production this hook does nothing.
     */
    hooks: {
      after: createAuthMiddleware(async context => {
        if (context.path !== '/sign-in/email' || !['demo', 'test'].includes(config.environment)) return;
        const signedIn = context.context.newSession;
        if (signedIn?.user.email.endsWith('@tamkeen.test')) signedIn.user.twoFactorEnabled = false;
      })
    },
    rateLimit: { enabled: true, window: 60, max: 30, customRules: { '/sign-in/email': { window: 60, max: 10 }, '/email-otp/request-password-reset': { window: 60, max: 3 } } },
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
