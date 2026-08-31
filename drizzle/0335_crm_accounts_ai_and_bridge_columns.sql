-- VERIDIAN Review Framework "Accounts & Contacts" gap-closure (2026-08-15).
-- Additive-only columns on the existing compliance.crm_accounts table (no
-- new tables, no changes to crm_contacts) -- closes 2 of the remaining
-- Weight-5-Critical findings from the 2045-row review:
--   - Cross-Module Integration Consistency: crm_accounts had no bridge
--     into erp_customers/clients, unlike crm_leads.clientId /
--     crm_opportunities.erpCustomerId.
--   - AI Copilot / Worker Agent Integration Depth: no aiScore-style
--     enrichment existed for accounts (Wave 75 CRM Intelligence pattern
--     covered crm_leads/crm_opportunities only).
-- See crm-accounts-service.ts#analyzeAccountHealth for the consumer of the
-- ai_* columns below, and schema.ts's crmAccounts table comment for the
-- erp_customer_id/client_id bridge-column rationale.

ALTER TABLE compliance.crm_accounts ADD COLUMN IF NOT EXISTS erp_customer_id text;
ALTER TABLE compliance.crm_accounts ADD COLUMN IF NOT EXISTS client_id text;
ALTER TABLE compliance.crm_accounts ADD COLUMN IF NOT EXISTS ai_health_score integer;
ALTER TABLE compliance.crm_accounts ADD COLUMN IF NOT EXISTS ai_risk_factors jsonb NOT NULL DEFAULT '[]';
ALTER TABLE compliance.crm_accounts ADD COLUMN IF NOT EXISTS ai_recommended_action text;
ALTER TABLE compliance.crm_accounts ADD COLUMN IF NOT EXISTS ai_analyzed_at timestamp;

-- Same prompt_templates/prompt_versions seeding pattern as
-- drizzle/0065_wave75_crm_intelligence.sql's crm_intelligence.score_lead /
-- crm_intelligence.analyze_opportunity rows.
INSERT INTO compliance.prompt_templates (template_key, display_name, description) VALUES
  ('crm_intelligence.analyze_account', 'CRM Intelligence: Account Health Analysis Prompt', 'Estimates account-relationship health score, risk factors, and a recommended next action for a CRM account (crm-accounts-service.ts)')
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You analyze company-level CRM accounts for a compliance/professional-services platform. Given an account's lifecycle stage, industry, age, contact-roster size, and its linked opportunities (count, stage, estimated value, AI win probability where available), respond with ONLY JSON matching: { "healthScore": number, "riskFactors": string[], "recommendedAction": string }. "healthScore" is 0-100 (higher = healthier, more likely to renew/expand). "riskFactors" are concrete concerns (e.g. "No primary contact on file", "No activity in 60 days", "All linked opportunities are stalled") -- empty array if none apparent. "recommendedAction" is one concrete next step.$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'crm_intelligence.analyze_account'
ON CONFLICT (prompt_template_id, version) DO NOTHING;
