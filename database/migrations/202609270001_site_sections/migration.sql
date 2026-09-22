-- Every section of every public page becomes admin-editable. A section row stores only what the
-- admin changed; the web app keeps each section's default copy and photo and fills any empty field
-- from it, so a missing or reset row never leaves a page blank.
BEGIN;

ALTER TABLE "site_media_items" DROP CONSTRAINT "site_media_items_slot";
ALTER TABLE "site_media_items" ADD CONSTRAINT "site_media_items_slot" CHECK (
    "slot" IN ('hero', 'track.charity', 'track.invest', 'track.work', 'about', 'contact')
    OR "slot" ~ '^(home|about|contact|invest|explore|opportunities|organizations)[.][a-z0-9-]+([.][0-9]{1,2})?$'
);

ALTER TABLE "site_media_items"
    ALTER COLUMN "body_ar" TYPE VARCHAR(1500),
    ALTER COLUMN "body_en" TYPE VARCHAR(1500),
    ADD COLUMN "kicker_ar" VARCHAR(80) NOT NULL DEFAULT '',
    ADD COLUMN "kicker_en" VARCHAR(80) NOT NULL DEFAULT '',
    ADD COLUMN "cta2_label_ar" VARCHAR(60) NOT NULL DEFAULT '',
    ADD COLUMN "cta2_label_en" VARCHAR(60) NOT NULL DEFAULT '',
    ADD COLUMN "cta2_href" VARCHAR(300) NOT NULL DEFAULT '';
ALTER TABLE "site_media_items" ADD CONSTRAINT "site_media_items_cta2_href_internal"
    CHECK ("cta2_href" = '' OR ("cta2_href" ~ '^/' AND "cta2_href" !~ '^/[/\]' AND "cta2_href" !~ '[\[:space:]]'));

-- Contact details and social links: a fixed set of keys, validated by the API.
CREATE TABLE "site_settings" (
    "key" VARCHAR(40) NOT NULL,
    "value" VARCHAR(500) NOT NULL DEFAULT '',
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("key")
);

COMMIT;
