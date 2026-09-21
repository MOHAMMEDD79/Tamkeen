BEGIN;

CREATE TYPE "BankChangeRequestState" AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE "organization_bank_change_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "organization_version" INTEGER NOT NULL,
    "requested_by" UUID NOT NULL,
    "bank_name" VARCHAR(140) NOT NULL,
    "account_holder" VARCHAR(200) NOT NULL,
    "account_identifier_ciphertext" TEXT NOT NULL,
    "account_identifier_hash" CHAR(64) NOT NULL,
    "account_last4" VARCHAR(4) NOT NULL,
    "country" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "state" "BankChangeRequestState" NOT NULL DEFAULT 'pending',
    "version" INTEGER NOT NULL DEFAULT 1,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_reason" VARCHAR(1000) NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organization_bank_change_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "organization_bank_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "source_request_id" UUID NOT NULL,
    "bank_name" VARCHAR(140) NOT NULL,
    "account_holder" VARCHAR(200) NOT NULL,
    "account_identifier_ciphertext" TEXT NOT NULL,
    "account_identifier_hash" CHAR(64) NOT NULL,
    "account_last4" VARCHAR(4) NOT NULL,
    "country" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "organization_bank_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_bank_change_requests_one_pending" ON "organization_bank_change_requests"("organization_id") WHERE "state" = 'pending';
CREATE INDEX "organization_bank_change_requests_organization_id_state_created_at_idx" ON "organization_bank_change_requests"("organization_id", "state", "created_at");
CREATE INDEX "organization_bank_change_requests_state_created_at_idx" ON "organization_bank_change_requests"("state", "created_at");
CREATE UNIQUE INDEX "organization_bank_accounts_organization_id_key" ON "organization_bank_accounts"("organization_id");
CREATE UNIQUE INDEX "organization_bank_accounts_source_request_id_key" ON "organization_bank_accounts"("source_request_id");

ALTER TABLE "organization_bank_change_requests"
    ADD CONSTRAINT "organization_bank_change_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "organization_bank_change_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "organization_bank_change_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "bank_change_organization_version" CHECK ("organization_version" > 0),
    ADD CONSTRAINT "bank_change_version" CHECK ("version" > 0),
    ADD CONSTRAINT "bank_change_last4" CHECK ("account_last4" ~ '^[A-Z0-9]{4}$'),
    ADD CONSTRAINT "bank_change_review_state" CHECK (
      ("state" = 'pending' AND "reviewed_by" IS NULL AND "reviewed_at" IS NULL) OR
      ("state" = 'approved' AND "reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL) OR
      ("state" = 'rejected' AND "reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL AND length("review_reason") >= 10)
    );

ALTER TABLE "organization_bank_accounts"
    ADD CONSTRAINT "organization_bank_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "organization_bank_accounts_source_request_id_fkey" FOREIGN KEY ("source_request_id") REFERENCES "organization_bank_change_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "organization_bank_account_last4" CHECK ("account_last4" ~ '^[A-Z0-9]{4}$');

COMMIT;
