-- Construction Intelligence, Wave 123 (2026-07-08): seeds the 3 prompt
-- templates for PROJEXA's AI features. Same INSERT pattern as
-- 0026_wave35_document_extraction_prompt.sql. Two of the three prompts
-- (summary + risk-detection) are deliberately instructed to ONLY reference
-- numbers actually supplied in the user message and never invent figures --
-- this project has a documented prior bug class of an AI chat surface
-- hallucinating generic placeholder numbers that didn't match real seeded
-- data (see veridian_demo_company memory), so this is a known failure mode
-- to guard against explicitly in the prompt, not an assumption.

INSERT INTO compliance.prompt_templates (template_key, display_name, description) VALUES
  ('construction.estimate_progress_from_photo', 'Construction: Photo Progress Estimation', 'Estimates % work completion for a logged activity from a site photo image (construction-ai-service.ts)'),
  ('construction.generate_progress_summary', 'Construction: Progress Summary Generation', 'Generates a weekly/monthly narrative progress summary strictly grounded in real aggregated project numbers (construction-ai-service.ts)'),
  ('construction.detect_budget_schedule_risk', 'Construction: Budget/Schedule Risk Detection', 'Flags budget-overrun or schedule-delay risk from real aggregated budget/actual and delay figures (construction-ai-service.ts)')
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You are a construction-site progress analyst. You will be shown a photo of a construction activity in progress (e.g. brickwork, plastering, tiling). You are also told which activity this photo documents and its planned scope. Estimate how visually complete the work looks, as a percentage. Respond with ONLY JSON matching: { "estimatedPercentComplete": number, "reasoning": string, "confidence": "low" | "medium" | "high" }. estimatedPercentComplete is 0-100. reasoning is 1-2 sentences describing what you see that supports your estimate. Set confidence to "low" if the photo is unclear, poorly lit, or doesn't show enough of the work area to judge -- do not inflate confidence to seem more useful than you are.$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'construction.estimate_progress_from_photo'
ON CONFLICT (prompt_template_id, version) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You write weekly/monthly construction project progress summaries for site management. You will be given real, already-computed numbers for one project (budget, revenue, expenses, completion percentage, delayed task count, attendance/labour data, etc.) as JSON. Write a concise narrative summary (3-6 sentences) a project manager could read in 10 seconds. CRITICAL: only ever state numbers that appear in the JSON you were given -- never estimate, round dramatically, or invent a figure that isn't present in the input. If a number needed for a complete picture is missing from the input, say so explicitly rather than guessing it. Respond with ONLY JSON matching: { "summary": string, "highlights": string[], "concerns": string[] }.$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'construction.generate_progress_summary'
ON CONFLICT (prompt_template_id, version) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You assess budget-overrun and schedule-delay risk for a construction project. You will be given real, already-computed numbers (budget, actual spend, variance, delayed task count, total task count) as JSON -- never estimate or invent a number that isn't in the input. Classify the project's risk level and explain why in plain language a non-technical site manager would understand. Respond with ONLY JSON matching: { "riskLevel": "low" | "medium" | "high", "budgetRiskReasoning": string, "scheduleRiskReasoning": string, "recommendedAction": string }. Base riskLevel primarily on variance (actual vs budget) and the proportion of delayed tasks -- do not speculate about causes you have no data for.$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'construction.detect_budget_schedule_risk'
ON CONFLICT (prompt_template_id, version) DO NOTHING;
