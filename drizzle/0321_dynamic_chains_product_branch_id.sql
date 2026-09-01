-- Point 141: the one missing segment of Rajat's fully-qualified dynamic
-- chain key (VERIDIAN + PRODUCT + ORG + USER + pill + options). Nullable,
-- no backfill, no FK -- see src/lib/db/schema.ts's dynamicChains comment
-- for why. Additive only (AR-11).
ALTER TABLE platform.dynamic_chains ADD COLUMN IF NOT EXISTS product_branch_id text;
CREATE INDEX IF NOT EXISTS dynamic_chains_product_branch_idx ON platform.dynamic_chains (product_branch_id);
