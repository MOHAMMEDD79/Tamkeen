BEGIN;

-- Consent evidence is immutable registration metadata in the current slice.
ALTER TABLE "users" ADD COLUMN     "terms_accepted_at" TIMESTAMPTZ(3) NOT NULL,
ADD COLUMN     "terms_version" VARCHAR(50) NOT NULL;

ALTER TABLE "users" ADD CONSTRAINT "users_terms_version_not_blank"
CHECK (length(btrim("terms_version")) > 0);

COMMIT;
