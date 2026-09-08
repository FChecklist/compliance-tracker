-- R81 D1-04 (second migration): extend platform.work_orders for the R81
-- work-order recovery backfill.
--
-- D1-03 established what the registry needs in order to answer "which work
-- orders exist, and can we read them" mechanically rather than by reading
-- prose:
--
--   r_number   the R-number a work order belongs to, as an integer, so
--              coverage can be stated as a fraction of the numbering
--              ("full text for N of 80") instead of as a percentage of
--              whatever happened to be found. Nullable: several real work
--              orders (IMG-S1, the standing prompt, MIGRATION-DEBT) carry no
--              R-number at all, and inventing one would be a fabrication.
--
--   body_hash  sha256 of the recovered body, so a body can be proven to be
--              the same bytes as the file it was recovered from, and a later
--              session can tell a real recovered body from one that was
--              re-typed or summarised. Nullable: a NULL body must have a NULL
--              hash, and D1-05 forbids fabricating a body, so NULL is the
--              honest value for every work order we could not recover.
--
-- Additive only (GG-03): adds two nullable columns, drops nothing, renames
-- nothing, narrows no type, adds no NOT NULL to a populated column.
ALTER TABLE platform.work_orders ADD COLUMN IF NOT EXISTS r_number  int;
ALTER TABLE platform.work_orders ADD COLUMN IF NOT EXISTS body_hash text;

COMMENT ON COLUMN platform.work_orders.r_number  IS
  'R-number of this work order, NULL where it genuinely has none (R81 D1-04).';
COMMENT ON COLUMN platform.work_orders.body_hash IS
  'sha256 of body, NULL when body is NULL. Never fabricate either (R81 D1-05).';
