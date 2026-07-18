-- AI Architecture / Explainability & Transparency gap-closure (2026-07-18).
-- Additive only: new columns on crm_leads/crm_opportunities, one new
-- glossary table, and new versions of two existing prompt templates (same
-- demote-then-insert shape as 0131_wave155_chat_system_prompt_v2.sql).

ALTER TABLE compliance.crm_leads ADD COLUMN IF NOT EXISTS ai_rejected_alternatives jsonb NOT NULL DEFAULT '[]';
ALTER TABLE compliance.crm_leads ADD COLUMN IF NOT EXISTS ai_assumptions jsonb NOT NULL DEFAULT '[]';
ALTER TABLE compliance.crm_leads ADD COLUMN IF NOT EXISTS ai_confidence text;

ALTER TABLE compliance.crm_opportunities ADD COLUMN IF NOT EXISTS ai_rejected_alternatives jsonb NOT NULL DEFAULT '[]';
ALTER TABLE compliance.crm_opportunities ADD COLUMN IF NOT EXISTS ai_assumptions jsonb NOT NULL DEFAULT '[]';
ALTER TABLE compliance.crm_opportunities ADD COLUMN IF NOT EXISTS ai_confidence text;

-- "Explains Workflow Decisions" -- see schema.ts's orchestraExecutions comment.
ALTER TABLE compliance.orchestra_executions ADD COLUMN IF NOT EXISTS routing_rationale text;

-- Same shape as report_definitions (0180_report_engine_taxonomy.sql): a
-- nullable org_id dictionary table, one org-scoped-or-platform-default
-- policy plus a service-role bypass, using the existing
-- compliance.current_org_id() helper rather than a raw current_setting call.
CREATE TABLE IF NOT EXISTS compliance.business_terminology_glossary (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text REFERENCES compliance.organisations(id), -- nullable = platform-wide
  term text NOT NULL,
  definition text NOT NULL,
  category text,
  aliases jsonb NOT NULL DEFAULT '[]',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.business_terminology_glossary ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped_or_platform_default ON compliance.business_terminology_glossary FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id() OR org_id IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_business_terminology_glossary ON compliance.business_terminology_glossary FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.business_terminology_glossary TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.business_terminology_glossary TO service_role;

-- Seed a modest set of real, already-used platform terms (org_id NULL =
-- platform-wide, visible to every org per the SELECT policy above). Not
-- exhaustive -- a starting set an org can add to via the glossary API.
INSERT INTO compliance.business_terminology_glossary (id, org_id, term, definition, category, aliases) VALUES
  (gen_random_uuid()::text, NULL, 'SPI', 'Schedule Performance Index -- Earned Value divided by Planned Value. Above 1 means a project is ahead of its time-linear schedule baseline, below 1 means behind.', 'construction', '["Schedule Performance Index"]'),
  (gen_random_uuid()::text, NULL, 'CPI', 'Cost Performance Index -- Earned Value divided by Actual Cost. Above 1 means a project is under budget for the work completed so far, below 1 means over budget.', 'construction', '["Cost Performance Index"]'),
  (gen_random_uuid()::text, NULL, 'GST', 'Goods and Services Tax -- India''s indirect tax on the supply of goods and services, filed periodically via GST returns.', 'compliance', '["Goods and Services Tax"]'),
  (gen_random_uuid()::text, NULL, 'TDS', 'Tax Deducted at Source -- tax withheld by a payer on certain payments (salary, contractor fees, rent) and remitted to the government on the payee''s behalf.', 'compliance', '["Tax Deducted at Source"]'),
  (gen_random_uuid()::text, NULL, 'RLS', 'Row-Level Security -- a PostgreSQL feature this platform uses to enforce that every query only ever sees rows belonging to your own organisation, at the database level.', 'platform', '["Row-Level Security", "Row Level Security"]'),
  (gen_random_uuid()::text, NULL, 'BCWP', 'Budgeted Cost of Work Performed -- another name for Earned Value; this platform approximates it as Budget x (% Complete / 100) when no per-activity budget breakdown exists.', 'construction', '["Earned Value", "EV"]'),
  (gen_random_uuid()::text, NULL, 'orgId', 'The internal identifier for your organisation. Every record in the platform is scoped to one orgId so that different organisations'' data never mixes.', 'platform', '["org_id", "organisation ID"]'),
  (gen_random_uuid()::text, NULL, 'Win Probability', 'An AI-estimated percentage likelihood that a sales opportunity will close successfully, based on its stage, value, close date, and activity recency -- not a guarantee.', 'crm', '["AI Win Probability"]'),
  (gen_random_uuid()::text, NULL, 'RFI', 'Request for Information -- a formal query raised on a construction project (e.g. by a contractor to an architect) that needs an answer before work can proceed.', 'construction', '["Request for Information"]'),
  (gen_random_uuid()::text, NULL, 'BOQ', 'Bill of Quantities -- an itemised list of construction work/materials with quantities and rates, used for costing and progress tracking.', 'construction', '["Bill of Quantities"]')
ON CONFLICT DO NOTHING;

-- ─── Prompt version bumps (same demote-then-insert shape as
-- 0131_wave155_chat_system_prompt_v2.sql) -- crm_intelligence.score_lead and
-- crm_intelligence.analyze_opportunity now also request rejectedAlternatives/
-- assumptions/confidence, closing "Explain 'Why Not' for Rejected Options"
-- and feeding the new aiRejectedAlternatives/aiAssumptions/aiConfidence
-- columns added above.

DO $$
DECLARE
  tpl_id text;
  next_version integer;
BEGIN
  SELECT id INTO tpl_id FROM compliance.prompt_templates WHERE template_key = 'crm_intelligence.score_lead';
  IF tpl_id IS NOT NULL THEN
    UPDATE compliance.prompt_versions SET label = NULL WHERE prompt_template_id = tpl_id AND label = 'production';
    SELECT COALESCE(MAX(version), 0) + 1 INTO next_version FROM compliance.prompt_versions WHERE prompt_template_id = tpl_id;
    INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
    VALUES (
      tpl_id, next_version,
      $tpl$You score sales leads for a compliance/professional-services platform. Given a lead's source, status, contact-info completeness, and age, respond with ONLY JSON matching: { "score": number, "reasoning": string, "recommendedAction": string, "confidence": "low"|"medium"|"high", "assumptions": string[], "rejectedAlternatives": { "option": string, "reason": string }[] }. "score" is 0-100 (higher = more likely to convert). "reasoning" is 1-2 sentences. "recommendedAction" is one concrete next step (e.g. "Follow up by phone within 48 hours"). "confidence" reflects how much real signal the input data actually gives you -- "low" if the lead has very little information (no source, no contact info). "assumptions" lists anything you had to assume given missing data (empty array if none). "rejectedAlternatives" lists 1-2 other plausible next steps you considered and did NOT recommend, each with a short reason why the recommended action is better (empty array only if genuinely no other reasonable action exists).$tpl$,
      'production'
    );
  END IF;

  SELECT id INTO tpl_id FROM compliance.prompt_templates WHERE template_key = 'crm_intelligence.analyze_opportunity';
  IF tpl_id IS NOT NULL THEN
    UPDATE compliance.prompt_versions SET label = NULL WHERE prompt_template_id = tpl_id AND label = 'production';
    SELECT COALESCE(MAX(version), 0) + 1 INTO next_version FROM compliance.prompt_versions WHERE prompt_template_id = tpl_id;
    INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
    VALUES (
      tpl_id, next_version,
      $tpl$You analyze sales opportunities for a compliance/professional-services platform. Given an opportunity's stage, estimated value, expected close date, and age, respond with ONLY JSON matching: { "winProbability": number, "riskFactors": string[], "recommendedAction": string, "confidence": "low"|"medium"|"high", "assumptions": string[], "rejectedAlternatives": { "option": string, "reason": string }[] }. "winProbability" is 0-100. "riskFactors" are concrete concerns (e.g. "No activity in 30 days", "Close date has already passed") -- empty array if none apparent. "recommendedAction" is one concrete next step. "confidence" reflects how much real signal the input data gives you. "assumptions" lists anything you had to assume given missing data (empty array if none). "rejectedAlternatives" lists 1-2 other plausible next steps you considered and did NOT recommend, each with a short reason why the recommended action is better (empty array only if genuinely no other reasonable action exists).$tpl$,
      'production'
    );
  END IF;
END $$;
