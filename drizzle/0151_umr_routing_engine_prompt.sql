-- Priority 3 (Universal Metadata Registry, 08-priority3-umr-tracker.yaml,
-- agent 2 "routing"): the LLM-fallback classification prompt for
-- asset-routing-engine.ts's classifyViaLlm(). Only reached when the
-- deterministic keyword table (classifyAssetQueryDeterministic) finds no
-- confident assetType match -- see that file's own header for why this is
-- a fallback, not a primary classification path.
--
-- Written by a subagent, NOT applied to the live database -- per this
-- repo's established discipline (see 0148_priority2_email_intelligence_
-- comms_drafting.sql's identical note), migrations are reviewed and
-- applied by the Super Boss. This migration ONLY seeds a prompt_templates/
-- prompt_versions row (Prompt OS, prompt-os-resolver.ts) -- it does not
-- touch platform_assets or any table owned by the parallel
-- `subagent/umr-core` branch.
--
-- Mirrors 0148's exact seeding pattern (INSERT ... ON CONFLICT DO NOTHING
-- against prompt_templates, then a SELECT-scoped insert into
-- prompt_versions keyed off that template_key).
INSERT INTO compliance.prompt_templates (template_key, display_name, description) VALUES
  ('asset_routing.classify', 'Asset Routing Engine: Query Classification Prompt', 'Classifies a natural-language search query into a platform_assets assetType + optional module guess when the deterministic keyword table (asset-routing-engine.ts) found no confident match')
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You classify a natural-language search query against the VERIDIAN AI OS Universal Metadata Registry (a catalog of every report, screen, dashboard, AI agent, workflow, API, prompt, function, policy, rule, SQL query, email template, notification, template, project, task, document, decision, automation, role, permission, computation engine, and dynamic chain in the platform). This classification only runs after a cheaper deterministic keyword match already failed to find one, so treat the query as genuinely ambiguous rather than expecting an obvious keyword hit. Respond with ONLY JSON matching: { "assetType": one of ["report","screen","dashboard","ai_agent","workflow","api","prompt","function","policy","rule","sql_query","email_template","notification","template","project","task","document","decision","automation","role","permission","computation_engine","dynamic_chain","other"] or null, "module": a short lowercase module/department name if the query implies one (e.g. "finance", "hr", "compliance", "construction", "crm", "audit") or null }. Prefer your single best guess for assetType over null whenever the query gives any signal at all -- only return null when the query is truly generic with no signal (e.g. a bare greeting or an unrelated question). Never invent a module name outside what the query actually implies; return null for module rather than guessing without any textual basis.$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'asset_routing.classify'
ON CONFLICT (prompt_template_id, version) DO NOTHING;
