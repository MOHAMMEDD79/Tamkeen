import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BankIdentifierError, normalizedIban, protectBankIdentifier, revealBankIdentifier, sameBankIdentifier } from '../apps/api/src/modules/identity/bank-identifier.js';

// Structurally valid IBANs with correct mod-97 checksums, used only as test fixtures.
const palestinian = 'PS92PALS000000000400123456702';
const jordanian = 'JO94CBJO0010000000000131000302';
const secret = 'local-test-secret-value-32-characters-long';

test('IBAN validation accepts canonical values and rejects malformed, mismatched or miscomputed ones', () => {
  assert.equal(normalizedIban(palestinian, 'PS'), palestinian);
  assert.equal(normalizedIban(jordanian, 'JO'), jordanian);
  // Spacing and case are presentation, not identity.
  assert.equal(normalizedIban('ps92 pals 0000 0000 0400 1234 5670 2', 'PS'), palestinian);

  const rejected = (value: string, country: string, reason: string) => {
    assert.throws(() => normalizedIban(value, country), (error: unknown) => error instanceof BankIdentifierError && error.reason === reason);
  };
  // A single transposed digit breaks the checksum; without mod-97 this would have been accepted.
  rejected('PS92PALS000000000400123456703', 'PS', 'invalid_checksum');
  rejected(palestinian, 'JO', 'country_mismatch');
  rejected('PS92', 'PS', 'invalid_format');
  rejected('PSXX PALS 0000', 'PS', 'invalid_format');
  rejected(`${palestinian}EXTRA0000000`, 'PS', 'invalid_format');
  rejected(palestinian, 'ps', 'invalid_country');
  rejected(palestinian, 'PSX', 'invalid_country');
});

test('stored bank identifiers are recoverable, deterministic for matching and never leak in ciphertext', () => {
  const first = protectBankIdentifier(palestinian, secret);
  const second = protectBankIdentifier(palestinian, secret);

  assert.equal(revealBankIdentifier(first.ciphertext, secret), palestinian);
  // A random IV per call means equal inputs must not produce equal ciphertexts.
  assert.notEqual(first.ciphertext, second.ciphertext);
  // The HMAC is deterministic so duplicate detection works without decrypting anything.
  assert.equal(first.hash, second.hash);
  assert.notEqual(first.hash, protectBankIdentifier(jordanian, secret).hash);
  assert.equal(first.last4, '6702');
  // Neither derived value may contain the account number or its tail beyond the declared last4.
  assert.equal(first.ciphertext.includes(palestinian), false);
  assert.equal(first.hash.includes('6702'), false);
});

test('ciphertext tampering and wrong secrets fail closed instead of returning a wrong account', () => {
  const { ciphertext } = protectBankIdentifier(palestinian, secret);
  const [version, iv, tag, payload] = ciphertext.split('.') as [string, string, string, string];
  const invalid = (value: string) => assert.throws(() => revealBankIdentifier(value, secret), (error: unknown) => error instanceof BankIdentifierError && error.reason === 'invalid_ciphertext');

  assert.throws(() => revealBankIdentifier(ciphertext, `${secret}-other`), (error: unknown) => error instanceof BankIdentifierError);
  // GCM authentication must reject a flipped payload rather than emit garbage.
  invalid([version, iv, tag, Buffer.from('tampered').toString('base64url')].join('.'));
  invalid([version, iv, Buffer.from('badtagbadtag1234').toString('base64url'), payload].join('.'));
  invalid(['v2', iv, tag, payload].join('.'));
  invalid([version, iv, tag].join('.'));
  invalid('');
});

test('identifier comparison is constant time and rejects values that are not stored hashes', () => {
  const { hash } = protectBankIdentifier(palestinian, secret);
  assert.equal(sameBankIdentifier(hash, hash), true);
  assert.equal(sameBankIdentifier(hash, protectBankIdentifier(jordanian, secret).hash), false);
  assert.equal(sameBankIdentifier(hash, ''), false);
  assert.equal(sameBankIdentifier(hash, hash.toUpperCase()), false);
  assert.equal(sameBankIdentifier(hash, hash.slice(0, 63)), false);
});
