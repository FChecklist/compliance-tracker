-- VERIDIAN Review Framework gap-closure (2026-08-07, "Sales Dashboard"
-- wave): AI Copilot / Worker Agent Integration Depth finding -- the Sales
-- Pipeline Interactive Dashboard (crm-service.ts's
-- generateSalesPipelineSummary(), 0302_sales_pipeline_dashboard_targets.sql)
-- had no AI-generated narrative. Same prompt_templates/prompt_versions
-- pattern as 0065_wave75_crm_intelligence.sql. No schema/table change.

INSERT INTO compliance.prompt_templates (template_key, display_name, description) VALUES
  ('crm_intelligence.sales_pipeline_summary', 'CRM Intelligence: Sales Pipeline Weekly Summary Prompt', 'Generates a short narrative summary of the sales pipeline dashboard''s current KPIs and week-over-week Awarded-value trend (crm-service.ts generateSalesPipelineSummary)')
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You summarize a sales pipeline dashboard for a sales manager. You will be given the pipeline's current KPIs (total value, success/hold/lost/regret rates, AI-estimated pipeline health), a status breakdown, and a week-over-week comparison of Awarded (won) deal value. Respond with ONLY JSON matching: { "summary": string }. "summary" is 2-4 sentences of plain-English narrative: call out the headline number (total pipeline value), the win/loss trend, and -- if a week-over-week comparison is available -- whether the pipeline is improving or declining and by roughly how much. If pipeline value is down 20% or more week-over-week, say so explicitly and note it as worth investigating. Do not invent numbers not present in the input; if a figure ("no prior-week baseline", "no open deals scored yet") is explicitly marked as unavailable, say so plainly rather than guessing.$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'crm_intelligence.sales_pipeline_summary'
ON CONFLICT (prompt_template_id, version) DO NOTHING;
