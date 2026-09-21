BEGIN;

-- PART-05: the charity lifecycle from a budgeted draft to a reviewed, published project.
-- No money moves here. Amounts are planning figures; the ledger arrives with PART-06.

-- 05-CHARITY-LIFECYCLE. Chosen at publication and fixed from then on, because a contributor
-- decides whether to give based on what happens if the goal is missed.
CREATE TYPE "FundingPolicy" AS ENUM ('flexible', 'all_or_nothing');

CREATE TYPE "MilestoneState" AS ENUM ('planned', 'active', 'evidence_submitted', 'verified', 'cancelled');

CREATE TYPE "ReviewOutcome" AS ENUM ('approved', 'changes_requested', 'rejected');

CREATE TYPE "ReportState" AS ENUM ('draft', 'submitted', 'published');

-- Amounts are BIGINT minor units (08-FINANCIAL-SYSTEM). They are never floats, and they leave the
-- API as strings so JavaScript number precision is never involved.
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "goal_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "policy" "FundingPolicy" NOT NULL DEFAULT 'flexible',
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "campaigns_goal_positive" CHECK ("goal_minor" > 0),
    CONSTRAINT "campaigns_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$')
);
-- One campaign per project to begin with (09-DATA-MODEL).
CREATE UNIQUE INDEX "campaigns_project_id_key" ON "campaigns"("project_id");

CREATE TABLE "budget_lines" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "label" VARCHAR(140) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    CONSTRAINT "budget_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "budget_lines_amount_positive" CHECK ("amount_minor" > 0)
);
CREATE INDEX "budget_lines_project_order_idx" ON "budget_lines"("project_id", "sort_order");

-- ORG-08.A05: a budget change creates a new version and never overwrites the old one. The snapshot
-- is what the organisation and any reviewer can point back to.
CREATE TABLE "budget_revisions" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "reason" VARCHAR(1000) NOT NULL DEFAULT '',
    "snapshot" JSONB NOT NULL,
    "total_minor" BIGINT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "budget_revisions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "budget_revisions_project_sequence_key" ON "budget_revisions"("project_id", "sequence");

CREATE TABLE "milestones" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "title" VARCHAR(140) NOT NULL,
    "budget_minor" BIGINT NOT NULL,
    -- 14-ANALYTICS: project completion is measured by verified milestones at their declared
    -- weights, which is why the weight is stored and not inferred from the amount.
    "weight" INTEGER NOT NULL,
    "state" "MilestoneState" NOT NULL DEFAULT 'planned',
    "evidence_note" VARCHAR(2000) NOT NULL DEFAULT '',
    "evidence_submitted_at" TIMESTAMPTZ(3),
    "verified_at" TIMESTAMPTZ(3),
    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "milestones_budget_positive" CHECK ("budget_minor" > 0),
    CONSTRAINT "milestones_weight_range" CHECK ("weight" > 0 AND "weight" <= 100)
);
CREATE UNIQUE INDEX "milestones_project_sequence_key" ON "milestones"("project_id", "sequence");

-- ADM-03. One decision per submitted version, append-only, and the reviewer is recorded but never
-- exposed publicly (ADR-013 set this precedent for verification).
CREATE TABLE "project_review_decisions" (
    "id" UUID NOT NULL,
    "project_version_id" UUID NOT NULL,
    "outcome" "ReviewOutcome" NOT NULL,
    "public_reason" VARCHAR(1000) NOT NULL DEFAULT '',
    "reviewer_id" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_review_decisions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "project_review_decisions_version_key" ON "project_review_decisions"("project_version_id");

CREATE TABLE "project_updates" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "title" VARCHAR(140) NOT NULL,
    "body" TEXT NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by" UUID NOT NULL,
    CONSTRAINT "project_updates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "project_updates_project_published_idx" ON "project_updates"("project_id", "published_at");

-- ORG-13. A published report is a frozen snapshot: the figures it states are the figures that were
-- true when it was published, not a live query that silently changes afterwards.
CREATE TABLE "project_reports" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "title" VARCHAR(140) NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "state" "ReportState" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "snapshot" JSONB,
    "created_by" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "project_reports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "project_reports_period_order" CHECK ("period_end" >= "period_start"),
    CONSTRAINT "project_reports_published_has_snapshot" CHECK (("state" <> 'published') OR ("snapshot" IS NOT NULL AND "published_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "project_reports_project_sequence_key" ON "project_reports"("project_id", "sequence");

-- Review assignment lives on the project, mirroring how verification cases are claimed.
ALTER TABLE "projects" ADD COLUMN "assigned_reviewer_id" UUID;
ALTER TABLE "projects" ADD COLUMN "claimed_at" TIMESTAMPTZ(3);
-- Recorded so a paused or cancelled project can always say why, to its organisation and publicly.
ALTER TABLE "projects" ADD COLUMN "state_reason" VARCHAR(1000) NOT NULL DEFAULT '';

ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "budget_revisions" ADD CONSTRAINT "budget_revisions_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "budget_revisions" ADD CONSTRAINT "budget_revisions_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_review_decisions" ADD CONSTRAINT "project_review_decisions_version_fkey"
  FOREIGN KEY ("project_version_id") REFERENCES "project_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_review_decisions" ADD CONSTRAINT "project_review_decisions_reviewer_fkey"
  FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_updates" ADD CONSTRAINT "project_updates_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_updates" ADD CONSTRAINT "project_updates_published_by_fkey"
  FOREIGN KEY ("published_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_reports" ADD CONSTRAINT "project_reports_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_reports" ADD CONSTRAINT "project_reports_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_assigned_reviewer_fkey"
  FOREIGN KEY ("assigned_reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A review decision is the record of a judgement. It is never edited or deleted, so a later
-- disagreement produces a new decision rather than a rewritten history.
CREATE FUNCTION prevent_project_review_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'project review decisions are append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER project_review_decisions_immutable BEFORE UPDATE OR DELETE ON "project_review_decisions"
  FOR EACH ROW EXECUTE FUNCTION prevent_project_review_mutation();

-- A budget revision is the evidence that a change was deliberate and attributed.
CREATE FUNCTION prevent_budget_revision_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'budget revisions are append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER budget_revisions_immutable BEFORE UPDATE OR DELETE ON "budget_revisions"
  FOR EACH ROW EXECUTE FUNCTION prevent_budget_revision_mutation();

-- A published report cannot be edited or withdrawn by editing the row: its figures were stated
-- publicly at a point in time. A correction is a new report.
CREATE FUNCTION prevent_published_report_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."state" = 'published' THEN RAISE EXCEPTION 'a published report cannot be deleted' USING ERRCODE = '23514'; END IF;
    RETURN OLD;
  END IF;
  IF OLD."state" = 'published' THEN
    RAISE EXCEPTION 'a published report is immutable; publish a correction instead' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER project_reports_published_immutable BEFORE UPDATE OR DELETE ON "project_reports"
  FOR EACH ROW EXECUTE FUNCTION prevent_published_report_mutation();

-- 05-CHARITY-LIFECYCLE: the funding policy and the currency are what a contributor relies on when
-- deciding to give. Once the project is public they are fixed. Contributions do not exist yet, so
-- publication is the earliest point at which someone could have relied on them.
CREATE FUNCTION prevent_published_campaign_repricing() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE project_published TIMESTAMPTZ;
BEGIN
  SELECT "published_at" INTO project_published FROM "projects" WHERE "id" = NEW."project_id";
  IF project_published IS NOT NULL AND (OLD."policy" <> NEW."policy" OR OLD."currency" <> NEW."currency") THEN
    RAISE EXCEPTION 'funding policy and currency are fixed once the project is published' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER campaigns_policy_is_fixed BEFORE UPDATE ON "campaigns"
  FOR EACH ROW EXECUTE FUNCTION prevent_published_campaign_repricing();

INSERT INTO "runtime_metadata" ("key", "value") VALUES ('charity_lifecycle_version', '1')
  ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = CURRENT_TIMESTAMP;

COMMIT;
