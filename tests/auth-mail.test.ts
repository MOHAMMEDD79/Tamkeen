import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAuthMail, resendSender } from '../apps/worker/src/auth-mail.js';

test('auth mail is Arabic RTL, carries the link, and escapes it in HTML', () => {
  const mail = buildAuthMail({ recipient: 'a@example.test', purpose: 'verify', url: 'http://127.0.0.1:4000/api/v1/auth/verify-email?token=a"b<c' });
  assert.equal(mail.to, 'a@example.test');
  assert.match(mail.html, /lang="ar" dir="rtl"/);
  assert.ok(mail.text.includes('token=a"b<c'));
  assert.ok(!mail.html.includes('a"b<c') && mail.html.includes('a&quot;b&lt;c'));
  for (const purpose of ['reset', 'invitation', 'platform-invitation', 'ownership-transfer']) assert.ok(buildAuthMail({ recipient: 'a@example.test', purpose, url: 'https://x.test/p' }).subject);
});

test('auth mail refuses unknown purposes and non-http links', () => {
  assert.throws(() => buildAuthMail({ recipient: 'a@example.test', purpose: 'marketing', url: 'https://x.test' }));
  assert.throws(() => buildAuthMail({ recipient: 'a@example.test', purpose: 'verify', url: 'javascript:alert(1)' }));
});

test('resend sender posts with an idempotency key and keeps the response body out of errors', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const ok = resendSender({ apiKey: 're_test_key_0000000000', from: 'Tamkeen <onboarding@resend.dev>' }, (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response('{}', { status: 200 }); }) as typeof fetch);
  await ok(buildAuthMail({ recipient: 'a@example.test', purpose: 'reset', url: 'https://x.test/r' }), 'key-1');
  assert.equal(calls[0]!.url, 'https://api.resend.com/emails');
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers['idempotency-key'], 'key-1');
  assert.equal(headers.authorization, 'Bearer re_test_key_0000000000');
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)).to, ['a@example.test']);

  const failing = resendSender({ apiKey: 're_test_key_0000000000', from: 'x@y.test' }, (async () => new Response('{"message":"a@example.test is not allowed"}', { status: 403 })) as typeof fetch);
  await assert.rejects(failing(buildAuthMail({ recipient: 'a@example.test', purpose: 'reset', url: 'https://x.test/r' }), 'key-2'), (error: Error) => error.name === 'ResendHttp403' && !error.message.includes('example.test'));
});
