import { notFound } from 'next/navigation';
import { isLocale } from '@tamkeen/ui';
import { IdentityWorkspace } from '../identity-workspace';
import { OrgProjects } from '../org-projects';
import { OrgProjectDetail } from '../org-project-detail';
import { AdminProjectReviews } from '../admin-project-reviews';
import { Checkout, MyContributions, OrgFinance, PaymentResult, SimulatePayment } from '../money-screens';
import { AdminFinance, OrgPayouts } from '../payout-screens';
import { InvestmentReviews, InvestorEligibility, OrgOfferings } from '../investment-screens';
import { InvestmentDetail, MyInvestments, OrgAllocations, OrgInvestorRelations } from '../subscription-screens';
import { CareerProfile, MyApplications, MyTrainingScreen } from '../program-screens';
import { OrgApplications, OrgCohort, OrgPrograms, ProgramReviews, SessionRegister } from '../program-operator-screens';
import { JobApplicationForm, JobOfferScreen, MyJobs, PlacementScreen } from '../employment-screens';
import { OrgJobOffers, OrgJobs, OrgPlacements } from '../employment-operator-screens';
import { MyAssistance, MyProposals, MyVolunteering } from '../enablement-screens';
import { OrgAgreements, OrgAssistance, OrgProgramOutcomes, OrgProposals, OrgSponsorships, OrgVolunteering } from '../enablement-operator-screens';
import { AdminOperations, ExportTracker, MyNotifications, OperationsDashboard, SupportTickets } from '../operations-screens';
import { SiteAdmin } from '../site-admin-screens';
import {
  adminDisbursement, adminInvestmentReview, checkout, isWorkspaceRoute,
  myInvestmentDetail, orgInvestorRelations,
  applicationDetail, applicationEdit, myTraining,
  orgApplicationDetail, orgApplications, orgCohortDetail, orgCohortSession,
  orgProgramDetail, orgProgramList, orgProgramNew, adminProgramReview,
  myJobOffer, myPlacement, orgJobEdit, orgJobList, orgJobNew, orgJobOffers, orgPlacements,
  myAssistanceCase, myProposal, orgAgreementDetail, orgAgreementList, orgProgramOutcomes,
  orgProposalDetail, orgProposalList, orgSponsorships, orgAssistanceCase, orgAssistanceList,
  orgVolunteering,
  orgOfferingAllocations, orgOfferingDataRoom, orgOfferingDetail, orgOfferingList, orgOfferingNew,
  orgPayoutDetail, orgPayoutList, orgPayoutNew,
  orgProjectDetail, orgProjectFinance, orgProjectList, orgProjectNew,
  paymentResult, paymentSimulate, projectReviewOne, myTicket, adminTicket, myExport
} from '../../../lib/routes';

/**
 * The workspace router. Which routes exist lives in lib/routes.ts so a test can check the list
 * against the action manifest without rendering React; this file only decides which component a
 * recognised route gets. Order matters where one pattern is a prefix of another.
 */

export default async function Page({ params, searchParams }: {
  params: Promise<{ locale: string; path: string[] }>;
  // PUB-11.A01's contract is `/app/applications/new?job=:id`, so the one route serves both kinds of
  // application and the query says which. Reading it here keeps that decision out of the component.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, path } = await params;
  const query = await searchParams;
  if (!isLocale(locale)) notFound();
  const route = '/' + path.join('/');
  if (!isWorkspaceRoute(route)) notFound();

  // PART-13 personal and platform operations. Detail patterns are resolved before their lists.
  const personalTicket = myTicket.exec(route);
  if (personalTicket?.[1]) return <SupportTickets locale={locale} ticketId={personalTicket[1]} />;
  const platformTicket = adminTicket.exec(route);
  if (platformTicket?.[1]) return <AdminOperations locale={locale} mode="tickets" ticketId={platformTicket[1]} />;
  const exportJob = myExport.exec(route);
  if (exportJob?.[1]) return <ExportTracker locale={locale} jobId={exportJob[1]} />;
  if (route === '/app/notifications') return <MyNotifications locale={locale} />;
  if (route === '/app/tickets') return <SupportTickets locale={locale} />;
  if (route === '/contact') return <SupportTickets locale={locale} create />;
  if (route === '/admin/tickets') return <AdminOperations locale={locale} mode="tickets" />;
  if (route === '/admin/audit') return <AdminOperations locale={locale} mode="audit" />;
  if (route === '/admin/operations') return <OperationsDashboard locale={locale} />;
  if (route === '/admin/site') return <SiteAdmin locale={locale} mode="content" />;
  if (route === '/admin/site/covers') return <SiteAdmin locale={locale} mode="covers" />;
  if (route === '/admin/messages') return <SiteAdmin locale={locale} mode="messages" />;

  // Longest-first among the /org/.../projects/... family, so /finance is not taken as a detail page.
  const finance = orgProjectFinance.exec(route);
  if (finance?.[1] && finance[2]) return <OrgFinance locale={locale} orgId={finance[1]} projectId={finance[2]} />;
  const newProject = orgProjectNew.exec(route);
  if (newProject?.[1]) return <OrgProjects locale={locale} orgId={newProject[1]} mode="new" />;
  const projectDetail = orgProjectDetail.exec(route);
  if (projectDetail?.[1] && projectDetail[2]) return <OrgProjectDetail locale={locale} orgId={projectDetail[1]} projectId={projectDetail[2]} />;
  const projectList = orgProjectList.exec(route);
  if (projectList?.[1]) return <OrgProjects locale={locale} orgId={projectList[1]} mode="list" />;

  // Both money paths start with /payments/, so the simulate page is matched before the result page.
  const simulate = paymentSimulate.exec(route);
  if (simulate?.[1]) return <SimulatePayment locale={locale} providerReference={simulate[1]} />;
  const payment = paymentResult.exec(route);
  if (payment?.[1]) return <PaymentResult locale={locale} intentId={payment[1]} />;
  const pay = checkout.exec(route);
  if (pay?.[1]) return <Checkout locale={locale} slug={pay[1]} />;
  if (route === '/app/contributions') return <MyContributions locale={locale} />;

  // ORG-11/ORG-12. `new` is tried before the detail pattern, which only matches a UUID anyway.
  const payoutNew = orgPayoutNew.exec(route);
  if (payoutNew?.[1]) return <OrgPayouts locale={locale} orgId={payoutNew[1]} mode="new" />;
  const payoutDetail = orgPayoutDetail.exec(route);
  if (payoutDetail?.[1] && payoutDetail[2]) return <OrgPayouts locale={locale} orgId={payoutDetail[1]} payoutId={payoutDetail[2]} mode="detail" />;
  const payoutList = orgPayoutList.exec(route);
  if (payoutList?.[1]) return <OrgPayouts locale={locale} orgId={payoutList[1]} mode="list" />;

  // BUS-01/02/03. The data room is a longer path than the detail, so it is tried first, and `new`
  // before the detail pattern even though that only matches a UUID.
  // PART-09. Both are longer than the offering-detail pattern, so they are tried before it.
  const allocations = orgOfferingAllocations.exec(route);
  if (allocations?.[1] && allocations[2]) return <OrgAllocations locale={locale} orgId={allocations[1]} offeringId={allocations[2]} />;
  const dataRoom = orgOfferingDataRoom.exec(route);
  if (dataRoom?.[1] && dataRoom[2]) return <OrgOfferings locale={locale} orgId={dataRoom[1]} offeringId={dataRoom[2]} mode="dataroom" />;
  const offeringNew = orgOfferingNew.exec(route);
  if (offeringNew?.[1]) return <OrgOfferings locale={locale} orgId={offeringNew[1]} mode="new" />;
  const offeringDetail = orgOfferingDetail.exec(route);
  if (offeringDetail?.[1] && offeringDetail[2]) return <OrgOfferings locale={locale} orgId={offeringDetail[1]} offeringId={offeringDetail[2]} mode="detail" />;
  const offeringList = orgOfferingList.exec(route);
  if (offeringList?.[1]) return <OrgOfferings locale={locale} orgId={offeringList[1]} mode="list" />;

  // PART-10. The longer paths first in every family: a session before its cohort, `new` before a
  // detail pattern, and an edit before the plain application detail.
  const cohortSession = orgCohortSession.exec(route);
  if (cohortSession?.[1] && cohortSession[2] && cohortSession[3]) return <SessionRegister locale={locale} orgId={cohortSession[1]} cohortId={cohortSession[2]} sessionId={cohortSession[3]} />;
  const cohortDetail = orgCohortDetail.exec(route);
  if (cohortDetail?.[1] && cohortDetail[2]) return <OrgCohort locale={locale} orgId={cohortDetail[1]} cohortId={cohortDetail[2]} />;
  const outcomes = orgProgramOutcomes.exec(route);
  if (outcomes?.[1] && outcomes[2]) return <OrgProgramOutcomes locale={locale} orgId={outcomes[1]} programId={outcomes[2]} />;
  const programNew = orgProgramNew.exec(route);
  if (programNew?.[1]) return <OrgPrograms locale={locale} orgId={programNew[1]} mode="new" />;
  const programDetail = orgProgramDetail.exec(route);
  if (programDetail?.[1] && programDetail[2]) return <OrgPrograms locale={locale} orgId={programDetail[1]} programId={programDetail[2]} mode="detail" />;
  const programList = orgProgramList.exec(route);
  if (programList?.[1]) return <OrgPrograms locale={locale} orgId={programList[1]} mode="list" />;
  const applicationDetailForOrg = orgApplicationDetail.exec(route);
  if (applicationDetailForOrg?.[1] && applicationDetailForOrg[2]) return <OrgApplications locale={locale} orgId={applicationDetailForOrg[1]} applicationId={applicationDetailForOrg[2]} />;
  const applicationsForOrg = orgApplications.exec(route);
  if (applicationsForOrg?.[1]) return <OrgApplications locale={locale} orgId={applicationsForOrg[1]} />;

  if (route === '/app/career/profile') return <CareerProfile locale={locale} />;
  if (route === '/app/applications/new') {
    const job = query.job;
    const jobSlug = Array.isArray(job) ? job[0] : job;
    if (jobSlug) return <JobApplicationForm locale={locale} jobSlug={jobSlug} />;
    return <MyApplications locale={locale} mode="new" />;
  }
  const applicationEditing = applicationEdit.exec(route);
  if (applicationEditing?.[1]) return <MyApplications locale={locale} applicationId={applicationEditing[1]} mode="edit" />;
  const applicationReading = applicationDetail.exec(route);
  if (applicationReading?.[1]) return <MyApplications locale={locale} applicationId={applicationReading[1]} mode="detail" />;
  if (route === '/app/applications') return <MyApplications locale={locale} mode="list" />;
  const training = myTraining.exec(route);
  if (training?.[1]) return <MyTrainingScreen locale={locale} enrollmentId={training[1]} />;
  if (route === '/app/jobs') return <MyJobs locale={locale} />;
  const offer = myJobOffer.exec(route);
  if (offer?.[1]) return <JobOfferScreen locale={locale} offerId={offer[1]} />;
  const placement = myPlacement.exec(route);
  if (placement?.[1]) return <PlacementScreen locale={locale} placementId={placement[1]} />;

  // PART-11. `new` and the edit path are both longer than the list, so they are tried first.
  const jobNew = orgJobNew.exec(route);
  if (jobNew?.[1]) return <OrgJobs locale={locale} orgId={jobNew[1]} mode="new" />;
  const jobEdit = orgJobEdit.exec(route);
  if (jobEdit?.[1] && jobEdit[2]) return <OrgJobs locale={locale} orgId={jobEdit[1]} jobId={jobEdit[2]} mode="edit" />;
  const jobList = orgJobList.exec(route);
  if (jobList?.[1]) return <OrgJobs locale={locale} orgId={jobList[1]} mode="list" />;
  const jobOffersForOrg = orgJobOffers.exec(route);
  if (jobOffersForOrg?.[1]) return <OrgJobOffers locale={locale} orgId={jobOffersForOrg[1]} />;
  const placementsForOrg = orgPlacements.exec(route);
  if (placementsForOrg?.[1]) return <OrgPlacements locale={locale} orgId={placementsForOrg[1]} />;

  // PART-12. A detail route before its list in every family.
  const assistanceCase = myAssistanceCase.exec(route);
  if (assistanceCase?.[1]) return <MyAssistance locale={locale} caseId={assistanceCase[1]} />;
  if (route === '/app/assistance') return <MyAssistance locale={locale} />;
  const proposal = myProposal.exec(route);
  if (proposal?.[1]) return <MyProposals locale={locale} proposalId={proposal[1]} />;
  if (route === '/app/proposals') return <MyProposals locale={locale} />;
  if (route === '/app/volunteering') return <MyVolunteering locale={locale} />;

  const agreementDetail = orgAgreementDetail.exec(route);
  if (agreementDetail?.[1] && agreementDetail[2]) return <OrgAgreements locale={locale} orgId={agreementDetail[1]} agreementId={agreementDetail[2]} />;
  const agreementList = orgAgreementList.exec(route);
  if (agreementList?.[1]) return <OrgAgreements locale={locale} orgId={agreementList[1]} />;
  const proposalDetailForOrg = orgProposalDetail.exec(route);
  if (proposalDetailForOrg?.[1] && proposalDetailForOrg[2]) return <OrgProposals locale={locale} orgId={proposalDetailForOrg[1]} proposalId={proposalDetailForOrg[2]} />;
  const proposalsForOrg = orgProposalList.exec(route);
  if (proposalsForOrg?.[1]) return <OrgProposals locale={locale} orgId={proposalsForOrg[1]} />;
  const sponsorships = orgSponsorships.exec(route);
  if (sponsorships?.[1]) return <OrgSponsorships locale={locale} orgId={sponsorships[1]} />;
  const assistanceCaseForOrg = orgAssistanceCase.exec(route);
  if (assistanceCaseForOrg?.[1] && assistanceCaseForOrg[2]) return <OrgAssistance locale={locale} orgId={assistanceCaseForOrg[1]} caseId={assistanceCaseForOrg[2]} />;
  const assistanceForOrg = orgAssistanceList.exec(route);
  if (assistanceForOrg?.[1]) return <OrgAssistance locale={locale} orgId={assistanceForOrg[1]} />;
  const volunteeringForOrg = orgVolunteering.exec(route);
  if (volunteeringForOrg?.[1]) return <OrgVolunteering locale={locale} orgId={volunteeringForOrg[1]} />;

  if (route === '/admin/program-reviews') return <ProgramReviews locale={locale} />;
  const programReview = adminProgramReview.exec(route);
  if (programReview?.[1]) return <ProgramReviews locale={locale} programId={programReview[1]} />;

  // PART-09. BUS-05, PER-06 and PER-09.
  const relations = orgInvestorRelations.exec(route);
  if (relations?.[1]) return <OrgInvestorRelations locale={locale} orgId={relations[1]} />;
  const investment = myInvestmentDetail.exec(route);
  if (investment?.[1]) return <InvestmentDetail locale={locale} commitmentId={investment[1]} />;
  if (route === '/app/investments') return <MyInvestments locale={locale} />;

  // PER-07 and ADM-04.
  if (route === '/app/investor/eligibility') return <InvestorEligibility locale={locale} />;
  if (route === '/admin/investment-reviews') return <InvestmentReviews locale={locale} />;
  const investmentReview = adminInvestmentReview.exec(route);
  if (investmentReview?.[1]) return <InvestmentReviews locale={locale} offeringId={investmentReview[1]} />;

  // ADM-05/ADM-06.
  if (route === '/admin/finance') return <AdminFinance locale={locale} />;
  const disbursement = adminDisbursement.exec(route);
  if (disbursement?.[1]) return <AdminFinance locale={locale} payoutId={disbursement[1]} />;

  if (route === '/admin/reviews/project') return <AdminProjectReviews locale={locale} />;
  const reviewOne = projectReviewOne.exec(route);
  if (reviewOne?.[1]) return <AdminProjectReviews locale={locale} versionId={reviewOne[1]} />;
  return <IdentityWorkspace route={route} locale={locale} />;
}
