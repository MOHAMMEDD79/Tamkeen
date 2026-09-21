-- PART-07 — payouts, refunds, disputes and reconciliation (08-FINANCIAL-SYSTEM).
--
-- Money can now leave a pool. Everything here exists to make that safe: an approval bound to the
-- exact request it was given for, a reservation that cannot overdraw the settled balance, and a
-- reconciliation record whose differences are work items rather than balance edits.

CREATE TYPE "PayoutState" AS ENUM ('requested', 'approved', 'rejected', 'cancelled', 'queued', 'processing', 'paid', 'failed', 'unknown');
CREATE TYPE "RefundState" AS ENUM ('requested', 'approved', 'rejected', 'processing', 'succeeded', 'failed', 'unknown');
CREATE TYPE "DisputeState" AS ENUM ('opened', 'under_review', 'lost', 'won', 'withdrawn');
CREATE TYPE "ReconciliationBatchState" AS ENUM ('imported', 'matched', 'closed');
CREATE TYPE "ReconciliationMatch" AS ENUM ('match', 'mismatch', 'missing', 'duplicate');

CREATE TABLE "payouts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "pool_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "milestone_id" UUID,
  "budget_revision_id" UUID,
  "amount_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "invoice_reference" VARCHAR(120) NOT NULL DEFAULT '',
  "state" "PayoutState" NOT NULL DEFAULT 'requested',
  "request_hash" CHAR(64) NOT NULL,
  "beneficiary_bank_name" VARCHAR(140) NOT NULL,
  "beneficiary_holder" VARCHAR(200) NOT NULL,
  "beneficiary_last4" VARCHAR(4) NOT NULL,
  "maker_id" UUID NOT NULL,
  "approver_id" UUID,
  "approved_at" TIMESTAMPTZ(3),
  "executed_by" UUID,
  "provider" VARCHAR(40),
  "provider_reference" VARCHAR(120),
  "paid_proof_reference" VARCHAR(200),
  "paid_at" TIMESTAMPTZ(3),
  "failure_reason" VARCHAR(1000) NOT NULL DEFAULT '',
  "last_inquired_at" TIMESTAMPTZ(3),
  "simulated" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "payouts_pkey" PRIMARY KEY ("id"),
  -- Money only ever moves in positive amounts; a negative payout would be an undocumented refund.
  CONSTRAINT "payouts_amount_positive" CHECK ("amount_minor" > 0),
  -- 08: an approval must name who gave it and when, or it is not an approval.
  CONSTRAINT "payouts_approval_complete" CHECK (
    ("approver_id" IS NULL AND "approved_at" IS NULL) OR ("approver_id" IS NOT NULL AND "approved_at" IS NOT NULL)
  ),
  -- Separation of duties, enforced in the database and not only in the service: the person who
  -- requested a disbursement can never be the person who approved it.
  CONSTRAINT "payouts_maker_is_not_approver" CHECK ("approver_id" IS NULL OR "approver_id" <> "maker_id"),
  -- `paid` is a claim about the outside world, so it needs independent evidence (08).
  CONSTRAINT "payouts_paid_needs_proof" CHECK (
    "state" <> 'paid' OR ("paid_at" IS NOT NULL AND "paid_proof_reference" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "payouts_provider_provider_reference_key" ON "payouts"("provider", "provider_reference");
CREATE INDEX "payouts_organization_id_state_created_at_idx" ON "payouts"("organization_id", "state", "created_at");
CREATE INDEX "payouts_pool_id_state_idx" ON "payouts"("pool_id", "state");

CREATE TABLE "payout_decisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "payout_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "action" VARCHAR(20) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "reason" VARCHAR(1000) NOT NULL DEFAULT '',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "payout_decisions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payout_decisions_payout_id_created_at_idx" ON "payout_decisions"("payout_id", "created_at");

CREATE TABLE "refunds" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "contribution_id" UUID NOT NULL,
  "pool_id" UUID NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "state" "RefundState" NOT NULL DEFAULT 'requested',
  "fee_covered_by_pool" BOOLEAN NOT NULL DEFAULT true,
  "fee_minor" BIGINT NOT NULL DEFAULT 0,
  "requested_by" UUID NOT NULL,
  "approver_id" UUID,
  "approved_at" TIMESTAMPTZ(3),
  "executed_by" UUID,
  "provider" VARCHAR(40),
  "provider_reference" VARCHAR(120),
  "succeeded_at" TIMESTAMPTZ(3),
  "failure_reason" VARCHAR(1000) NOT NULL DEFAULT '',
  "last_inquired_at" TIMESTAMPTZ(3),
  "simulated" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "refunds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "refunds_amount_positive" CHECK ("amount_minor" > 0),
  CONSTRAINT "refunds_fee_not_negative" CHECK ("fee_minor" >= 0),
  CONSTRAINT "refunds_approval_complete" CHECK (
    ("approver_id" IS NULL AND "approved_at" IS NULL) OR ("approver_id" IS NOT NULL AND "approved_at" IS NOT NULL)
  ),
  CONSTRAINT "refunds_requester_is_not_approver" CHECK ("approver_id" IS NULL OR "approver_id" <> "requested_by")
);
CREATE UNIQUE INDEX "refunds_provider_provider_reference_key" ON "refunds"("provider", "provider_reference");
CREATE INDEX "refunds_contribution_id_state_idx" ON "refunds"("contribution_id", "state");
CREATE INDEX "refunds_pool_id_state_idx" ON "refunds"("pool_id", "state");

CREATE TABLE "disputes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "contribution_id" UUID NOT NULL,
  "pool_id" UUID NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "state" "DisputeState" NOT NULL DEFAULT 'opened',
  "reason" VARCHAR(1000) NOT NULL,
  "coverage_plan" VARCHAR(2000) NOT NULL DEFAULT '',
  "opened_by" UUID NOT NULL,
  "resolved_by" UUID,
  "resolved_at" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "disputes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "disputes_amount_positive" CHECK ("amount_minor" > 0)
);
CREATE INDEX "disputes_pool_id_state_idx" ON "disputes"("pool_id", "state");

CREATE TABLE "reconciliation_batches" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "source" VARCHAR(40) NOT NULL,
  "environment" VARCHAR(20) NOT NULL,
  "file_hash" CHAR(64) NOT NULL,
  "statement_date" TIMESTAMPTZ(3) NOT NULL,
  "row_count" INTEGER NOT NULL,
  "state" "ReconciliationBatchState" NOT NULL DEFAULT 'imported',
  "imported_by" UUID NOT NULL,
  "last_run_at" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "reconciliation_batches_pkey" PRIMARY KEY ("id")
);
-- The same statement cannot be imported twice into the same environment and counted twice.
CREATE UNIQUE INDEX "reconciliation_batches_source_environment_file_hash_key"
  ON "reconciliation_batches"("source", "environment", "file_hash");
CREATE INDEX "reconciliation_batches_state_created_at_idx" ON "reconciliation_batches"("state", "created_at");

CREATE TABLE "reconciliation_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "batch_id" UUID NOT NULL,
  "provider_transaction_id" VARCHAR(120) NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "fee_minor" BIGINT NOT NULL DEFAULT 0,
  "outcome" VARCHAR(20) NOT NULL,
  "match_state" "ReconciliationMatch" NOT NULL,
  "our_amount_minor" BIGINT,
  "our_fee_minor" BIGINT,
  "our_state" VARCHAR(30),
  "note" VARCHAR(500) NOT NULL DEFAULT '',
  "resolved_by" UUID,
  "resolved_at" TIMESTAMPTZ(3),
  "resolution_reason" VARCHAR(1000) NOT NULL DEFAULT '',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "reconciliation_items_pkey" PRIMARY KEY ("id"),
  -- 08: a difference is closed with a reason, never silently.
  CONSTRAINT "reconciliation_items_resolution_has_reason" CHECK (
    "resolved_at" IS NULL OR (length(btrim("resolution_reason")) >= 10 AND "resolved_by" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "reconciliation_items_batch_id_provider_transaction_id_key"
  ON "reconciliation_items"("batch_id", "provider_transaction_id");
CREATE INDEX "reconciliation_items_batch_id_match_state_idx" ON "reconciliation_items"("batch_id", "match_state");

ALTER TABLE "payouts" ADD CONSTRAINT "payouts_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "funding_pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "milestones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_maker_id_fkey" FOREIGN KEY ("maker_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_executed_by_fkey" FOREIGN KEY ("executed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payout_decisions" ADD CONSTRAINT "payout_decisions_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payout_decisions" ADD CONSTRAINT "payout_decisions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_contribution_id_fkey" FOREIGN KEY ("contribution_id") REFERENCES "contributions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "funding_pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_executed_by_fkey" FOREIGN KEY ("executed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_contribution_id_fkey" FOREIGN KEY ("contribution_id") REFERENCES "contributions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "funding_pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_opened_by_fkey" FOREIGN KEY ("opened_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reconciliation_batches" ADD CONSTRAINT "reconciliation_batches_imported_by_fkey" FOREIGN KEY ("imported_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "reconciliation_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A payout decision is a record of what someone judged at a moment. Editing it would rewrite that
-- judgement, so it is append-only like every other decision in this product.
CREATE TRIGGER payout_decisions_immutable BEFORE UPDATE OR DELETE ON "payout_decisions"
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

-- An imported statement line is evidence from outside. Its match verdict and resolution may be
-- written once, but the figures the provider sent must never be edited to make a difference go
-- away — 08 forbids closing a reconciliation with a manually adjusted balance.
CREATE FUNCTION prevent_statement_figure_edit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."provider_transaction_id" IS DISTINCT FROM OLD."provider_transaction_id"
     OR NEW."amount_minor" IS DISTINCT FROM OLD."amount_minor"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."fee_minor" IS DISTINCT FROM OLD."fee_minor"
     OR NEW."outcome" IS DISTINCT FROM OLD."outcome" THEN
    RAISE EXCEPTION 'an imported statement line is evidence and cannot be edited; resolve the difference instead'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reconciliation_items_figures_immutable BEFORE UPDATE ON "reconciliation_items"
  FOR EACH ROW EXECUTE FUNCTION prevent_statement_figure_edit();

-- A resolved difference cannot be silently un-resolved or re-resolved: reopening one is a new
-- decision someone has to make deliberately, not an UPDATE that erases the last reason.
CREATE FUNCTION prevent_resolution_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."resolved_at" IS NOT NULL AND (
       NEW."resolved_at" IS DISTINCT FROM OLD."resolved_at"
       OR NEW."resolved_by" IS DISTINCT FROM OLD."resolved_by"
       OR NEW."resolution_reason" IS DISTINCT FROM OLD."resolution_reason") THEN
    RAISE EXCEPTION 'a reconciliation resolution is append-only' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reconciliation_items_resolution_immutable BEFORE UPDATE ON "reconciliation_items"
  FOR EACH ROW EXECUTE FUNCTION prevent_resolution_rewrite();
