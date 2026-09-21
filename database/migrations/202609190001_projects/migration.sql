BEGIN;

-- PART-04: Project is the joining entity across all three tracks (01-PRODUCT-SCOPE). Its type is
-- fixed and its public projection is deliberately narrower than its record.

CREATE TYPE "ProjectType" AS ENUM ('charity', 'venture', 'enablement');

-- 05-CHARITY-LIFECYCLE state machine. The later financial states exist in the enum so a project
-- cannot be re-typed mid-flight, but only the pre-publication transitions are reachable in PART-04.
CREATE TYPE "ProjectState" AS ENUM (
  'draft', 'submitted', 'in_review', 'changes_requested', 'approved', 'published',
  'funding_closed', 'executing', 'impact_review', 'completed', 'archived',
  'paused', 'cancelled', 'rejected'
);

-- How precisely a project may be located publicly. 12-SECURITY forbids publishing a beneficiary's
-- address, so `exact` is reserved for a public facility and is never derived from a private record.
CREATE TYPE "LocationPrecision" AS ENUM ('city', 'approximate', 'exact');

CREATE TABLE "cities" (
    "id" UUID NOT NULL,
    "country" CHAR(2) NOT NULL,
    "name_ar" VARCHAR(100) NOT NULL,
    "name_en" VARCHAR(100) NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "cities_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cities_latitude_range" CHECK ("latitude" >= -90 AND "latitude" <= 90),
    CONSTRAINT "cities_longitude_range" CHECK ("longitude" >= -180 AND "longitude" <= 180)
);
CREATE UNIQUE INDEX "cities_country_name_en_key" ON "cities"("country", "name_en");

CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" "ProjectType" NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "title" VARCHAR(140) NOT NULL,
    "summary" VARCHAR(300) NOT NULL DEFAULT '',
    "story" TEXT NOT NULL DEFAULT '',
    "state" "ProjectState" NOT NULL DEFAULT 'draft',
    "manager_id" UUID NOT NULL,
    "city_id" UUID NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "public_location_precision" "LocationPrecision" NOT NULL DEFAULT 'city',
    "published_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "projects_pkey" PRIMARY KEY ("id"),
    -- 21-FORMS-VALIDATION: title 5-140, summary 30-300 once it carries content.
    CONSTRAINT "projects_title_length" CHECK (char_length("title") BETWEEN 5 AND 140),
    CONSTRAINT "projects_summary_length" CHECK (char_length("summary") <= 300),
    CONSTRAINT "projects_latitude_range" CHECK ("latitude" IS NULL OR ("latitude" >= -90 AND "latitude" <= 90)),
    CONSTRAINT "projects_longitude_range" CHECK ("longitude" IS NULL OR ("longitude" >= -180 AND "longitude" <= 180)),
    -- A published project must have been published at a known time; a draft must not claim one.
    CONSTRAINT "projects_published_at_matches_state" CHECK (
      ("published_at" IS NOT NULL) = ("state" IN ('published', 'funding_closed', 'executing', 'impact_review', 'completed', 'archived', 'paused'))
    )
);
CREATE UNIQUE INDEX "projects_slug_key" ON "projects"("slug");
CREATE INDEX "projects_organization_state_created_idx" ON "projects"("organization_id", "state", "created_at");
-- The public index: published projects by track and city, which is what /explore and /map read.
CREATE INDEX "projects_public_browse_idx" ON "projects"("state", "type", "city_id", "published_at");

CREATE TABLE "project_versions" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "previous_version_id" UUID,
    "snapshot" JSONB NOT NULL,
    "submitted_by" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "project_versions_project_sequence_key" ON "project_versions"("project_id", "sequence");
CREATE UNIQUE INDEX "project_versions_previous_version_id_key" ON "project_versions"("previous_version_id");

CREATE TABLE "bookmarks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bookmarks_pkey" PRIMARY KEY ("id")
);
-- One bookmark per person per project: saving twice is idempotent, not a duplicate row.
CREATE UNIQUE INDEX "bookmarks_user_project_key" ON "bookmarks"("user_id", "project_id");

ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_manager_id_fkey"
  FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_city_id_fkey"
  FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_versions" ADD CONSTRAINT "project_versions_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_versions" ADD CONSTRAINT "project_versions_previous_version_id_fkey"
  FOREIGN KEY ("previous_version_id") REFERENCES "project_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_versions" ADD CONSTRAINT "project_versions_submitted_by_fkey"
  FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 01-PRODUCT-SCOPE: a project's type is fixed once it is published. Changing the funding model
-- means creating a linked project, not rewriting the history of this one. Enforced in SQL because
-- the rule protects the meaning of every downstream financial record.
CREATE FUNCTION prevent_published_project_retype() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."type" <> NEW."type" AND OLD."published_at" IS NOT NULL THEN
    RAISE EXCEPTION 'a published project cannot change type' USING ERRCODE = '23514';
  END IF;
  IF OLD."organization_id" <> NEW."organization_id" THEN
    RAISE EXCEPTION 'a project cannot move between organizations' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER projects_type_is_fixed BEFORE UPDATE ON "projects"
  FOR EACH ROW EXECUTE FUNCTION prevent_published_project_retype();

-- A submitted snapshot is evidence of what a reviewer saw; it is never edited or deleted.
CREATE FUNCTION prevent_project_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'project versions are append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER project_versions_immutable BEFORE UPDATE OR DELETE ON "project_versions"
  FOR EACH ROW EXECUTE FUNCTION prevent_project_version_mutation();

-- The project manager must be an active member of the owning organisation (09-DATA-MODEL).
CREATE FUNCTION require_project_manager_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM memberships
    WHERE user_id = NEW."manager_id" AND organization_id = NEW."organization_id" AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'project manager must be an active member of the owning organization' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER projects_manager_is_member AFTER INSERT OR UPDATE ON "projects"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_project_manager_membership();

-- Reference cities for the local market (01-PRODUCT-SCOPE assumes Palestine by default).
-- Coordinates are city centres: they locate a project's city, never a person.
INSERT INTO "cities" ("id", "country", "name_ar", "name_en", "latitude", "longitude") VALUES
  (gen_random_uuid(), 'PS', 'نابلس', 'Nablus', 32.2211, 35.2544),
  (gen_random_uuid(), 'PS', 'رام الله', 'Ramallah', 31.9038, 35.2034),
  (gen_random_uuid(), 'PS', 'الخليل', 'Hebron', 31.5326, 35.0998),
  (gen_random_uuid(), 'PS', 'جنين', 'Jenin', 32.4597, 35.2956),
  (gen_random_uuid(), 'PS', 'طولكرم', 'Tulkarm', 32.3104, 35.0286),
  (gen_random_uuid(), 'PS', 'بيت لحم', 'Bethlehem', 31.7054, 35.2024),
  (gen_random_uuid(), 'PS', 'غزة', 'Gaza', 31.5017, 34.4668),
  (gen_random_uuid(), 'PS', 'القدس', 'Jerusalem', 31.7683, 35.2137),
  (gen_random_uuid(), 'JO', 'عمّان', 'Amman', 31.9539, 35.9106),
  (gen_random_uuid(), 'JO', 'إربد', 'Irbid', 32.5556, 35.8500),
  (gen_random_uuid(), 'JO', 'الزرقاء', 'Zarqa', 32.0728, 36.0880);

INSERT INTO "runtime_metadata" ("key", "value") VALUES ('projects_version', '1')
  ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = CURRENT_TIMESTAMP;

COMMIT;
