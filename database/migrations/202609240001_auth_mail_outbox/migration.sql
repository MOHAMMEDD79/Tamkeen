-- local_auth_mail becomes the outbox the worker relays to Resend when EMAIL_MODE=resend.
-- Rows written before this migration were never meant to leave the machine: mark them local_only.
ALTER TABLE "local_auth_mail"
  ADD COLUMN "state" VARCHAR(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "last_error_code" VARCHAR(80) NOT NULL DEFAULT '',
  ADD COLUMN "delivered_at" TIMESTAMPTZ(3);

UPDATE "local_auth_mail" SET "state" = 'local_only';

ALTER TABLE "local_auth_mail"
  ADD CONSTRAINT "local_auth_mail_state_check" CHECK ("state" IN ('pending', 'processing', 'failed', 'delivered', 'dead_letter', 'local_only', 'expired'));

CREATE INDEX "local_auth_mail_state_next_attempt_at_idx" ON "local_auth_mail"("state", "next_attempt_at");
