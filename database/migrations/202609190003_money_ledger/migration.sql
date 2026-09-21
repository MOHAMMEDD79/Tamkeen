BEGIN;

-- PART-06: the money model. 08-FINANCIAL-SYSTEM governs every line of this file.
--
-- The ledger is the source of truth. A balance shown anywhere in the product is a projection of
-- these entries, never a column somebody can edit. Amounts are BIGINT minor units; there is no
-- floating point anywhere in the money path.
--
-- MONEY_ENABLED stays false and PAYMENT_MODE stays `simulator`. Nothing here moves real money:
-- every record carries `simulated` so a demo receipt can never be mistaken for a real one.

CREATE TYPE "PoolKind" AS ENUM ('charity_campaign');

-- Double-entry account types. The normal balance side is derived from the type, not stored.
CREATE TYPE "LedgerAccountType" AS ENUM ('asset', 'liability', 'revenue', 'expense');

CREATE TYPE "PaymentIntentState" AS ENUM ('created', 'awaiting_action', 'processing', 'succeeded', 'failed', 'cancelled', 'expired');

-- 05-CHARITY-LIFECYCLE. `pending` covers everything before the provider confirms; a contributor
-- sees "awaiting confirmation" rather than a success the provider has not given.
CREATE TYPE "ContributionState" AS ENUM ('pending', 'succeeded', 'failed', 'expired', 'refunded', 'partially_refunded');

CREATE TYPE "ContributionVisibility" AS ENUM ('named', 'anonymous');

CREATE TYPE "SettlementState" AS ENUM ('pending', 'settled', 'disputed');

-- One pool per funding source and purpose (08). Money never crosses pools in this release.
CREATE TABLE "funding_pools" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "kind" "PoolKind" NOT NULL DEFAULT 'charity_campaign',
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "funding_pools_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "funding_pools_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$')
);
-- One pool per project per kind to begin with.
CREATE UNIQUE INDEX "funding_pools_project_kind_key" ON "funding_pools"("project_id", "kind");

CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL,
    "pool_id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ledger_accounts_pool_code_key" ON "ledger_accounts"("pool_id", "code");

CREATE TABLE "ledger_transactions" (
    "id" UUID NOT NULL,
    "pool_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    -- What caused this transaction, so every entry can be traced back to a business event.
    "source_type" VARCHAR(40) NOT NULL,
    "source_id" UUID NOT NULL,
    -- A correction is a reversing transaction linked to the original, never an edit (08).
    "reversal_of" UUID,
    "posted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ledger_transactions_pool_posted_idx" ON "ledger_transactions"("pool_id", "posted_at");
-- One transaction per business event of a given kind: this is what makes a replayed webhook a
-- no-op at the ledger level rather than a second set of entries.
CREATE UNIQUE INDEX "ledger_transactions_source_key" ON "ledger_transactions"("source_type", "source_id");

CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "debit_minor" BIGINT NOT NULL DEFAULT 0,
    "credit_minor" BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ledger_entries_non_negative" CHECK ("debit_minor" >= 0 AND "credit_minor" >= 0),
    -- Exactly one side is positive on every entry (09-DATA-MODEL).
    CONSTRAINT "ledger_entries_one_side" CHECK (("debit_minor" > 0) <> ("credit_minor" > 0))
);
CREATE INDEX "ledger_entries_transaction_idx" ON "ledger_entries"("transaction_id");
CREATE INDEX "ledger_entries_account_idx" ON "ledger_entries"("account_id");

CREATE TABLE "contributions" (
    "id" UUID NOT NULL,
    "pool_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "payer_party_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "state" "ContributionState" NOT NULL DEFAULT 'pending',
    -- 05-CHARITY-LIFECYCLE: anonymous by default, and showing the amount is a separate consent.
    "visibility" "ContributionVisibility" NOT NULL DEFAULT 'anonymous',
    "show_amount_publicly" BOOLEAN NOT NULL DEFAULT false,
    "fee_minor" BIGINT NOT NULL DEFAULT 0,
    "refunded_minor" BIGINT NOT NULL DEFAULT 0,
    -- Capacity is held from checkout until this instant (CH-02 overfunding rules).
    "reserved_until" TIMESTAMPTZ(3),
    "confirmed_at" TIMESTAMPTZ(3),
    -- Never real money in this build. Kept on the row so a receipt cannot lose the context.
    "simulated" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "contributions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contributions_amount_positive" CHECK ("amount_minor" > 0),
    CONSTRAINT "contributions_fee_non_negative" CHECK ("fee_minor" >= 0),
    -- A refund can never exceed what was received (08).
    CONSTRAINT "contributions_refund_within_amount" CHECK ("refunded_minor" >= 0 AND "refunded_minor" <= "amount_minor"),
    CONSTRAINT "contributions_confirmed_matches_state" CHECK (
      ("confirmed_at" IS NOT NULL) = ("state" IN ('succeeded', 'refunded', 'partially_refunded'))
    )
);
CREATE INDEX "contributions_project_state_idx" ON "contributions"("project_id", "state", "created_at");
CREATE INDEX "contributions_payer_idx" ON "contributions"("payer_party_id", "created_at");
-- Capacity reservations are counted by this index.
CREATE INDEX "contributions_pool_reservation_idx" ON "contributions"("pool_id", "state", "reserved_until");

CREATE TABLE "payment_intents" (
    "id" UUID NOT NULL,
    "contribution_id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "provider_reference" VARCHAR(120) NOT NULL,
    "state" "PaymentIntentState" NOT NULL DEFAULT 'created',
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    -- Monotonic guard against out-of-order provider events (FIN-02).
    "last_event_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_intents_amount_positive" CHECK ("amount_minor" > 0)
);
CREATE UNIQUE INDEX "payment_intents_contribution_key" ON "payment_intents"("contribution_id");
CREATE UNIQUE INDEX "payment_intents_provider_reference_key" ON "payment_intents"("provider", "provider_reference");

CREATE TABLE "settlements" (
    "id" UUID NOT NULL,
    "payment_intent_id" UUID NOT NULL,
    "state" "SettlementState" NOT NULL DEFAULT 'pending',
    "gross_minor" BIGINT NOT NULL,
    "fee_minor" BIGINT NOT NULL,
    "net_minor" BIGINT NOT NULL,
    "settled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "settlements_amounts_consistent" CHECK ("gross_minor" > 0 AND "fee_minor" >= 0 AND "net_minor" = "gross_minor" - "fee_minor")
);
CREATE UNIQUE INDEX "settlements_intent_key" ON "settlements"("payment_intent_id");

-- 08 webhook protocol step 2: a durable inbox keyed by the provider's own event id, so a replay is
-- acknowledged without being processed twice.
CREATE TABLE "webhook_inbox" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "event_id" VARCHAR(120) NOT NULL,
    "event_type" VARCHAR(60) NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "outcome" VARCHAR(40),
    CONSTRAINT "webhook_inbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "webhook_inbox_provider_event_key" ON "webhook_inbox"("provider", "event_id");

-- Delivery of receipts and notifications is decoupled from the money transaction (08 step 6):
-- a failed email must never undo a confirmed payment.
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "topic" VARCHAR(60) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "outbox_events_status_next_idx" ON "outbox_events"("status", "next_attempt_at");

-- 11-API-CONTRACTS: the same key with the same body returns the same result; a different body is a
-- conflict. This is what makes a retried checkout safe.
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "route" VARCHAR(120) NOT NULL,
    "idempotency_key" VARCHAR(120) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "idempotency_actor_route_key" ON "idempotency_records"("actor_id", "route", "idempotency_key");

ALTER TABLE "funding_pools" ADD CONSTRAINT "funding_pools_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_pool_id_fkey"
  FOREIGN KEY ("pool_id") REFERENCES "funding_pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_pool_id_fkey"
  FOREIGN KEY ("pool_id") REFERENCES "funding_pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_reversal_of_fkey"
  FOREIGN KEY ("reversal_of") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_fkey"
  FOREIGN KEY ("transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_pool_id_fkey"
  FOREIGN KEY ("pool_id") REFERENCES "funding_pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_payer_party_id_fkey"
  FOREIGN KEY ("payer_party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_contribution_id_fkey"
  FOREIGN KEY ("contribution_id") REFERENCES "contributions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_payment_intent_id_fkey"
  FOREIGN KEY ("payment_intent_id") REFERENCES "payment_intents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The ledger is append-only. A mistake is corrected by a reversing transaction that points at the
-- original, so the history of what was believed and when survives.
CREATE FUNCTION prevent_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'the ledger is append-only; post a reversing transaction instead' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
CREATE TRIGGER ledger_transactions_immutable BEFORE UPDATE OR DELETE ON "ledger_transactions"
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

-- Every transaction balances, checked at COMMIT so the entries of one transaction can be inserted
-- in any order inside it (09-DATA-MODEL allows a service or a constraint trigger; this is both).
CREATE FUNCTION require_balanced_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  debits BIGINT;
  credits BIGINT;
  entry_count INTEGER;
  mixed_currency INTEGER;
BEGIN
  SELECT COALESCE(SUM(e."debit_minor"), 0), COALESCE(SUM(e."credit_minor"), 0), COUNT(*)
    INTO debits, credits, entry_count
    FROM "ledger_entries" e WHERE e."transaction_id" = NEW."transaction_id";

  -- The transaction may have been rolled back inside the same statement; nothing to check.
  IF entry_count = 0 THEN RETURN NULL; END IF;

  IF debits <> credits THEN
    RAISE EXCEPTION 'ledger transaction % does not balance: debits % credits %', NEW."transaction_id", debits, credits USING ERRCODE = '23514';
  END IF;

  -- One currency per transaction: amounts in different currencies are never added (08).
  SELECT COUNT(DISTINCT a."currency") INTO mixed_currency
    FROM "ledger_entries" e JOIN "ledger_accounts" a ON a."id" = e."account_id"
    WHERE e."transaction_id" = NEW."transaction_id";
  IF mixed_currency > 1 THEN
    RAISE EXCEPTION 'a ledger transaction cannot mix currencies' USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER ledger_entries_balanced AFTER INSERT ON "ledger_entries"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_balanced_transaction();

-- An account belongs to exactly one pool and must share its currency.
CREATE FUNCTION require_account_currency_match() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pool_currency CHAR(3);
BEGIN
  SELECT "currency" INTO pool_currency FROM "funding_pools" WHERE "id" = NEW."pool_id";
  IF pool_currency IS DISTINCT FROM NEW."currency" THEN
    RAISE EXCEPTION 'a ledger account must use its pool currency' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ledger_accounts_currency_matches BEFORE INSERT OR UPDATE ON "ledger_accounts"
  FOR EACH ROW EXECUTE FUNCTION require_account_currency_match();

-- The webhook inbox is evidence of what the provider sent. The payload is never rewritten; only
-- the processing outcome is recorded.
CREATE FUNCTION prevent_webhook_payload_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'webhook inbox records are append-only' USING ERRCODE = '23514';
  END IF;
  IF OLD."payload" IS DISTINCT FROM NEW."payload" OR OLD."event_id" IS DISTINCT FROM NEW."event_id" OR OLD."provider" IS DISTINCT FROM NEW."provider" THEN
    RAISE EXCEPTION 'a received webhook payload cannot be rewritten' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER webhook_inbox_payload_immutable BEFORE UPDATE OR DELETE ON "webhook_inbox"
  FOR EACH ROW EXECUTE FUNCTION prevent_webhook_payload_mutation();

INSERT INTO "runtime_metadata" ("key", "value") VALUES ('money_ledger_version', '1')
  ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = CURRENT_TIMESTAMP;

COMMIT;
