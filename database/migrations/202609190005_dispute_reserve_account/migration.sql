-- PART-07 adds DisputeReserve to the chart of accounts. Pools created before this migration have
-- no such account, and a posting to a missing account fails, so every existing pool gets one.
--
-- No entries are written: an account with no entries has a zero balance, which is the truth for a
-- pool that has never had a chargeback. Nothing about the existing ledger changes.
INSERT INTO "ledger_accounts" ("id", "pool_id", "code", "type", "currency")
SELECT gen_random_uuid(), p."id", 'DisputeReserve', 'liability', p."currency"
FROM "funding_pools" p
WHERE NOT EXISTS (
  SELECT 1 FROM "ledger_accounts" a WHERE a."pool_id" = p."id" AND a."code" = 'DisputeReserve'
);
