import type { LocationPrecision, ProjectState } from '@tamkeen/database';

/**
 * Public projections for PART-04.
 *
 * 09-DATA-MODEL requires allowlisted DTOs rather than `SELECT *` followed by deleting fields: the
 * safe shape is built field by field here, so adding a column to a table can never widen what the
 * public sees. Every function in this file is pure, which is what lets the privacy rules be tested
 * without a database.
 */

/** The only project states a visitor may see at all. A draft is not "hidden", it is absent. */
export const PUBLICLY_VISIBLE_STATES: readonly ProjectState[] = ['published', 'funding_closed', 'executing', 'impact_review', 'completed', 'paused'] as const;

export function isPubliclyVisible(state: ProjectState): boolean {
  return PUBLICLY_VISIBLE_STATES.includes(state);
}

export interface PublicLocation {
  city: { nameAr: string; nameEn: string; country: string };
  /** Present only when the project is allowed to be pinned; otherwise the map falls back to the city. */
  point: { latitude: number; longitude: number } | null;
  precision: LocationPrecision;
}

/**
 * Rounds a coordinate to the precision the project declared.
 *
 * 04-INFORMATION-ARCHITECTURE forbids putting a beneficiary's exact coordinates into the public
 * index, and 12-SECURITY forbids publishing their address. So:
 *  - `city`        → no point at all; the map shows the city centre instead.
 *  - `approximate` → rounded to two decimal places, roughly a kilometre, which locates a
 *                    neighbourhood without identifying a building.
 *  - `exact`       → passed through, and only ever set for a public facility.
 */
export function publicLocation(input: {
  precision: LocationPrecision;
  latitude: number | null;
  longitude: number | null;
  city: { nameAr: string; nameEn: string; country: string; latitude: number; longitude: number };
}): PublicLocation {
  const city = { nameAr: input.city.nameAr, nameEn: input.city.nameEn, country: input.city.country };
  if (input.precision === 'city' || input.latitude === null || input.longitude === null) {
    return { city, point: { latitude: round(input.city.latitude, 4), longitude: round(input.city.longitude, 4) }, precision: 'city' };
  }
  if (input.precision === 'approximate') {
    return { city, point: { latitude: round(input.latitude, 2), longitude: round(input.longitude, 2) }, precision: 'approximate' };
  }
  return { city, point: { latitude: round(input.latitude, 6), longitude: round(input.longitude, 6) }, precision: 'exact' };
}

const round = (value: number, places: number) => Number(value.toFixed(places));

export interface PublicOrganizationSummary {
  slug: string;
  displayName: string;
  type: string;
  city: string;
  country: string;
  /** Verified only while the verification is actually current; an expired one is not "verified". */
  verified: boolean;
  logoUrl: string | null;
}

export function publicOrganizationSummary(organization: {
  slug: string; displayName: string; type: string; city: string; country: string;
  verification: string; currentLogoId: string | null;
}): PublicOrganizationSummary {
  return {
    slug: organization.slug,
    displayName: organization.displayName,
    type: organization.type,
    city: organization.city,
    country: organization.country,
    verified: organization.verification === 'verified',
    logoUrl: organization.currentLogoId ? `/api/v1/organizations/${encodeURIComponent(organization.slug)}/logo` : null
  };
}

export interface PublicProjectCard {
  slug: string;
  title: string;
  summary: string;
  type: string;
  state: ProjectState;
  publishedAt: string | null;
  organization: PublicOrganizationSummary;
  location: PublicLocation;
}

/**
 * The card shape used by /explore, /map and an organisation's public profile.
 *
 * Deliberately absent: the organisation's legal name, the manager's identity, the creator, the
 * internal project id, and any financial figure. Money arrives with PART-06 and will be published
 * through its own reviewed projection, not by widening this one.
 */
export function publicProjectCard(project: {
  slug: string; title: string; summary: string; type: string; state: ProjectState;
  publishedAt: Date | null; latitude: number | null; longitude: number | null;
  publicLocationPrecision: LocationPrecision;
  city: { nameAr: string; nameEn: string; country: string; latitude: number; longitude: number };
  organization: { slug: string; displayName: string; type: string; city: string; country: string; verification: string; currentLogoId: string | null };
}): PublicProjectCard {
  return {
    slug: project.slug,
    title: project.title,
    summary: project.summary,
    type: project.type,
    state: project.state,
    publishedAt: project.publishedAt ? project.publishedAt.toISOString() : null,
    organization: publicOrganizationSummary(project.organization),
    location: publicLocation({
      precision: project.publicLocationPrecision,
      latitude: project.latitude,
      longitude: project.longitude,
      city: project.city
    })
  };
}

/**
 * The public funding figures, or an explicit statement that there are none.
 *
 * The two cases are kept distinguishable on purpose: 15-QUALITY forbids presenting an absent
 * source as a zero, so a project with no campaign says so rather than showing "0 raised".
 */
export type PublicFunding =
  | {
      available: true;
      currency: string;
      goalMinor: string;
      /** Confirmed money net of confirmed refunds. Derived on every read; never a stored total. */
      raisedMinor: string;
      remainingMinor: string;
      /** Whole percent of the goal, clamped to 100 so an over-goal campaign cannot render past full. */
      percentOfGoal: number;
      policy: string;
      endsAt: string;
      /** Contributions counted, not contributors: one person may give more than once. */
      contributionCount: number;
      /** false once the campaign has ended or the project stopped accepting money. */
      acceptsContributions: boolean;
      /** Every figure here comes from a simulated payment path; no real money moved. */
      simulated: true;
    }
  | { available: false; reason: 'no_campaign' };

export interface PublicProjectDetail extends PublicProjectCard {
  story: string;
  /** Present so a reader can tell "no campaign" from "zero raised". */
  funding: PublicFunding;
}

/**
 * Builds the public funding block. Everything is derived from the campaign and the confirmed
 * contributions passed in; nothing is read from a cached total, so this figure cannot drift from
 * the ledger.
 */
export function publicFunding(input: {
  campaign: { goalMinor: bigint; currency: string; policy: string; endsAt: Date } | null;
  state: string;
  confirmed: ReadonlyArray<{ amountMinor: bigint; refundedMinor: bigint }>;
}): PublicFunding {
  if (!input.campaign) return { available: false, reason: 'no_campaign' };
  const raised = input.confirmed.reduce((total, row) => total + row.amountMinor - row.refundedMinor, 0n);
  const goal = input.campaign.goalMinor;
  const remaining = raised >= goal ? 0n : goal - raised;
  // Integer arithmetic throughout: the percentage is derived from minor units, not from a float.
  const percent = goal > 0n ? Number((raised * 100n) / goal) : 0;
  const live = input.campaign.endsAt > new Date() && ['published', 'executing'].includes(input.state);
  return {
    available: true,
    currency: input.campaign.currency,
    goalMinor: goal.toString(),
    raisedMinor: raised.toString(),
    remainingMinor: remaining.toString(),
    percentOfGoal: Math.min(100, Math.max(0, percent)),
    policy: input.campaign.policy,
    endsAt: input.campaign.endsAt.toISOString(),
    contributionCount: input.confirmed.length,
    acceptsContributions: live && remaining > 0n,
    simulated: true
  };
}

export function publicProjectDetail(
  project: Parameters<typeof publicProjectCard>[0] & { story: string },
  funding: PublicFunding
): PublicProjectDetail {
  return {
    ...publicProjectCard(project),
    story: project.story,
    funding
  };
}
