-- Verification and password reset now send a 6-digit code instead of a link, because a link to the
-- local preview does not open on another device. A row carries either a link or a code, never both.
ALTER TABLE "local_auth_mail"
  ALTER COLUMN "url" SET DEFAULT '',
  ADD COLUMN "code" VARCHAR(12);

ALTER TABLE "local_auth_mail"
  ADD CONSTRAINT "local_auth_mail_link_or_code_check" CHECK ("code" IS NULL OR "url" = '');
