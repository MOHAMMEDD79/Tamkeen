import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { CURRENT_TERMS_VERSION, loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { IdentityService } from '../apps/api/dist/modules/identity/identity.service.js';
import { revealBankIdentifier } from '../apps/api/dist/modules/identity/bank-identifier.js';

const config = loadConfig(process.env);
// Structurally valid fixtures with correct mod-97 checksums; no real account is referenced.
const firstIban = 'PS92PALS000000000400123456702';
const secondIban = 'PS65PALS000000000400123456703';
const otherOrgIban = 'JO94CBJO0010000000000131000302';

test('organisation bank account changes require MFA, an independent reviewer and never expose the identifier', async () => {
  const db = createDatabase(config.databaseUrl);
  const service = new IdentityService(db);
  const prefix = randomUUID();
  const users: string[] = [];
  const organizations: string[] = [];
  const createUser = async (suffix: string, twoFactor = true) => {
    const user = await db.user.create({ data: { email: `${prefix}-${suffix}@example.test`, name: `Bank ${suffix}`, emailVerified: true, twoFactorEnabled: twoFactor, termsVersion: CURRENT_TERMS_VERSION, termsAcceptedAt: new Date() } });
    users.push(user.id);
    return user;
  };
  const sessionFor = async (userId: string) => db.session.create({ data: { userId, token: randomUUID().replace(/-/g, '').padEnd(64, '0').slice(0, 64), expiresAt: new Date(Date.now() + 3600_000) } });
  // The operator's second factor is asserted by the service; the challenge row is what binds the
  // decision, so tests verify it through the service rather than replaying a real TOTP code.
  const passChallenge = async (actorId: string, sessionId: string, challengeId: string) => service.verifyMfaChallenge(actorId, sessionId, challengeId);

  try {
    const owner = await createUser('owner');
    const viewer = await createUser('viewer');
    const outsider = await createUser('outsider');
    const operator = await createUser('operator');
    const secondOperator = await createUser('operator-two');
    const weakOwner = await createUser('weak-owner', false);

    await db.platformGrant.createMany({ data: [
      { userId: operator.id, role: 'FinanceOperator', grantedBy: operator.id },
      { userId: secondOperator.id, role: 'FinanceOperator', grantedBy: operator.id }
    ] });

    const org = await service.createOrganization(owner.id, { legalName: `Bank Org ${prefix}`, displayName: `Bank Org ${prefix}`, type: 'NGO', country: 'PS', city: 'Nablus' });
    organizations.push(org.id);
    const otherOrg = await service.createOrganization(outsider.id, { legalName: `Other Org ${prefix}`, displayName: `Other Org ${prefix}`, type: 'NGO', country: 'JO', city: 'Amman' });
    organizations.push(otherOrg.id);
    await db.membership.create({ data: { userId: viewer.id, organizationId: org.id, roles: ['Viewer'] } });
    await db.membership.create({ data: { userId: weakOwner.id, organizationId: org.id, roles: ['OrgAdmin'] } });

    const ownerSession = await sessionFor(owner.id);
    const weakSession = await sessionFor(weakOwner.id);
    const operatorSession = await sessionFor(operator.id);
    const secondOperatorSession = await sessionFor(secondOperator.id);

    // --- Permission scope -------------------------------------------------------------------
    // bank.manage is not implied by membership, by Viewer, or by belonging to a different tenant.
    await assert.rejects(() => service.bankSettings(viewer.id, org.id), /forbidden/);
    await assert.rejects(() => service.bankSettings(outsider.id, org.id), /forbidden/);
    await assert.rejects(() => service.createBankChangeChallenge(outsider.id, ownerSession.id, org.id, org.version), /forbidden/);

    const empty = await service.bankSettings(owner.id, org.id);
    assert.equal(empty.activeAccount, null);
    assert.equal(empty.requests.length, 0);

    // --- Second factor is mandatory before a request can even be started --------------------
    const currentVersion = (await db.organization.findUniqueOrThrow({ where: { id: org.id } })).version;
    await assert.rejects(() => service.createBankChangeChallenge(weakOwner.id, weakSession.id, org.id, currentVersion), /conflict/);
    // A stale organisation version cannot open a challenge either.
    await assert.rejects(() => service.createBankChangeChallenge(owner.id, ownerSession.id, org.id, currentVersion + 5), /conflict/);

    const challenge = await service.createBankChangeChallenge(owner.id, ownerSession.id, org.id, currentVersion);
    // An unverified challenge must not authorise the request.
    await assert.rejects(() => service.createBankChangeRequest(owner.id, ownerSession.id, org.id, { bankName: 'Test Bank', accountHolder: 'Bank Org', iban: firstIban, country: 'PS', currency: 'ILS', version: currentVersion, mfaChallengeId: challenge.id }, config.sessionSecret), /mfa_unavailable/);
    await passChallenge(owner.id, ownerSession.id, challenge.id);

    // A malformed IBAN is rejected after the factor passes, so the challenge is not wasted silently.
    await assert.rejects(() => service.createBankChangeRequest(owner.id, ownerSession.id, org.id, { bankName: 'Test Bank', accountHolder: 'Bank Org', iban: 'PS92PALS000000000400123456703', country: 'PS', currency: 'ILS', version: currentVersion, mfaChallengeId: challenge.id }, config.sessionSecret), /invalid_input/);

    const request = await service.createBankChangeRequest(owner.id, ownerSession.id, org.id, { bankName: 'Test Bank', accountHolder: 'Bank Org', iban: firstIban, country: 'PS', currency: 'ILS', version: currentVersion, mfaChallengeId: challenge.id }, config.sessionSecret);
    assert.equal(request.state, 'pending');
    assert.equal(request.accountLast4, '6702');

    // --- The challenge is single use --------------------------------------------------------
    await assert.rejects(() => service.createBankChangeRequest(owner.id, ownerSession.id, org.id, { bankName: 'Test Bank', accountHolder: 'Bank Org', iban: secondIban, country: 'PS', currency: 'ILS', version: currentVersion, mfaChallengeId: challenge.id }, config.sessionSecret), /mfa_unavailable/);

    // --- Requesting does not change the active account --------------------------------------
    const afterRequest = await service.bankSettings(owner.id, org.id);
    assert.equal(afterRequest.activeAccount, null, 'a pending request must not become the active account');
    assert.equal(afterRequest.requests.length, 1);
    // The identifier and its ciphertext never appear in the organisation-facing DTO.
    const requestDto = afterRequest.requests[0] as Record<string, unknown>;
    assert.equal(Object.hasOwn(requestDto, 'accountIdentifierCiphertext'), false);
    assert.equal(Object.hasOwn(requestDto, 'accountIdentifierHash'), false);
    assert.equal(JSON.stringify(afterRequest).includes(firstIban), false);

    // --- Only one pending request per organisation ------------------------------------------
    const blockedChallenge = await service.createBankChangeChallenge(owner.id, ownerSession.id, org.id, currentVersion);
    await passChallenge(owner.id, ownerSession.id, blockedChallenge.id);
    await assert.rejects(() => service.createBankChangeRequest(owner.id, ownerSession.id, org.id, { bankName: 'Second Bank', accountHolder: 'Bank Org', iban: secondIban, country: 'PS', currency: 'ILS', version: currentVersion, mfaChallengeId: blockedChallenge.id }, config.sessionSecret), /conflict/);

    // --- Review scope ------------------------------------------------------------------------
    await assert.rejects(() => service.bankChangeReviewQueue(owner.id), /forbidden/);
    await assert.rejects(() => service.bankChangeReviewQueue(viewer.id), /forbidden/);
    const queue = await service.bankChangeReviewQueue(operator.id);
    const queued = queue.find(item => item.id === request.id);
    assert.ok(queued, 'a pending request must reach the finance operator queue');
    assert.equal(queued.stale, false);
    assert.equal(queued.accountLast4, '6702');
    assert.equal(JSON.stringify(queue).includes(firstIban), false, 'the review queue must not carry the full identifier');

    // --- Separation of duties: the requester cannot review their own request ------------------
    await db.platformGrant.create({ data: { userId: owner.id, role: 'FinanceOperator', grantedBy: operator.id } });
    await assert.rejects(() => service.createBankChangeReviewChallenge(owner.id, ownerSession.id, request.id, request.version), /conflict/);
    await db.platformGrant.updateMany({ where: { userId: owner.id, role: 'FinanceOperator' }, data: { revokedAt: new Date() } });

    // --- A decision requires a verified, operation-bound challenge ---------------------------
    const reviewChallenge = await service.createBankChangeReviewChallenge(operator.id, operatorSession.id, request.id, request.version);
    await assert.rejects(() => service.decideBankChange(operator.id, operatorSession.id, request.id, { outcome: 'approved', reason: '', version: request.version, mfaChallengeId: reviewChallenge.id }), /conflict/);
    await passChallenge(operator.id, operatorSession.id, reviewChallenge.id);
    // A challenge bound to this operator's session cannot be spent by a different operator.
    await assert.rejects(() => service.decideBankChange(secondOperator.id, secondOperatorSession.id, request.id, { outcome: 'approved', reason: '', version: request.version, mfaChallengeId: reviewChallenge.id }), /conflict/);
    // Rejection demands a stated reason.
    await assert.rejects(() => service.decideBankChange(operator.id, operatorSession.id, request.id, { outcome: 'rejected', reason: 'short', version: request.version, mfaChallengeId: reviewChallenge.id }), /invalid_input/);

    const approved = await service.decideBankChange(operator.id, operatorSession.id, request.id, { outcome: 'approved', reason: '', version: request.version, mfaChallengeId: reviewChallenge.id });
    assert.equal(approved.state, 'approved');
    assert.equal(approved.activeAccountChanged, true);

    // The approval, and only the approval, installs the active account.
    const afterApproval = await service.bankSettings(owner.id, org.id);
    assert.equal(afterApproval.activeAccount?.accountLast4, '6702');
    assert.equal(afterApproval.activeAccount?.currency, 'ILS');
    assert.equal(JSON.stringify(afterApproval).includes(firstIban), false);

    // Stored at rest encrypted, and recoverable only with the configured secret.
    const stored = await db.organizationBankAccount.findUniqueOrThrow({ where: { organizationId: org.id } });
    assert.equal(stored.accountIdentifierCiphertext.includes(firstIban), false);
    assert.equal(revealBankIdentifier(stored.accountIdentifierCiphertext, config.sessionSecret), firstIban);

    // The review challenge is consumed; the same decision cannot be replayed.
    await assert.rejects(() => service.decideBankChange(operator.id, operatorSession.id, request.id, { outcome: 'rejected', reason: 'replay attempt should fail', version: request.version, mfaChallengeId: reviewChallenge.id }), /conflict/);

    // --- Re-submitting the identical account is refused ---------------------------------------
    const sameVersion = (await db.organization.findUniqueOrThrow({ where: { id: org.id } })).version;
    const duplicateChallenge = await service.createBankChangeChallenge(owner.id, ownerSession.id, org.id, sameVersion);
    await passChallenge(owner.id, ownerSession.id, duplicateChallenge.id);
    await assert.rejects(() => service.createBankChangeRequest(owner.id, ownerSession.id, org.id, { bankName: 'Test Bank', accountHolder: 'Bank Org', iban: firstIban, country: 'PS', currency: 'ILS', version: sameVersion, mfaChallengeId: duplicateChallenge.id }, config.sessionSecret), /conflict/);

    // --- A rejected request leaves the active account untouched -------------------------------
    const rejectChallenge = await service.createBankChangeChallenge(owner.id, ownerSession.id, org.id, sameVersion);
    await passChallenge(owner.id, ownerSession.id, rejectChallenge.id);
    const secondRequest = await service.createBankChangeRequest(owner.id, ownerSession.id, org.id, { bankName: 'Other Bank', accountHolder: 'Bank Org', iban: secondIban, country: 'PS', currency: 'ILS', version: sameVersion, mfaChallengeId: rejectChallenge.id }, config.sessionSecret);
    const rejectReview = await service.createBankChangeReviewChallenge(operator.id, operatorSession.id, secondRequest.id, secondRequest.version);
    await passChallenge(operator.id, operatorSession.id, rejectReview.id);
    const rejected = await service.decideBankChange(operator.id, operatorSession.id, secondRequest.id, { outcome: 'rejected', reason: 'The submitted holder name does not match the registered legal name.', version: secondRequest.version, mfaChallengeId: rejectReview.id });
    assert.equal(rejected.state, 'rejected');
    assert.equal(rejected.activeAccountChanged, false);
    const afterRejection = await service.bankSettings(owner.id, org.id);
    assert.equal(afterRejection.activeAccount?.accountLast4, '6702', 'a rejected request must leave the approved account in place');

    // --- A decision is void once the organisation it was reviewed against changes -------------
    const staleBase = (await db.organization.findUniqueOrThrow({ where: { id: org.id } })).version;
    const staleChallenge = await service.createBankChangeChallenge(owner.id, ownerSession.id, org.id, staleBase);
    await passChallenge(owner.id, ownerSession.id, staleChallenge.id);
    const staleRequest = await service.createBankChangeRequest(owner.id, ownerSession.id, org.id, { bankName: 'Third Bank', accountHolder: 'Bank Org', iban: secondIban, country: 'PS', currency: 'ILS', version: staleBase, mfaChallengeId: staleChallenge.id }, config.sessionSecret);
    const staleReview = await service.createBankChangeReviewChallenge(operator.id, operatorSession.id, staleRequest.id, staleRequest.version);
    await passChallenge(operator.id, operatorSession.id, staleReview.id);
    await db.organization.update({ where: { id: org.id }, data: { publicDescription: 'Edited after the bank request was queued.', version: { increment: 1 } } });
    assert.equal((await service.bankChangeReviewQueue(operator.id)).find(item => item.id === staleRequest.id)?.stale, true);
    await assert.rejects(() => service.decideBankChange(operator.id, operatorSession.id, staleRequest.id, { outcome: 'approved', reason: '', version: staleRequest.version, mfaChallengeId: staleReview.id }), /conflict/);
    assert.equal((await service.bankSettings(owner.id, org.id)).activeAccount?.accountLast4, '6702');

    // --- Tenant isolation on the write path ---------------------------------------------------
    const otherVersion = (await db.organization.findUniqueOrThrow({ where: { id: otherOrg.id } })).version;
    const outsiderSession = await sessionFor(outsider.id);
    const outsiderChallenge = await service.createBankChangeChallenge(outsider.id, outsiderSession.id, otherOrg.id, otherVersion);
    await passChallenge(outsider.id, outsiderSession.id, outsiderChallenge.id);
    // A challenge raised for one organisation cannot authorise a change to another.
    await assert.rejects(() => service.createBankChangeRequest(outsider.id, outsiderSession.id, org.id, { bankName: 'Cross Tenant', accountHolder: 'Attacker', iban: otherOrgIban, country: 'JO', currency: 'JOD', version: otherVersion, mfaChallengeId: outsiderChallenge.id }, config.sessionSecret), /forbidden/);
    assert.equal((await service.bankSettings(owner.id, org.id)).activeAccount?.accountLast4, '6702');
  } finally {
    await db.$transaction(async tx => {
      await tx.organizationBankAccount.deleteMany({ where: { organizationId: { in: organizations } } });
      await tx.organizationBankChangeRequest.deleteMany({ where: { organizationId: { in: organizations } } });
      await tx.membership.deleteMany({ where: { organizationId: { in: organizations } } });
      await tx.party.deleteMany({ where: { OR: [{ userId: { in: users } }, { organizationId: { in: organizations } }] } });
      await tx.organization.deleteMany({ where: { id: { in: organizations } } });
      await tx.mfaChallenge.deleteMany({ where: { userId: { in: users } } });
      await tx.session.deleteMany({ where: { userId: { in: users } } });
      await tx.platformGrant.deleteMany({ where: { OR: [{ userId: { in: users } }, { grantedBy: { in: users } }] } });
      await tx.individualProfile.deleteMany({ where: { userId: { in: users } } });
      await tx.user.deleteMany({ where: { id: { in: users } } });
    });
    await db.$disconnect();
  }
});
