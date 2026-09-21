-- PART-09 adds an escrow pool kind for offerings.
--
-- It is its own migration because PostgreSQL will not let a new enum value be *used* in the same
-- transaction that adds it, and the next migration's CHECK constraint refers to this value.
ALTER TYPE "PoolKind" ADD VALUE IF NOT EXISTS 'offering_escrow';
