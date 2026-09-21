/**
 * The only Better Auth routes this API exposes. Everything else the library mounts is answered with
 * 404 before it reaches the handler, so an upstream release cannot silently widen the surface.
 * ADR-012 records why these library paths are used instead of re-implementing the plan's names.
 */
export const AUTH_ROUTES = [
  { method: 'post', path: '/sign-up/email', operationId: 'authRegister' },
  { method: 'post', path: '/sign-in/email', operationId: 'authLogin' },
  { method: 'post', path: '/sign-out', operationId: 'authLogout' },
  // Verification and reset use 6-digit email codes (ADR-012 addendum); the link routes are closed.
  { method: 'post', path: '/email-otp/send-verification-otp', operationId: 'authResendVerification' },
  { method: 'post', path: '/email-otp/verify-email', operationId: 'authVerifyEmail' },
  { method: 'post', path: '/email-otp/request-password-reset', operationId: 'authRequestPasswordReset' },
  { method: 'post', path: '/email-otp/reset-password', operationId: 'authResetPassword' },
  { method: 'post', path: '/two-factor/enable', operationId: 'authEnableTotp' },
  { method: 'post', path: '/two-factor/disable', operationId: 'authDisableTotp' },
  { method: 'post', path: '/two-factor/verify-totp', operationId: 'authVerifyTotp' },
  { method: 'post', path: '/two-factor/verify-backup-code', operationId: 'authVerifyBackupCode' },
  { method: 'post', path: '/two-factor/generate-backup-codes', operationId: 'authGenerateBackupCodes' }
] as const satisfies ReadonlyArray<{ method: 'get' | 'post'; path: string; operationId: string }>;

export const ALLOWED_AUTH_PATHS: ReadonlySet<string> = new Set(AUTH_ROUTES.map(route => route.path));
