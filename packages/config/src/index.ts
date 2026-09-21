export type AppEnvironment = 'demo' | 'test' | 'staging' | 'production';
export const CURRENT_TERMS_VERSION = 'local-preview-2026-09-16';
export interface RuntimeConfig {
  environment: AppEnvironment;
  databaseUrl: string;
  apiPort: number;
  apiHost: string;
  appBaseUrl: string;
  apiBaseUrl: string;
  heartbeatMs: number;
  sessionSecret: string;
  emailMode: 'mailpit' | 'local-outbox' | 'resend';
  /** Present only when emailMode is 'resend'. Never log this object whole. */
  resend?: { apiKey: string; from: string };
}

// Errors name configuration keys only; never include secret values or connection strings.
export function loadConfig(env: Record<string, string | undefined>): RuntimeConfig {
  const required = (key: string): string => {
    const value = env[key]?.trim();
    if (!value) throw new Error(`Missing configuration: ${key}`);
    return value;
  };
  const environment = required('APP_ENV');
  if (!['demo', 'test', 'staging', 'production'].includes(environment)) throw new Error('Invalid APP_ENV');
  const databaseUrl = required('DATABASE_URL');
  let database: URL;
  try { database = new URL(databaseUrl); } catch { throw new Error('Invalid DATABASE_URL'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error('Invalid DATABASE_URL protocol');
  const secret = required('SESSION_SECRET');
  if (secret.length < 32 || /REPLACE|example|changeme/i.test(secret)) throw new Error('Unsafe SESSION_SECRET');
  const integer = (key: string, min: number, max: number): number => {
    const raw = required(key);
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${key}`);
    return value;
  };
  const url = (key: string): string => {
    let value: URL;
    try { value = new URL(required(key)); } catch { throw new Error(`Invalid ${key}`); }
    if (!['http:', 'https:'].includes(value.protocol) || value.username || value.password) throw new Error(`Invalid ${key}`);
    return value.origin;
  };
  const local = environment === 'demo' || environment === 'test';
  if (local) {
    if (!['127.0.0.1', 'localhost', '[::1]', 'postgres'].includes(database.hostname)) throw new Error('Local environment requires a local database');
    if (!/^\/tamkeen_(demo|test)$/.test(database.pathname)) throw new Error('Local database must be tamkeen_demo or tamkeen_test');
  }
  // No live-money adapter exists. Fail closed in every environment.
  // Resend is the one real email adapter, and only for demo/test: the outbox it relays from stores
  // link tokens in plain text, which is acceptable for a local preview and not for production.
  const emailMode = required('EMAIL_MODE');
  if (required('PAYMENT_MODE') !== 'simulator' || !['mailpit', 'local-outbox', 'resend'].includes(emailMode)) throw new Error('External providers are not implemented');
  if (!local && (emailMode === 'local-outbox' || emailMode === 'resend')) throw new Error(`EMAIL_MODE ${emailMode} is forbidden outside demo/test`);
  if (required('MONEY_ENABLED') !== 'false' || required('INVESTMENT_ENABLED') !== 'false') throw new Error('Financial features are not implemented');
  const forbidden = Object.keys(env).some(key => /^(STRIPE|PAYPAL|ADYEN|PAYMENT|SMTP|SENDGRID|RESEND).*?(SECRET|TOKEN|KEY|PASSWORD)/i.test(key) && Boolean(env[key]) && !(key === 'RESEND_API_KEY' && emailMode === 'resend'));
  if (forbidden) throw new Error('External provider credentials are forbidden in foundation mode');
  let resend: RuntimeConfig['resend'];
  if (emailMode === 'resend') {
    const apiKey = required('RESEND_API_KEY');
    if (!/^re_[A-Za-z0-9_]{16,}$/.test(apiKey)) throw new Error('Invalid RESEND_API_KEY');
    const from = required('EMAIL_FROM');
    // "Name <address>" or a bare address; no line breaks, so the value cannot inject headers.
    if (!/^([^<>\r\n]{1,64} <[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/.test(from)) throw new Error('Invalid EMAIL_FROM');
    resend = { apiKey, from };
  }
  return {
    environment: environment as AppEnvironment, databaseUrl, sessionSecret: secret, emailMode: emailMode as RuntimeConfig['emailMode'], ...(resend ? { resend } : {}),
    apiPort: integer('API_PORT', 1, 65535), apiHost: required('API_HOST'),
    appBaseUrl: url('APP_BASE_URL'), apiBaseUrl: url('API_BASE_URL'),
    heartbeatMs: integer('WORKER_HEARTBEAT_MS', 1000, 60000)
  };
}
