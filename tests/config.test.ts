import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../packages/config/src/index.js';

const safe = {
  APP_ENV: 'demo', DATABASE_URL: 'postgresql://local:secret@127.0.0.1:55432/tamkeen_demo',
  SESSION_SECRET: 'a'.repeat(48), APP_BASE_URL: 'http://127.0.0.1:3000', API_BASE_URL: 'http://127.0.0.1:4000',
  API_PORT: '4000', API_HOST: '127.0.0.1', WORKER_HEARTBEAT_MS: '10000',
  PAYMENT_MODE: 'simulator', EMAIL_MODE: 'mailpit', MONEY_ENABLED: 'false', INVESTMENT_ENABLED: 'false'
};
test('accepts the isolated local profile', () => assert.equal(loadConfig(safe).environment, 'demo'));
test('private local auth delivery is allowed only in demo/test', () => {
  assert.equal(loadConfig({ ...safe, EMAIL_MODE: 'local-outbox' }).emailMode, 'local-outbox');
  assert.throws(() => loadConfig({ ...safe, APP_ENV: 'production', EMAIL_MODE: 'local-outbox' }));
});
test('refuses real payments, live email and provider secrets before adapters exist', () => {
  for (const override of [{ MONEY_ENABLED: 'true' }, { INVESTMENT_ENABLED: 'true' }, { PAYMENT_MODE: 'live' }, { EMAIL_MODE: 'smtp' }, { STRIPE_SECRET_KEY: 'sk_live_private' }, { RESEND_API_KEY: 'private' }]) {
    assert.throws(() => loadConfig({ ...safe, ...override }));
  }
});
test('resend is the one real email adapter, demo/test only, and needs a key and a sender', () => {
  const key = 're_' + 'x'.repeat(24);
  const resend = { ...safe, EMAIL_MODE: 'resend', RESEND_API_KEY: key, EMAIL_FROM: 'Tamkeen <onboarding@resend.dev>' };
  const config = loadConfig(resend);
  assert.equal(config.emailMode, 'resend');
  assert.equal(config.resend?.from, 'Tamkeen <onboarding@resend.dev>');
  assert.equal(loadConfig({ ...safe, EMAIL_MODE: 'local-outbox' }).resend, undefined);
  assert.throws(() => loadConfig({ ...resend, APP_ENV: 'production' }));
  assert.throws(() => loadConfig({ ...resend, RESEND_API_KEY: '' }));
  assert.throws(() => loadConfig({ ...resend, EMAIL_FROM: 'Tamkeen <a@b.test>\r\nBcc: x@y.test' }), 'a sender with a line break could inject headers');
  assert.throws(() => loadConfig({ ...resend, SENDGRID_API_KEY: 'private' }), 'a resend key does not unlock other providers');
  assert.throws(() => loadConfig({ ...resend, RESEND_API_KEY: `${key}!` }), error => error instanceof Error && !error.message.includes('xxxx'));
});
test('smtp mode needs host, TLS port, user, password and sender, and stays demo/test only', () => {
  const smtp = { ...safe, EMAIL_MODE: 'smtp', SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '465', SMTP_USER: 'me@gmail.com', SMTP_PASSWORD: 'abcd efgh ijkl mnop', EMAIL_FROM: 'Tamkeen <me@gmail.com>' };
  const config = loadConfig(smtp);
  assert.equal(config.emailMode, 'smtp');
  assert.equal(config.smtp?.password, 'abcdefghijklmnop', 'a Gmail app password pasted with spaces still works');
  assert.equal(config.resend, undefined);
  assert.throws(() => loadConfig({ ...smtp, APP_ENV: 'production' }));
  assert.throws(() => loadConfig({ ...smtp, SMTP_PORT: '25' }), 'plain-text SMTP would expose link tokens');
  assert.throws(() => loadConfig({ ...smtp, SMTP_PASSWORD: '' }));
  assert.throws(() => loadConfig({ ...smtp, RESEND_API_KEY: 're_' + 'x'.repeat(24) }), 'an smtp password does not unlock other providers');
  assert.throws(() => loadConfig({ ...safe, SMTP_PASSWORD: 'secret' }), 'a stray smtp password is refused outside smtp mode');
});
test('refuses remote or production-named databases in demo', () => {
  for (const url of ['postgresql://x:secret@db.example.com/tamkeen_demo', 'postgresql://x:secret@127.0.0.1/tamkeen_prod', 'https://127.0.0.1/tamkeen_demo']) assert.throws(() => loadConfig({ ...safe, DATABASE_URL: url }));
});
test('rejects malformed flags, ports and placeholder secrets', () => {
  for (const override of [{ MONEY_ENABLED: 'FALSE' }, { API_PORT: '4e3' }, { API_PORT: '65536' }, { SESSION_SECRET: 'REPLACE_WITH_GENERATED_SECRET' }, { WORKER_HEARTBEAT_MS: '0' }]) assert.throws(() => loadConfig({ ...safe, ...override }));
});
test('validation errors do not disclose configuration secrets', () => {
  const privateValue = 'postgresql://user:top-secret@private.example.com/tamkeen_prod';
  assert.throws(() => loadConfig({ ...safe, DATABASE_URL: privateValue }), error => error instanceof Error && !error.message.includes('top-secret') && !error.message.includes('private.example.com'));
});
