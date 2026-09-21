/**
 * Minor-unit amounts, per 08-FINANCIAL-SYSTEM.
 *
 * An amount is an integer count of the currency's smallest unit. It is never a float, never a
 * JavaScript number in transit, and never parsed with `Number`. It is stored as BIGINT and it
 * crosses HTTP as a decimal string, because JSON numbers lose precision above 2^53 and because a
 * reader should never have to guess whether "1250.5" meant 1,250.50 or 12,505.
 */

import { IdentityError } from '../identity/policy.js';

/** Highest amount accepted from a client. Well above any realistic project, far below BIGINT's limit. */
const MAX_MINOR = 10n ** 15n;

/** Parses a client-supplied minor-unit string. Rejects anything that is not a plain positive integer. */
export function parseMinor(value: unknown, { allowZero = false } = {}): bigint {
  if (typeof value !== 'string' || !/^[0-9]{1,16}$/.test(value)) throw new IdentityError('invalid_input', 422);
  const amount = BigInt(value);
  if (amount > MAX_MINOR) throw new IdentityError('invalid_input', 422);
  if (!allowZero && amount <= 0n) throw new IdentityError('invalid_input', 422);
  return amount;
}

/** Serialises for transport. Every DTO carrying an amount goes through this. */
export const minorToString = (value: bigint): string => value.toString();

/** Sums without ever converting to a JavaScript number. */
export const sumMinor = (values: readonly bigint[]): bigint => values.reduce((total, value) => total + value, 0n);

/** ISO 4217 shape only; which currencies are actually operable is a launch decision (18-DECISIONS). */
export function parseCurrency(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value)) throw new IdentityError('invalid_input', 422);
  return value.toUpperCase();
}
