BEGIN;

ALTER TABLE "organizations" ADD COLUMN     "contact_address" VARCHAR(300),
ADD COLUMN     "contact_email" VARCHAR(254),
ADD COLUMN     "public_description" VARCHAR(1200) NOT NULL DEFAULT '',
ADD COLUMN     "sectors" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "slug" VARCHAR(90),
ADD COLUMN     "website_url" VARCHAR(500);

UPDATE "organizations" SET "slug" = 'organization-' || replace("id"::text, '-', '');
ALTER TABLE "organizations" ALTER COLUMN "slug" SET NOT NULL;
ALTER TABLE "organizations" ALTER COLUMN "sectors" SET NOT NULL;

CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

ALTER TABLE "organizations" ADD CONSTRAINT "organizations_slug_normalized"
CHECK ("slug" = lower(btrim("slug")) AND "slug" !~ '[[:space:]/?#%]');
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_contact_email_normalized"
CHECK ("contact_email" IS NULL OR "contact_email" = lower(btrim("contact_email")));
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_sector_count"
CHECK (cardinality("sectors") <= 10);

COMMIT;
