-- R85 Addendum 3 v4, Phase 4 (E3, gates 4-01/4-02/4-07; owner rulings D87
-- claude_log 366, D88 372, D91 375; supersession notice 379). Hand-authored,
-- additive-only, matching drizzle/0593's own precedent -- `drizzle-kit
-- generate` cannot be trusted on this repo (its local snapshot is far behind
-- the live schema's true history, per this repo's documented drizzle-vs-
-- live-history gap: a bare `generate` run against these two schema.ts edits
-- produced a 1300+ line file trying to CREATE TABLE dozens of tables that
-- already exist live -- discarded, not applied).
--
-- Applied LIVE against pcrjmlpuqsbocqfwoxod via Supabase MCP apply_migration
-- BEFORE this file was committed, per this repo's established practice. This
-- file is the committed record of that change.
--
-- Two independent, unrelated additions, both nullable-or-defaulted so every
-- existing row keeps behaving exactly as before:
--
-- 1) projects.vatRatePercent / projects.retentionPercent -- the Phase 4
--    gross/net stack's two configurable rates (4-01/4-02). See schema.ts's
--    own comment on these two columns for why they live on `projects` and
--    not a separate jurisdiction/org-settings table (this schema has none).
--
-- 2) construction_boqs.contract_value_override + its actor/timestamp/reason/
--    evidence-artefact columns -- the MANUAL CONTRACT OVERRIDE (4-07, D88).
--    BOQ-header level, not per line item. NEVER overwrites the computed
--    rolled-up total (X-12) -- both are retained; resolveEffectiveContractValue()
--    in boq-dual-view-service.ts is the one place that decides which is "in
--    force". Nullable at the DB level so this stays a plain additive ALTER
--    TABLE; applyContractOverride() (the only writer) enforces "reason AND
--    evidenceArtefactRef both non-empty" at the service layer.

ALTER TABLE compliance.projects
  ADD COLUMN vat_rate_percent numeric NOT NULL DEFAULT 5,
  ADD COLUMN retention_percent numeric NOT NULL DEFAULT 5;

ALTER TABLE compliance.construction_boqs
  ADD COLUMN contract_value_override numeric,
  ADD COLUMN override_actor_id text,
  ADD COLUMN override_at timestamp,
  ADD COLUMN override_reason text,
  ADD COLUMN evidence_artefact_ref text;

COMMENT ON COLUMN compliance.projects.vat_rate_percent IS 'R85 Addendum 3 Phase 4 (4-01, D91 E3): VAT rate applied in the gross/net stack. Default 5 (AE). Project-level because this schema has no separate jurisdiction/org-settings table -- see schema.ts.';
COMMENT ON COLUMN compliance.projects.retention_percent IS 'R85 Addendum 3 Phase 4 (4-02, D91 E3): retention % applied in the gross/net stack (the project''s TARGET/default rate, distinct from constructionInterimBills.retentionPercent / erpPurchaseInvoices.retentionPercent, which are real per-transaction rates snapshotted at billing time). Default 5.';
COMMENT ON COLUMN compliance.construction_boqs.contract_value_override IS 'R85 Addendum 3 Phase 4 (4-07, D88): manual override of this BOQ''s contract value. NEVER overwrites the computed rollup -- both retained, see resolveEffectiveContractValue() in boq-dual-view-service.ts. NULL = no override in force.';
COMMENT ON COLUMN compliance.construction_boqs.override_actor_id IS 'R85 Addendum 3 Phase 4 (4-07/4-08): user id who set contract_value_override. Set/cleared together with contract_value_override/override_at/override_reason/evidence_artefact_ref by applyContractOverride() only.';
COMMENT ON COLUMN compliance.construction_boqs.override_at IS 'R85 Addendum 3 Phase 4 (4-07/4-08): timestamp contract_value_override was set.';
COMMENT ON COLUMN compliance.construction_boqs.override_reason IS 'R85 Addendum 3 Phase 4 (4-07): required non-empty by applyContractOverride() at the service layer (nullable here only so this ALTER TABLE stays additive).';
COMMENT ON COLUMN compliance.construction_boqs.evidence_artefact_ref IS 'R85 Addendum 3 Phase 4 (4-07, D88): cited evidence artefact for the override -- required non-empty by applyContractOverride() at the service layer.';
