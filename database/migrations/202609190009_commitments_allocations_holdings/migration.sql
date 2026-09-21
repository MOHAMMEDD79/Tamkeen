-- PART-09 — commitments, subscriptions, allocations, holdings and distributions.
--
-- Two existing tables are generalised rather than duplicated:
--
--  * a funding pool may belong to a project (a charity campaign) or to an offering (its escrow);
--  * a payment intent may settle a contribution or a subscription.
--
-- Both go through the same signed webhook and the same inbox. Writing a second payment path for
-- investments would mean a second idempotency implementation, and that is the one thing
-- 08-FINANCIAL-SYSTEM is most insistent about getting right exactly once.

ALTER TABLE "funding_pools" ALTER COLUMN "project_id" DROP NOT NULL;
ALTER TABLE "funding_pools" ADD COLUMN "offering_id" UUID;
CREATE UNIQUE INDEX "funding_pools_offering_id_key" ON "funding_pools"("offering_id");
ALTER TABLE "funding_pools"
  ADD CONSTRAINT "funding_pools_one_owner" CHECK (
    ("project_id" IS NOT NULL AND "offering_id" IS NULL) OR
    ("project_id" IS NULL AND "offering_id" IS NOT NULL)
  );
-- The kind and the owner must agree, so an offering's escrow can never be read as campaign money.
ALTER TABLE "funding_pools"
  ADD CONSTRAINT "funding_pools_kind_matches_owner" CHECK (
    ("kind" = 'charity_campaign' AND "project_id" IS NOT NULL) OR
    ("kind" = 'offering_escrow' AND "offering_id" IS NOT NULL)
  );

ALTER TABLE "payment_intents" ALTER COLUMN "contribution_id" DROP NOT NULL;
ALTER TABLE "payment_intents" ADD COLUMN "subscription_id" UUID;
CREATE UNIQUE INDEX "payment_intents_subscription_id_key" ON "payment_intents"("subscription_id");
ALTER TABLE "payment_intents"
  ADD CONSTRAINT "payment_intents_one_source" CHECK (
    ("contribution_id" IS NOT NULL AND "subscription_id" IS NULL) OR
    ("contribution_id" IS NULL AND "subscription_id" IS NOT NULL)
  );

CREATE TYPE "CommitmentState" AS ENUM ('reserved', 'confirmed', 'paying', 'paid', 'allocated', 'cancelled', 'expired', 'refunding', 'refunded');
CREATE TYPE "SignatureMethod" AS ENUM ('simulated_click');
CREATE TYPE "AllocationRequestState" AS ENUM ('draft', 'submitted', 'approved', 'rejected');
CREATE TYPE "DistributionState" AS ENUM ('requested', 'approved', 'rejected', 'paying', 'paid', 'failed');
CREATE TYPE "CorporateEventKind" AS ENUM ('report', 'distribution', 'buyback', 'exit', 'loss', 'liquidation');

CREATE TABLE "commitments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "offering_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "requested_minor" BIGINT NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "units" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "state" "CommitmentState" NOT NULL DEFAULT 'reserved',
  "disclosure_id" UUID NOT NULL,
  "eligible_at_commitment" BOOLEAN NOT NULL DEFAULT false,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "cancelled_reason" VARCHAR(1000) NOT NULL DEFAULT '',
  "simulated" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "commitments_pkey" PRIMARY KEY ("id"),
  -- 06 forbids fractional shares, so a commitment that buys none is not a commitment.
  CONSTRAINT "commitments_units_positive" CHECK ("units" > 0),
  CONSTRAINT "commitments_amount_positive" CHECK ("amount_minor" > 0),
  -- What is paid is always whole shares, never the rounded-up request.
  CONSTRAINT "commitments_amount_not_above_request" CHECK ("amount_minor" <= "requested_minor")
);
CREATE INDEX "commitments_offering_id_state_expires_at_idx" ON "commitments"("offering_id", "state", "expires_at");
CREATE INDEX "commitments_user_id_created_at_idx" ON "commitments"("user_id", "created_at");

CREATE TABLE "subscriptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "commitment_id" UUID NOT NULL,
  "disclosure_id" UUID NOT NULL,
  "disclosure_checksum" CHAR(64) NOT NULL,
  "contract_checksum" CHAR(64) NOT NULL,
  "signature_method" "SignatureMethod" NOT NULL DEFAULT 'simulated_click',
  "acknowledged_risk" BOOLEAN NOT NULL,
  "confirmed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id"),
  -- 06: the total-loss acknowledgement is explicit at the binding step. A contract without it is
  -- not a contract this product will record.
  CONSTRAINT "subscriptions_risk_acknowledged" CHECK ("acknowledged_risk" = true)
);
CREATE UNIQUE INDEX "subscriptions_commitment_id_key" ON "subscriptions"("commitment_id");

CREATE TABLE "allocations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "offering_id" UUID NOT NULL,
  "commitment_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "units" BIGINT NOT NULL,
  "cost_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "proof_reference" VARCHAR(200) NOT NULL,
  "simulated" BOOLEAN NOT NULL DEFAULT true,
  "finalised_by" UUID NOT NULL,
  "finalised_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "allocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "allocations_units_positive" CHECK ("units" > 0),
  -- An allocation is a claim that units were issued, so it carries evidence or it does not exist.
  CONSTRAINT "allocations_has_proof" CHECK (length(btrim("proof_reference")) >= 4)
);
CREATE UNIQUE INDEX "allocations_commitment_id_key" ON "allocations"("commitment_id");
CREATE INDEX "allocations_offering_id_finalised_at_idx" ON "allocations"("offering_id", "finalised_at");

CREATE TABLE "holdings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "allocation_id" UUID NOT NULL,
  "venture_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "units" BIGINT NOT NULL,
  "cost_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "simulated" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "holdings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "holdings_units_positive" CHECK ("units" > 0)
);
-- One holding per allocation, which is what makes "no holding without a proven allocation" a
-- property of the schema rather than a rule the service is trusted to remember.
CREATE UNIQUE INDEX "holdings_allocation_id_key" ON "holdings"("allocation_id");
CREATE INDEX "holdings_user_id_venture_id_idx" ON "holdings"("user_id", "venture_id");

CREATE TABLE "allocation_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "offering_id" UUID NOT NULL,
  "state" "AllocationRequestState" NOT NULL DEFAULT 'submitted',
  "snapshot" JSONB NOT NULL,
  "checksum" CHAR(64) NOT NULL,
  "total_units" BIGINT NOT NULL,
  "total_minor" BIGINT NOT NULL,
  "requested_by" UUID NOT NULL,
  "decided_by" UUID,
  "decided_at" TIMESTAMPTZ(3),
  "reason" VARCHAR(1000) NOT NULL DEFAULT '',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "allocation_requests_pkey" PRIMARY KEY ("id"),
  -- Separation of duties: whoever computed the schedule does not approve it.
  CONSTRAINT "allocation_requests_requester_is_not_decider" CHECK ("decided_by" IS NULL OR "decided_by" <> "requested_by"),
  CONSTRAINT "allocation_requests_decision_complete" CHECK (
    ("decided_by" IS NULL AND "decided_at" IS NULL) OR ("decided_by" IS NOT NULL AND "decided_at" IS NOT NULL)
  )
);
CREATE INDEX "allocation_requests_offering_id_state_idx" ON "allocation_requests"("offering_id", "state");

CREATE TABLE "company_reports" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "venture_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "body" VARCHAR(20000) NOT NULL,
  "period_start" TIMESTAMPTZ(3) NOT NULL,
  "period_end" TIMESTAMPTZ(3) NOT NULL,
  "published_by" UUID NOT NULL,
  "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "company_reports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "company_reports_period_ordered" CHECK ("period_end" >= "period_start")
);
CREATE UNIQUE INDEX "company_reports_venture_id_sequence_key" ON "company_reports"("venture_id", "sequence");

CREATE TABLE "distributions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "venture_id" UUID NOT NULL,
  "total_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "state" "DistributionState" NOT NULL DEFAULT 'requested',
  "snapshot_units" BIGINT NOT NULL,
  "requested_by" UUID NOT NULL,
  "approver_id" UUID,
  "approved_at" TIMESTAMPTZ(3),
  "failure_reason" VARCHAR(1000) NOT NULL DEFAULT '',
  "simulated" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "distributions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "distributions_total_positive" CHECK ("total_minor" > 0),
  -- A distribution against nothing has no denominator and no holders to pay.
  CONSTRAINT "distributions_snapshot_positive" CHECK ("snapshot_units" > 0),
  -- The same separation of duties as every other money decision in this product.
  CONSTRAINT "distributions_requester_is_not_approver" CHECK ("approver_id" IS NULL OR "approver_id" <> "requested_by"),
  CONSTRAINT "distributions_approval_complete" CHECK (
    ("approver_id" IS NULL AND "approved_at" IS NULL) OR ("approver_id" IS NOT NULL AND "approved_at" IS NOT NULL)
  )
);
CREATE INDEX "distributions_venture_id_state_idx" ON "distributions"("venture_id", "state");

CREATE TABLE "distribution_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "distribution_id" UUID NOT NULL,
  "holding_id" UUID NOT NULL,
  "units" BIGINT NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "distribution_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "distribution_lines_amount_not_negative" CHECK ("amount_minor" >= 0)
);
CREATE UNIQUE INDEX "distribution_lines_distribution_id_holding_id_key" ON "distribution_lines"("distribution_id", "holding_id");

CREATE TABLE "corporate_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "venture_id" UUID NOT NULL,
  "kind" "CorporateEventKind" NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "body" VARCHAR(10000) NOT NULL,
  "document_ref" VARCHAR(200) NOT NULL DEFAULT '',
  "effective_at" TIMESTAMPTZ(3) NOT NULL,
  "recorded_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "corporate_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "corporate_events_venture_id_effective_at_idx" ON "corporate_events"("venture_id", "effective_at");

ALTER TABLE "funding_pools" ADD CONSTRAINT "funding_pools_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_disclosure_id_fkey" FOREIGN KEY ("disclosure_id") REFERENCES "offering_disclosures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_disclosure_id_fkey" FOREIGN KEY ("disclosure_id") REFERENCES "offering_disclosures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_finalised_by_fkey" FOREIGN KEY ("finalised_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_allocation_id_fkey" FOREIGN KEY ("allocation_id") REFERENCES "allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_venture_id_fkey" FOREIGN KEY ("venture_id") REFERENCES "ventures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "allocation_requests" ADD CONSTRAINT "allocation_requests_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "allocation_requests" ADD CONSTRAINT "allocation_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "allocation_requests" ADD CONSTRAINT "allocation_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "company_reports" ADD CONSTRAINT "company_reports_venture_id_fkey" FOREIGN KEY ("venture_id") REFERENCES "ventures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "company_reports" ADD CONSTRAINT "company_reports_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "distributions" ADD CONSTRAINT "distributions_venture_id_fkey" FOREIGN KEY ("venture_id") REFERENCES "ventures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "distributions" ADD CONSTRAINT "distributions_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "distributions" ADD CONSTRAINT "distributions_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "distribution_lines" ADD CONSTRAINT "distribution_lines_distribution_id_fkey" FOREIGN KEY ("distribution_id") REFERENCES "distributions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "distribution_lines" ADD CONSTRAINT "distribution_lines_holding_id_fkey" FOREIGN KEY ("holding_id") REFERENCES "holdings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "corporate_events" ADD CONSTRAINT "corporate_events_venture_id_fkey" FOREIGN KEY ("venture_id") REFERENCES "ventures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "corporate_events" ADD CONSTRAINT "corporate_events_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A subscription is the contract somebody agreed to, an allocation is the proof units were issued,
-- and a holding follows from that proof. None of the three may be edited after the fact.
CREATE TRIGGER subscriptions_immutable BEFORE UPDATE OR DELETE ON "subscriptions"
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
CREATE TRIGGER allocations_immutable BEFORE UPDATE OR DELETE ON "allocations"
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
CREATE TRIGGER company_reports_immutable BEFORE UPDATE OR DELETE ON "company_reports"
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
CREATE TRIGGER corporate_events_immutable BEFORE UPDATE OR DELETE ON "corporate_events"
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

-- 06 forbids adjusting a holding by hand: a change comes from an allocation or from an approved
-- corporate event that is processed, never from an UPDATE on the register.
CREATE FUNCTION prevent_holding_edit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."units" IS DISTINCT FROM OLD."units"
     OR NEW."allocation_id" IS DISTINCT FROM OLD."allocation_id"
     OR NEW."user_id" IS DISTINCT FROM OLD."user_id" THEN
    RAISE EXCEPTION 'a holding follows from a proven allocation and cannot be edited by hand'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER holdings_not_hand_edited BEFORE UPDATE ON "holdings"
  FOR EACH ROW EXECUTE FUNCTION prevent_holding_edit();
