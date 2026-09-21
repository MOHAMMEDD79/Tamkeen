-- PART-08 — ventures, offerings, disclosures, investor eligibility and the data room.
--
-- Two rules from 06-INVESTMENT-LIFECYCLE shape the constraints here:
--
--  * eligibility is a reviewed decision, never a consequence of choosing a capability, so it lives
--    in its own table with its own decisions rather than as a flag on the profile;
--  * what an investor accepted survives the documents being replaced, so an acceptance copies the
--    checksum of the text it was given and nothing can edit it afterwards.

CREATE TYPE "OfferingState" AS ENUM ('draft', 'submitted', 'due_diligence', 'changes_requested', 'rejected', 'approved', 'open', 'suspended', 'closing', 'failed', 'allocated', 'reporting', 'closed');
CREATE TYPE "InvestmentInstrument" AS ENUM ('common_shares');
CREATE TYPE "OversubscriptionPolicy" AS ENUM ('reject', 'pro_rata');
CREATE TYPE "EligibilityState" AS ENUM ('not_started', 'draft', 'submitted', 'in_review', 'changes_requested', 'approved', 'rejected', 'expired');
CREATE TYPE "DataRoomCategory" AS ENUM ('company_profile', 'historical_performance', 'use_of_funds', 'current_ownership', 'contracts', 'risks', 'due_diligence_report');
CREATE TYPE "DataRoomClassification" AS ENUM ('public', 'nda', 'granted');
CREATE TYPE "DataRoomRequestState" AS ENUM ('requested', 'approved', 'rejected', 'withdrawn');

CREATE TABLE "ventures" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "legal_name" VARCHAR(200) NOT NULL,
  "summary" VARCHAR(2000) NOT NULL,
  "current_shares" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "incorporated_at" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "ventures_pkey" PRIMARY KEY ("id"),
  -- A company with no shares in issue cannot offer a percentage of itself.
  CONSTRAINT "ventures_shares_positive" CHECK ("current_shares" > 0)
);
CREATE UNIQUE INDEX "ventures_organization_id_key" ON "ventures"("organization_id");

CREATE TABLE "offerings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "venture_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "slug" VARCHAR(120) NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "instrument" "InvestmentInstrument" NOT NULL DEFAULT 'common_shares',
  "currency" CHAR(3) NOT NULL,
  "shares_offered" BIGINT NOT NULL,
  "price_per_share_minor" BIGINT NOT NULL,
  "minimum_raise_minor" BIGINT NOT NULL,
  "minimum_ticket_minor" BIGINT NOT NULL,
  "maximum_ticket_minor" BIGINT,
  "use_of_funds" VARCHAR(4000) NOT NULL DEFAULT '',
  "oversubscription_policy" "OversubscriptionPolicy" NOT NULL DEFAULT 'reject',
  "requires_eligibility" BOOLEAN NOT NULL DEFAULT true,
  "requires_nda" BOOLEAN NOT NULL DEFAULT false,
  "state" "OfferingState" NOT NULL DEFAULT 'draft',
  "state_reason" VARCHAR(1000) NOT NULL DEFAULT '',
  "opens_at" TIMESTAMPTZ(3),
  "closes_at" TIMESTAMPTZ(3),
  "manager_id" UUID,
  "current_disclosure_id" UUID,
  "simulated" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "offerings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "offerings_shares_positive" CHECK ("shares_offered" > 0),
  CONSTRAINT "offerings_price_positive" CHECK ("price_per_share_minor" > 0),
  -- The minimum raise cannot exceed what the offering could raise if every share sold.
  CONSTRAINT "offerings_minimum_within_maximum" CHECK ("minimum_raise_minor" <= "shares_offered" * "price_per_share_minor"),
  CONSTRAINT "offerings_minimum_raise_positive" CHECK ("minimum_raise_minor" > 0),
  -- 06 forbids fractional shares, so the smallest ticket must buy at least one whole share.
  CONSTRAINT "offerings_ticket_buys_a_share" CHECK ("minimum_ticket_minor" >= "price_per_share_minor"),
  CONSTRAINT "offerings_ticket_range" CHECK ("maximum_ticket_minor" IS NULL OR "maximum_ticket_minor" >= "minimum_ticket_minor"),
  CONSTRAINT "offerings_window_ordered" CHECK ("opens_at" IS NULL OR "closes_at" IS NULL OR "closes_at" > "opens_at"),
  -- A published offering must name the disclosure it is published against.
  CONSTRAINT "offerings_open_needs_disclosure" CHECK (
    "state" NOT IN ('open', 'closing', 'allocated', 'reporting') OR "current_disclosure_id" IS NOT NULL
  )
);
CREATE UNIQUE INDEX "offerings_slug_key" ON "offerings"("slug");
CREATE UNIQUE INDEX "offerings_current_disclosure_id_key" ON "offerings"("current_disclosure_id");
CREATE INDEX "offerings_state_opens_at_idx" ON "offerings"("state", "opens_at");
CREATE INDEX "offerings_organization_id_state_idx" ON "offerings"("organization_id", "state");

CREATE TABLE "offering_disclosures" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "offering_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "summary" VARCHAR(4000) NOT NULL,
  "risks" VARCHAR(6000) NOT NULL,
  "use_of_funds" VARCHAR(4000) NOT NULL,
  "checksum" CHAR(64) NOT NULL,
  "material" BOOLEAN NOT NULL DEFAULT true,
  "reason" VARCHAR(1000) NOT NULL DEFAULT '',
  "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "created_by" UUID NOT NULL,
  CONSTRAINT "offering_disclosures_pkey" PRIMARY KEY ("id"),
  -- A disclosure with no risk section is not a disclosure (06).
  CONSTRAINT "offering_disclosures_has_risks" CHECK (length(btrim("risks")) >= 20)
);
CREATE UNIQUE INDEX "offering_disclosures_offering_id_sequence_key" ON "offering_disclosures"("offering_id", "sequence");

CREATE TABLE "offering_review_decisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "offering_id" UUID NOT NULL,
  "disclosure_id" UUID NOT NULL,
  "reviewer_id" UUID NOT NULL,
  "outcome" "ReviewOutcome" NOT NULL,
  "public_reason" VARCHAR(1000) NOT NULL DEFAULT '',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "offering_review_decisions_pkey" PRIMARY KEY ("id"),
  -- Anything other than an approval owes the issuer an explanation they can act on.
  CONSTRAINT "offering_review_decisions_reason_required" CHECK (
    "outcome" = 'approved' OR length(btrim("public_reason")) >= 10
  )
);
CREATE INDEX "offering_review_decisions_offering_id_created_at_idx" ON "offering_review_decisions"("offering_id", "created_at");

CREATE TABLE "investor_eligibility" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "state" "EligibilityState" NOT NULL DEFAULT 'not_started',
  "draft" JSONB,
  "decided_at" TIMESTAMPTZ(3),
  "expires_at" TIMESTAMPTZ(3),
  "reason" VARCHAR(1000) NOT NULL DEFAULT '',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "investor_eligibility_pkey" PRIMARY KEY ("id"),
  -- 06: an eligibility result carries an expiry. An approval without one never expires, which is
  -- exactly the state the specification says must not exist.
  CONSTRAINT "investor_eligibility_approval_expires" CHECK (
    "state" <> 'approved' OR ("expires_at" IS NOT NULL AND "decided_at" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "investor_eligibility_user_id_key" ON "investor_eligibility"("user_id");

CREATE TABLE "investor_eligibility_submissions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "eligibility_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "answers" JSONB NOT NULL,
  "checksum" CHAR(64) NOT NULL,
  "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "investor_eligibility_submissions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "investor_eligibility_submissions_eligibility_id_sequence_key"
  ON "investor_eligibility_submissions"("eligibility_id", "sequence");

CREATE TABLE "eligibility_decisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "eligibility_id" UUID NOT NULL,
  "submission_id" UUID NOT NULL,
  "reviewer_id" UUID NOT NULL,
  "outcome" "ReviewOutcome" NOT NULL,
  "reason" VARCHAR(1000) NOT NULL DEFAULT '',
  "expires_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "eligibility_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "eligibility_decisions_reason_required" CHECK (
    "outcome" = 'approved' OR length(btrim("reason")) >= 10
  ),
  CONSTRAINT "eligibility_decisions_approval_expires" CHECK (
    "outcome" <> 'approved' OR "expires_at" IS NOT NULL
  )
);
CREATE INDEX "eligibility_decisions_eligibility_id_created_at_idx" ON "eligibility_decisions"("eligibility_id", "created_at");

CREATE TABLE "data_room_documents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "offering_id" UUID NOT NULL,
  "category" "DataRoomCategory" NOT NULL,
  "classification" "DataRoomClassification" NOT NULL DEFAULT 'granted',
  "title" VARCHAR(200) NOT NULL,
  "sequence" INTEGER NOT NULL,
  "checksum" CHAR(64) NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "content_type" VARCHAR(100) NOT NULL,
  "storage_key" VARCHAR(400),
  "scan_state" "VerificationDocumentState" NOT NULL DEFAULT 'pending_scan',
  "superseded_by_id" UUID,
  "uploaded_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "data_room_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "data_room_documents_size_positive" CHECK ("byte_size" > 0)
);
CREATE UNIQUE INDEX "data_room_documents_offering_id_title_sequence_key" ON "data_room_documents"("offering_id", "title", "sequence");
CREATE UNIQUE INDEX "data_room_documents_superseded_by_id_key" ON "data_room_documents"("superseded_by_id");
CREATE INDEX "data_room_documents_offering_id_classification_idx" ON "data_room_documents"("offering_id", "classification");

CREATE TABLE "data_room_access_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "offering_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "state" "DataRoomRequestState" NOT NULL DEFAULT 'requested',
  "reason" VARCHAR(1000) NOT NULL DEFAULT '',
  "decided_by" UUID,
  "decided_at" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "data_room_access_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "data_room_access_requests_decision_complete" CHECK (
    ("decided_by" IS NULL AND "decided_at" IS NULL) OR ("decided_by" IS NOT NULL AND "decided_at" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "data_room_access_requests_offering_id_user_id_key" ON "data_room_access_requests"("offering_id", "user_id");

CREATE TABLE "data_room_grants" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "offering_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "granted_by" UUID NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  "revoked_by" UUID,
  "revoke_reason" VARCHAR(1000) NOT NULL DEFAULT '',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "data_room_grants_pkey" PRIMARY KEY ("id"),
  -- 06: a grant is time-boxed. One without an end is standing access to a private data room.
  CONSTRAINT "data_room_grants_expiry_after_start" CHECK ("expires_at" > "created_at"),
  -- BUS-03.A03: a revocation records why, and does not erase the grant that existed.
  CONSTRAINT "data_room_grants_revocation_has_reason" CHECK (
    "revoked_at" IS NULL OR ("revoked_by" IS NOT NULL AND length(btrim("revoke_reason")) >= 10)
  )
);
CREATE INDEX "data_room_grants_offering_id_user_id_revoked_at_idx" ON "data_room_grants"("offering_id", "user_id", "revoked_at");

CREATE TABLE "nda_acceptances" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "offering_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "disclosure_id" UUID NOT NULL,
  "checksum" CHAR(64) NOT NULL,
  "accepted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "nda_acceptances_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "nda_acceptances_offering_id_user_id_disclosure_id_key"
  ON "nda_acceptances"("offering_id", "user_id", "disclosure_id");

CREATE TABLE "data_room_downloads" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "document_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "data_room_downloads_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "data_room_downloads_document_id_created_at_idx" ON "data_room_downloads"("document_id", "created_at");

CREATE TABLE "investor_questions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "offering_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "body" VARCHAR(2000) NOT NULL,
  "answered_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "investor_questions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "investor_questions_offering_id_created_at_idx" ON "investor_questions"("offering_id", "created_at");

CREATE TABLE "investor_question_replies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "question_id" UUID NOT NULL,
  "author_id" UUID NOT NULL,
  "body" VARCHAR(4000) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "investor_question_replies_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "investor_question_replies_question_id_created_at_idx" ON "investor_question_replies"("question_id", "created_at");

CREATE TABLE "offering_interests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "offering_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "indicative_amount_minor" BIGINT,
  "withdrawn_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "offering_interests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "offering_interests_amount_positive" CHECK ("indicative_amount_minor" IS NULL OR "indicative_amount_minor" > 0)
);
CREATE UNIQUE INDEX "offering_interests_offering_id_user_id_key" ON "offering_interests"("offering_id", "user_id");

ALTER TABLE "ventures" ADD CONSTRAINT "ventures_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ventures" ADD CONSTRAINT "ventures_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offerings" ADD CONSTRAINT "offerings_venture_id_fkey" FOREIGN KEY ("venture_id") REFERENCES "ventures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offerings" ADD CONSTRAINT "offerings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offerings" ADD CONSTRAINT "offerings_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offerings" ADD CONSTRAINT "offerings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offerings" ADD CONSTRAINT "offerings_current_disclosure_id_fkey" FOREIGN KEY ("current_disclosure_id") REFERENCES "offering_disclosures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offering_disclosures" ADD CONSTRAINT "offering_disclosures_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offering_disclosures" ADD CONSTRAINT "offering_disclosures_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offering_review_decisions" ADD CONSTRAINT "offering_review_decisions_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offering_review_decisions" ADD CONSTRAINT "offering_review_decisions_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "investor_eligibility" ADD CONSTRAINT "investor_eligibility_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "investor_eligibility_submissions" ADD CONSTRAINT "investor_eligibility_submissions_eligibility_id_fkey" FOREIGN KEY ("eligibility_id") REFERENCES "investor_eligibility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "eligibility_decisions" ADD CONSTRAINT "eligibility_decisions_eligibility_id_fkey" FOREIGN KEY ("eligibility_id") REFERENCES "investor_eligibility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "eligibility_decisions" ADD CONSTRAINT "eligibility_decisions_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "investor_eligibility_submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "eligibility_decisions" ADD CONSTRAINT "eligibility_decisions_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_room_documents" ADD CONSTRAINT "data_room_documents_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_room_documents" ADD CONSTRAINT "data_room_documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_room_documents" ADD CONSTRAINT "data_room_documents_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "data_room_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_room_access_requests" ADD CONSTRAINT "data_room_access_requests_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_room_access_requests" ADD CONSTRAINT "data_room_access_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_room_access_requests" ADD CONSTRAINT "data_room_access_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_room_grants" ADD CONSTRAINT "data_room_grants_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_room_grants" ADD CONSTRAINT "data_room_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_room_grants" ADD CONSTRAINT "data_room_grants_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_room_grants" ADD CONSTRAINT "data_room_grants_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "nda_acceptances" ADD CONSTRAINT "nda_acceptances_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "nda_acceptances" ADD CONSTRAINT "nda_acceptances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "nda_acceptances" ADD CONSTRAINT "nda_acceptances_disclosure_id_fkey" FOREIGN KEY ("disclosure_id") REFERENCES "offering_disclosures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_room_downloads" ADD CONSTRAINT "data_room_downloads_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "data_room_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_room_downloads" ADD CONSTRAINT "data_room_downloads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "investor_questions" ADD CONSTRAINT "investor_questions_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "investor_questions" ADD CONSTRAINT "investor_questions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "investor_question_replies" ADD CONSTRAINT "investor_question_replies_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "investor_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "investor_question_replies" ADD CONSTRAINT "investor_question_replies_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offering_interests" ADD CONSTRAINT "offering_interests_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offering_interests" ADD CONSTRAINT "offering_interests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A disclosure is what an investor read and agreed to. Editing one would silently change the terms
-- of every acceptance that points at it, so it is append-only: a revision is a new version.
CREATE TRIGGER offering_disclosures_immutable BEFORE UPDATE OR DELETE ON "offering_disclosures"
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

-- Review and eligibility decisions are judgements made at a moment, and an acceptance is a record
-- of consent. All three are append-only for the same reason.
CREATE TRIGGER offering_review_decisions_immutable BEFORE UPDATE OR DELETE ON "offering_review_decisions"
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
CREATE TRIGGER eligibility_decisions_immutable BEFORE UPDATE OR DELETE ON "eligibility_decisions"
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
CREATE TRIGGER nda_acceptances_immutable BEFORE UPDATE OR DELETE ON "nda_acceptances"
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
CREATE TRIGGER eligibility_submissions_immutable BEFORE UPDATE OR DELETE ON "investor_eligibility_submissions"
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
CREATE TRIGGER data_room_downloads_immutable BEFORE UPDATE OR DELETE ON "data_room_downloads"
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
