BEGIN;

CREATE TABLE "organization_logo_assets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "organization_version" INTEGER NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "expected_size" INTEGER NOT NULL,
    "actual_size" INTEGER,
    "checksum" CHAR(64),
    "upload_token_hash" CHAR(64),
    "upload_expires_at" TIMESTAMPTZ(3),
    "scan_state" "VerificationDocumentState" NOT NULL DEFAULT 'pending_scan',
    "scan_reason" VARCHAR(64),
    "finalized_at" TIMESTAMPTZ(3),
    "classification" VARCHAR(32) NOT NULL DEFAULT 'Public',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organization_logo_assets_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "organizations" ADD COLUMN "current_logo_id" UUID;

CREATE UNIQUE INDEX "organization_logo_assets_storage_key_key" ON "organization_logo_assets"("storage_key");
CREATE UNIQUE INDEX "organization_logo_assets_upload_token_hash_key" ON "organization_logo_assets"("upload_token_hash");
CREATE INDEX "organization_logo_assets_organization_id_scan_state_idx" ON "organization_logo_assets"("organization_id", "scan_state");
CREATE UNIQUE INDEX "organizations_current_logo_id_key" ON "organizations"("current_logo_id");

ALTER TABLE "organization_logo_assets"
    ADD CONSTRAINT "organization_logo_assets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "organization_logo_assets_version_positive" CHECK ("organization_version" > 0),
    ADD CONSTRAINT "organization_logo_assets_content_type" CHECK ("content_type" IN ('image/png', 'image/jpeg')),
    ADD CONSTRAINT "organization_logo_assets_sizes" CHECK ("expected_size" BETWEEN 24 AND 10485760 AND ("actual_size" IS NULL OR "actual_size" BETWEEN 24 AND 10485760)),
    ADD CONSTRAINT "organization_logo_assets_checksum_sha256" CHECK ("checksum" IS NULL OR "checksum" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "organization_logo_assets_upload_token_sha256" CHECK ("upload_token_hash" IS NULL OR "upload_token_hash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "organization_logo_assets_classification" CHECK ("classification" = 'Public'),
    ADD CONSTRAINT "organization_logo_assets_clean_complete" CHECK ("scan_state" <> 'clean' OR ("checksum" IS NOT NULL AND "actual_size" = "expected_size" AND "finalized_at" IS NOT NULL AND "upload_token_hash" IS NULL)),
    ADD CONSTRAINT "organization_logo_assets_rejected_complete" CHECK ("scan_state" <> 'rejected' OR ("scan_reason" IS NOT NULL AND "actual_size" = "expected_size" AND "finalized_at" IS NOT NULL AND "upload_token_hash" IS NULL));

ALTER TABLE "organizations"
    ADD CONSTRAINT "organizations_current_logo_id_fkey" FOREIGN KEY ("current_logo_id") REFERENCES "organization_logo_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
