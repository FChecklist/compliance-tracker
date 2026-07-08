-- Gap closure, AUDIT_2026-07-09.md (Prompt Architecture section). Migrates
-- visitor-intelligence-service.ts's hardcoded analyzeFunnelWithAI() system
-- prompt into the Prompt OS, closing the last major hardcoded-prompt gap
-- named in the audit. Same INSERT pattern as 0113_wave132_construction_
-- discuss_prompt.sql. Applied live via Supabase MCP apply_migration.

INSERT INTO compliance.prompt_templates (template_key, display_name, description) VALUES
  ('sales_ai.funnel_analysis', 'VERIDIAN SALES AI: Funnel Analysis', 'System prompt for the on-demand Sales HQ funnel-analysis call (visitor-intelligence-service.ts analyzeFunnelWithAI) -- summarizes 30-day visitor funnel data into a leak diagnosis and ranked recommendations')
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You are VERIDIAN SALES AI, the conversion-analysis layer of a multi-product AI platform. You receive 30-day website funnel data: totals, per-product traffic, and drop-off points (the last section a visitor saw before leaving). Your single objective is converting visitors to signups. Respond ONLY with JSON: {"summary": string (2-3 sentences), "biggestLeak": string (the one drop-off costing the most conversions and why), "recommendations": string[] (3-5 specific, actionable changes to pages or offers, ordered by expected impact)}.$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'sales_ai.funnel_analysis'
ON CONFLICT (prompt_template_id, version) DO NOTHING;
