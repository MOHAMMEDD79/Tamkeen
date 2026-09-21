BEGIN;

CREATE TYPE "OwnershipTransferState" AS ENUM ('pending', 'accepted', 'expired');

CREATE TABLE "organization_ownership_transfers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "organization_version" INTEGER NOT NULL,
    "current_owner_id" UUID NOT NULL,
    "new_owner_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "state" "OwnershipTransferState" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organization_ownership_transfers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_ownership_transfers_token_hash_key" ON "organization_ownership_transfers"("token_hash");
CREATE UNIQUE INDEX "organization_ownership_transfers_one_pending" ON "organization_ownership_transfers"("organization_id") WHERE "state" = 'pending';
CREATE INDEX "organization_ownership_transfers_organization_id_state_expires_at_idx" ON "organization_ownership_transfers"("organization_id", "state", "expires_at");
CREATE INDEX "organization_ownership_transfers_new_owner_id_state_expires_at_idx" ON "organization_ownership_transfers"("new_owner_id", "state", "expires_at");

ALTER TABLE "organization_ownership_transfers"
    ADD CONSTRAINT "organization_ownership_transfers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "organization_ownership_transfers_current_owner_id_fkey" FOREIGN KEY ("current_owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "organization_ownership_transfers_new_owner_id_fkey" FOREIGN KEY ("new_owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "ownership_transfer_distinct_users" CHECK ("current_owner_id" <> "new_owner_id"),
    ADD CONSTRAINT "ownership_transfer_version" CHECK ("organization_version" > 0),
    ADD CONSTRAINT "ownership_transfer_state_timestamp" CHECK (("state" = 'accepted') = ("accepted_at" IS NOT NULL));

COMMIT;
