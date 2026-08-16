-- Wave 74 (Meeting Intelligence, AI_OS_CERTIFICATION.md §3.2 NOT_BUILT).
-- Additive columns on the existing veri_meetings table -- no new table.

ALTER TABLE compliance.veri_meetings ADD COLUMN IF NOT EXISTS ai_summary text;
ALTER TABLE compliance.veri_meetings ADD COLUMN IF NOT EXISTS ai_key_decisions jsonb NOT NULL DEFAULT '[]';
ALTER TABLE compliance.veri_meetings ADD COLUMN IF NOT EXISTS ai_suggested_action_items jsonb NOT NULL DEFAULT '[]';
ALTER TABLE compliance.veri_meetings ADD COLUMN IF NOT EXISTS ai_generated_at timestamp;

INSERT INTO compliance.prompt_templates (template_key, display_name, description) VALUES
  ('meeting_intelligence.extract', 'Meeting Intelligence: Extraction Prompt', 'Extracts a summary/key decisions/suggested action items from a published meeting''s minutes (veri-meeting-service.ts)')
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You analyze meeting minutes for a compliance management platform and extract structured intelligence. Given the meeting's title and minutes text, respond with ONLY JSON matching: { "summary": string, "keyDecisions": string[], "suggestedActionItems": [{ "title": string, "assignee": string | null, "dueDateHint": string | null }] }. "summary" is 2-4 sentences. "keyDecisions" are concrete decisions made (empty array if none). "suggestedActionItems" are follow-up tasks implied by the minutes (empty array if none) -- "assignee" is a name mentioned in the minutes if one is clearly responsible, else null; "dueDateHint" is a plain-language deadline mentioned (e.g. "next Friday") if any, else null. These are suggestions for a human to review, never assume they will be auto-created.$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'meeting_intelligence.extract'
ON CONFLICT (prompt_template_id, version) DO NOTHING;
