-- CreateEnum
CREATE TYPE "AgreementKind" AS ENUM ('cash', 'in_kind', 'mixed');
-- CreateEnum
CREATE TYPE "AgreementState" AS ENUM ('draft', 'pending_acceptance', 'active', 'completed', 'terminated', 'disputed');
-- CreateEnum
CREATE TYPE "AgreementPartyRole" AS ENUM ('sponsor', 'operator');
-- CreateEnum
CREATE TYPE "AgreementMilestoneState" AS ENUM ('planned', 'evidence_submitted', 'approved', 'changes_requested');
-- CreateEnum
CREATE TYPE "AgreementReportState" AS ENUM ('draft', 'submitted', 'approved', 'changes_requested');
-- CreateEnum
CREATE TYPE "StipendBatchState" AS ENUM ('draft', 'requested', 'approved', 'paid', 'cancelled');
-- CreateEnum
CREATE TYPE "CertificateState" AS ENUM ('issued', 'revoked');
-- CreateEnum
CREATE TYPE "ProposalState" AS ENUM ('draft', 'submitted', 'review', 'accepted', 'rejected', 'active', 'closed', 'withdrawn');
-- CreateEnum
CREATE TYPE "IncubationAgreementState" AS ENUM ('draft', 'offered', 'accepted', 'declined', 'withdrawn', 'closed');
-- CreateEnum
CREATE TYPE "IncubationMilestoneState" AS ENUM ('planned', 'evidence_submitted', 'approved', 'changes_requested');
-- CreateEnum
CREATE TYPE "AssistanceState" AS ENUM ('draft', 'submitted', 'in_review', 'awaiting_info', 'approved', 'rejected', 'delivered', 'closed', 'disputed', 'withdrawn');
-- CreateEnum
CREATE TYPE "VolunteerOpportunityState" AS ENUM ('draft', 'open', 'paused', 'closed');
-- CreateEnum
CREATE TYPE "VolunteerApplicationState" AS ENUM ('submitted', 'accepted', 'rejected', 'withdrawn');
-- CreateEnum
CREATE TYPE "VolunteerAssignmentState" AS ENUM ('offered', 'accepted', 'declined', 'active', 'ended');
-- CreateEnum
CREATE TYPE "VolunteerHoursState" AS ENUM ('submitted', 'approved', 'rejected');
-- CreateTable
CREATE TABLE "agreements" (
    "id" UUID NOT NULL,
    "sponsor_org_id" UUID NOT NULL,
    "operator_org_id" UUID NOT NULL,
    "program_id" UUID,
    "project_id" UUID,
    "reference" VARCHAR(20) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "kind" "AgreementKind" NOT NULL DEFAULT 'cash',
    "amount_minor" BIGINT,
    "currency" CHAR(3),
    "in_kind_description" VARCHAR(2000) NOT NULL DEFAULT '',
    "in_kind_value_minor" BIGINT,
    "purpose" VARCHAR(4000) NOT NULL,
    "obligations" VARCHAR(4000) NOT NULL DEFAULT '',
    "reporting_terms" VARCHAR(2000) NOT NULL DEFAULT '',
    "surplus_terms" VARCHAR(1000) NOT NULL DEFAULT '',
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "state" "AgreementState" NOT NULL DEFAULT 'draft',
    "state_reason" VARCHAR(1000) NOT NULL DEFAULT '',
    "terms_checksum" CHAR(64) NOT NULL DEFAULT '',
    "sent_at" TIMESTAMPTZ(3),
    "activated_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "creates_equity" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agreements_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "agreement_revisions" (
    "id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "terms" VARCHAR(8000) NOT NULL,
    "checksum" CHAR(64) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agreement_revisions_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "agreement_acceptances" (
    "id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,
    "party_role" "AgreementPartyRole" NOT NULL,
    "checksum" CHAR(64) NOT NULL,
    "accepted_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agreement_acceptances_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "agreement_milestones" (
    "id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000) NOT NULL DEFAULT '',
    "due_at" DATE NOT NULL,
    "amount_minor" BIGINT,
    "state" "AgreementMilestoneState" NOT NULL DEFAULT 'planned',
    "evidence_ref" VARCHAR(200) NOT NULL DEFAULT '',
    "evidence_note" VARCHAR(2000) NOT NULL DEFAULT '',
    "submitted_at" TIMESTAMPTZ(3),
    "decided_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agreement_milestones_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "agreement_milestone_decisions" (
    "id" UUID NOT NULL,
    "milestone_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "outcome" VARCHAR(30) NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "evidence_ref" VARCHAR(200) NOT NULL DEFAULT '',
    "released_funds" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agreement_milestone_decisions_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "agreement_reports" (
    "id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "narrative" VARCHAR(8000) NOT NULL DEFAULT '',
    "spent_minor" BIGINT NOT NULL DEFAULT 0,
    "participants_reached" INTEGER NOT NULL DEFAULT 0,
    "outcomes_note" VARCHAR(4000) NOT NULL DEFAULT '',
    "variance_note" VARCHAR(2000) NOT NULL DEFAULT '',
    "state" "AgreementReportState" NOT NULL DEFAULT 'draft',
    "submitted_at" TIMESTAMPTZ(3),
    "decided_at" TIMESTAMPTZ(3),
    "decision_reason" VARCHAR(1000) NOT NULL DEFAULT '',
    "reviewer_id" UUID,
    "created_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agreement_reports_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "agreement_funding_intents" (
    "id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,
    "payment_intent_id" UUID,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "note" VARCHAR(1000) NOT NULL DEFAULT '',
    "creates_equity" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agreement_funding_intents_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "stipend_batches" (
    "id" UUID NOT NULL,
    "cohort_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "total_minor" BIGINT NOT NULL DEFAULT 0,
    "state" "StipendBatchState" NOT NULL DEFAULT 'draft',
    "state_reason" VARCHAR(1000) NOT NULL DEFAULT '',
    "payout_id" UUID,
    "created_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stipend_batches_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "stipend_lines" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "sessions_counted" INTEGER NOT NULL DEFAULT 0,
    "sessions_held" INTEGER NOT NULL DEFAULT 0,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "basis" VARCHAR(500) NOT NULL DEFAULT '',
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancel_reason" VARCHAR(1000) NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stipend_lines_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "certificates" (
    "id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "public_id" VARCHAR(24) NOT NULL,
    "holder_name" VARCHAR(200) NOT NULL,
    "program_title" VARCHAR(200) NOT NULL,
    "issuer_name" VARCHAR(200) NOT NULL,
    "completed_at" DATE NOT NULL,
    "state" "CertificateState" NOT NULL DEFAULT 'issued',
    "issued_by" UUID NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoke_reason" VARCHAR(1000) NOT NULL DEFAULT '',
    "revoke_evidence" VARCHAR(200) NOT NULL DEFAULT '',
    "revoked_by" UUID,
    "revoked_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "proposals" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "organization_id" UUID,
    "reference" VARCHAR(20) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "summary" VARCHAR(4000) NOT NULL DEFAULT '',
    "problem" VARCHAR(4000) NOT NULL DEFAULT '',
    "stage" VARCHAR(60) NOT NULL DEFAULT '',
    "sector" VARCHAR(100) NOT NULL DEFAULT '',
    "city" VARCHAR(100) NOT NULL DEFAULT '',
    "support_sought" VARCHAR(2000) NOT NULL DEFAULT '',
    "state" "ProposalState" NOT NULL DEFAULT 'draft',
    "state_reason" VARCHAR(1000) NOT NULL DEFAULT '',
    "sharing_consent" BOOLEAN NOT NULL DEFAULT false,
    "submitted_at" TIMESTAMPTZ(3),
    "decided_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "close_outcome" VARCHAR(40) NOT NULL DEFAULT '',
    "close_note" VARCHAR(2000) NOT NULL DEFAULT '',
    "startup_org_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "proposal_decisions" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "outcome" VARCHAR(30) NOT NULL,
    "reason" VARCHAR(2000) NOT NULL,
    "criteria" VARCHAR(2000) NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_decisions_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "mentor_assignments" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "mentor_id" UUID NOT NULL,
    "assigned_by" UUID NOT NULL,
    "note" VARCHAR(1000) NOT NULL DEFAULT '',
    "ended_at" TIMESTAMPTZ(3),
    "end_reason" VARCHAR(1000) NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mentor_assignments_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "incubation_agreements" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "terms" VARCHAR(8000) NOT NULL,
    "ip_terms" VARCHAR(4000) NOT NULL,
    "responsibilities" VARCHAR(4000) NOT NULL DEFAULT '',
    "grant_minor" BIGINT,
    "currency" CHAR(3),
    "grant_conditions" VARCHAR(2000) NOT NULL DEFAULT '',
    "grants_equity" BOOLEAN NOT NULL DEFAULT false,
    "duration_months" INTEGER,
    "checksum" CHAR(64) NOT NULL,
    "state" "IncubationAgreementState" NOT NULL DEFAULT 'draft',
    "decline_reason" VARCHAR(1000) NOT NULL DEFAULT '',
    "offered_at" TIMESTAMPTZ(3),
    "responded_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "incubation_agreements_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "incubation_milestones" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000) NOT NULL DEFAULT '',
    "due_at" DATE NOT NULL,
    "state" "IncubationMilestoneState" NOT NULL DEFAULT 'planned',
    "evidence_ref" VARCHAR(200) NOT NULL DEFAULT '',
    "evidence_note" VARCHAR(4000) NOT NULL DEFAULT '',
    "submitted_at" TIMESTAMPTZ(3),
    "decided_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "incubation_milestones_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "incubation_milestone_decisions" (
    "id" UUID NOT NULL,
    "milestone_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "outcome" VARCHAR(30) NOT NULL,
    "reason" VARCHAR(2000) NOT NULL,
    "evidence_ref" VARCHAR(200) NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incubation_milestone_decisions_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "assistance_cases" (
    "id" UUID NOT NULL,
    "applicant_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "reference" VARCHAR(20) NOT NULL,
    "category" VARCHAR(60) NOT NULL,
    "need_summary" VARCHAR(4000) NOT NULL,
    "household_size" INTEGER,
    "requested_minor" BIGINT,
    "currency" CHAR(3),
    "state" "AssistanceState" NOT NULL DEFAULT 'draft',
    "state_reason" VARCHAR(1000) NOT NULL DEFAULT '',
    "case_worker_id" UUID,
    "submitted_at" TIMESTAMPTZ(3),
    "decided_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assistance_cases_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "assistance_consents" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "action" VARCHAR(10) NOT NULL,
    "scope" VARCHAR(1000) NOT NULL,
    "reason" VARCHAR(1000) NOT NULL DEFAULT '',
    "actor_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistance_consents_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "assistance_messages" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "author" VARCHAR(10) NOT NULL,
    "body" VARCHAR(4000) NOT NULL,
    "document_ref" VARCHAR(200) NOT NULL DEFAULT '',
    "author_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistance_messages_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "assistance_decisions" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "outcome" VARCHAR(30) NOT NULL,
    "reason" VARCHAR(2000) NOT NULL,
    "criteria" VARCHAR(2000) NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistance_decisions_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "assistance_deliveries" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "funding_source" VARCHAR(200) NOT NULL,
    "amount_minor" BIGINT,
    "currency" CHAR(3),
    "evidence_ref" VARCHAR(200) NOT NULL DEFAULT '',
    "delivered_at" DATE NOT NULL,
    "recorded_by" UUID NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3),
    "disputed_at" TIMESTAMPTZ(3),
    "dispute_reason" VARCHAR(1000) NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assistance_deliveries_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "volunteer_opportunities" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "summary" VARCHAR(2000) NOT NULL,
    "tasks" VARCHAR(4000) NOT NULL,
    "requirements" VARCHAR(2000) NOT NULL DEFAULT '',
    "supervisor_id" UUID NOT NULL,
    "city" VARCHAR(100) NOT NULL DEFAULT '',
    "delivery_mode" "ProgramDeliveryMode" NOT NULL DEFAULT 'in_person',
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "hours_per_week" INTEGER NOT NULL DEFAULT 0,
    "starts_at" DATE,
    "ends_at" DATE,
    "withdrawal_policy" VARCHAR(1000) NOT NULL DEFAULT '',
    "state" "VolunteerOpportunityState" NOT NULL DEFAULT 'draft',
    "state_reason" VARCHAR(200) NOT NULL DEFAULT '',
    "created_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "volunteer_opportunities_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "volunteer_applications" (
    "id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "motivation" VARCHAR(2000) NOT NULL DEFAULT '',
    "availability" VARCHAR(500) NOT NULL DEFAULT '',
    "state" "VolunteerApplicationState" NOT NULL DEFAULT 'submitted',
    "decision_reason" VARCHAR(1000) NOT NULL DEFAULT '',
    "decided_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "volunteer_applications_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "volunteer_assignments" (
    "id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "task" VARCHAR(1000) NOT NULL,
    "starts_at" DATE NOT NULL,
    "ends_at" DATE,
    "state" "VolunteerAssignmentState" NOT NULL DEFAULT 'offered',
    "end_reason" VARCHAR(1000) NOT NULL DEFAULT '',
    "assigned_by" UUID NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "volunteer_assignments_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "volunteer_hours" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "worked_on" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "note" VARCHAR(1000) NOT NULL DEFAULT '',
    "state" "VolunteerHoursState" NOT NULL DEFAULT 'submitted',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "decision_reason" VARCHAR(1000) NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "volunteer_hours_pkey" PRIMARY KEY ("id")
);
-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_sponsor_org_id_fkey" FOREIGN KEY ("sponsor_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_operator_org_id_fkey" FOREIGN KEY ("operator_org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "agreement_revisions" ADD CONSTRAINT "agreement_revisions_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "agreement_revisions" ADD CONSTRAINT "agreement_revisions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_accepted_by_fkey" FOREIGN KEY ("accepted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "agreement_milestones" ADD CONSTRAINT "agreement_milestones_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "agreement_milestone_decisions" ADD CONSTRAINT "agreement_milestone_decisions_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "agreement_milestones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "agreement_milestone_decisions" ADD CONSTRAINT "agreement_milestone_decisions_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "agreement_reports" ADD CONSTRAINT "agreement_reports_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "agreement_reports" ADD CONSTRAINT "agreement_reports_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "agreement_reports" ADD CONSTRAINT "agreement_reports_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "agreement_funding_intents" ADD CONSTRAINT "agreement_funding_intents_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "agreement_funding_intents" ADD CONSTRAINT "agreement_funding_intents_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "payment_intents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "agreement_funding_intents" ADD CONSTRAINT "agreement_funding_intents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "stipend_batches" ADD CONSTRAINT "stipend_batches_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "stipend_batches" ADD CONSTRAINT "stipend_batches_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "stipend_batches" ADD CONSTRAINT "stipend_batches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "stipend_lines" ADD CONSTRAINT "stipend_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "stipend_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "stipend_lines" ADD CONSTRAINT "stipend_lines_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_startup_org_id_fkey" FOREIGN KEY ("startup_org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "proposal_decisions" ADD CONSTRAINT "proposal_decisions_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "proposal_decisions" ADD CONSTRAINT "proposal_decisions_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "mentor_assignments" ADD CONSTRAINT "mentor_assignments_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "mentor_assignments" ADD CONSTRAINT "mentor_assignments_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "mentor_assignments" ADD CONSTRAINT "mentor_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "incubation_agreements" ADD CONSTRAINT "incubation_agreements_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "incubation_agreements" ADD CONSTRAINT "incubation_agreements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "incubation_milestones" ADD CONSTRAINT "incubation_milestones_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "incubation_milestone_decisions" ADD CONSTRAINT "incubation_milestone_decisions_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "incubation_milestones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "incubation_milestone_decisions" ADD CONSTRAINT "incubation_milestone_decisions_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "assistance_cases" ADD CONSTRAINT "assistance_cases_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "assistance_cases" ADD CONSTRAINT "assistance_cases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "assistance_cases" ADD CONSTRAINT "assistance_cases_case_worker_id_fkey" FOREIGN KEY ("case_worker_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "assistance_consents" ADD CONSTRAINT "assistance_consents_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "assistance_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "assistance_consents" ADD CONSTRAINT "assistance_consents_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "assistance_messages" ADD CONSTRAINT "assistance_messages_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "assistance_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "assistance_messages" ADD CONSTRAINT "assistance_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "assistance_decisions" ADD CONSTRAINT "assistance_decisions_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "assistance_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "assistance_decisions" ADD CONSTRAINT "assistance_decisions_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "assistance_deliveries" ADD CONSTRAINT "assistance_deliveries_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "assistance_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "assistance_deliveries" ADD CONSTRAINT "assistance_deliveries_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "volunteer_opportunities" ADD CONSTRAINT "volunteer_opportunities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "volunteer_opportunities" ADD CONSTRAINT "volunteer_opportunities_supervisor_id_fkey" FOREIGN KEY ("supervisor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "volunteer_opportunities" ADD CONSTRAINT "volunteer_opportunities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "volunteer_applications" ADD CONSTRAINT "volunteer_applications_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "volunteer_opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "volunteer_applications" ADD CONSTRAINT "volunteer_applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "volunteer_assignments" ADD CONSTRAINT "volunteer_assignments_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "volunteer_opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "volunteer_assignments" ADD CONSTRAINT "volunteer_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "volunteer_assignments" ADD CONSTRAINT "volunteer_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "volunteer_hours" ADD CONSTRAINT "volunteer_hours_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "volunteer_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "volunteer_hours" ADD CONSTRAINT "volunteer_hours_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ================================================================================================
-- PART-12 rules the database enforces itself
--
-- Four of this part's acceptance criteria are written here rather than only in a service, because
-- each of them is a thing a later code path could get wrong by accident: a grant quietly becoming
-- equity, a period of stipend paid twice, a volunteer signing off their own hours, and a case being
-- processed after its consent was withdrawn.
-- ================================================================================================

-- ------------------------------------------------------------------------------------------------
-- A grant is not equity
--
-- 07: the platform takes no shares for an idea, and any incubator stake needs an explicit agreement
-- on a separate investment path. These columns exist so the absence is a stated fact that cannot be
-- edited into a presence.
-- ------------------------------------------------------------------------------------------------
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_grant_is_not_equity" CHECK ("creates_equity" = false);
ALTER TABLE "agreement_funding_intents" ADD CONSTRAINT "funding_intent_is_not_equity" CHECK ("creates_equity" = false);
ALTER TABLE "incubation_agreements" ADD CONSTRAINT "incubation_agreement_grants_no_equity" CHECK ("grants_equity" = false);

-- The two parties to an agreement are two different organisations. An agreement with itself is not
-- an agreement, and it would let one side's approval stand in for both.
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_two_distinct_parties" CHECK ("sponsor_org_id" <> "operator_org_id");

-- Cash means an amount and a currency; in-kind means a description and a stated estimated value.
-- 08 reports the two separately and never adds them, so neither may be half-stated.
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_cash_is_complete"
  CHECK ("kind" = 'in_kind' OR ("amount_minor" IS NOT NULL AND "amount_minor" > 0 AND "currency" IS NOT NULL));
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_in_kind_is_valued"
  CHECK ("kind" = 'cash' OR (length(btrim("in_kind_description")) >= 10 AND "in_kind_value_minor" IS NOT NULL));

-- A live agreement carries the text both sides accepted.
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_live_states_have_terms"
  CHECK ("state" IN ('draft') OR length(btrim("terms_checksum")) = 64);

-- Releasing money is a separate, independently approved act. A milestone decision never does it.
ALTER TABLE "agreement_milestone_decisions" ADD CONSTRAINT "milestone_decision_releases_no_funds"
  CHECK ("released_funds" = false);

-- 12: a sponsor report carries counts, never names. The narrative is free text, but the figure that
-- describes people is an integer and cannot be negative.
ALTER TABLE "agreement_reports" ADD CONSTRAINT "agreement_reports_period_is_ordered" CHECK ("period_end" >= "period_start");
ALTER TABLE "agreement_reports" ADD CONSTRAINT "agreement_reports_counts_are_counts" CHECK ("participants_reached" >= 0 AND "spent_minor" >= 0);

-- ------------------------------------------------------------------------------------------------
-- A stipend period is never paid twice
--
-- The service checks it, but the guarantee belongs here: an exclusion constraint refuses any line
-- whose period overlaps another line for the same enrolment, among the lines that have not been
-- cancelled. A second batch covering the same days cannot be written at all — not by a retry, not
-- by two operators at once, not by direct SQL.
-- ------------------------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "stipend_lines" ADD CONSTRAINT "stipend_lines_period_is_ordered" CHECK ("period_end" >= "period_start");
ALTER TABLE "stipend_lines" ADD CONSTRAINT "stipend_lines_amount_is_not_negative" CHECK ("amount_minor" >= 0);
ALTER TABLE "stipend_lines" ADD CONSTRAINT "stipend_lines_cancel_is_explained"
  CHECK ("cancelled" = false OR length(btrim("cancel_reason")) >= 10);
ALTER TABLE "stipend_lines" ADD CONSTRAINT "stipend_lines_counted_within_held"
  CHECK ("sessions_counted" >= 0 AND "sessions_counted" <= "sessions_held");

ALTER TABLE "stipend_lines" ADD CONSTRAINT "stipend_lines_no_overlapping_period"
  EXCLUDE USING gist (
    "enrollment_id" WITH =,
    daterange("period_start", "period_end", '[]') WITH &&
  ) WHERE ("cancelled" = false);

ALTER TABLE "stipend_batches" ADD CONSTRAINT "stipend_batches_period_is_ordered" CHECK ("period_end" >= "period_start");
-- A batch that has been sent for payment carries the payout it was sent as. `approved` and `paid`
-- without one would be a claim about money with nothing behind it.
ALTER TABLE "stipend_batches" ADD CONSTRAINT "stipend_batches_sent_has_a_payout"
  CHECK ("state" NOT IN ('approved', 'paid') OR "payout_id" IS NOT NULL);
-- One live batch per cohort per period. Two would be the double payment by another route.
CREATE UNIQUE INDEX "stipend_batches_one_live_per_period"
  ON "stipend_batches"("cohort_id", "period_start", "period_end")
  WHERE "state" <> 'cancelled';

-- ------------------------------------------------------------------------------------------------
-- Certificates
--
-- 07: the public reference carries no national identifier, and revoking says why in private while
-- the public check says only that it is no longer valid.
-- ------------------------------------------------------------------------------------------------
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_revoke_is_explained"
  CHECK ("state" <> 'revoked' OR (length(btrim("revoke_reason")) >= 10 AND "revoked_at" IS NOT NULL AND "revoked_by" IS NOT NULL));
-- A public reference that could be guessed is not a reference. Short, but not two characters.
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_public_id_is_substantial" CHECK (length("public_id") >= 12);

-- ------------------------------------------------------------------------------------------------
-- Incubation
-- ------------------------------------------------------------------------------------------------
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_sent_has_an_incubator"
  CHECK ("state" = 'draft' OR ("organization_id" IS NOT NULL AND "sharing_consent" = true));
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_close_is_explained"
  CHECK ("state" <> 'closed' OR (length(btrim("close_outcome")) >= 3 AND "closed_at" IS NOT NULL));
ALTER TABLE "incubation_agreements" ADD CONSTRAINT "incubation_agreements_sequence_positive" CHECK ("sequence" > 0);
ALTER TABLE "incubation_agreements" ADD CONSTRAINT "incubation_agreements_terms_are_substantive"
  CHECK (length(btrim("terms")) >= 20 AND length(btrim("ip_terms")) >= 20);
ALTER TABLE "incubation_agreements" ADD CONSTRAINT "incubation_agreements_grant_has_currency"
  CHECK ("grant_minor" IS NULL OR ("currency" IS NOT NULL AND "grant_minor" > 0));
ALTER TABLE "incubation_agreements" ADD CONSTRAINT "incubation_agreements_decline_is_explained"
  CHECK ("state" <> 'declined' OR length(btrim("decline_reason")) >= 10);
-- One live offer per proposal, for the same reason PART-11 allows one live job offer per candidacy:
-- two open texts is a race over which one was agreed.
CREATE UNIQUE INDEX "incubation_agreements_one_live_per_proposal"
  ON "incubation_agreements"("proposal_id")
  WHERE "state" IN ('draft', 'offered');

-- ------------------------------------------------------------------------------------------------
-- Assistance
--
-- The consent record is two rows, not a flag, so "they agreed" and "they later withdrew" stay two
-- separate facts. A delivery says where the support came from, because an unattributed delivery is
-- the same unexplained balance 22 forbids one step earlier.
-- ------------------------------------------------------------------------------------------------
ALTER TABLE "assistance_cases" ADD CONSTRAINT "assistance_cases_submitted_has_a_need"
  CHECK ("state" = 'draft' OR length(btrim("need_summary")) >= 20);
ALTER TABLE "assistance_cases" ADD CONSTRAINT "assistance_cases_decided_has_a_worker"
  CHECK ("state" NOT IN ('approved', 'rejected', 'delivered', 'closed') OR "case_worker_id" IS NOT NULL);
ALTER TABLE "assistance_consents" ADD CONSTRAINT "assistance_consents_known_action"
  CHECK ("action" IN ('granted', 'revoked'));
ALTER TABLE "assistance_consents" ADD CONSTRAINT "assistance_consents_scope_is_stated"
  CHECK (length(btrim("scope")) >= 10);
ALTER TABLE "assistance_messages" ADD CONSTRAINT "assistance_messages_known_author"
  CHECK ("author" IN ('operator', 'applicant'));
ALTER TABLE "assistance_deliveries" ADD CONSTRAINT "assistance_deliveries_source_is_named"
  CHECK (length(btrim("funding_source")) >= 3);
ALTER TABLE "assistance_deliveries" ADD CONSTRAINT "assistance_deliveries_amount_has_currency"
  CHECK ("amount_minor" IS NULL OR ("currency" IS NOT NULL AND "amount_minor" > 0));
ALTER TABLE "assistance_deliveries" ADD CONSTRAINT "assistance_deliveries_dispute_is_explained"
  CHECK ("disputed_at" IS NULL OR length(btrim("dispute_reason")) >= 10);
-- A delivery is either confirmed or disputed, never both.
ALTER TABLE "assistance_deliveries" ADD CONSTRAINT "assistance_deliveries_one_outcome"
  CHECK ("confirmed_at" IS NULL OR "disputed_at" IS NULL);

-- ------------------------------------------------------------------------------------------------
-- Volunteering
--
-- Nobody approves their own hours. It is the one rule here that decides whether a reported figure
-- means anything, so it is a constraint rather than a check somebody could forget.
-- ------------------------------------------------------------------------------------------------
-- A CHECK cannot look at another table, so this is a trigger. It is the same rule either way: the
-- approver is not the volunteer.
CREATE OR REPLACE FUNCTION prevent_volunteer_self_approval() RETURNS trigger AS $$
DECLARE
  volunteer uuid;
BEGIN
  IF NEW."approved_by" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "user_id" INTO volunteer FROM "volunteer_assignments" WHERE "id" = NEW."assignment_id";
  IF volunteer = NEW."approved_by" THEN
    RAISE EXCEPTION 'a volunteer cannot approve their own hours';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER volunteer_hours_no_self_approval
  BEFORE INSERT OR UPDATE ON "volunteer_hours"
  FOR EACH ROW EXECUTE FUNCTION prevent_volunteer_self_approval();
ALTER TABLE "volunteer_hours" ADD CONSTRAINT "volunteer_hours_are_positive" CHECK ("minutes" > 0 AND "minutes" <= 1440);
ALTER TABLE "volunteer_hours" ADD CONSTRAINT "volunteer_hours_approved_has_an_approver"
  CHECK ("state" <> 'approved' OR ("approved_by" IS NOT NULL AND "approved_at" IS NOT NULL));
ALTER TABLE "volunteer_hours" ADD CONSTRAINT "volunteer_hours_rejected_is_explained"
  CHECK ("state" <> 'rejected' OR length(btrim("decision_reason")) >= 10);

ALTER TABLE "volunteer_opportunities" ADD CONSTRAINT "volunteer_opportunities_capacity_positive" CHECK ("capacity" > 0);
ALTER TABLE "volunteer_opportunities" ADD CONSTRAINT "volunteer_opportunities_public_is_complete"
  CHECK (
    "state" NOT IN ('open', 'paused')
    OR (length(btrim("summary")) >= 30 AND length(btrim("tasks")) >= 20 AND length(btrim("withdrawal_policy")) >= 10)
  );
ALTER TABLE "volunteer_assignments" ADD CONSTRAINT "volunteer_assignments_end_is_ordered"
  CHECK ("ends_at" IS NULL OR "ends_at" >= "starts_at");
ALTER TABLE "volunteer_assignments" ADD CONSTRAINT "volunteer_assignments_ended_is_explained"
  CHECK ("state" <> 'ended' OR length(btrim("end_reason")) >= 10);

-- ------------------------------------------------------------------------------------------------
-- Append-only records
-- ------------------------------------------------------------------------------------------------
CREATE TRIGGER agreement_revisions_append_only
  BEFORE UPDATE OR DELETE ON "agreement_revisions"
  FOR EACH ROW EXECUTE FUNCTION prevent_enablement_record_mutation();

CREATE TRIGGER agreement_acceptances_append_only
  BEFORE UPDATE OR DELETE ON "agreement_acceptances"
  FOR EACH ROW EXECUTE FUNCTION prevent_enablement_record_mutation();

CREATE TRIGGER agreement_milestone_decisions_append_only
  BEFORE UPDATE OR DELETE ON "agreement_milestone_decisions"
  FOR EACH ROW EXECUTE FUNCTION prevent_enablement_record_mutation();

CREATE TRIGGER proposal_decisions_append_only
  BEFORE UPDATE OR DELETE ON "proposal_decisions"
  FOR EACH ROW EXECUTE FUNCTION prevent_enablement_record_mutation();

CREATE TRIGGER incubation_milestone_decisions_append_only
  BEFORE UPDATE OR DELETE ON "incubation_milestone_decisions"
  FOR EACH ROW EXECUTE FUNCTION prevent_enablement_record_mutation();

CREATE TRIGGER assistance_consents_append_only
  BEFORE UPDATE OR DELETE ON "assistance_consents"
  FOR EACH ROW EXECUTE FUNCTION prevent_enablement_record_mutation();

CREATE TRIGGER assistance_decisions_append_only
  BEFORE UPDATE OR DELETE ON "assistance_decisions"
  FOR EACH ROW EXECUTE FUNCTION prevent_enablement_record_mutation();

-- An offered incubation agreement is frozen, exactly as a sent job offer is: a change is a new
-- version with a new sequence, so a founder always knows which text they accepted.
CREATE OR REPLACE FUNCTION prevent_offered_incubation_edit() RETURNS trigger AS $$
BEGIN
  IF OLD."state" <> 'draft' AND (
    NEW."terms" <> OLD."terms"
    OR NEW."ip_terms" <> OLD."ip_terms"
    OR NEW."checksum" <> OLD."checksum"
    OR NEW."grant_minor" IS DISTINCT FROM OLD."grant_minor"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."grants_equity" <> OLD."grants_equity"
  ) THEN
    RAISE EXCEPTION 'an offered incubation agreement cannot be edited: issue a new version instead';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER incubation_agreements_frozen_once_offered
  BEFORE UPDATE ON "incubation_agreements"
  FOR EACH ROW EXECUTE FUNCTION prevent_offered_incubation_edit();
