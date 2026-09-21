-- PART-09. An offering escrow must be able to return every subscriber the amount their contract
-- names, so the processor fee cannot be taken out of what is owed to them. The platform funds that
-- gap instead, and it needs somewhere to land that is visibly not the subscribers' money.
--
-- Every pool gets the account, not only the new escrows: one chart of accounts, so that a balance
-- means the same thing whichever kind of pool it belongs to. Charity pools will simply never post
-- to it under the declared fee policy, and an account that stays at zero says that plainly.
INSERT INTO "ledger_accounts" ("id", "pool_id", "code", "type", "currency")
SELECT gen_random_uuid(), p."id", 'PlatformFundingLiability', 'liability'::"LedgerAccountType", p."currency"
FROM "funding_pools" p
WHERE NOT EXISTS (
  SELECT 1 FROM "ledger_accounts" a
  WHERE a."pool_id" = p."id" AND a."code" = 'PlatformFundingLiability'
);
