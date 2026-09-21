-- Lets test and demo organisations stay usable while only real ones appear in the public directory.
ALTER TABLE "organizations" ADD COLUMN "publicly_listed" BOOLEAN NOT NULL DEFAULT true;
