-- R85 Addendum 3 v2, Phase 1 (owner rulings D87 claude_log 366, D90 claude_log 374,
-- D91 claude_log 375). Additive-only per G-01.
--
-- Applied LIVE against pcrjmlpuqsbocqfwoxod via Supabase MCP apply_migration,
-- 2026-09-12, supabase_migrations.schema_migrations version 20260912063030,
-- name r85a3_p1_boq_line_project_contract_columns. This file is the committed
-- record of that change, per this repo's own documented drizzle-vs-live-history
-- gap (many migrations in this era are applied out-of-band and only later
-- reflected here as a file).
--
-- Four new NULLABLE columns on construction_boq_line_items. Existing
-- quantity/rate ALWAYS meant the quoted (contract/sell) figure -- D89/D90,
-- Addendum 3 v2 Phase 1 step 1-02 -- so they are backfilled into the new
-- qty_contract/rate_contract columns. Nothing existing changes meaning or
-- behavior; `quantity`, `rate`, `amount` are untouched.
--
-- Verified after apply: 912 existing rows, 0 real mismatches between
-- qty_contract*rate_contract and amount after correcting for float-precision
-- display noise (8 rows were `217.79999999999998` vs `217.80`-style identical
-- values). One genuine, PRE-EXISTING, unrelated data anomaly found and
-- flagged, not fixed here: line fx3401ycp8l9ml6s6vj8g1iv (quantity=100,
-- rate=50, amount=150), created 2026-09-11, predates this migration.

ALTER TABLE compliance.construction_boq_line_items
  ADD COLUMN qty_project numeric,
  ADD COLUMN rate_project numeric,
  ADD COLUMN qty_contract numeric,
  ADD COLUMN rate_contract numeric;

UPDATE compliance.construction_boq_line_items
SET qty_contract = quantity,
    rate_contract = rate
WHERE qty_contract IS NULL AND rate_contract IS NULL;

COMMENT ON COLUMN compliance.construction_boq_line_items.qty_project IS 'R85 Addendum 3 (D87/D90/D91): internal/cost-side quantity. NULL = no project-side estimate entered yet. Never auto-derived from qty_contract.';
COMMENT ON COLUMN compliance.construction_boq_line_items.rate_project IS 'R85 Addendum 3 (D87/D90/D91): internal/cost-side unit rate -- the firm''s own cost. MOST SENSITIVE FIELD IN THE PRODUCT per D91 B1: never client-reachable in any surface.';
COMMENT ON COLUMN compliance.construction_boq_line_items.qty_contract IS 'R85 Addendum 3 (D87/D90/D91): customer-facing quantity. Backfilled from legacy `quantity` at migration time (that column always meant the quoted figure). Independently editable going forward.';
COMMENT ON COLUMN compliance.construction_boq_line_items.rate_contract IS 'R85 Addendum 3 (D87/D90/D91): customer-facing unit rate. Backfilled from legacy `rate` at migration time. After baseline confirmation, changes require a cited evidence artefact per D88/D91 B2.';
