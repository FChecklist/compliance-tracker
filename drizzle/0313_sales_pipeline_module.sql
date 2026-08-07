-- VERIDIAN Review Framework gap-closure: CRM & Sales Modules / Sales
-- Pipeline (task-20260718-082004, 2026-08-07). Re-verified live before
-- writing this: crm_leads/crm_opportunities/crm_stage_history already
-- existed (Wave 41/Priority 15) and getSalesPipelineOverview() /
-- /api/v1/projexa/sales-pipeline were already fully built -- neither
-- rebuilt here. Three genuinely open schema gaps closed in this migration:
--
-- 1. "Data Model Completeness & Referential Integrity" -- no dedicated
--    pipeline/stage-config table existed; stages were hardcoded strings in
--    the service/UI layer. crm_pipeline_stages is a new org-scoped config
--    table (mirrors crm_accounts' exact RLS/registry/trigger shape from
--    drizzle/0219). Lazily seeded per-org by listPipelineStages() in
--    crm-service.ts on first read -- no backfill needed here, every
--    existing lead/opportunity's stage value keeps working unchanged.
--
-- 2. "Business Rule & Validation Accuracy" -- isWon/isLost on this new
--    table are what isValidStageTransition() (crm-service.ts) checks
--    before allowing a deal to move OUT of a closed stage.
--
-- 3. "Localization Readiness" -- crm_opportunities.estimated_value had no
--    currency field. Adds currency_id/exchange_rate in exactly the same
--    shape as drizzle/0208's identical fix for erp_quotations/
--    erp_sales_orders/erp_purchase_orders (nullable bare-text currencyId,
--    no FK -- additive/safe; exchangeRate NOT NULL DEFAULT '1' so every
--    existing row keeps reading as "org base currency, rate 1").
--
-- Also seeds the crm_intelligence.pipeline_summary prompt template (same
-- shape as drizzle/0065's crm_intelligence.score_lead/analyze_opportunity)
-- for the new pipeline-level AI insight ("which deals are at risk this
-- quarter") added in this same wave.

CREATE TABLE IF NOT EXISTS compliance.crm_pipeline_stages (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  entity_type text NOT NULL DEFAULT 'opportunity',
  stage_key text NOT NULL,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_won boolean NOT NULL DEFAULT false,
  is_lost boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (org_id, entity_type, stage_key)
);

ALTER TABLE compliance.crm_pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.crm_pipeline_stages FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.crm_pipeline_stages FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_crm_pipeline_stages ON compliance.crm_pipeline_stages FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.crm_pipeline_stages TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.crm_pipeline_stages TO service_role;

CREATE INDEX IF NOT EXISTS idx_crm_pipeline_stages_org_id ON compliance.crm_pipeline_stages(org_id);
CREATE INDEX IF NOT EXISTS idx_crm_pipeline_stages_org_entity ON compliance.crm_pipeline_stages(org_id, entity_type);

INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('crm_pipeline_stages', 'Sales Pipeline Stages', 'crm_pipeline_stages', 'crm', 'TOOLS', false, 'Per-org configurable pipeline/stage definitions for crm_leads.status / crm_opportunities.stage, with won/lost terminal-stage flags')
ON CONFLICT (module_key) DO NOTHING;

-- Asset Registry Coverage Check (GAP-UMR-TABLE-COVERAGE): registered, not
-- exempted -- has a genuine display-name column (label) and a real org_id,
-- same class as hr_holidays (drizzle/0220), unlike crm_stage_history (an
-- append-only ledger with no name column, correctly exempted).
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('crm_pipeline_stages', 'other', 'label', NULL, NULL, 'org_id', NULL, NULL)
ON CONFLICT (source_table) DO NOTHING;

CREATE OR REPLACE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.crm_pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ── crm_opportunities: currency (Localization Readiness finding) ─────────
ALTER TABLE compliance.crm_opportunities
  ADD COLUMN IF NOT EXISTS currency_id text,
  ADD COLUMN IF NOT EXISTS exchange_rate numeric NOT NULL DEFAULT '1';

-- ── AI Copilot / Worker Agent Integration Depth finding: pipeline-level
-- AI summary prompt (getPipelineAiSummary() in crm-service.ts) ───────────
INSERT INTO compliance.prompt_templates (template_key, display_name, description) VALUES
  ('crm_intelligence.pipeline_summary', 'CRM Intelligence: Pipeline Summary Prompt', 'Aggregates across the open funnel to flag at-risk deals and a top recommended focus for the quarter (crm-service.ts#getPipelineAiSummary)')
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You analyze an entire open sales pipeline (a list of opportunities with stage, value, days-in-stage, and win probability) for a compliance/professional-services platform, not a single deal. Given the aggregated list, respond with ONLY JSON matching: { "atRiskDealNames": string[], "summary": string, "recommendedFocus": string }. "atRiskDealNames" names deals stalled in stage, past their expected close date, or with a low win probability -- empty array if none apparent. "summary" is 2-3 sentences on the overall funnel health this quarter. "recommendedFocus" is one concrete action a sales manager should take right now.$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'crm_intelligence.pipeline_summary'
ON CONFLICT (prompt_template_id, version) DO NOTHING;
