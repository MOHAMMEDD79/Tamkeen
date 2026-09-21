-- PART-11 — jobs, referrals, offers, placements and follow-up.
-- 07-INCUBATION-EMPLOYMENT and 14-ANALYTICS-IMPACT. Tables first, then the rules the database
-- holds on its own — above all JOB-01 (an accepted offer is not a job started) and JOB-02
-- (silence is not success).

-- CreateEnum
CREATE TYPE "JobState" AS ENUM ('draft', 'review', 'open', 'paused', 'closed', 'filled', 'cancelled');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('full_time', 'part_time', 'fixed_term', 'apprenticeship', 'temporary');

-- CreateEnum
CREATE TYPE "JobApplicationState" AS ENUM ('draft', 'submitted', 'screening', 'shortlisted', 'interview', 'offered', 'hired', 'rejected', 'withdrawn');

-- CreateEnum
CREATE TYPE "JobOfferState" AS ENUM ('draft', 'sent', 'accepted', 'declined', 'withdrawn', 'expired');

-- CreateEnum
CREATE TYPE "PlacementState" AS ENUM ('offered', 'accepted', 'start_pending', 'started', 'retained', 'ended', 'disputed');

-- CreateEnum
CREATE TYPE "FollowupResult" AS ENUM ('working', 'ended', 'unknown', 'disputed');

-- CreateEnum
CREATE TYPE "ConfirmationParty" AS ENUM ('employer', 'candidate', 'reviewer');

-- AlterTable
ALTER TABLE "interviews" ADD COLUMN     "job_application_id" UUID,
ALTER COLUMN "application_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "program_id" UUID,
    "slug" VARCHAR(120) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "summary" VARCHAR(2000) NOT NULL,
    "responsibilities" VARCHAR(4000) NOT NULL DEFAULT '',
    "requirements" VARCHAR(4000) NOT NULL DEFAULT '',
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contract_type" "ContractType" NOT NULL DEFAULT 'full_time',
    "contract_months" INTEGER,
    "delivery_mode" "ProgramDeliveryMode" NOT NULL DEFAULT 'in_person',
    "city" VARCHAR(100) NOT NULL DEFAULT '',
    "hours_per_week" INTEGER NOT NULL DEFAULT 0,
    "salary_disclosed" BOOLEAN NOT NULL DEFAULT false,
    "salary_min_minor" BIGINT,
    "salary_max_minor" BIGINT,
    "salary_currency" CHAR(3),
    "salary_period" VARCHAR(20) NOT NULL DEFAULT '',
    "salary_undisclosed_reason" VARCHAR(200) NOT NULL DEFAULT '',
    "application_fee_minor" BIGINT NOT NULL DEFAULT 0,
    "closes_at" TIMESTAMPTZ(3),
    "openings" INTEGER NOT NULL DEFAULT 1,
    "state" "JobState" NOT NULL DEFAULT 'draft',
    "state_reason" VARCHAR(200) NOT NULL DEFAULT '',
    "published_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_applications" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reference" VARCHAR(20) NOT NULL,
    "state" "JobApplicationState" NOT NULL DEFAULT 'draft',
    "cover_note" VARCHAR(4000) NOT NULL DEFAULT '',
    "sharing_consent" BOOLEAN NOT NULL DEFAULT false,
    "referral_id" UUID,
    "submitted_at" TIMESTAMPTZ(3),
    "decided_at" TIMESTAMPTZ(3),
    "withdrawn_reason" VARCHAR(1000) NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_referrals" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "referred_by" UUID NOT NULL,
    "note" VARCHAR(1000) NOT NULL DEFAULT '',
    "consented_at" TIMESTAMPTZ(3),
    "declined_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_offers" (
    "id" UUID NOT NULL,
    "job_application_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "state" "JobOfferState" NOT NULL DEFAULT 'draft',
    "title" VARCHAR(200) NOT NULL,
    "terms" VARCHAR(4000) NOT NULL,
    "contract_type" "ContractType" NOT NULL DEFAULT 'full_time',
    "contract_months" INTEGER,
    "salary_minor" BIGINT,
    "salary_currency" CHAR(3),
    "salary_period" VARCHAR(20) NOT NULL DEFAULT '',
    "proposed_start_date" DATE NOT NULL,
    "respond_by_at" TIMESTAMPTZ(3) NOT NULL,
    "terms_checksum" CHAR(64) NOT NULL,
    "sent_at" TIMESTAMPTZ(3),
    "responded_at" TIMESTAMPTZ(3),
    "decline_reason" VARCHAR(1000) NOT NULL DEFAULT '',
    "withdraw_reason" VARCHAR(1000) NOT NULL DEFAULT '',
    "created_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "placements" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "state" "PlacementState" NOT NULL DEFAULT 'start_pending',
    "proposed_start_date" DATE NOT NULL,
    "actual_start_date" DATE,
    "start_verified_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "end_reason" VARCHAR(1000) NOT NULL DEFAULT '',
    "dispute_reason" VARCHAR(1000) NOT NULL DEFAULT '',
    "self_found" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "placements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "placement_start_confirmations" (
    "id" UUID NOT NULL,
    "placement_id" UUID NOT NULL,
    "party" "ConfirmationParty" NOT NULL,
    "start_date" DATE NOT NULL,
    "evidence_ref" VARCHAR(200) NOT NULL DEFAULT '',
    "confirmed_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "placement_start_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "placement_followups" (
    "id" UUID NOT NULL,
    "placement_id" UUID NOT NULL,
    "day_offset" INTEGER NOT NULL,
    "due_at" DATE NOT NULL,
    "result" "FollowupResult" NOT NULL DEFAULT 'unknown',
    "source" VARCHAR(120) NOT NULL DEFAULT '',
    "evidence_ref" VARCHAR(200) NOT NULL DEFAULT '',
    "note" VARCHAR(1000) NOT NULL DEFAULT '',
    "recorded_at" TIMESTAMPTZ(3),
    "recorded_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "placement_followups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "placement_review_decisions" (
    "id" UUID NOT NULL,
    "placement_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "outcome" VARCHAR(40) NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "evidence_ref" VARCHAR(200) NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "placement_review_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "jobs_slug_key" ON "jobs"("slug");

-- CreateIndex
CREATE INDEX "jobs_organization_id_state_idx" ON "jobs"("organization_id", "state");

-- CreateIndex
CREATE INDEX "jobs_state_closes_at_idx" ON "jobs"("state", "closes_at");

-- CreateIndex
CREATE UNIQUE INDEX "job_applications_reference_key" ON "job_applications"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "job_applications_referral_id_key" ON "job_applications"("referral_id");

-- CreateIndex
CREATE INDEX "job_applications_job_id_state_idx" ON "job_applications"("job_id", "state");

-- CreateIndex
CREATE INDEX "job_applications_user_id_created_at_idx" ON "job_applications"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "job_applications_job_id_user_id_key" ON "job_applications"("job_id", "user_id");

-- CreateIndex
CREATE INDEX "job_referrals_user_id_created_at_idx" ON "job_referrals"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "job_referrals_job_id_user_id_key" ON "job_referrals"("job_id", "user_id");

-- CreateIndex
CREATE INDEX "job_offers_state_respond_by_at_idx" ON "job_offers"("state", "respond_by_at");

-- CreateIndex
CREATE UNIQUE INDEX "job_offers_job_application_id_sequence_key" ON "job_offers"("job_application_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "placements_offer_id_key" ON "placements"("offer_id");

-- CreateIndex
CREATE INDEX "placements_state_actual_start_date_idx" ON "placements"("state", "actual_start_date");

-- CreateIndex
CREATE UNIQUE INDEX "placements_job_id_user_id_key" ON "placements"("job_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "placement_start_confirmations_placement_id_party_key" ON "placement_start_confirmations"("placement_id", "party");

-- CreateIndex
CREATE INDEX "placement_followups_result_due_at_idx" ON "placement_followups"("result", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "placement_followups_placement_id_day_offset_key" ON "placement_followups"("placement_id", "day_offset");

-- CreateIndex
CREATE INDEX "placement_review_decisions_placement_id_created_at_idx" ON "placement_review_decisions"("placement_id", "created_at");

-- CreateIndex
CREATE INDEX "interviews_job_application_id_scheduled_at_idx" ON "interviews"("job_application_id", "scheduled_at");

-- AddForeignKey
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_job_application_id_fkey" FOREIGN KEY ("job_application_id") REFERENCES "job_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_referral_id_fkey" FOREIGN KEY ("referral_id") REFERENCES "job_referrals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_referrals" ADD CONSTRAINT "job_referrals_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_referrals" ADD CONSTRAINT "job_referrals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_referrals" ADD CONSTRAINT "job_referrals_referred_by_fkey" FOREIGN KEY ("referred_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_job_application_id_fkey" FOREIGN KEY ("job_application_id") REFERENCES "job_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placements" ADD CONSTRAINT "placements_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placements" ADD CONSTRAINT "placements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placements" ADD CONSTRAINT "placements_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "job_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_start_confirmations" ADD CONSTRAINT "placement_start_confirmations_placement_id_fkey" FOREIGN KEY ("placement_id") REFERENCES "placements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_start_confirmations" ADD CONSTRAINT "placement_start_confirmations_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_followups" ADD CONSTRAINT "placement_followups_placement_id_fkey" FOREIGN KEY ("placement_id") REFERENCES "placements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_followups" ADD CONSTRAINT "placement_followups_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_review_decisions" ADD CONSTRAINT "placement_review_decisions_placement_id_fkey" FOREIGN KEY ("placement_id") REFERENCES "placements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_review_decisions" ADD CONSTRAINT "placement_review_decisions_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ================================================================================================
-- PART-11 rules the database enforces itself
--
-- The two that matter most are JOB-01 and JOB-02, because both are ways a platform can flatter
-- itself: counting an accepted offer as a job started, and counting silence as success.
-- ================================================================================================

-- An interview belongs to exactly one candidacy. PART-11 gave it a second kind of owner and this
-- is what stops a row belonging to both, or to neither.
ALTER TABLE "interviews"
  ADD CONSTRAINT "interviews_one_candidacy"
  CHECK (("application_id" IS NOT NULL)::int + ("job_application_id" IS NOT NULL)::int = 1);

-- 07 forbids a listing that asks a candidate for an undocumented fee, and this build has no way to
-- document or take one. Zero is the only permitted value, said in SQL rather than in a comment.
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_no_application_fee" CHECK ("application_fee_minor" = 0);

ALTER TABLE "jobs" ADD CONSTRAINT "jobs_openings_positive" CHECK ("openings" > 0);

-- Pay is disclosed properly or its absence is explained. A range with no currency, or a maximum
-- below its minimum, is a number nobody can act on.
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_salary_is_disclosed_or_explained"
  CHECK (
    ("salary_disclosed" = true AND "salary_min_minor" IS NOT NULL AND "salary_currency" IS NOT NULL
      AND "salary_min_minor" > 0
      AND ("salary_max_minor" IS NULL OR "salary_max_minor" >= "salary_min_minor"))
    OR ("salary_disclosed" = false AND length(btrim("salary_undisclosed_reason")) >= 10)
  );

-- A fixed term that does not say how long is not a stated contract type.
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_fixed_term_states_its_length"
  CHECK ("contract_type" <> 'fixed_term' OR ("contract_months" IS NOT NULL AND "contract_months" > 0));

-- A published job has to carry what a candidate decides on.
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_public_states_are_complete"
  CHECK (
    "state" NOT IN ('open', 'paused', 'filled')
    OR (length(btrim("summary")) >= 50 AND length(btrim("requirements")) >= 20 AND "closes_at" IS NOT NULL)
  );

-- An offer names its terms, its deadline and a start date; a decline says why.
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_sequence_positive" CHECK ("sequence" > 0);
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_terms_are_substantive" CHECK (length(btrim("terms")) >= 20);
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_sent_has_a_deadline"
  CHECK ("state" = 'draft' OR "sent_at" IS NOT NULL);
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_decline_is_explained"
  CHECK ("state" <> 'declined' OR length(btrim("decline_reason")) >= 10);
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_withdraw_is_explained"
  CHECK ("state" <> 'withdrawn' OR length(btrim("withdraw_reason")) >= 10);
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_salary_needs_currency"
  CHECK ("salary_minor" IS NULL OR ("salary_currency" IS NOT NULL AND "salary_minor" > 0));

-- ------------------------------------------------------------------------------------------------
-- JOB-01: an accepted offer is not a job started
--
-- A placement may only claim `started` or anything after it once an actual start date has been
-- recorded. The service confirms that date from both sides or from a reviewed decision; this makes
-- the rule true of every path, including a direct write and any future code that forgets.
-- ------------------------------------------------------------------------------------------------
ALTER TABLE "placements" ADD CONSTRAINT "placements_started_needs_an_actual_start_date"
  CHECK (
    "state" NOT IN ('started', 'retained', 'ended')
    OR ("actual_start_date" IS NOT NULL AND "start_verified_at" IS NOT NULL)
  );

-- And the reverse: a placement still waiting to begin has not begun.
ALTER TABLE "placements" ADD CONSTRAINT "placements_pending_has_no_start_date"
  CHECK ("state" <> 'start_pending' OR "actual_start_date" IS NULL);

ALTER TABLE "placements" ADD CONSTRAINT "placements_ended_is_explained"
  CHECK ("state" <> 'ended' OR (length(btrim("end_reason")) >= 10 AND "ended_at" IS NOT NULL));
ALTER TABLE "placements" ADD CONSTRAINT "placements_dispute_is_explained"
  CHECK ("state" <> 'disputed' OR length(btrim("dispute_reason")) >= 10);

-- ------------------------------------------------------------------------------------------------
-- JOB-02: silence is not success
--
-- A follow-up may only say `working` or `ended` when somebody actually recorded it and named where
-- the answer came from. `unknown` needs neither, because that is exactly what it means: nobody
-- answered. This is what stops a due checkpoint being quietly counted as retained.
-- ------------------------------------------------------------------------------------------------
ALTER TABLE "placement_followups" ADD CONSTRAINT "placement_followups_answer_has_a_source"
  CHECK (
    "result" = 'unknown'
    OR ("recorded_at" IS NOT NULL AND "recorded_by" IS NOT NULL AND length(btrim("source")) >= 3)
  );

-- 07 names the two checkpoints, and 14 counts retention at ninety days. Anything else is a
-- checkpoint nobody defined.
ALTER TABLE "placement_followups" ADD CONSTRAINT "placement_followups_known_checkpoints"
  CHECK ("day_offset" IN (30, 90));

-- A confirmation of a start is a statement about a date, so it has to carry one.
ALTER TABLE "placement_start_confirmations" ADD CONSTRAINT "start_confirmations_reviewer_needs_evidence"
  CHECK ("party" <> 'reviewer' OR length(btrim("evidence_ref")) >= 3);

ALTER TABLE "placement_review_decisions" ADD CONSTRAINT "placement_review_decisions_reason_required"
  CHECK (length(btrim("reason")) >= 10);

-- ------------------------------------------------------------------------------------------------
-- Append-only records
-- ------------------------------------------------------------------------------------------------
CREATE TRIGGER placement_review_decisions_append_only
  BEFORE UPDATE OR DELETE ON "placement_review_decisions"
  FOR EACH ROW EXECUTE FUNCTION prevent_enablement_record_mutation();

CREATE TRIGGER placement_start_confirmations_append_only
  BEFORE UPDATE OR DELETE ON "placement_start_confirmations"
  FOR EACH ROW EXECUTE FUNCTION prevent_enablement_record_mutation();

-- A sent offer is frozen. Changing the terms somebody is deciding on, or has already accepted, is
-- the failure this trigger exists to make impossible: a revision is a new offer with a new
-- sequence, so the candidate always knows which text they said yes to.
CREATE OR REPLACE FUNCTION prevent_sent_offer_edit() RETURNS trigger AS $$
BEGIN
  IF OLD."state" <> 'draft' AND (
    NEW."terms" <> OLD."terms"
    OR NEW."terms_checksum" <> OLD."terms_checksum"
    OR NEW."salary_minor" IS DISTINCT FROM OLD."salary_minor"
    OR NEW."salary_currency" IS DISTINCT FROM OLD."salary_currency"
    OR NEW."contract_type" <> OLD."contract_type"
    OR NEW."contract_months" IS DISTINCT FROM OLD."contract_months"
    OR NEW."proposed_start_date" <> OLD."proposed_start_date"
  ) THEN
    RAISE EXCEPTION 'a sent offer cannot be edited: issue a new version instead';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER job_offers_frozen_once_sent
  BEFORE UPDATE ON "job_offers"
  FOR EACH ROW EXECUTE FUNCTION prevent_sent_offer_edit();

-- ------------------------------------------------------------------------------------------------
-- One live offer per application
--
-- Two offers open at once means two texts somebody could accept, and a race over which one counts.
-- ------------------------------------------------------------------------------------------------
CREATE UNIQUE INDEX "job_offers_one_live_per_application"
  ON "job_offers"("job_application_id")
  WHERE "state" IN ('draft', 'sent');
