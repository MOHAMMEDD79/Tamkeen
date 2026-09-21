-- The simulated provider's own record of what it believes happened.
--
-- An inquiry (FIN-04) is only meaningful when it asks a system other than ours. There is no second
-- system in this build, so the simulator keeps its answers here: written by the demo endpoints,
-- read only by the simulator's inquiry. Nothing in the product reads this table, and it exists
-- solely because there is no payment provider.
CREATE TABLE "simulated_provider_operations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "kind" VARCHAR(20) NOT NULL,
  "provider_reference" VARCHAR(120) NOT NULL,
  "result" VARCHAR(20) NOT NULL,
  "proof_reference" VARCHAR(200),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "simulated_provider_operations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "simulated_provider_operations_kind_provider_reference_key"
  ON "simulated_provider_operations"("kind", "provider_reference");
