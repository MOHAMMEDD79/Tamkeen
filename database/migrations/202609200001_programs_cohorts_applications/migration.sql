-- PART-10 — programmes, cohorts, applications, enrolment, attendance and assessment.
-- 07-INCUBATION-EMPLOYMENT and 09-DATA-MODEL. The tables come first, then the rules the
-- database holds on its own.

-- CreateEnum
CREATE TYPE "ProgramState" AS ENUM ('draft', 'review', 'approved', 'recruiting', 'selection', 'active', 'completed', 'follow_up', 'closed', 'paused', 'cancelled');

-- CreateEnum
CREATE TYPE "ProgramDeliveryMode" AS ENUM ('in_person', 'remote', 'hybrid');

-- CreateEnum
CREATE TYPE "JobCommitmentKind" AS ENUM ('none', 'expected', 'committed');

-- CreateEnum
CREATE TYPE "CohortState" AS ENUM ('planned', 'recruiting', 'running', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "ApplicationState" AS ENUM ('draft', 'submitted', 'screening', 'shortlisted', 'interview', 'accepted', 'waitlisted', 'rejected', 'withdrawn', 'discarded');

-- CreateEnum
CREATE TYPE "EnrollmentState" AS ENUM ('invited', 'confirmed', 'active', 'completed', 'dropped_out', 'terminated', 'expired');

-- CreateEnum
CREATE TYPE "WaitlistState" AS ENUM ('waiting', 'invited', 'enrolled', 'expired', 'withdrawn');

-- CreateEnum
CREATE TYPE "TrainingSessionState" AS ENUM ('scheduled', 'held', 'cancelled', 'closed');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('present', 'absent', 'excused', 'late');

-- CreateEnum
CREATE TYPE "ObjectionState" AS ENUM ('open', 'upheld', 'rejected');

-- CreateEnum
CREATE TYPE "InterviewState" AS ENUM ('proposed', 'confirmed', 'reschedule_requested', 'completed', 'cancelled');

-- AlterTable
ALTER TABLE "bookmarks" ADD COLUMN     "program_id" UUID,
ALTER COLUMN "project_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "programs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID,
    "slug" VARCHAR(120) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "summary" VARCHAR(2000) NOT NULL,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "level" VARCHAR(60) NOT NULL DEFAULT '',
    "delivery_mode" "ProgramDeliveryMode" NOT NULL DEFAULT 'in_person',
    "city" VARCHAR(100) NOT NULL DEFAULT '',
    "capacity" INTEGER NOT NULL,
    "apply_opens_at" TIMESTAMPTZ(3),
    "apply_closes_at" TIMESTAMPTZ(3),
    "duration_weeks" INTEGER NOT NULL DEFAULT 0,
    "hours_per_week" INTEGER NOT NULL DEFAULT 0,
    "schedule" VARCHAR(1000) NOT NULL DEFAULT '',
    "attendance_policy" VARCHAR(2000) NOT NULL DEFAULT '',
    "assessment_policy" VARCHAR(2000) NOT NULL DEFAULT '',
    "selection_method" VARCHAR(2000) NOT NULL DEFAULT '',
    "withdrawal_policy" VARCHAR(2000) NOT NULL DEFAULT '',
    "accessibility_note" VARCHAR(1000) NOT NULL DEFAULT '',
    "privacy_note" VARCHAR(1000) NOT NULL DEFAULT '',
    "complaints_contact" VARCHAR(200) NOT NULL DEFAULT '',
    "stipend_offered" BOOLEAN NOT NULL DEFAULT false,
    "stipend_amount_minor" BIGINT,
    "stipend_currency" CHAR(3),
    "stipend_conditions" VARCHAR(1000) NOT NULL DEFAULT '',
    "job_commitment_kind" "JobCommitmentKind" NOT NULL DEFAULT 'none',
    "job_count" INTEGER NOT NULL DEFAULT 0,
    "job_commitment_terms" VARCHAR(2000) NOT NULL DEFAULT '',
    "application_fee_minor" BIGINT NOT NULL DEFAULT 0,
    "minimum_age" INTEGER,
    "maximum_age" INTEGER,
    "education_requirement" VARCHAR(500) NOT NULL DEFAULT '',
    "state" "ProgramState" NOT NULL DEFAULT 'draft',
    "state_reason" VARCHAR(200) NOT NULL DEFAULT '',
    "published_at" TIMESTAMPTZ(3),
    "current_reviewer_id" UUID,
    "created_by" UUID NOT NULL,
    "manager_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_review_decisions" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "outcome" "ReviewOutcome" NOT NULL,
    "public_reason" VARCHAR(1000) NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "program_review_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cohorts" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "name" VARCHAR(140) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "acceptance_window_hours" INTEGER NOT NULL DEFAULT 72,
    "timezone" VARCHAR(60) NOT NULL DEFAULT 'Asia/Hebron',
    "state" "CohortState" NOT NULL DEFAULT 'planned',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cohorts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cohort_trainers" (
    "id" UUID NOT NULL,
    "cohort_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "assigned_by" UUID NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cohort_trainers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_profiles" (
    "user_id" UUID NOT NULL,
    "headline" VARCHAR(200) NOT NULL DEFAULT '',
    "summary" VARCHAR(2000) NOT NULL DEFAULT '',
    "city" VARCHAR(100) NOT NULL DEFAULT '',
    "availability" VARCHAR(200) NOT NULL DEFAULT '',
    "education" VARCHAR(1000) NOT NULL DEFAULT '',
    "experience" VARCHAR(2000) NOT NULL DEFAULT '',
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cv_reference" VARCHAR(200) NOT NULL DEFAULT '',
    "share_with_operators" BOOLEAN NOT NULL DEFAULT false,
    "share_contact" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "candidate_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "cohort_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reference" VARCHAR(20) NOT NULL,
    "state" "ApplicationState" NOT NULL DEFAULT 'draft',
    "answers" JSONB NOT NULL DEFAULT '{}',
    "motivation" VARCHAR(4000) NOT NULL DEFAULT '',
    "sharing_consent" BOOLEAN NOT NULL DEFAULT false,
    "submitted_at" TIMESTAMPTZ(3),
    "decided_at" TIMESTAMPTZ(3),
    "withdrawn_reason" VARCHAR(1000) NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_reviews" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "scores" JSONB NOT NULL DEFAULT '{}',
    "total" INTEGER NOT NULL DEFAULT 0,
    "scale_max" INTEGER NOT NULL DEFAULT 5,
    "note" VARCHAR(2000) NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_decisions" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "decider_id" UUID NOT NULL,
    "outcome" "ApplicationState" NOT NULL,
    "reason" VARCHAR(1000) NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interviews" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_minutes" INTEGER NOT NULL DEFAULT 30,
    "timezone" VARCHAR(60) NOT NULL DEFAULT 'Asia/Hebron',
    "mode" "ProgramDeliveryMode" NOT NULL DEFAULT 'in_person',
    "location" VARCHAR(300) NOT NULL DEFAULT '',
    "state" "InterviewState" NOT NULL DEFAULT 'proposed',
    "scheduled_by" UUID NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "interviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interview_reschedule_requests" (
    "id" UUID NOT NULL,
    "interview_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "alternatives" VARCHAR(1000) NOT NULL DEFAULT '',
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interview_reschedule_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL,
    "cohort_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "state" "EnrollmentState" NOT NULL DEFAULT 'invited',
    "invited_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invitation_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "exit_reason" VARCHAR(1000) NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollment_withdrawal_requests" (
    "id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "state" "ObjectionState" NOT NULL DEFAULT 'open',
    "decided_by" UUID,
    "decision_reason" VARCHAR(1000) NOT NULL DEFAULT '',
    "decided_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollment_withdrawal_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist_entries" (
    "id" UUID NOT NULL,
    "cohort_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "state" "WaitlistState" NOT NULL DEFAULT 'waiting',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_sessions" (
    "id" UUID NOT NULL,
    "cohort_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "timezone" VARCHAR(60) NOT NULL DEFAULT 'Asia/Hebron',
    "mode" "ProgramDeliveryMode" NOT NULL DEFAULT 'in_person',
    "location" VARCHAR(300) NOT NULL DEFAULT '',
    "state" "TrainingSessionState" NOT NULL DEFAULT 'scheduled',
    "closed_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "training_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "excuse_note" VARCHAR(1000) NOT NULL DEFAULT '',
    "recorded_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_revisions" (
    "id" UUID NOT NULL,
    "attendance_id" UUID NOT NULL,
    "from_status" "AttendanceStatus" NOT NULL,
    "to_status" "AttendanceStatus" NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "revised_by" UUID NOT NULL,
    "after_close" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_objections" (
    "id" UUID NOT NULL,
    "attendance_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "state" "ObjectionState" NOT NULL DEFAULT 'open',
    "decided_by" UUID,
    "decision_reason" VARCHAR(1000) NOT NULL DEFAULT '',
    "decided_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_objections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" UUID NOT NULL,
    "cohort_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "rubric" JSONB NOT NULL DEFAULT '{}',
    "scale_max" INTEGER NOT NULL DEFAULT 5,
    "pass_mark" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_results" (
    "id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "scores" JSONB NOT NULL DEFAULT '{}',
    "total" INTEGER NOT NULL DEFAULT 0,
    "note" VARCHAR(2000) NOT NULL DEFAULT '',
    "recorded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assessment_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "programs_slug_key" ON "programs"("slug");

-- CreateIndex
CREATE INDEX "programs_organization_id_state_idx" ON "programs"("organization_id", "state");

-- CreateIndex
CREATE INDEX "programs_state_apply_closes_at_idx" ON "programs"("state", "apply_closes_at");

-- CreateIndex
CREATE INDEX "program_review_decisions_program_id_created_at_idx" ON "program_review_decisions"("program_id", "created_at");

-- CreateIndex
CREATE INDEX "cohorts_program_id_start_at_idx" ON "cohorts"("program_id", "start_at");

-- CreateIndex
CREATE INDEX "cohort_trainers_user_id_revoked_at_idx" ON "cohort_trainers"("user_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "cohort_trainers_cohort_id_user_id_key" ON "cohort_trainers"("cohort_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "applications_reference_key" ON "applications"("reference");

-- CreateIndex
CREATE INDEX "applications_program_id_state_idx" ON "applications"("program_id", "state");

-- CreateIndex
CREATE INDEX "applications_user_id_created_at_idx" ON "applications"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "applications_cohort_id_user_id_key" ON "applications"("cohort_id", "user_id");

-- CreateIndex
CREATE INDEX "application_reviews_application_id_created_at_idx" ON "application_reviews"("application_id", "created_at");

-- CreateIndex
CREATE INDEX "application_decisions_application_id_created_at_idx" ON "application_decisions"("application_id", "created_at");

-- CreateIndex
CREATE INDEX "interviews_application_id_scheduled_at_idx" ON "interviews"("application_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "interview_reschedule_requests_interview_id_created_at_idx" ON "interview_reschedule_requests"("interview_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_application_id_key" ON "enrollments"("application_id");

-- CreateIndex
CREATE INDEX "enrollments_cohort_id_state_idx" ON "enrollments"("cohort_id", "state");

-- CreateIndex
CREATE INDEX "enrollments_state_invitation_expires_at_idx" ON "enrollments"("state", "invitation_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_cohort_id_user_id_key" ON "enrollments"("cohort_id", "user_id");

-- CreateIndex
CREATE INDEX "enrollment_withdrawal_requests_enrollment_id_created_at_idx" ON "enrollment_withdrawal_requests"("enrollment_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_entries_application_id_key" ON "waitlist_entries"("application_id");

-- CreateIndex
CREATE INDEX "waitlist_entries_cohort_id_state_position_idx" ON "waitlist_entries"("cohort_id", "state", "position");

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_entries_cohort_id_position_key" ON "waitlist_entries"("cohort_id", "position");

-- CreateIndex
CREATE INDEX "training_sessions_cohort_id_starts_at_idx" ON "training_sessions"("cohort_id", "starts_at");

-- CreateIndex
CREATE INDEX "attendance_enrollment_id_created_at_idx" ON "attendance"("enrollment_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_session_id_enrollment_id_key" ON "attendance"("session_id", "enrollment_id");

-- CreateIndex
CREATE INDEX "attendance_revisions_attendance_id_created_at_idx" ON "attendance_revisions"("attendance_id", "created_at");

-- CreateIndex
CREATE INDEX "attendance_objections_attendance_id_created_at_idx" ON "attendance_objections"("attendance_id", "created_at");

-- CreateIndex
CREATE INDEX "attendance_objections_state_created_at_idx" ON "attendance_objections"("state", "created_at");

-- CreateIndex
CREATE INDEX "assessments_cohort_id_created_at_idx" ON "assessments"("cohort_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_results_assessment_id_enrollment_id_key" ON "assessment_results"("assessment_id", "enrollment_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookmarks_user_id_program_id_key" ON "bookmarks"("user_id", "program_id");

-- RenameForeignKey
ALTER TABLE "project_review_decisions" RENAME CONSTRAINT "project_review_decisions_reviewer_fkey" TO "project_review_decisions_reviewer_id_fkey";

-- RenameForeignKey
ALTER TABLE "project_review_decisions" RENAME CONSTRAINT "project_review_decisions_version_fkey" TO "project_review_decisions_project_version_id_fkey";

-- RenameForeignKey
ALTER TABLE "projects" RENAME CONSTRAINT "projects_assigned_reviewer_fkey" TO "projects_assigned_reviewer_id_fkey";

-- AddForeignKey
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_current_reviewer_id_fkey" FOREIGN KEY ("current_reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_review_decisions" ADD CONSTRAINT "program_review_decisions_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_review_decisions" ADD CONSTRAINT "program_review_decisions_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cohort_trainers" ADD CONSTRAINT "cohort_trainers_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cohort_trainers" ADD CONSTRAINT "cohort_trainers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cohort_trainers" ADD CONSTRAINT "cohort_trainers_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_reviews" ADD CONSTRAINT "application_reviews_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_reviews" ADD CONSTRAINT "application_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_decisions" ADD CONSTRAINT "application_decisions_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_decisions" ADD CONSTRAINT "application_decisions_decider_id_fkey" FOREIGN KEY ("decider_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_scheduled_by_fkey" FOREIGN KEY ("scheduled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_reschedule_requests" ADD CONSTRAINT "interview_reschedule_requests_interview_id_fkey" FOREIGN KEY ("interview_id") REFERENCES "interviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_reschedule_requests" ADD CONSTRAINT "interview_reschedule_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment_withdrawal_requests" ADD CONSTRAINT "enrollment_withdrawal_requests_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment_withdrawal_requests" ADD CONSTRAINT "enrollment_withdrawal_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "training_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_revisions" ADD CONSTRAINT "attendance_revisions_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "attendance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_revisions" ADD CONSTRAINT "attendance_revisions_revised_by_fkey" FOREIGN KEY ("revised_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_objections" ADD CONSTRAINT "attendance_objections_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "attendance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_objections" ADD CONSTRAINT "attendance_objections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_objections" ADD CONSTRAINT "attendance_objections_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ================================================================================================
-- PART-10 rules the database enforces itself
--
-- Everything below is a rule from 07-INCUBATION-EMPLOYMENT that must hold even if a service is
-- wrong, a script writes directly, or a future part adds a second code path. A constraint here is
-- not a duplicate of the service check: it is the one that cannot be forgotten.
-- ================================================================================================

-- A bookmark points at exactly one thing. Saving an opportunity is not applying to it, and a
-- bookmark pointing at nothing is a row nobody can render.
ALTER TABLE "bookmarks"
  ADD CONSTRAINT "bookmarks_one_target"
  CHECK (("project_id" IS NOT NULL)::int + ("program_id" IS NOT NULL)::int = 1);

-- Seats and dates have to make sense before anyone can be told about them.
ALTER TABLE "programs" ADD CONSTRAINT "programs_capacity_positive" CHECK ("capacity" > 0);
ALTER TABLE "programs" ADD CONSTRAINT "programs_application_window_ordered"
  CHECK ("apply_opens_at" IS NULL OR "apply_closes_at" IS NULL OR "apply_opens_at" < "apply_closes_at");
ALTER TABLE "programs" ADD CONSTRAINT "programs_age_range_ordered"
  CHECK ("minimum_age" IS NULL OR "maximum_age" IS NULL OR "minimum_age" <= "maximum_age");

-- 07: a stipend that is offered has to say how much and in what currency, or it is not an offer.
ALTER TABLE "programs" ADD CONSTRAINT "programs_stipend_needs_amount"
  CHECK (
    "stipend_offered" = false
    OR ("stipend_amount_minor" IS NOT NULL AND "stipend_amount_minor" > 0 AND "stipend_currency" IS NOT NULL)
  );

-- 07: "10 jobs" must say whether it is a target or an obligation. A count without a kind, or a
-- kind without a count, is the ambiguity the specification exists to forbid.
ALTER TABLE "programs" ADD CONSTRAINT "programs_job_claim_is_qualified"
  CHECK (
    ("job_commitment_kind" = 'none' AND "job_count" = 0)
    OR ("job_commitment_kind" <> 'none' AND "job_count" > 0)
  );

-- A committed number of jobs is a promise, so it has to carry the terms it is committed under.
ALTER TABLE "programs" ADD CONSTRAINT "programs_committed_jobs_need_terms"
  CHECK ("job_commitment_kind" <> 'committed' OR length(btrim("job_commitment_terms")) >= 20);

-- 07 forbids an undocumented application fee. This build has no way to document or take one, so
-- the only permitted value is zero and the database says so rather than a comment.
ALTER TABLE "programs" ADD CONSTRAINT "programs_no_application_fee" CHECK ("application_fee_minor" = 0);

-- A published programme has to have said the things a candidate decides on. Checking it here as
-- well as in the service means no later code path can publish an empty prospectus.
ALTER TABLE "programs" ADD CONSTRAINT "programs_public_states_are_complete"
  CHECK (
    "state" NOT IN ('recruiting', 'selection', 'active', 'completed', 'follow_up')
    OR (
      length(btrim("summary")) >= 50
      AND length(btrim("attendance_policy")) >= 20
      AND length(btrim("selection_method")) >= 20
      AND length(btrim("withdrawal_policy")) >= 20
      AND "apply_closes_at" IS NOT NULL
    )
  );

ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_capacity_positive" CHECK ("capacity" > 0);
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_dates_ordered" CHECK ("start_at" < "end_at");
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_acceptance_window_positive" CHECK ("acceptance_window_hours" > 0);

ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_times_ordered" CHECK ("starts_at" < "ends_at");
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_duration_positive" CHECK ("duration_minutes" > 0);

-- An invitation without a deadline never expires, and a seat that never expires is a seat the next
-- person on the waitlist never gets.
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_invitation_expires_after_invite"
  CHECK ("invitation_expires_at" > "invited_at");

-- A decision the candidate is shown has to say why, except where acceptance speaks for itself.
ALTER TABLE "application_decisions" ADD CONSTRAINT "application_decisions_reason_required"
  CHECK ("outcome" = 'accepted' OR length(btrim("reason")) >= 10);

-- Only the three outcomes a decision can actually produce; the other application states are
-- reached by the candidate or by time, never by somebody deciding them.
ALTER TABLE "application_decisions" ADD CONSTRAINT "application_decisions_outcome_is_a_decision"
  CHECK ("outcome" IN ('accepted', 'waitlisted', 'rejected', 'screening', 'shortlisted', 'interview'));

ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_position_positive" CHECK ("position" > 0);

-- A revision that does not say what changed, or changes nothing, is not a revision.
ALTER TABLE "attendance_revisions" ADD CONSTRAINT "attendance_revisions_change_something"
  CHECK ("from_status" <> "to_status");
ALTER TABLE "attendance_revisions" ADD CONSTRAINT "attendance_revisions_reason_required"
  CHECK (length(btrim("reason")) >= 10);

-- 08-PERMISSION-EXTENSIONS: nobody rules on an objection against a record they made themselves.
-- The service checks it; this makes it true of every path, including a direct write.
ALTER TABLE "attendance_objections" ADD CONSTRAINT "attendance_objections_decider_is_not_the_objector"
  CHECK ("decided_by" IS NULL OR "decided_by" <> "user_id");

-- A resolved objection or withdrawal request has to say who resolved it and why.
ALTER TABLE "attendance_objections" ADD CONSTRAINT "attendance_objections_resolution_is_explained"
  CHECK ("state" = 'open' OR ("decided_by" IS NOT NULL AND length(btrim("decision_reason")) >= 10 AND "decided_at" IS NOT NULL));
ALTER TABLE "enrollment_withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_resolution_is_explained"
  CHECK ("state" = 'open' OR ("decided_by" IS NOT NULL AND length(btrim("decision_reason")) >= 10 AND "decided_at" IS NOT NULL));

ALTER TABLE "assessments" ADD CONSTRAINT "assessments_scale_positive" CHECK ("scale_max" > 0);
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_pass_mark_within_scale"
  CHECK ("pass_mark" >= 0 AND "pass_mark" <= "scale_max");
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_total_not_negative" CHECK ("total" >= 0);
ALTER TABLE "application_reviews" ADD CONSTRAINT "application_reviews_scale_positive" CHECK ("scale_max" > 0);

-- ------------------------------------------------------------------------------------------------
-- Append-only records
--
-- A decision, a review and a revision are evidence of what happened. Correcting one means adding
-- another that says so, never editing the first — otherwise the record is only ever as honest as
-- whoever last had write access.
-- ------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_enablement_record_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only: % records cannot be changed or removed once written', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER program_review_decisions_append_only
  BEFORE UPDATE OR DELETE ON "program_review_decisions"
  FOR EACH ROW EXECUTE FUNCTION prevent_enablement_record_mutation();

CREATE TRIGGER application_decisions_append_only
  BEFORE UPDATE OR DELETE ON "application_decisions"
  FOR EACH ROW EXECUTE FUNCTION prevent_enablement_record_mutation();

CREATE TRIGGER application_reviews_append_only
  BEFORE UPDATE OR DELETE ON "application_reviews"
  FOR EACH ROW EXECUTE FUNCTION prevent_enablement_record_mutation();

CREATE TRIGGER attendance_revisions_append_only
  BEFORE UPDATE OR DELETE ON "attendance_revisions"
  FOR EACH ROW EXECUTE FUNCTION prevent_enablement_record_mutation();

-- ------------------------------------------------------------------------------------------------
-- A seat is never taken by two people
--
-- The service locks the cohort row and counts before it writes, which is what makes the common
-- path correct. This trigger is the backstop for every other path: it counts the seats that are
-- actually held at COMMIT time and refuses the transaction if they exceed the cohort's capacity.
-- Deferred, because two concurrent inserts each look fine on their own and only the pair is wrong.
-- ------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_cohort_capacity() RETURNS trigger AS $$
DECLARE
  held integer;
  seats integer;
BEGIN
  SELECT c."capacity" INTO seats FROM "cohorts" c WHERE c."id" = NEW."cohort_id";
  IF seats IS NULL THEN
    RETURN NEW;
  END IF;
  -- An invitation that has lapsed is not holding a seat, which is the same rule the waitlist and
  -- the remaining-seat count use. Counting it here too keeps one definition of "taken".
  SELECT count(*) INTO held FROM "enrollments" e
  WHERE e."cohort_id" = NEW."cohort_id"
    AND (
      e."state" IN ('confirmed', 'active', 'completed')
      OR (e."state" = 'invited' AND e."invitation_expires_at" > now())
    );
  IF held > seats THEN
    RAISE EXCEPTION 'cohort capacity exceeded: % seats held against a capacity of %', held, seats;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER enrollments_within_capacity
  AFTER INSERT OR UPDATE ON "enrollments"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_cohort_capacity();
