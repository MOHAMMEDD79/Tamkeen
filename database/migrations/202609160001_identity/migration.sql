BEGIN;

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'suspended', 'closed');

-- CreateEnum
CREATE TYPE "IndividualCapability" AS ENUM ('Donor', 'Beneficiary', 'JobSeeker', 'Investor', 'Volunteer');

-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('NGO', 'Company', 'Startup', 'Foundation', 'Institution');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('active', 'suspended', 'closed');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('Owner', 'OrgAdmin', 'ProjectManager', 'FinanceMaker', 'FinanceApprover', 'Recruiter', 'ProgramManager', 'Trainer', 'InvestmentManager', 'Analyst', 'Viewer');

-- CreateEnum
CREATE TYPE "VerificationState" AS ENUM ('not_started', 'submitted', 'in_review', 'changes_requested', 'verified', 'rejected', 'expired');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "individual_profiles" (
    "user_id" UUID NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "locale" VARCHAR(5) NOT NULL DEFAULT 'ar',
    "city" VARCHAR(100),
    "capabilities" "IndividualCapability"[] DEFAULT ARRAY[]::"IndividualCapability"[],
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "individual_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "legal_name" VARCHAR(200) NOT NULL,
    "display_name" VARCHAR(140) NOT NULL,
    "type" "OrganizationType" NOT NULL,
    "country" CHAR(2) NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'active',
    "verification" "VerificationState" NOT NULL DEFAULT 'not_started',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parties" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "organization_id" UUID,

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'active',
    "roles" "MembershipRole"[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "roles" "MembershipRole"[],
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_audit_events" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "organization_id" UUID,
    "action" VARCHAR(64) NOT NULL,
    "resource_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "parties_user_id_key" ON "parties"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "parties_organization_id_key" ON "parties"("organization_id");

-- CreateIndex
CREATE INDEX "memberships_organization_id_status_idx" ON "memberships"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_user_id_organization_id_key" ON "memberships"("user_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_organization_id_email_idx" ON "invitations"("organization_id", "email");

-- CreateIndex
CREATE INDEX "identity_audit_events_organization_id_created_at_idx" ON "identity_audit_events"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "individual_profiles" ADD CONSTRAINT "individual_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parties" ADD CONSTRAINT "parties_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parties" ADD CONSTRAINT "parties_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invariants that Prisma's schema language cannot express.
ALTER TABLE "parties" ADD CONSTRAINT "party_exactly_one_subject"
  CHECK (num_nonnulls(user_id, organization_id) = 1);
ALTER TABLE "users" ADD CONSTRAINT "users_email_normalized"
  CHECK (email = lower(btrim(email)) AND length(email) > 3);
ALTER TABLE "individual_profiles" ALTER COLUMN "capabilities" SET NOT NULL;
ALTER TABLE "memberships" ALTER COLUMN "roles" SET NOT NULL;
ALTER TABLE "invitations" ALTER COLUMN "roles" SET NOT NULL;
ALTER TABLE "memberships" ADD CONSTRAINT "membership_has_roles" CHECK (cardinality(roles) > 0);
ALTER TABLE "invitations" ADD CONSTRAINT "invitation_no_owner" CHECK (cardinality(roles) > 0 AND NOT ('Owner' = ANY(roles)));
ALTER TABLE "invitations" ADD CONSTRAINT "invitation_email_normalized" CHECK (email = lower(btrim(email)));
ALTER TABLE "individual_profiles" ADD CONSTRAINT "profile_locale" CHECK (locale IN ('ar', 'en'));

-- Initialization is in the same transaction as identity creation, including future auth-library inserts.
CREATE FUNCTION initialize_individual() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO individual_profiles (user_id, display_name) VALUES (NEW.id, NEW.name);
  INSERT INTO parties (id, user_id) VALUES (gen_random_uuid(), NEW.id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER initialize_individual_after_insert AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION initialize_individual();

-- Re-evaluate at commit so a future ownership transfer can be atomic.
CREATE FUNCTION require_organization_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target UUID;
BEGIN
  IF TG_TABLE_NAME = 'organizations' THEN
    target := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    target := OLD.organization_id;
  ELSE
    target := NEW.organization_id;
  END IF;
  IF EXISTS (SELECT 1 FROM organizations WHERE id = target AND status = 'active')
     AND NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = target AND status = 'active' AND 'Owner' = ANY(roles)) THEN
    RAISE EXCEPTION 'active organization requires an owner' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER organization_requires_owner AFTER INSERT OR UPDATE ON organizations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_organization_owner();
CREATE CONSTRAINT TRIGGER membership_preserves_owner AFTER INSERT OR UPDATE OR DELETE ON memberships
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_organization_owner();

CREATE FUNCTION prevent_identity_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'identity audit is append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER identity_audit_immutable BEFORE UPDATE OR DELETE ON identity_audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_identity_audit_mutation();

CREATE FUNCTION prevent_membership_reparenting() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id <> OLD.organization_id OR NEW.user_id <> OLD.user_id THEN
    RAISE EXCEPTION 'membership subject is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER membership_subject_immutable BEFORE UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION prevent_membership_reparenting();

COMMIT;
