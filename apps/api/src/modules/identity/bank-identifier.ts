import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Bank identifiers are HighlySensitive (12-SECURITY-TRUST-PRIVACY). They are never stored or
 * returned in clear text. Two derived values are kept instead:
 *  - a reversible AES-256-GCM ciphertext, so an authorised payout execution can recover the value;
 *  - a deterministic HMAC, so duplicate detection and reconciliation matching work without decrypting.
 * Only the last four characters are safe to display, and only to an actor holding bank.manage.
 */

const CIPHER_VERSION = 'v1';
const derive = (secret: string) => createHash('sha256').update(`tamkeen-bank:${secret}`).digest();

export class BankIdentifierError extends Error {
  constructor(public readonly reason: 'invalid_country' | 'invalid_format' | 'invalid_checksum' | 'country_mismatch' | 'invalid_ciphertext') { super(reason); }
}

/**
 * Validates an IBAN structurally and by its ISO 7064 mod-97 checksum, then returns the canonical
 * uppercase form with separators removed. A checksum pass proves the value is well formed; it does
 * not prove the account exists or belongs to the organisation — that stays a reviewer's judgement.
 */
export function normalizedIban(value: string, country: string): string {
  if (typeof value !== 'string' || typeof country !== 'string' || !/^[A-Z]{2}$/.test(country)) throw new BankIdentifierError('invalid_country');
  const iban = value.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban) || iban.length > 34) throw new BankIdentifierError('invalid_format');
  if (iban.slice(0, 2) !== country) throw new BankIdentifierError('country_mismatch');
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;
  for (const character of rearranged) {
    const digits = /[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  if (remainder !== 1) throw new BankIdentifierError('invalid_checksum');
  return iban;
}

export function protectBankIdentifier(value: string, secret: string): { ciphertext: string; hash: string; last4: string } {
  const key = derive(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {
    ciphertext: `${CIPHER_VERSION}.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`,
    hash: createHmac('sha256', key).update(value).digest('hex'),
    last4: value.slice(-4)
  };
}

/**
 * Recovers the stored identifier. Reserved for an authorised payout execution path (PART-07); it
 * exists now so the stored ciphertext is provably recoverable rather than write-only.
 */
export function revealBankIdentifier(ciphertext: string, secret: string): string {
  const parts = typeof ciphertext === 'string' ? ciphertext.split('.') : [];
  const [version, iv, tag, payload] = parts;
  if (parts.length !== 4 || version !== CIPHER_VERSION || !iv || !tag || !payload) throw new BankIdentifierError('invalid_ciphertext');
  try {
    const decipher = createDecipheriv('aes-256-gcm', derive(secret), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(payload, 'base64url')), decipher.final()]).toString('utf8');
  } catch { throw new BankIdentifierError('invalid_ciphertext'); }
}

/** Constant-time comparison of two stored HMACs, used when matching a submitted account to the active one. */
export function sameBankIdentifier(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}
