import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { CURRENT_TERMS_VERSION, loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { createApp } from '../apps/api/dist/app.js';
import { IdentityService } from '../apps/api/dist/modules/identity/identity.service.js';

function totpFromUri(uri: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const secret = new URL(uri).searchParams.get('secret') ?? '';
  let bits = '';
  for (const character of secret.replace(/=+$/g, '').toUpperCase()) bits += alphabet.indexOf(character).toString(2).padStart(5, '0');
  const key = Buffer.from(Array.from({ length: Math.floor(bits.length / 8) }, (_, index) => Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', key).update(counter).digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

test('registration, verification, hashed sessions, CSRF, reset and revocation over HTTP', async () => {
  const config = { ...loadConfig(process.env), emailMode: 'local-outbox' as const };
  const db = createDatabase(config.databaseUrl);
  const app = await createApp(config);
  const email = `${randomUUID()}@example.test`;
  const password = `Test-only-${randomUUID()}`;
  let userId: string | undefined;
  let organizationId: string | undefined;
  let uploadedStorageKey: string | undefined;
  let logoStorageKey: string | undefined;
  let consumedVerificationIdentifier: string | undefined;
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const request = (path: string, body?: unknown, cookie = '', origin = config.appBaseUrl) => fetch(`${base}/api/v1${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', origin, cookie }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'manual' });
    const noConsent = await request('/auth/sign-up/email', { email, password, name: 'Integration User', callbackURL: `${config.appBaseUrl}/login` });
    assert.equal(noConsent.status, 400);
    const oldConsent = await request('/auth/sign-up/email', { email, password, name: 'Integration User', termsVersion: 'old-version', callbackURL: `${config.appBaseUrl}/login` });
    assert.equal(oldConsent.status, 400);
    const verificationCallback = `${config.appBaseUrl}/verify?success=1`;
    const registered = await request('/auth/sign-up/email', { email, password, name: 'Integration User', termsVersion: CURRENT_TERMS_VERSION, callbackURL: verificationCallback });
    assert.equal(registered.status, 200, await registered.text());
    const user = await db.user.findUniqueOrThrow({ where: { email } }); userId = user.id;
    assert.equal(user.emailVerified, false);
    assert.equal(user.termsVersion, CURRENT_TERMS_VERSION);
    assert.ok(user.termsAcceptedAt instanceof Date);
    assert.equal((await request('/auth/sign-in/email', { email, password })).status, 403);
    const mailCount = await db.localAuthMail.count({ where: { recipient: email, purpose: 'verify' } });
    assert.equal((await request('/auth/send-verification-email', { email, callbackURL: verificationCallback })).status, 200);
    assert.equal(await db.localAuthMail.count({ where: { recipient: email, purpose: 'verify' } }), mailCount + 1);
    const mail = await db.localAuthMail.findFirstOrThrow({ where: { recipient: email, purpose: 'verify' }, orderBy: { createdAt: 'desc' } });
    const url = new URL(mail.url);
    consumedVerificationIdentifier = `used-email-verification:${createHash('sha256').update(url.searchParams.get('token') ?? '').digest('hex')}`;
    const verificationAttempts = await Promise.all([
      fetch(`${base}${url.pathname}${url.search}`, { redirect: 'manual' }),
      fetch(`${base}${url.pathname}${url.search}`, { redirect: 'manual' })
    ]);
    assert.equal(verificationAttempts.filter(response => response.headers.get('location') === verificationCallback).length, 1);
    assert.equal(verificationAttempts.filter(response => /error=/.test(response.headers.get('location') ?? '')).length, 1);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified, true);
    const replay = await fetch(`${base}${url.pathname}${url.search}`, { redirect: 'manual' });
    assert.equal(replay.status, 302);
    assert.match(replay.headers.get('location') ?? '', /error=/);
    const login = await request('/auth/sign-in/email', { email, password });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    assert.ok(cookie.includes('session_token'));
    assert.ok(login.headers.getSetCookie().some(value => value.toLowerCase().includes('httponly')));
    const loginBody = await login.json();
    const stored = await db.session.findFirstOrThrow({ where: { userId: user.id } });
    assert.notEqual(stored.token, loginBody.token);
    assert.match(stored.token, /^[0-9a-f]{64}$/);
    const staleSessionTime = new Date(Date.now() - 2 * 3600_000);
    await db.session.update({ where: { id: stored.id }, data: { updatedAt: staleSessionTime } });
    assert.equal((await request('/me', undefined, cookie)).status, 200);
    const refreshed = await db.session.findUniqueOrThrow({ where: { id: stored.id } });
    assert.ok(refreshed.updatedAt > staleSessionTime);
    assert.equal(refreshed.token, stored.token);
    const identity = new IdentityService(db);
    const organization = await identity.createOrganization(user.id, { legalName: 'Upload test organization', displayName: 'Upload test', city: 'Ramallah', country: 'PS', type: 'NGO' });
    organizationId = organization.id;
    const verificationDraft = await identity.saveVerificationCase(user.id, organization.id, { registrationNumber: 'UPLOAD-1', issuingAuthority: 'Registry', registeredAddress: 'Ramallah', documentExpiresAt: null, version: 0 });
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
    const intentResponse = await request(`/orgs/${organization.id}/verification/documents/upload-intents`, { fileName: 'registration.pdf', contentType: 'application/pdf', size: pdf.length, version: verificationDraft.version }, cookie);
    assert.equal(intentResponse.status, 201);
    const intent = (await intentResponse.json()).data as { id: string; token: string; uploadPath: string; finalizePath: string };
    const uploaded = await fetch(`${base}/api/v1${intent.uploadPath}`, { method: 'PUT', headers: { origin: config.appBaseUrl, cookie, 'content-type': 'application/pdf', 'content-length': String(pdf.length), 'x-upload-token': intent.token }, body: pdf });
    assert.equal(uploaded.status, 200, await uploaded.text());
    const finalized = await fetch(`${base}/api/v1${intent.finalizePath}`, { method: 'POST', headers: { origin: config.appBaseUrl, cookie, 'x-upload-token': intent.token } });
    assert.equal(finalized.status, 201);
    assert.equal((await finalized.json()).data.scanState, 'clean');
    assert.equal((await identity.verificationCase(user.id, organization.id)).documents[0]?.scanState, 'clean');
    uploadedStorageKey = (await db.organizationVerificationDocument.findUniqueOrThrow({ where: { id: intent.id } })).storageKey;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    const logoVersion = (await identity.organization(user.id, organization.id)).version;
    const logoIntentResponse = await request(`/orgs/${organization.id}/logo/upload-intents`, { fileName: 'logo.png', contentType: 'image/png', size: png.length, version: logoVersion }, cookie);
    assert.equal(logoIntentResponse.status, 201);
    const logoIntent = (await logoIntentResponse.json()).data as { id: string; token: string; uploadPath: string; finalizePath: string };
    assert.equal((await fetch(`${base}/api/v1${logoIntent.uploadPath}`, { method: 'PUT', headers: { origin: config.appBaseUrl, cookie, 'content-type': 'image/png', 'content-length': String(png.length), 'x-upload-token': logoIntent.token }, body: png })).status, 200);
    const finalizedLogo = await fetch(`${base}/api/v1${logoIntent.finalizePath}`, { method: 'POST', headers: { origin: config.appBaseUrl, cookie, 'x-upload-token': logoIntent.token } });
    assert.equal(finalizedLogo.status, 201);
    assert.equal((await finalizedLogo.json()).data.scanState, 'clean');
    const logoAsset = await db.organizationLogoAsset.findUniqueOrThrow({ where: { id: logoIntent.id } });
    logoStorageKey = logoAsset.storageKey;
    const publicLogo = await fetch(`${base}/api/v1/organizations/${organization.slug}/logo`);
    assert.equal(publicLogo.status, 200);
    assert.equal(publicLogo.headers.get('content-type'), 'image/png');
    assert.equal(publicLogo.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await publicLogo.arrayBuffer()), png);
    const cachedLogo = await fetch(`${base}/api/v1/organizations/${organization.slug}/logo`, { headers: { 'if-none-match': publicLogo.headers.get('etag') ?? '' } });
    assert.equal(cachedLogo.status, 304);
    assert.equal((await request('/me')).status, 401);
    assert.equal((await request('/me/context', { organizationId: null }, cookie, 'https://attacker.example')).status, 403);
    const reset = await request('/auth/request-password-reset', { email, redirectTo: `${config.appBaseUrl}/reset` });
    assert.equal(reset.status, 200);
    const resetMail = await db.localAuthMail.findFirstOrThrow({ where: { recipient: email, purpose: 'reset' }, orderBy: { createdAt: 'desc' } });
    const token = new URL(resetMail.url).searchParams.get('token');
    const newPassword = `Changed-${randomUUID()}`;
    assert.equal((await request('/auth/reset-password', { token, newPassword })).status, 200);
    assert.equal((await request('/me', undefined, cookie)).status, 401);
    assert.notEqual((await request('/auth/reset-password', { token, newPassword })).status, 200);
    assert.equal((await request('/auth/sign-in/email', { email, password })).status, 401);
    const relogin = await request('/auth/sign-in/email', { email, password: newPassword });
    assert.equal(relogin.status, 200);
    const newCookie = relogin.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    const enabled = await request('/auth/two-factor/enable', { password: newPassword, method: 'totp', issuer: 'Tamkeen' }, newCookie);
    assert.equal(enabled.status, 200);
    const setup = await enabled.json() as { totpURI: string; backupCodes: string[] };
    assert.ok(setup.totpURI.startsWith('otpauth://'));
    assert.ok(setup.backupCodes.length > 0);
    const setupVerified = await request('/auth/two-factor/verify-totp', { code: totpFromUri(setup.totpURI), trustDevice: false }, newCookie);
    assert.equal(setupVerified.status, 200);
    const mfaCookie = setupVerified.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).twoFactorEnabled, true);
    assert.equal((await request('/auth/sign-out', {}, mfaCookie)).status, 200);
    assert.equal((await request('/me', undefined, mfaCookie)).status, 401);
    const mfaLogin = await request('/auth/sign-in/email', { email, password: newPassword });
    assert.equal(mfaLogin.status, 200);
    assert.equal((await mfaLogin.clone().json()).twoFactorRedirect, true);
    const challengeCookie = mfaLogin.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    const mfaVerified = await request('/auth/two-factor/verify-totp', { code: totpFromUri(setup.totpURI), trustDevice: false }, challengeCookie);
    assert.equal(mfaVerified.status, 200);
    const verifiedCookie = mfaVerified.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    assert.equal((await request('/me', undefined, verifiedCookie)).status, 200);
    assert.equal((await request('/auth/sign-out', {}, verifiedCookie)).status, 200);
    const limitedResetStatuses = [];
    for (let attempt = 0; attempt < 3; attempt += 1) limitedResetStatuses.push((await request('/auth/request-password-reset', { email, redirectTo: `${config.appBaseUrl}/reset` })).status);
    assert.deepEqual(limitedResetStatuses, [200, 200, 429]);
  } finally {
    if (userId) {
      if (organizationId) {
        await db.organization.update({ where: { id: organizationId }, data: { status: 'closed', currentLogoId: null } });
        const verificationCase = await db.organizationVerificationCase.findUnique({ where: { organizationId } });
        if (verificationCase) {
          await db.organizationVerificationDocument.deleteMany({ where: { caseId: verificationCase.id } });
          await db.organizationVerificationCase.delete({ where: { id: verificationCase.id } });
        }
        await db.organizationLogoAsset.deleteMany({ where: { organizationId } });
        await db.membership.deleteMany({ where: { organizationId } });
        await db.party.deleteMany({ where: { organizationId } });
        await db.organization.delete({ where: { id: organizationId } });
      }
      await db.session.deleteMany({ where: { userId } });
      await db.account.deleteMany({ where: { userId } });
      await db.twoFactor.deleteMany({ where: { userId } });
      await db.party.deleteMany({ where: { userId } });
      await db.individualProfile.deleteMany({ where: { userId } });
      await db.user.delete({ where: { id: userId } });
    }
    await db.localAuthMail.deleteMany({ where: { recipient: email } });
    if (consumedVerificationIdentifier) await db.verification.deleteMany({ where: { identifier: consumedVerificationIdentifier } });
    if (uploadedStorageKey) await rm(resolve(process.cwd(), '.local', 'verification-files', 'clean', ...uploadedStorageKey.split('/')), { force: true });
    if (logoStorageKey) await rm(resolve(process.cwd(), '.local', 'organization-logos', 'public', ...logoStorageKey.split('/')), { force: true });
    await app.close(); await db.$disconnect();
  }
});
