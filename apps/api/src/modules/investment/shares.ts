import { IdentityError } from '../identity/policy.js';

/**
 * Share arithmetic for an offering (06-INVESTMENT-LIFECYCLE).
 *
 * All of it is integer. There are no fractional shares in this release, and money is minor units,
 * so nothing here ever produces a float — the one exception is the percentage, which is a display
 * figure derived from integers and carried as a string with its precision fixed.
 *
 * The mistake this module exists to prevent is in the specification by name: subscribing 10,000 to
 * an offering of 100,000 shares is **1% of the shares offered, not 1% of the company**. On a
 * company with 1,000,000 shares already in issue it is about 0.0909% after a full raise. Reporting
 * the first number would overstate what an investor is buying by an order of magnitude.
 */

/** Percentages are shown to this many decimal places; 0.0909% must not round to 0.09%. */
const PERCENT_DECIMALS = 6;
const PERCENT_SCALE = 10n ** BigInt(PERCENT_DECIMALS);

export interface OfferingTerms {
  /** Shares in issue before this offering. */
  currentShares: bigint;
  /** New shares being offered. */
  sharesOffered: bigint;
  pricePerShareMinor: bigint;
  minimumTicketMinor: bigint;
  maximumTicketMinor: bigint | null;
}

export interface SubscriptionMaths {
  /** What the investor actually pays: whole shares only, so this may be less than they offered. */
  amountMinor: bigint;
  /** What they asked to invest, before it was rounded down to whole shares. */
  requestedMinor: bigint;
  units: bigint;
  /** The remainder that buys no whole share, returned rather than quietly kept. */
  remainderMinor: bigint;
  /** Share of the company **after** a full raise, which is the honest denominator. */
  percentOfPostRaise: string;
  /** Share of this offering alone. Much larger, and the number people confuse for the one above. */
  percentOfOffering: string;
  /** Shares in issue if every offered share sells. */
  postRaiseShares: bigint;
}

/**
 * Formats an integer ratio as a fixed-precision percentage string, without ever using a float.
 *
 * Truncates rather than rounds. A holding percentage that rounds up overstates what someone owns,
 * and for this figure being slightly low is a much smaller problem than being slightly high.
 */
export function percentString(numerator: bigint, denominator: bigint): string {
  if (denominator <= 0n) return '0';
  // Scale first, divide once: the whole calculation stays in integers.
  const scaled = (numerator * 100n * PERCENT_SCALE) / denominator;
  const whole = scaled / PERCENT_SCALE;
  const fraction = (scaled % PERCENT_SCALE).toString().padStart(PERCENT_DECIMALS, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

/**
 * Works out what an amount buys.
 *
 * Rounds **down** to whole shares. 06 forbids fractional shares, and rounding up would sell a share
 * the investor has not paid for, so the remainder is reported back instead of being absorbed.
 */
export function subscriptionMaths(terms: OfferingTerms, requestedMinor: bigint): SubscriptionMaths {
  if (terms.pricePerShareMinor <= 0n || terms.sharesOffered <= 0n || terms.currentShares <= 0n) {
    throw new IdentityError('invalid_input', 422);
  }
  if (requestedMinor <= 0n) throw new IdentityError('invalid_input', 422);

  const units = requestedMinor / terms.pricePerShareMinor;
  if (units <= 0n) throw new IdentityError('invalid_input', 422);
  const amountMinor = units * terms.pricePerShareMinor;
  const postRaiseShares = terms.currentShares + terms.sharesOffered;

  return {
    amountMinor,
    requestedMinor,
    units,
    remainderMinor: requestedMinor - amountMinor,
    // The figure an investor should be quoted: their shares over everything in issue afterwards.
    percentOfPostRaise: percentString(units, postRaiseShares),
    // Kept separate and named, because it is the number a page might show by mistake.
    percentOfOffering: percentString(units, terms.sharesOffered),
    postRaiseShares
  };
}

export interface TermsProblem {
  code: string;
}

/**
 * BUS-02.A02. Checks that an offering's numbers are consistent before anyone can rely on them.
 *
 * Returns codes rather than sentences, so the screens can say it in the reader's language.
 */
export function validateOfferingTerms(input: {
  currentShares: bigint;
  sharesOffered: bigint;
  pricePerShareMinor: bigint;
  minimumRaiseMinor: bigint;
  minimumTicketMinor: bigint;
  maximumTicketMinor: bigint | null;
}): { valid: boolean; problems: TermsProblem[]; maximumRaiseMinor: string; postRaiseShares: string; fullRaisePercent: string } {
  const problems: TermsProblem[] = [];
  const maximumRaise = input.sharesOffered * input.pricePerShareMinor;

  if (input.currentShares <= 0n) problems.push({ code: 'current_shares_missing' });
  if (input.sharesOffered <= 0n) problems.push({ code: 'shares_offered_missing' });
  if (input.pricePerShareMinor <= 0n) problems.push({ code: 'price_missing' });
  if (input.minimumRaiseMinor <= 0n) problems.push({ code: 'minimum_raise_missing' });
  // A minimum above the maximum can never be reached, so the offering could only ever fail.
  if (input.minimumRaiseMinor > maximumRaise) problems.push({ code: 'minimum_above_maximum' });
  // A ticket that cannot buy one whole share can never be accepted, given no fractional shares.
  if (input.minimumTicketMinor < input.pricePerShareMinor) problems.push({ code: 'ticket_below_share_price' });
  // A minimum ticket that is not a whole number of shares silently returns a remainder every time.
  if (input.pricePerShareMinor > 0n && input.minimumTicketMinor % input.pricePerShareMinor !== 0n) {
    problems.push({ code: 'ticket_not_whole_shares' });
  }
  if (input.maximumTicketMinor !== null) {
    if (input.maximumTicketMinor < input.minimumTicketMinor) problems.push({ code: 'ticket_range_inverted' });
    if (input.maximumTicketMinor > maximumRaise) problems.push({ code: 'ticket_above_offering' });
  }

  const postRaiseShares = input.currentShares + input.sharesOffered;
  return {
    valid: problems.length === 0,
    problems,
    maximumRaiseMinor: maximumRaise.toString(),
    postRaiseShares: postRaiseShares.toString(),
    // What a buyer of the entire offering would own afterwards — never 100%, and stating it makes
    // the difference between "of the offering" and "of the company" visible on the editor itself.
    fullRaisePercent: percentString(input.sharesOffered, postRaiseShares)
  };
}
