-- The platform admin's say over any listing, independent of its workflow state: 'hidden' takes it
-- off the public site, 'removed' also moves it to the admin's archive. Neither deletes anything, so
-- contributions, applications, reviews and the ledger stay intact and the listing can be restored.
BEGIN;

ALTER TABLE "projects" ADD COLUMN "admin_visibility" VARCHAR(8) NOT NULL DEFAULT 'visible';
ALTER TABLE "offerings" ADD COLUMN "admin_visibility" VARCHAR(8) NOT NULL DEFAULT 'visible';
ALTER TABLE "programs" ADD COLUMN "admin_visibility" VARCHAR(8) NOT NULL DEFAULT 'visible';
ALTER TABLE "jobs" ADD COLUMN "admin_visibility" VARCHAR(8) NOT NULL DEFAULT 'visible';
ALTER TABLE "projects" ADD CONSTRAINT "projects_admin_visibility" CHECK ("admin_visibility" IN ('visible', 'hidden', 'removed'));
ALTER TABLE "offerings" ADD CONSTRAINT "offerings_admin_visibility" CHECK ("admin_visibility" IN ('visible', 'hidden', 'removed'));
ALTER TABLE "programs" ADD CONSTRAINT "programs_admin_visibility" CHECK ("admin_visibility" IN ('visible', 'hidden', 'removed'));
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_admin_visibility" CHECK ("admin_visibility" IN ('visible', 'hidden', 'removed'));

COMMIT;
