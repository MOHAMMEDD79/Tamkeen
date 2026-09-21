BEGIN;

ALTER TABLE "organization_verification_documents"
    ALTER COLUMN "checksum" DROP NOT NULL,
    ADD COLUMN "content_type" VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream',
    ADD COLUMN "expected_size" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "actual_size" INTEGER,
    ADD COLUMN "upload_token_hash" CHAR(64),
    ADD COLUMN "upload_expires_at" TIMESTAMPTZ(3),
    ADD COLUMN "scan_reason" VARCHAR(64),
    ADD COLUMN "finalized_at" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "organization_verification_documents_upload_token_hash_key"
    ON "organization_verification_documents"("upload_token_hash");

ALTER TABLE "organization_verification_documents"
    ADD CONSTRAINT "organization_verification_documents_content_type"
      CHECK ("content_type" IN ('application/octet-stream', 'application/pdf', 'image/png', 'image/jpeg')),
    ADD CONSTRAINT "organization_verification_documents_sizes"
      CHECK ("expected_size" BETWEEN 0 AND 20971520 AND ("actual_size" IS NULL OR "actual_size" BETWEEN 0 AND 20971520)),
    ADD CONSTRAINT "organization_verification_documents_upload_token_sha256"
      CHECK ("upload_token_hash" IS NULL OR "upload_token_hash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "organization_verification_documents_clean_complete"
      CHECK ("scan_state" <> 'clean' OR ("checksum" IS NOT NULL AND "actual_size" = "expected_size" AND "finalized_at" IS NOT NULL AND "upload_token_hash" IS NULL)),
    ADD CONSTRAINT "organization_verification_documents_rejected_complete"
      CHECK ("scan_state" <> 'rejected' OR ("scan_reason" IS NOT NULL AND "actual_size" = "expected_size" AND "finalized_at" IS NOT NULL AND "upload_token_hash" IS NULL));

COMMIT;
