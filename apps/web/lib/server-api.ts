import 'server-only';

/**
 * Server-side reads for the public pages.
 *
 * 10-TECHNICAL-ARCHITECTURE requires the public surface to be indexable, so these pages render on
 * the server rather than fetching after hydration. A failed read is returned as a value, not
 * thrown, because 20-UI-CONTRACT requires every list to have a distinguishable error state — a
 * page that silently renders empty is indistinguishable from one with no results.
 */

const API_BASE = process.env.API_BASE_URL ?? 'http://127.0.0.1:4000';

export type ReadResult<T> =
  | { ok: true; data: T; page?: { nextCursor: string | null; hasMore: boolean } }
  | { ok: false; status: number; requestId: string };

// Re-exported so pages keep one import for their server-side reads.
export { pathSegment } from './path-segment';

export async function readPublic<T>(path: string, search?: URLSearchParams): Promise<ReadResult<T>> {
  const query = search?.toString();
  const url = `${API_BASE}/api/v1${path}${query ? `?${query}` : ''}`;
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
    if (!response.ok) return { ok: false, status: response.status, requestId: reference(url, response.status) };
    const body = await response.json() as { data: T; page?: { nextCursor: string | null; hasMore: boolean } };
    return { ok: true, data: body.data, ...(body.page ? { page: body.page } : {}) };
  } catch {
    // A timeout or a refused connection is a 503 from the reader's point of view.
    return { ok: false, status: 503, requestId: reference(url, 503) };
  }
}

/** A short, non-secret reference a person can quote to support; it identifies the call, not them. */
function reference(url: string, status: number): string {
  let hash = 0;
  for (const character of `${url}:${status}`) hash = (Math.imul(31, hash) + character.charCodeAt(0)) | 0;
  return `req_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export interface PublicLocation {
  city: { nameAr: string; nameEn: string; country: string };
  point: { latitude: number; longitude: number } | null;
  precision: 'city' | 'approximate' | 'exact';
}

export interface PublicOrganizationSummary {
  slug: string; displayName: string; type: string; city: string; country: string;
  verified: boolean; logoUrl: string | null;
}

export interface PublicProjectCard {
  slug: string; title: string; summary: string; type: string; state: string;
  publishedAt: string | null;
  /** Admin-set cover photo; null means the web shows the default photo for the project type. */
  coverUrl?: string | null;
  organization: PublicOrganizationSummary;
  location: PublicLocation;
}

/** Mirrors the API's PublicFunding. The two cases stay distinguishable: no campaign is not zero. */
export type PublicFunding =
  | {
      available: true;
      currency: string;
      goalMinor: string; raisedMinor: string; remainingMinor: string;
      percentOfGoal: number;
      policy: string;
      endsAt: string;
      contributionCount: number;
      acceptsContributions: boolean;
      simulated: true;
    }
  | { available: false; reason: string };

export interface PublicProjectDetail extends PublicProjectCard {
  story: string;
  funding: PublicFunding;
}

export interface PublicContributor {
  id: string;
  name: string | null;
  anonymous: boolean;
  amountMinor: string | null;
  currency: string;
  confirmedAt: string | null;
}

export interface PublicOrganizationProfile extends PublicOrganizationSummary {
  publicDescription: string; sectors: string[]; websiteUrl: string | null; contactEmail: string | null;
  projects: PublicProjectCard[];
}

export interface City { id: string; country: string; nameAr: string; nameEn: string }

export interface ImpactSummary {
  asOf: string;
  counted: Array<{ key: string; value: number; definition: string }>;
  unavailable: Array<{ key: string; reason: string; part: string }>;
}
export interface PublicReportSummary { id: string; title: string; sourceType: string; version: number; currency: string | null; periodStart: string | null; periodEnd: string | null; filterDefinition: string; publishedAt: string }

/** PUB-07. A card in the investment index. Carries no projected return and no valuation. */
export interface PublicOfferingCard {
  slug: string; title: string; instrument: string; currency: string; state: string;
  sharesOffered: string; pricePerShareMinor: string; maximumRaiseMinor: string;
  minimumRaiseMinor: string; minimumTicketMinor: string; maximumTicketMinor: string | null;
  /** What the whole offering amounts to as a share of the company after issue. Never 100%. */
  offeringPercentOfPostRaise: string;
  postRaiseShares: string;
  opensAt: string | null; closesAt: string | null;
  organization: { slug: string; displayName: string; city: string; country: string; verified: boolean };
  simulated: boolean;
}

export interface PublicOfferingDetail extends PublicOfferingCard {
  /** Present on the detail projection only. Every action on this page is addressed by it. */
  id: string;
  useOfFunds: string;
  disclosure: {
    id: string; sequence: number; summary: string; risks: string; useOfFunds: string;
    checksum: string; material: boolean; publishedAt: string;
  } | null;
  publicDocuments: Array<{ id: string; title: string; category: string }>;
  requiresEligibility: boolean;
  requiresNda: boolean;
  /** Whether a commitment would be accepted right now: the same condition the server enforces. */
  acceptsCommitments: boolean;
  /** A machine code, empty when commitments are accepted. Rendered by `subscribeClosedReason`. */
  commitmentsUnavailableReason: string;
}

/** PUB-09. A programme card. Carries no candidate data and no promise of work. */
export interface PublicProgramCard {
  slug: string; title: string; skills: string[]; level: string;
  deliveryMode: 'in_person' | 'remote' | 'hybrid'; city: string;
  capacity: number; durationWeeks: number; hoursPerWeek: number;
  applyOpensAt: string | null; applyClosesAt: string | null; state: string;
  /** Never a bare count: 07 requires the claim to say which kind of claim it is. */
  jobCommitmentKind: 'none' | 'expected' | 'committed';
  jobCount: number;
  jobCommitmentTerms: string;
  completionGuaranteesJob: boolean;
  stipendOffered: boolean;
  stipendAmountMinor: string | null;
  stipendCurrency: string | null;
  stipendConditions: string;
  stipendPayable: boolean;
  stipendUnavailableReason: string;
  organization: { slug: string; displayName: string; city: string; country: string; verified: boolean };
}

/**
 * PUB-09/PUB-11. A job card.
 *
 * It carries no candidate data at all, and pay is either stated or its absence is: a card with an
 * empty pay line would leave the reader guessing, which is exactly what 07 forbids.
 */
export interface PublicJobCard {
  slug: string; title: string; skills: string[];
  contractType: 'full_time' | 'part_time' | 'fixed_term' | 'apprenticeship' | 'temporary';
  contractMonths: number | null;
  deliveryMode: 'in_person' | 'remote' | 'hybrid'; city: string;
  closesAt: string | null; openings: number; state: string;
  salaryDisclosed: boolean;
  salaryMinMinor: string | null;
  salaryMaxMinor: string | null;
  salaryCurrency: string | null;
  salaryPeriod: string;
  /** Never empty when the pay is not disclosed. */
  salaryUndisclosedReason: string;
  organization: { slug: string; displayName: string; city: string; country: string; verified: boolean };
}

/**
 * PER-17. A volunteering opportunity as the public sees it.
 *
 * It names no volunteer and no supervisor — 07 requires somebody answerable, not somebody named on
 * an open page — and it states that the work is unpaid and is not employment.
 */
export interface PublicVolunteerOpportunity {
  slug: string; title: string; summary: string; city: string;
  deliveryMode: 'in_person' | 'remote' | 'hybrid';
  capacity: number; placesLeft: number; hoursPerWeek: number;
  startsAt: string | null; endsAt: string | null; state: string;
  acceptsApplications: boolean; applicationsUnavailableReason: string;
  organization: { slug: string; displayName: string; city: string; verified: boolean };
  isPaid: boolean;
  isEmployment: boolean;
}

export interface PublicVolunteerOpportunityDetail extends PublicVolunteerOpportunity {
  id: string;
  tasks: string;
  requirements: string;
  /** Published before anybody applies, so a volunteer knows how they can stop. */
  withdrawalPolicy: string;
  hasNamedSupervisor: boolean;
}

/**
 * The public answer to a certificate reference.
 *
 * Enough to attribute the certificate and nothing else about the person: `withheld` names what is
 * deliberately absent, so a reader knows it is a rule rather than a gap in the record.
 */
export interface CertificateCheck {
  publicId: string;
  valid: boolean;
  state: 'issued' | 'revoked';
  holderName: string;
  programTitle: string;
  issuerName: string;
  completedAt: string;
  issuedAt: string;
  revokedAt: string | null;
  withheld: string[];
}

export interface PublicJobDetail extends PublicJobCard {
  id: string;
  summary: string;
  responsibilities: string;
  requirements: string;
  hoursPerWeek: number;
  /** The training this job came out of, where there is one. */
  program: { slug: string; title: string; state: string } | null;
  /** 07's stage limit: a job linked to a programme is not something that programme promised. */
  programDidNotPromiseThisJob: boolean;
  /** The same condition the submit endpoint enforces, so no page offers a button the server refuses. */
  acceptsApplications: boolean;
  applicationsUnavailableReason: string;
}

export interface PublicProgramDetail extends PublicProgramCard {
  summary: string;
  schedule: string;
  attendancePolicy: string;
  assessmentPolicy: string;
  selectionMethod: string;
  withdrawalPolicy: string;
  accessibilityNote: string;
  privacyNote: string;
  complaintsContact: string;
  educationRequirement: string;
  minimumAge: number | null;
  maximumAge: number | null;
  cohorts: Array<{ id: string; name: string; startAt: string; endAt: string; timezone: string; capacity: number; seatsTaken: number; seatsRemaining: number }>;
  /** The same condition the submit endpoint enforces, so no page offers a button the server refuses. */
  acceptsApplications: boolean;
  applicationsUnavailableReason: string;
}
