/**
 * Writes .env from the process environment.
 *
 * Every pnpm script here runs node with `--env-file=.env`, which fails outright if the file is
 * missing, and Render supplies configuration as environment variables rather than as a file. This
 * bridges the two so the existing scripts run unchanged. Values are never printed.
 */
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const port = process.env.PORT ?? '3000';
const base = process.env.RENDER_EXTERNAL_URL ?? process.env.APP_BASE_URL ?? `http://127.0.0.1:${port}`;

const values = {
  APP_ENV: process.env.APP_ENV ?? 'demo',
  APP_BASE_URL: base,
  API_BASE_URL: 'http://127.0.0.1:4000',
  API_PORT: '4000',
  API_HOST: '127.0.0.1',
  WEB_PORT: port,
  // The database lives beside the app in this container: the demo profile refuses a remote host.
  DATABASE_URL: process.env.DATABASE_URL ?? `postgresql://tamkeen:${randomBytes(18).toString('hex')}@127.0.0.1:55432/tamkeen_demo`,
  SESSION_SECRET: process.env.SESSION_SECRET ?? randomBytes(32).toString('hex'),
  PAYMENT_MODE: 'simulator',
  EMAIL_MODE: 'local-outbox',
  RESEND_API_KEY: '',
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_PORT: '465',
  SMTP_USER: '',
  SMTP_PASSWORD: '',
  EMAIL_FROM: process.env.EMAIL_FROM ?? 'tamkeen@example.test',
  MONEY_ENABLED: 'false',
  INVESTMENT_ENABLED: 'false',
  DEFAULT_LOCALE: 'ar',
  DEFAULT_CURRENCY: 'ILS',
  REDIS_URL: 'redis://127.0.0.1:56379',
  STORAGE_ENDPOINT: 'http://127.0.0.1:59000',
  STORAGE_BUCKET: 'tamkeen-demo',
  MAP_PROVIDER: 'osm',
  WORKER_HEARTBEAT_MS: '10000',
  NEXT_TELEMETRY_DISABLED: '1'
};

/**
 * Two values must survive a re-run.
 *
 * The session secret, because rolling it signs everybody out. And the database URL, because the
 * build creates the data directory with the credentials in it — generating a fresh password at
 * start time leaves the application unable to authenticate against the database it just seeded.
 */
if (existsSync('.env')) {
  const current = Object.fromEntries(
    readFileSync('.env', 'utf8').split('\n')
      .map(line => line.split('='))
      .filter(parts => parts.length > 1)
      .map(([key, ...rest]) => [key.trim(), rest.join('=')])
  );
  if (current.SESSION_SECRET) values.SESSION_SECRET = current.SESSION_SECRET;
  if (current.DATABASE_URL) values.DATABASE_URL = current.DATABASE_URL;
}

writeFileSync('.env', `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`, 'utf8');
console.log(`.env written for ${values.APP_ENV} at ${values.APP_BASE_URL} (values not printed)`);
