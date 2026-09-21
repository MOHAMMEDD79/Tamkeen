import assert from 'node:assert/strict';
import { test } from 'node:test';
import { percentString, subscriptionMaths, validateOfferingTerms } from '../apps/api/src/modules/investment/shares.js';

/**
 * The worked example in 06-INVESTMENT-LIFECYCLE, which exists in the specification because the
 * obvious calculation is wrong: a company with 1,000,000 shares offers 100,000 new shares at
 * 10 ILS. Subscribing 10,000 ILS buys 1,000 shares — 1% of the offering, but about 0.0909% of the
 * company after a full raise. Reporting the first as the second overstates what the investor owns
 * by more than tenfold.
 */

const terms = {
  currentShares: 1_000_000n,
  sharesOffered: 100_000n,
  pricePerShareMinor: 1000n,     // 10.00 ILS
  minimumTicketMinor: 1000n,
  maximumTicketMinor: null
};

test('the worked example: 10,000 ILS buys 1,000 shares, and that is 0.0909% of the company', () => {
  const result = subscriptionMaths(terms, 1_000_000n); // 10,000.00 ILS in minor units
  assert.equal(result.units, 1000n);
  assert.equal(result.amountMinor, 1_000_000n);
  assert.equal(result.remainderMinor, 0n);
  assert.equal(result.postRaiseShares, 1_100_000n);
  // 1000 / 1,100,000 = 0.0909090…%
  assert.equal(result.percentOfPostRaise, '0.090909');
  // The number this must never be confused with.
  assert.equal(result.percentOfOffering, '1');
  assert.notEqual(result.percentOfPostRaise, result.percentOfOffering);
});

test('a full raise never amounts to the whole company', () => {
  const check = validateOfferingTerms({ ...terms, minimumRaiseMinor: 50_000_000n });
  assert.equal(check.valid, true);
  // 100,000 new shares out of 1,100,000 in issue afterwards.
  assert.equal(check.fullRaisePercent, '9.090909');
  assert.equal(check.postRaiseShares, '1100000');
  // 100,000 shares at 10.00 is 1,000,000.00 — a million ILS, in minor units.
  assert.equal(check.maximumRaiseMinor, '100000000');
});

test('an amount that does not buy a whole share is rounded down, and the remainder is reported', () => {
  // 15.50 ILS against a 10.00 share: one share, 5.50 left over.
  const result = subscriptionMaths(terms, 1550n);
  assert.equal(result.units, 1n);
  assert.equal(result.amountMinor, 1000n);
  // 06 forbids fractional shares, so the remainder is handed back rather than quietly kept.
  assert.equal(result.remainderMinor, 550n);
  assert.equal(result.requestedMinor, 1550n);
});

test('an amount too small to buy one share is refused rather than rounded to zero', () => {
  assert.throws(() => subscriptionMaths(terms, 999n), /invalid_input/);
  assert.throws(() => subscriptionMaths(terms, 0n), /invalid_input/);
  assert.throws(() => subscriptionMaths(terms, -1000n), /invalid_input/);
});

test('percentages are derived from integers and never lose the significant digits', () => {
  // A very small holding must not round away to zero: it is someone's actual stake. It truncates
  // rather than rounds, because a holding percentage that rounds up says someone owns more than
  // they do — 0.0000909…% is shown as 0.00009%, never 0.000091%.
  assert.equal(percentString(1n, 1_100_000n), '0.00009');
  assert.equal(percentString(1n, 3n), '33.333333');
  assert.equal(percentString(1n, 1n), '100');
  assert.equal(percentString(0n, 100n), '0');
  // A zero denominator is not an error to a reader; it is simply nothing owned.
  assert.equal(percentString(5n, 0n), '0');
  // No JavaScript number is involved anywhere: the inputs are BigInt and the output is a string.
  assert.equal(typeof percentString(1n, 7n), 'string');
});

test('inconsistent terms are named individually rather than failing as one opaque error', () => {
  const check = validateOfferingTerms({
    currentShares: 1_000_000n,
    sharesOffered: 100_000n,
    pricePerShareMinor: 1000n,
    // A minimum larger than a full raise could only ever fail.
    minimumRaiseMinor: 200_000_000n,
    // A ticket below the share price can never be accepted.
    minimumTicketMinor: 500n,
    maximumTicketMinor: 400n
  });
  assert.equal(check.valid, false);
  const codes = check.problems.map(problem => problem.code);
  assert.equal(codes.includes('minimum_above_maximum'), true);
  assert.equal(codes.includes('ticket_below_share_price'), true);
  assert.equal(codes.includes('ticket_range_inverted'), true);
});

test('a minimum ticket that is not a whole number of shares is flagged', () => {
  const check = validateOfferingTerms({ ...terms, minimumTicketMinor: 1500n, minimumRaiseMinor: 1_000_000n });
  // 15.00 against a 10.00 share always leaves 5.00 that buys nothing.
  assert.equal(check.problems.some(problem => problem.code === 'ticket_not_whole_shares'), true);
});
