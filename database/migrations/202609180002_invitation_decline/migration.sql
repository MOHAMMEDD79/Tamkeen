BEGIN;

ALTER TABLE "invitations"
    ADD COLUMN "declined_at" TIMESTAMPTZ(3),
    ADD COLUMN "declined_by" UUID;

ALTER TABLE "invitations"
    ADD CONSTRAINT "invitations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "invitations_declined_by_fkey" FOREIGN KEY ("declined_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "invitation_decline_pair" CHECK (("declined_at" IS NULL) = ("declined_by" IS NULL)),
    ADD CONSTRAINT "invitation_single_terminal_state" CHECK (num_nonnulls("consumed_at", "revoked_at", "declined_at") <= 1);

COMMIT;
