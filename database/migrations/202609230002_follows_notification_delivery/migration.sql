CREATE TABLE "follows" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "follower_id" UUID NOT NULL,
  "subject_type" VARCHAR(30) NOT NULL,
  "subject_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "follows_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "follows_subject_type_check" CHECK ("subject_type" IN ('organization', 'project')),
  CONSTRAINT "follows_follower_id_fkey" FOREIGN KEY ("follower_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "follows_follower_id_subject_type_subject_id_key" ON "follows"("follower_id", "subject_type", "subject_id");
CREATE INDEX "follows_subject_type_subject_id_idx" ON "follows"("subject_type", "subject_id");
