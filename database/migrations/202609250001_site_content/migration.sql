-- Admin-controlled site content, project cover photos and the public contact inbox.
-- The seed rows below are the site's copy until an admin edits it: the public read must never come
-- back empty, and every singleton slot must exist before the admin screen can edit it.
BEGIN;

CREATE TABLE "site_media_items" (
    "id" UUID NOT NULL,
    "slot" VARCHAR(32) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "title_ar" VARCHAR(200) NOT NULL DEFAULT '',
    "title_en" VARCHAR(200) NOT NULL DEFAULT '',
    "body_ar" VARCHAR(600) NOT NULL DEFAULT '',
    "body_en" VARCHAR(600) NOT NULL DEFAULT '',
    "cta_label_ar" VARCHAR(60) NOT NULL DEFAULT '',
    "cta_label_en" VARCHAR(60) NOT NULL DEFAULT '',
    "cta_href" VARCHAR(300) NOT NULL DEFAULT '',
    "image_key" VARCHAR(120),
    "image_content_type" VARCHAR(40),
    "image_checksum" CHAR(64),
    "default_image" VARCHAR(200) NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "site_media_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "site_media_items_slot_sort_order_idx" ON "site_media_items"("slot", "sort_order");
-- Only hero slides repeat; every other slot is one row, enforced here rather than trusted to the API.
CREATE UNIQUE INDEX "site_media_items_singleton_slot_key" ON "site_media_items"("slot") WHERE "slot" <> 'hero';

ALTER TABLE "site_media_items"
    ADD CONSTRAINT "site_media_items_slot" CHECK ("slot" IN ('hero', 'track.charity', 'track.invest', 'track.work', 'about', 'contact')),
    ADD CONSTRAINT "site_media_items_version_positive" CHECK ("version" > 0),
    -- A path on this site or nothing. "//host" and "/\host" are protocol-relative in browsers.
    ADD CONSTRAINT "site_media_items_cta_href_internal" CHECK ("cta_href" = '' OR ("cta_href" ~ '^/' AND "cta_href" !~ '^/[/\\]' AND "cta_href" !~ '[\\[:space:]]')),
    ADD CONSTRAINT "site_media_items_default_image_path" CHECK ("default_image" = '' OR "default_image" ~ '^/media/defaults/[a-z0-9-]+\.(jpg|jpeg|png|webp)$'),
    ADD CONSTRAINT "site_media_items_image_complete" CHECK (("image_key" IS NULL AND "image_content_type" IS NULL AND "image_checksum" IS NULL) OR ("image_key" ~ '^site/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.bin$' AND "image_content_type" IN ('image/png', 'image/jpeg', 'image/webp') AND "image_checksum" ~ '^[0-9a-f]{64}$'));

CREATE TABLE "project_covers" (
    "project_id" UUID NOT NULL,
    "image_key" VARCHAR(120) NOT NULL,
    "content_type" VARCHAR(40) NOT NULL,
    "checksum" CHAR(64) NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_covers_pkey" PRIMARY KEY ("project_id")
);

ALTER TABLE "project_covers"
    ADD CONSTRAINT "project_covers_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "project_covers_image_key" CHECK ("image_key" ~ '^site/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.bin$'),
    ADD CONSTRAINT "project_covers_content_type" CHECK ("content_type" IN ('image/png', 'image/jpeg', 'image/webp')),
    ADD CONSTRAINT "project_covers_checksum_sha256" CHECK ("checksum" ~ '^[0-9a-f]{64}$');

CREATE TABLE "contact_messages" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "body" VARCHAR(4000) NOT NULL,
    "locale" VARCHAR(5) NOT NULL DEFAULT 'ar',
    "state" VARCHAR(20) NOT NULL DEFAULT 'new',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(3),
    "handled_by_id" UUID,
    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contact_messages_state_created_at_idx" ON "contact_messages"("state", "created_at");

ALTER TABLE "contact_messages"
    ADD CONSTRAINT "contact_messages_state" CHECK ("state" IN ('new', 'read', 'archived')),
    ADD CONSTRAINT "contact_messages_locale" CHECK ("locale" IN ('ar', 'en'));

INSERT INTO "site_media_items" ("id", "slot", "sort_order", "title_ar", "title_en", "body_ar", "body_en", "cta_label_ar", "cta_label_en", "cta_href", "default_image") VALUES
    (gen_random_uuid(), 'hero', 0,
     'ادعم مشاريع خيرية موثّقة تصل إلى أصحابها',
     'Back verified charitable projects that reach the people they serve',
     'كل مشروع خيري على تمكين تديره جهة موثّقة، بميزانية معلنة وتقارير إنجاز تُراجَع قبل النشر، فتعرف أين ذهب عطاؤك.',
     'Every charity project on Tamkeen is run by a verified organisation, with a published budget and progress reports reviewed before they go live, so you know where your giving went.',
     'تصفّح المشاريع', 'Browse projects', '/explore', '/media/defaults/hero-charity.jpg'),
    (gen_random_uuid(), 'hero', 1,
     'التعليم يبني المستقبل، مقعدًا بعد مقعد',
     'Education builds the future, one seat at a time',
     'ساهم في تجهيز الصفوف ومنح الطلاب وبرامج التدريب التي تفتح أمام الشباب أبوابًا جديدة في مدنهم وقراهم.',
     'Help equip classrooms, fund scholarships and support training programmes that open new doors for young people in their own towns and villages.',
     'تصفّح المشاريع', 'Browse projects', '/explore', '/media/defaults/hero-education.jpg'),
    (gen_random_uuid(), 'hero', 2,
     'من الأرض إلى فرصة عمل',
     'From the land to a real job',
     'برامج زراعية وتدريب مهني يقود إلى فرص تشغيل حقيقية، تُتابَع فيها النتائج بعد انتهاء التدريب لا قبله.',
     'Agricultural programmes and vocational training that lead to real employment, with outcomes followed up after the training ends, not before.',
     'اكتشف الفرص', 'Explore opportunities', '/opportunities', '/media/defaults/hero-agriculture.jpg'),
    (gen_random_uuid(), 'hero', 3,
     'استثمر في شركات تنمو وتخلق فرصًا',
     'Invest in growing companies that create opportunity',
     'استثمار ربحي في شركات ناشئة وصغيرة تمت مراجعة طرحها، مع إفصاحات واضحة وتقارير دورية للمستثمرين.',
     'Profit-seeking investment in reviewed offerings from startups and small companies, with clear disclosures and regular investor reports.',
     'ابدأ الاستثمار', 'Start investing', '/invest', '/media/defaults/hero-business.jpg'),
    (gen_random_uuid(), 'track.charity', 0,
     'مشاريع خيرية', 'Charity projects',
     'تبرّع لمشاريع تديرها جهات موثّقة بميزانيات معلنة، وتابع التقدّم والتقارير خطوة بخطوة.',
     'Give to projects run by verified organisations with published budgets, and follow progress and reports step by step.',
     'تصفّح المشاريع الخيرية', 'Browse charity projects', '/explore?type=charity', '/media/defaults/track-charity.jpg'),
    (gen_random_uuid(), 'track.invest', 0,
     'استثمار ربحي', 'Profit investment',
     'اطّلع على طروحات استثمارية مراجَعة في شركات تنمو، مع إفصاحات كاملة قبل أي التزام.',
     'Review vetted investment offerings in growing companies, with full disclosures before any commitment.',
     'اكتشف الطروحات', 'View offerings', '/invest', '/media/defaults/track-invest.jpg'),
    (gen_random_uuid(), 'track.work', 0,
     'فرص تشغيل', 'Jobs & training',
     'برامج تدريب ووظائف لدى جهات موثّقة، تبدأ بطلب واحد وتنتهي بعمل حقيقي.',
     'Training programmes and jobs with verified organisations: one application, leading to real work.',
     'اكتشف الفرص', 'Explore opportunities', '/opportunities', '/media/defaults/track-work.jpg'),
    (gen_random_uuid(), 'about', 0,
     'عن تمكين', 'About Tamkeen',
     'تمكين منصة تجمع العطاء الخيري والاستثمار الربحي وفرص العمل في مكان واحد، وتقوم على جهات موثّقة وأرقام تُراجَع قبل أن تُنشر.',
     'Tamkeen brings charitable giving, profit investment and work opportunities together in one place, built on verified organisations and figures that are reviewed before they are published.',
     'تصفّح المشاريع', 'Browse projects', '/explore', '/media/defaults/about-village.jpg'),
    (gen_random_uuid(), 'contact', 0,
     'تواصل معنا', 'Contact us',
     'لديك سؤال أو اقتراح أو ترغب في تسجيل جهتك؟ اكتب لنا وسيعود إليك فريقنا في أقرب وقت.',
     'Have a question, a suggestion, or want to register your organisation? Write to us and our team will get back to you soon.',
     '', '', '', '/media/defaults/contact-team.jpg');

COMMIT;
