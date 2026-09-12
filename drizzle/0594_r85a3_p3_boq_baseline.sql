-- R85 Addendum 3 v4, Phase 3 -- BASELINES (E2 "the versioned baseline, not a
-- freeze"). Owner rulings D87 (claude_log 366), D88 (372), D89 (373), D90
-- (374), D91 (375). Work order: Google Drive
-- WORK_ORDER_R85_ADDENDUM_3_v4_R50_FINAL.md, section E2/Phase 3, gates
-- 3-01..3-09. Additive: one new table.
--
-- Applied LIVE against pcrjmlpuqsbocqfwoxod via Supabase MCP apply_migration
-- (this repo's current-era convention for schema changes -- see
-- drizzle/0593's own header for the precedent this migration follows).
--
-- E2 / D91 Q5, THE CORE RULE THIS TABLE EXISTS TO ENFORCE: confirming a
-- baseline is an explicit user act (3-02 -- never an automatic trigger from a
-- PO, a status change, or an invoice) that snapshots every BOQ line's four
-- dual-view columns (qty_project/rate_project/qty_contract/rate_contract,
-- drizzle/0593) at that moment. THE CONTRACT VALUE MAY STILL CHANGE AFTER
-- CONFIRMATION -- this is a VERSIONED BASELINE, not a freeze (A9 S-3 is
-- explicitly superseded/prohibited, see X-07). Each confirmation writes a
-- NEW version (3-03); prior versions are NEVER overwritten or deleted.
-- rate_project as it stood at each confirmation IS the estimated cost for
-- every later comparison (A5) -- src/lib/services/boq-baseline-service.ts is
-- the single producer of every figure derived from this table, reusing
-- boq-dual-view-service.ts's computeBoqLineMoneyView/rollUpRootLines on the
-- frozen snapshot rather than recomputing the math here (X-27).
--
-- ONE ROW PER BASELINE VERSION, not one row per line (the work order's own
-- 3-01 only requires "a snapshot of every line's four columns", not
-- line-level baseline rows -- simpler, and sufficient). line_snapshot is a
-- JSONB array of { lineItemId, parentLineItemId, qtyProject, rateProject,
-- qtyContract, rateContract } for every line in the BOQ at confirmation time,
-- shaped to match boq-dual-view-service.ts's BoqLineForRollup exactly so
-- rollUpRootLines()/computeCostCoverage() can run directly against it with no
-- adapter (single-producer rule, X-27).
--
-- IMMUTABILITY, ENFORCED AT THE DB LAYER TOO (belt-and-suspenders on top of
-- the service-layer guard, matching this codebase's established convention
-- -- see drizzle/0236's Part A for the audit_logs precedent this follows):
-- UPDATE and DELETE are revoked from BOTH app_runtime and service_role below.
-- HONEST LIMITATION, same as 0236's own: the table owner (`postgres`, the
-- role DATABASE_URL's plain `db` export connects as) retains implicit
-- privileges that REVOKE cannot strip -- no application code path uses that
-- connection to write to this table, so this is a real, if not absolute,
-- guarantee.
--
-- evidence_artefact_ref is NOT NULL AND non-empty at the DB layer (CHECK),
-- on top of confirmBaseline()'s own guard (3-04, D88: PO, proforma, agreed
-- proposal, term sheet, proposal sent, agreement, email, or explicit written
-- confirmation -- this column does not classify which type, matching the
-- spec's own instruction not to attempt that classification).
--
-- No explicit app_runtime/service_role GRANT needed for SELECT/INSERT:
-- drizzle/0010's ALTER DEFAULT PRIVILEGES IN SCHEMA compliance already covers
-- every future table in this schema (see drizzle/0512's identical note).

CREATE TABLE IF NOT EXISTS compliance.boq_baseline (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  boq_id text NOT NULL REFERENCES compliance.construction_boqs(id),
  version integer NOT NULL,
  confirmed_by_id text NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  evidence_artefact_ref text NOT NULL CHECK (btrim(evidence_artefact_ref) <> ''),
  line_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT boq_baseline_boq_id_version_unique UNIQUE (boq_id, version)
);

CREATE INDEX IF NOT EXISTS idx_boq_baseline_org_id ON compliance.boq_baseline(org_id);
CREATE INDEX IF NOT EXISTS idx_boq_baseline_boq_id ON compliance.boq_baseline(boq_id);

ALTER TABLE compliance.boq_baseline ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.boq_baseline
    FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id())
    WITH CHECK (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY service_role_bypass_boq_baseline ON compliance.boq_baseline
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

REVOKE UPDATE, DELETE ON compliance.boq_baseline FROM app_runtime, service_role;
