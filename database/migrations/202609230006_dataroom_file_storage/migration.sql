ALTER TABLE "data_room_documents"
  ADD COLUMN "upload_token_hash" CHAR(64),
  ADD COLUMN "upload_expires_at" TIMESTAMPTZ(3),
  ADD COLUMN "actual_size" INTEGER,
  ADD COLUMN "scan_reason" VARCHAR(100) NOT NULL DEFAULT '',
  ADD COLUMN "finalized_at" TIMESTAMPTZ(3);
