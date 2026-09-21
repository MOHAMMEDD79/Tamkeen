BEGIN;

-- CreateEnum
CREATE TYPE "VerificationDocumentState" AS ENUM ('pending_scan', 'clean', 'rejected');

-- CreateEnum
CREATE TYPE "VerificationDecisionOutcome" AS ENUM ('changes_requested', 'verified', 'rejected');

-- CreateTable
CREATE TABLE "organization_verification_cases" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "registration_number" VARCHAR(100) NOT NULL DEFAULT '',
    "issuing_authority" VARCHAR(200) NOT NULL DEFAULT '',
    "registered_address" VARCHAR(300) NOT NULL DEFAULT '',
    "document_expires_at" DATE,
    "state" "VerificationState" NOT NULL DEFAULT 'not_started',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organization_verification_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_verification_documents" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "checksum" CHAR(64) NOT NULL,
    "scan_state" "VerificationDocumentState" NOT NULL DEFAULT 'pending_scan',
    "classification" VARCHAR(32) NOT NULL DEFAULT 'HighlySensitive',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_verification_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_verification_submissions" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "previous_submission_id" UUID,
    "submitted_by" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_verification_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_verification_decisions" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "outcome" "VerificationDecisionOutcome" NOT NULL,
    "public_reason" VARCHAR(1000) NOT NULL DEFAULT '',
    "reviewer_id" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_verification_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_verification_cases_organization_id_key" ON "organization_verification_cases"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_verification_documents_storage_key_key" ON "organization_verification_documents"("storage_key");

-- CreateIndex
CREATE INDEX "organization_verification_documents_case_id_scan_state_idx" ON "organization_verification_documents"("case_id", "scan_state");

-- CreateIndex
CREATE UNIQUE INDEX "organization_verification_submissions_previous_submission_i_key" ON "organization_verification_submissions"("previous_submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_verification_submissions_case_id_sequence_key" ON "organization_verification_submissions"("case_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "organization_verification_decisions_submission_id_key" ON "organization_verification_decisions"("submission_id");

-- AddForeignKey
ALTER TABLE "organization_verification_cases" ADD CONSTRAINT "organization_verification_cases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_verification_documents" ADD CONSTRAINT "organization_verification_documents_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "organization_verification_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_verification_submissions" ADD CONSTRAINT "organization_verification_submissions_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "organization_verification_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_verification_submissions" ADD CONSTRAINT "organization_verification_submissions_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_verification_submissions" ADD CONSTRAINT "organization_verification_submissions_previous_submission__fkey" FOREIGN KEY ("previous_submission_id") REFERENCES "organization_verification_submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_verification_decisions" ADD CONSTRAINT "organization_verification_decisions_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "organization_verification_submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_verification_decisions" ADD CONSTRAINT "organization_verification_decisions_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Draft versions and immutable submission sequences are strictly positive.
ALTER TABLE "organization_verification_cases"
    ADD CONSTRAINT "organization_verification_cases_version_positive" CHECK ("version" > 0);

ALTER TABLE "organization_verification_submissions"
    ADD CONSTRAINT "organization_verification_submissions_sequence_positive" CHECK ("sequence" > 0);

-- Verification evidence always remains highly sensitive and content-addressed.
ALTER TABLE "organization_verification_documents"
    ADD CONSTRAINT "organization_verification_documents_checksum_sha256" CHECK ("checksum" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "organization_verification_documents_classification" CHECK ("classification" = 'HighlySensitive');

-- Submitted snapshots and review decisions form an append-only evidence trail.
CREATE FUNCTION prevent_organization_verification_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'organization verification evidence is append-only' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "organization_verification_submissions_append_only"
BEFORE UPDATE OR DELETE ON "organization_verification_submissions"
FOR EACH ROW EXECUTE FUNCTION prevent_organization_verification_evidence_mutation();

CREATE TRIGGER "organization_verification_decisions_append_only"
BEFORE UPDATE OR DELETE ON "organization_verification_decisions"
FOR EACH ROW EXECUTE FUNCTION prevent_organization_verification_evidence_mutation();

COMMIT;
