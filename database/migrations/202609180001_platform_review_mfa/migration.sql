BEGIN;

CREATE TYPE "PlatformRole" AS ENUM ('Support', 'VerificationReviewer', 'ContentReviewer', 'FinanceOperator', 'RiskReviewer', 'PlatformAdmin', 'Auditor');
CREATE TYPE "MfaChallengeState" AS ENUM ('pending', 'verified', 'consumed', 'cancelled');

ALTER TABLE "users" ADD COLUMN "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "organization_verification_cases"
    ADD COLUMN "assigned_reviewer_id" UUID,
    ADD COLUMN "claimed_at" TIMESTAMPTZ(3);

CREATE TABLE "two_factors" (
    "id" UUID NOT NULL,
    "secret" TEXT NOT NULL,
    "backup_codes" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT true,
    "failed_verification_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    CONSTRAINT "two_factors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "platform_grants" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "PlatformRole" NOT NULL,
    "granted_by" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_grants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mfa_challenges" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "operation" VARCHAR(64) NOT NULL,
    "resource_id" UUID NOT NULL,
    "resource_version" INTEGER NOT NULL,
    "state" "MfaChallengeState" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "verified_at" TIMESTAMPTZ(3),
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mfa_challenges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "two_factors_user_id_key" ON "two_factors"("user_id");
CREATE INDEX "two_factors_secret_idx" ON "two_factors"("secret");
CREATE INDEX "platform_grants_user_id_role_revoked_at_expires_at_idx" ON "platform_grants"("user_id", "role", "revoked_at", "expires_at");
CREATE UNIQUE INDEX "platform_grants_one_unrevoked_role" ON "platform_grants"("user_id", "role") WHERE "revoked_at" IS NULL;
CREATE INDEX "mfa_challenges_user_id_session_id_state_expires_at_idx" ON "mfa_challenges"("user_id", "session_id", "state", "expires_at");

ALTER TABLE "two_factors"
    ADD CONSTRAINT "two_factors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "two_factors_failed_count" CHECK ("failed_verification_count" BETWEEN 0 AND 20);

ALTER TABLE "platform_grants"
    ADD CONSTRAINT "platform_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "platform_grants_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mfa_challenges"
    ADD CONSTRAINT "mfa_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "mfa_challenges_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "mfa_challenges_attempts" CHECK ("attempts" BETWEEN 0 AND 5),
    ADD CONSTRAINT "mfa_challenges_resource_version" CHECK ("resource_version" > 0),
    ADD CONSTRAINT "mfa_challenges_state_timestamps" CHECK (
      ("state" = 'pending' AND "verified_at" IS NULL AND "consumed_at" IS NULL) OR
      ("state" = 'verified' AND "verified_at" IS NOT NULL AND "consumed_at" IS NULL) OR
      ("state" = 'consumed' AND "verified_at" IS NOT NULL AND "consumed_at" IS NOT NULL) OR
      ("state" = 'cancelled' AND "consumed_at" IS NULL)
    );

ALTER TABLE "organization_verification_cases"
    ADD CONSTRAINT "organization_verification_cases_assigned_reviewer_id_fkey" FOREIGN KEY ("assigned_reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "organization_verification_cases_claim_pair" CHECK (("assigned_reviewer_id" IS NULL) = ("claimed_at" IS NULL));

COMMIT;
