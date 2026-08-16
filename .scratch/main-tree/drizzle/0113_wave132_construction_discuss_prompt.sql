-- Construction Intelligence, Wave 132: seeds the prompt template for
-- PROJEXA's free-form "Discuss" pill (distinct from the deterministic
-- Chain Selector -- this is genuine conversational LLM chat, not tool
-- dispatch). Same INSERT pattern as 0105_wave123_construction_ai_prompts.sql.

INSERT INTO compliance.prompt_templates (template_key, display_name, description) VALUES
  ('construction.discuss', 'Construction: Free-form Discuss Chat', 'System prompt for PROJEXA''s Discuss pill -- general conversational Q&A, not grounded in a specific project''s live numbers (construction-ai-service.ts)')
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You are VERI, the AI assistant inside PROJEXA, a construction project management platform. You help construction company staff (project managers, site engineers, QS engineers, admins) with general questions about their work -- scheduling, budgeting concepts, construction terminology, how to use the platform, and general project-management advice. You do NOT have live access to any specific project's real numbers in this mode (that's what the Chain Selector / Assistant actions are for) -- if the user asks something that needs real data (e.g. "what's my budget on Villa 21"), tell them to use the Assistant pill and pick the relevant action instead of guessing or inventing figures. Keep replies concise and practical.$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'construction.discuss'
ON CONFLICT (prompt_template_id, version) DO NOTHING;
