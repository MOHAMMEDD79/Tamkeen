CREATE TYPE "SupportTicketState" AS ENUM ('open', 'assigned', 'awaiting_user', 'awaiting_internal', 'resolved', 'closed');
CREATE TYPE "SupportTicketPriority" AS ENUM ('low', 'normal', 'high', 'urgent');
CREATE TYPE "NotificationDeliveryState" AS ENUM ('pending', 'processing', 'delivered', 'failed', 'dead_letter');

CREATE TABLE "support_tickets" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "reference" VARCHAR(24) NOT NULL UNIQUE,
  "requester_id" UUID, "requester_email" VARCHAR(254), "organization_id" UUID,
  "subject_type" VARCHAR(40) NOT NULL, "subject_id" UUID, "category" VARCHAR(40) NOT NULL,
  "title" VARCHAR(200) NOT NULL, "state" "SupportTicketState" NOT NULL DEFAULT 'open',
  "priority" "SupportTicketPriority" NOT NULL DEFAULT 'normal', "assignee_id" UUID,
  "next_action_at" TIMESTAMPTZ(3), "resolution_code" VARCHAR(50) NOT NULL DEFAULT '',
  "resolution" VARCHAR(2000) NOT NULL DEFAULT '', "version" INTEGER NOT NULL DEFAULT 1,
  "resolved_at" TIMESTAMPTZ(3), "closed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_ticket_requester" CHECK ("requester_id" IS NOT NULL OR "requester_email" IS NOT NULL),
  CONSTRAINT "support_ticket_resolution" CHECK (("state" NOT IN ('resolved','closed')) OR (length("resolution_code") > 0 AND length("resolution") >= 10))
);
CREATE INDEX "support_tickets_requester_id_created_at_idx" ON "support_tickets"("requester_id", "created_at");
CREATE INDEX "support_tickets_state_priority_created_at_idx" ON "support_tickets"("state", "priority", "created_at");
CREATE INDEX "support_tickets_assignee_id_state_idx" ON "support_tickets"("assignee_id", "state");

CREATE TABLE "support_ticket_replies" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "ticket_id" UUID NOT NULL REFERENCES "support_tickets"("id") ON DELETE RESTRICT,
  "author_id" UUID NOT NULL, "author_kind" VARCHAR(20) NOT NULL, "body" VARCHAR(4000) NOT NULL,
  "internal" BOOLEAN NOT NULL DEFAULT false, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_reply_body" CHECK (length("body") >= 2)
);
CREATE INDEX "support_ticket_replies_ticket_id_created_at_idx" ON "support_ticket_replies"("ticket_id", "created_at");

CREATE TABLE "user_notifications" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "recipient_id" UUID NOT NULL,
  "event_type" VARCHAR(80) NOT NULL, "title" VARCHAR(200) NOT NULL, "body" VARCHAR(1000) NOT NULL,
  "safe_path" VARCHAR(500) NOT NULL, "dedup_key" VARCHAR(180) NOT NULL UNIQUE,
  "read_at" TIMESTAMPTZ(3), "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_safe_path" CHECK ("safe_path" = '' OR ("safe_path" LIKE '/%' AND "safe_path" NOT LIKE '//%' AND "safe_path" NOT LIKE '%://%'))
);
CREATE INDEX "user_notifications_recipient_id_read_at_created_at_idx" ON "user_notifications"("recipient_id", "read_at", "created_at");

CREATE TABLE "notification_outbox" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "notification_id" UUID NOT NULL UNIQUE REFERENCES "user_notifications"("id") ON DELETE RESTRICT,
  "channel" VARCHAR(20) NOT NULL, "template_version" INTEGER NOT NULL DEFAULT 1,
  "state" "NotificationDeliveryState" NOT NULL DEFAULT 'pending', "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "last_error_code" VARCHAR(80) NOT NULL DEFAULT '',
  "delivered_at" TIMESTAMPTZ(3), "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_channel" CHECK ("channel" IN ('in_app','email')),
  CONSTRAINT "notification_attempts" CHECK ("attempts" >= 0 AND "attempts" <= 12)
);
CREATE INDEX "notification_outbox_state_next_attempt_at_idx" ON "notification_outbox"("state", "next_attempt_at");

CREATE TABLE "subject_freezes" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "subject_type" VARCHAR(40) NOT NULL, "subject_id" UUID NOT NULL,
  "scope" VARCHAR(20) NOT NULL, "reason" VARCHAR(1000) NOT NULL, "frozen_by" UUID NOT NULL,
  "frozen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "unfrozen_by" UUID,
  "unfrozen_at" TIMESTAMPTZ(3), "unfreeze_reason" VARCHAR(1000) NOT NULL DEFAULT '', "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "freeze_scope" CHECK ("scope" IN ('collect','payout','publish')),
  CONSTRAINT "freeze_reason" CHECK (length("reason") >= 10),
  CONSTRAINT "unfreeze_complete" CHECK (("unfrozen_at" IS NULL AND "unfrozen_by" IS NULL AND "unfreeze_reason" = '') OR ("unfrozen_at" IS NOT NULL AND "unfrozen_by" IS NOT NULL AND length("unfreeze_reason") >= 10))
);
CREATE INDEX "subject_freezes_subject_type_subject_id_unfrozen_at_idx" ON "subject_freezes"("subject_type", "subject_id", "unfrozen_at");
CREATE UNIQUE INDEX "subject_freezes_one_active_scope" ON "subject_freezes"("subject_type", "subject_id", "scope") WHERE "unfrozen_at" IS NULL;

CREATE OR REPLACE FUNCTION prevent_support_history_edit() RETURNS trigger AS $$ BEGIN
  RAISE EXCEPTION 'append-only: support replies cannot be changed or removed once written';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "support_ticket_replies_append_only" BEFORE UPDATE OR DELETE ON "support_ticket_replies" FOR EACH ROW EXECUTE FUNCTION prevent_support_history_edit();
