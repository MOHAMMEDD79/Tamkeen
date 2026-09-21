BEGIN;

ALTER TABLE "users" ADD COLUMN "platform_access_version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "platform_access_invitations" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "roles" "PlatformRole"[] NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "grant_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_access_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_access_invitations_token_hash_key" ON "platform_access_invitations"("token_hash");
CREATE INDEX "platform_access_invitations_email_consumed_at_revoked_at_idx" ON "platform_access_invitations"("email", "consumed_at", "revoked_at");

ALTER TABLE "platform_access_invitations"
    ADD CONSTRAINT "platform_access_invitations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "platform_invitation_email_normalized" CHECK ("email" = lower(btrim("email"))),
    ADD CONSTRAINT "platform_invitation_roles" CHECK (cardinality("roles") > 0),
    ADD CONSTRAINT "platform_invitation_terminal" CHECK (num_nonnulls("consumed_at", "revoked_at") <= 1),
    ADD CONSTRAINT "platform_invitation_expiry" CHECK ("grant_expires_at" > "expires_at");

ALTER TABLE "users" ADD CONSTRAINT "users_platform_access_version" CHECK ("platform_access_version" > 0);

COMMIT;
