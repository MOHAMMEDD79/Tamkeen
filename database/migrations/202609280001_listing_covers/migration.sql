-- Admin-set cover photos for investment offerings, training programmes and jobs (projects keep
-- their own project_covers table). One photo per listing; removing the row returns the listing to
-- its default topic photo.
BEGIN;

CREATE TABLE "listing_covers" (
    "kind" VARCHAR(16) NOT NULL,
    "subject_id" UUID NOT NULL,
    "image_key" VARCHAR(120) NOT NULL,
    "content_type" VARCHAR(40) NOT NULL,
    "checksum" CHAR(64) NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "listing_covers_pkey" PRIMARY KEY ("kind", "subject_id"),
    CONSTRAINT "listing_covers_kind" CHECK ("kind" IN ('offering', 'program', 'job')),
    CONSTRAINT "listing_covers_image_key" CHECK ("image_key" ~ '^site/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.bin$'),
    CONSTRAINT "listing_covers_content_type" CHECK ("content_type" IN ('image/png', 'image/jpeg', 'image/webp')),
    CONSTRAINT "listing_covers_checksum_sha256" CHECK ("checksum" ~ '^[0-9a-f]{64}$')
);

COMMIT;
