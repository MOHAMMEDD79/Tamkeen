import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAuthMail, resendSender, smtpSender } from '../apps/worker/src/auth-mail.js';

const smtpConfig = { host: 'smtp.gmail.com', port: 465, user: 'me@gmail.com', password: 'app-password', from: 'Tamkeen <me@gmail.com>' };

test('smtp sender sends from the configured address with a stable Message-ID', async () => {
  const sent: Record<string, unknown>[] = [];
  const send = smtpSender(smtpConfig, { sendMail: (async (options: Record<string, unknown>) => { sent.push(options); return {}; }) as never });
  await send(buildAuthMail({ recipient: 'anyone@example.test', purpose: 'invitation', url: 'https://x.test/v' }), 'tamkeen-auth-mail-1');
  assert.equal(sent[0]!.to, 'anyone@example.test');
  assert.equal(sent[0]!.from, 'Tamkeen <me@gmail.com>');
  assert.equal(sent[0]!.messageId, '<tamkeen-auth-mail-1@tamkeen.local>');
});

test('smtp failures keep only the response code, never the server text', async () => {
  const send = smtpSender(smtpConfig, { sendMail: (async () => { throw Object.assign(new Error('535 Username me@gmail.com and Password not accepted'), { responseCode: 535, code: 'EAUTH' }); }) as never });
  await assert.rejects(send(buildAuthMail({ recipient: 'a@example.test', purpose: 'invitation', url: 'https://x.test/r' }), 'k'), (error: Error) => error.name === 'Smtp535' && !error.message.includes('gmail'));
});

test('a code email shows the 6 digits and no link', () => {
  const mail = buildAuthMail({ recipient: 'a@example.test', purpose: 'verify-code', url: '', code: '042917' });
  assert.equal(mail.to, 'a@example.test');
  assert.match(mail.html, /lang="ar" dir="rtl"/);
  assert.ok(mail.text.includes('042917') && mail.html.includes('042917'));
  assert.ok(!/href=/.test(mail.html), 'a code email carries no link to the local preview');
  assert.ok(buildAuthMail({ recipient: 'a@example.test', purpose: 'reset-code', url: '', code: '123456' }).subject);
  assert.throws(() => buildAuthMail({ recipient: 'a@example.test', purpose: 'verify-code', url: '', code: null }));
  assert.throws(() => buildAuthMail({ recipient: 'a@example.test', purpose: 'verify-code', url: '', code: '<b>1</b>' }));
});

test('a link email is Arabic RTL, carries the link, and escapes it in HTML', () => {
  const mail = buildAuthMail({ recipient: 'a@example.test', purpose: 'invitation', url: 'http://127.0.0.1:3000/invitations/a"b<c' });
  assert.match(mail.html, /lang="ar" dir="rtl"/);
  assert.ok(mail.text.includes('invitations/a"b<c'));
  assert.ok(!mail.html.includes('a"b<c') && mail.html.includes('a&quot;b&lt;c'));
  for (const purpose of ['platform-invitation', 'ownership-transfer']) assert.ok(buildAuthMail({ recipient: 'a@example.test', purpose, url: 'https://x.test/p' }).subject);
});

test('auth mail refuses unknown purposes and non-http links', () => {
  assert.throws(() => buildAuthMail({ recipient: 'a@example.test', purpose: 'marketing', url: 'https://x.test' }));
  assert.throws(() => buildAuthMail({ recipient: 'a@example.test', purpose: 'invitation', url: 'javascript:alert(1)' }));
});

test('resend sender posts with an idempotency key and keeps the response body out of errors', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const ok = resendSender({ apiKey: 're_test_key_0000000000', from: 'Tamkeen <onboarding@resend.dev>' }, (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response('{}', { status: 200 }); }) as typeof fetch);
  await ok(buildAuthMail({ recipient: 'a@example.test', purpose: 'invitation', url: 'https://x.test/r' }), 'key-1');
  assert.equal(calls[0]!.url, 'https://api.resend.com/emails');
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers['idempotency-key'], 'key-1');
  assert.equal(headers.authorization, 'Bearer re_test_key_0000000000');
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)).to, ['a@example.test']);

  const failing = resendSender({ apiKey: 're_test_key_0000000000', from: 'x@y.test' }, (async () => new Response('{"message":"a@example.test is not allowed"}', { status: 403 })) as typeof fetch);
  await assert.rejects(failing(buildAuthMail({ recipient: 'a@example.test', purpose: 'invitation', url: 'https://x.test/r' }), 'key-2'), (error: Error) => error.name === 'ResendHttp403' && !error.message.includes('example.test'));
});
