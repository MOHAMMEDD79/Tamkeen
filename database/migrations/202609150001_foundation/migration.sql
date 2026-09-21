CREATE TABLE "runtime_metadata" (
  "key" VARCHAR(64) PRIMARY KEY,
  "value" VARCHAR(128) NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "worker_heartbeats" (
  "worker_id" VARCHAR(64) PRIMARY KEY,
  "last_seen" TIMESTAMPTZ(3) NOT NULL
);
INSERT INTO "runtime_metadata" ("key", "value") VALUES ('foundation_version', '1');
