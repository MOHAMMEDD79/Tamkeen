CREATE TYPE "ExportJobState" AS ENUM ('pending', 'processing', 'ready', 'failed', 'expired', 'revoked');
CREATE TABLE "export_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "owner_id" UUID NOT NULL, "kind" VARCHAR(50) NOT NULL,
  "scope" JSONB NOT NULL, "reason" VARCHAR(1000) NOT NULL DEFAULT '', "state" "ExportJobState" NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0, "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "filename" VARCHAR(180) NOT NULL DEFAULT '', "mime_type" VARCHAR(100) NOT NULL DEFAULT 'text/csv; charset=utf-8',
  "content" TEXT NOT NULL DEFAULT '', "last_error_code" VARCHAR(80) NOT NULL DEFAULT '', "expires_at" TIMESTAMPTZ(3),
  "revoked_at" TIMESTAMPTZ(3), "version" INTEGER NOT NULL DEFAULT 1, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "export_jobs_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "export_jobs_state_next_attempt_at_idx" ON "export_jobs"("state", "next_attempt_at");
CREATE INDEX "export_jobs_owner_id_created_at_idx" ON "export_jobs"("owner_id", "created_at");
CREATE TABLE "public_reports" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "title" VARCHAR(200) NOT NULL, "source_type" VARCHAR(40) NOT NULL,
  "source_id" UUID NOT NULL, "version" INTEGER NOT NULL, "snapshot" JSONB NOT NULL, "currency" CHAR(3),
  "period_start" DATE, "period_end" DATE, "filter_definition" VARCHAR(1000) NOT NULL DEFAULT '',
  "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_by" UUID NOT NULL,
  CONSTRAINT "public_reports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "public_reports_creator_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "public_reports_period_check" CHECK ("period_start" IS NULL OR "period_end" IS NULL OR "period_end" >= "period_start")
);
CREATE UNIQUE INDEX "public_reports_source_type_source_id_version_key" ON "public_reports"("source_type", "source_id", "version");
CREATE INDEX "public_reports_published_at_idx" ON "public_reports"("published_at");
