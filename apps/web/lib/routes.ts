/**
 * Which routes the workspace catch-all can render.
 *
 * This lives apart from the page component so a test can import it without pulling in React. It is
 * load-bearing: a route absent from here 404s before its component ever runs, which is exactly how
 * five implemented PART-03 screens shipped unreachable while every API test passed. Adding a
 * workspace screen means adding it here, and tests/route-resolution.test.ts enforces that against
 * the action manifest.
 *
 * Token routes stay patterns so an opaque value never becomes a static route.
 */

export const staticRoutes = [
  '/login', '/register', '/recover', '/reset', '/verify', '/mfa/login', '/mfa/challenge',
  '/onboarding', '/app', '/app/security', '/app/settings', '/app/organizations/new',
  '/admin/verifications', '/admin/team', '/admin/bank-change-requests', '/policies/terms',
  '/admin/reviews/project', '/app/contributions', '/admin/finance',
  '/app/investor/eligibility', '/admin/investment-reviews', '/app/investments',
  // PART-10. The career profile and the application list are personal records: neither depends
  // on belonging to an organisation, so both sit under /app rather than under /org.
  '/app/career/profile', '/app/applications', '/app/applications/new', '/admin/program-reviews',
  // PART-11. The candidate's job candidacies and the referrals waiting on their agreement. Both
  // are personal records, so neither sits under /org.
  '/app/jobs',
  // PART-12. A person's own assistance requests, their ideas and their volunteering. All three are
  // personal records; the organisation's side of each lives under /org.
  '/app/assistance', '/app/proposals', '/app/volunteering',
  // PART-13. Personal notifications/support and the scoped platform queues.
  '/app/notifications', '/app/saved', '/app/tickets', '/contact', '/admin/tickets', '/admin/audit', '/admin/operations'
];

/** ORG-06 and ORG-07 have their own component, so they are matched before the workspace routes. */
export const orgProjectList = /^\/org\/([^/]+)\/projects$/;
export const orgProjectNew = /^\/org\/([^/]+)\/projects\/new$/;
export const orgProjectDetail = /^\/org\/([^/]+)\/projects\/([0-9a-fA-F-]{36})$/;
/** ORG-09 and ORG-10. Longer than the detail route, so it must be tried before it. */
export const orgProjectFinance = /^\/org\/([^/]+)\/projects\/([0-9a-fA-F-]{36})\/finance$/;
export const projectReviewOne = /^\/admin\/reviews\/project\/([^/]+)$/;
/** PER-04. The slug identifies the campaign: this build has one campaign per project. */
export const checkout = /^\/checkout\/([^/]+)$/;
/** The local simulate page. Matched before the result route, since both start with /payments/. */
export const paymentSimulate = /^\/payments\/simulate\/([^/]+)$/;
/** PER-05. A UUID, so it cannot collide with the simulate path above. */
export const paymentResult = /^\/payments\/([0-9a-fA-F-]{36})$/;
/** ORG-11 and ORG-12. `new` is matched before the detail pattern, which requires a UUID. */
export const orgPayoutNew = /^\/org\/([^/]+)\/payouts\/new$/;
export const orgPayoutList = /^\/org\/([^/]+)\/payouts$/;
export const orgPayoutDetail = /^\/org\/([^/]+)\/payouts\/([0-9a-fA-F-]{36})$/;
/** ADM-06. The platform side of the same payout. */
export const adminDisbursement = /^\/admin\/disbursements\/([0-9a-fA-F-]{36})$/;
/** PART-08. BUS-01/02/03: the issuer's own offerings, the editor, and the data room. */
export const orgOfferingNew = /^\/org\/([^/]+)\/offerings\/new$/;
export const orgOfferingList = /^\/org\/([^/]+)\/offerings$/;
export const orgOfferingDataRoom = /^\/org\/([^/]+)\/offerings\/([0-9a-fA-F-]{36})\/dataroom$/;
export const orgOfferingDetail = /^\/org\/([^/]+)\/offerings\/([0-9a-fA-F-]{36})$/;
/** PART-09. PER-09: one investment in full. The id is a commitment, so it must look like one. */
export const myInvestmentDetail = /^\/app\/investments\/([0-9a-fA-F-]{36})$/;
/** BUS-04 and BUS-05: closing an offering, and what the issuer owes its investors afterwards. */
export const orgOfferingAllocations = /^\/org\/([^/]+)\/offerings\/([0-9a-fA-F-]{36})\/allocations$/;
export const orgInvestorRelations = /^\/org\/([^/]+)\/investor-relations$/;
/** PART-10. PER-11/12: a draft or a submitted application, and PER-13: one trainee's training. */
export const applicationEdit = /^\/app\/applications\/([0-9a-fA-F-]{36})\/edit$/;
export const applicationDetail = /^\/app\/applications\/([0-9a-fA-F-]{36})$/;
export const myTraining = /^\/app\/training\/([0-9a-fA-F-]{36})$/;
/** PRG-01..05: the operator's programmes, its screening queue, and the cohorts a trainer runs. */
export const orgProgramNew = /^\/org\/([^/]+)\/programs\/new$/;
export const orgProgramList = /^\/org\/([^/]+)\/programs$/;
export const orgProgramDetail = /^\/org\/([^/]+)\/programs\/([0-9a-fA-F-]{36})$/;
export const orgApplications = /^\/org\/([^/]+)\/applications$/;
export const orgApplicationDetail = /^\/org\/([^/]+)\/applications\/([0-9a-fA-F-]{36})$/;
/** The session register is a longer path than the cohort, so it is matched before it. */
export const orgCohortSession = /^\/org\/([^/]+)\/cohorts\/([0-9a-fA-F-]{36})\/sessions\/([0-9a-fA-F-]{36})$/;
export const orgCohortDetail = /^\/org\/([^/]+)\/cohorts\/([0-9a-fA-F-]{36})$/;
export const adminProgramReview = /^\/admin\/program-reviews\/([0-9a-fA-F-]{36})$/;
/** PART-11. PER-14: one job offer, and one placement with its follow-up checkpoints. */
export const myJobOffer = /^\/app\/job-offers\/([0-9a-fA-F-]{36})$/;
export const myPlacement = /^\/app\/placements\/([0-9a-fA-F-]{36})$/;
/** PRG-07..09: the employer's jobs, the offers it has made, and what became of them. */
export const orgJobNew = /^\/org\/([^/]+)\/jobs\/new$/;
export const orgJobList = /^\/org\/([^/]+)\/jobs$/;
export const orgJobEdit = /^\/org\/([^/]+)\/jobs\/([0-9a-fA-F-]{36})\/edit$/;
export const orgJobOffers = /^\/org\/([^/]+)\/job-offers$/;
export const orgPlacements = /^\/org\/([^/]+)\/placements$/;
/** PART-12. PER-15/16: one assistance case and one idea, each the person's own record. */
export const myAssistanceCase = /^\/app\/assistance\/([0-9a-fA-F-]{36})$/;
export const myProposal = /^\/app\/proposals\/([0-9a-fA-F-]{36})$/;
/** BUS-06 and PRG-06/10..13: the organisation's agreements, outcomes, ideas, cases and volunteers. */
export const orgAgreementList = /^\/org\/([^/]+)\/agreements$/;
export const orgAgreementDetail = /^\/org\/([^/]+)\/agreements\/([0-9a-fA-F-]{36})$/;
export const orgProgramOutcomes = /^\/org\/([^/]+)\/programs\/([0-9a-fA-F-]{36})\/outcomes$/;
export const orgProposalList = /^\/org\/([^/]+)\/proposals$/;
export const orgProposalDetail = /^\/org\/([^/]+)\/proposals\/([0-9a-fA-F-]{36})$/;
export const orgSponsorships = /^\/org\/([^/]+)\/sponsorships$/;
export const orgAssistanceList = /^\/org\/([^/]+)\/assistance$/;
export const orgAssistanceCase = /^\/org\/([^/]+)\/assistance\/([0-9a-fA-F-]{36})$/;
export const orgVolunteering = /^\/org\/([^/]+)\/volunteering$/;
/** ADM-04. */
export const adminInvestmentReview = /^\/admin\/investment-reviews\/([0-9a-fA-F-]{36})$/;
export const myTicket = /^\/app\/tickets\/([0-9a-fA-F-]{36})$/;
export const adminTicket = /^\/admin\/tickets\/([0-9a-fA-F-]{36})$/;
export const myExport = /^\/app\/exports\/([0-9a-fA-F-]{36})$/;
export const publicImpactReport = /^\/impact\/reports\/([0-9a-fA-F-]{36})$/;

const patternRoutes = [
  /^\/org\/[^/]+(?:\/(?:team|settings|verification))?$/,
  orgProjectList,
  orgProjectNew,
  orgProjectDetail,
  orgProjectFinance,
  projectReviewOne,
  checkout,
  paymentSimulate,
  paymentResult,
  orgPayoutNew,
  orgPayoutList,
  orgPayoutDetail,
  adminDisbursement,
  orgOfferingNew,
  orgOfferingList,
  orgOfferingDataRoom,
  orgOfferingAllocations,
  orgOfferingDetail,
  orgInvestorRelations,
  myInvestmentDetail,
  adminInvestmentReview,
  myTicket,
  adminTicket,
  myExport,
  publicImpactReport,
  applicationEdit,
  applicationDetail,
  myTraining,
  orgProgramNew,
  orgProgramList,
  orgProgramDetail,
  orgApplicationDetail,
  orgApplications,
  orgCohortSession,
  orgCohortDetail,
  adminProgramReview,
  myJobOffer,
  myPlacement,
  myAssistanceCase,
  myProposal,
  orgAgreementDetail,
  orgAgreementList,
  orgProgramOutcomes,
  orgProposalDetail,
  orgProposalList,
  orgSponsorships,
  orgAssistanceCase,
  orgAssistanceList,
  orgVolunteering,
  orgJobNew,
  orgJobEdit,
  orgJobList,
  orgJobOffers,
  orgPlacements,
  /^\/invitations\/[^/]+$/,
  /^\/ownership-transfers\/[^/]+$/,
  /^\/platform-invitations\/[^/]+$/,
  /^\/admin\/verifications\/[^/]+$/
];

export function isWorkspaceRoute(route: string): boolean {
  return staticRoutes.includes(route) || patternRoutes.some(pattern => pattern.test(route));
}
