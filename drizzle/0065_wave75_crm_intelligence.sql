-- Wave 75 (CRM Intelligence, AI_OS_CERTIFICATION.md §3.3 NOT_BUILT).
-- Additive columns on crm_leads/crm_opportunities -- no new tables.

ALTER TABLE compliance.crm_leads ADD COLUMN IF NOT EXISTS ai_score integer;
ALTER TABLE compliance.crm_leads ADD COLUMN IF NOT EXISTS ai_score_reasoning text;
ALTER TABLE compliance.crm_leads ADD COLUMN IF NOT EXISTS ai_recommended_action text;
ALTER TABLE compliance.crm_leads ADD COLUMN IF NOT EXISTS ai_scored_at timestamp;

ALTER TABLE compliance.crm_opportunities ADD COLUMN IF NOT EXISTS ai_win_probability integer;
ALTER TABLE compliance.crm_opportunities ADD COLUMN IF NOT EXISTS ai_risk_factors jsonb NOT NULL DEFAULT '[]';
ALTER TABLE compliance.crm_opportunities ADD COLUMN IF NOT EXISTS ai_recommended_action text;
ALTER TABLE compliance.crm_opportunities ADD COLUMN IF NOT EXISTS ai_analyzed_at timestamp;

INSERT INTO compliance.prompt_templates (template_key, display_name, description) VALUES
  ('crm_intelligence.score_lead', 'CRM Intelligence: Lead Scoring Prompt', 'Scores a lead 0-100 with reasoning and a recommended next action (crm-service.ts)'),
  ('crm_intelligence.analyze_opportunity', 'CRM Intelligence: Opportunity Analysis Prompt', 'Estimates win probability, risk factors, and a recommended next action for an opportunity (crm-service.ts)')
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You score sales leads for a compliance/professional-services platform. Given a lead's source, status, contact-info completeness, and age, respond with ONLY JSON matching: { "score": number, "reasoning": string, "recommendedAction": string }. "score" is 0-100 (higher = more likely to convert). "reasoning" is 1-2 sentences. "recommendedAction" is one concrete next step (e.g. "Follow up by phone within 48 hours").$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'crm_intelligence.score_lead'
ON CONFLICT (prompt_template_id, version) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You analyze sales opportunities for a compliance/professional-services platform. Given an opportunity's stage, estimated value, expected close date, and age, respond with ONLY JSON matching: { "winProbability": number, "riskFactors": string[], "recommendedAction": string }. "winProbability" is 0-100. "riskFactors" are concrete concerns (e.g. "No activity in 30 days", "Close date has already passed") -- empty array if none apparent. "recommendedAction" is one concrete next step.$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'crm_intelligence.analyze_opportunity'
ON CONFLICT (prompt_template_id, version) DO NOTHING;
