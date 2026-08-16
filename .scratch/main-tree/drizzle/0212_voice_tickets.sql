-- Priority 14 Wave 2 (GAP-MOM-VOICE-TICKETS): a user records/uploads a
-- short voice memo, transcribed via OpenAI Whisper (src/lib/whisper-client.ts,
-- OPENAI_API_KEY -- Owner decision 2026-07-14), turned into real `tasks`
-- rows via the same reuse discipline veri_meetings already established for
-- text minutes. New tables only -- no existing table altered.

CREATE TABLE IF NOT EXISTS compliance.voice_memos (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  user_id text NOT NULL,
  meeting_id text,
  audio_storage_path text NOT NULL,
  audio_mime_type text,
  duration_seconds integer,
  status text NOT NULL DEFAULT 'uploaded',
  error_message text,
  transcript text,
  ai_summary text,
  ai_suggested_action_items jsonb NOT NULL DEFAULT '[]',
  ai_generated_at timestamp,
  transcribed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.voice_memo_action_items (
  id text PRIMARY KEY,
  voice_memo_id text NOT NULL,
  task_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voice_memos_org_id ON compliance.voice_memos(org_id);
CREATE INDEX IF NOT EXISTS idx_voice_memos_meeting_id ON compliance.voice_memos(meeting_id);
CREATE INDEX IF NOT EXISTS idx_voice_memos_user_id ON compliance.voice_memos(user_id);
CREATE INDEX IF NOT EXISTS idx_voice_memo_action_items_voice_memo_id ON compliance.voice_memo_action_items(voice_memo_id);

-- Standalone (non-meeting-attached) voice-memo extraction prompt -- mirrors
-- meeting_intelligence.extract's own registration convention exactly
-- (drizzle/0064_wave74_meeting_intelligence.sql). Meeting-attached voice
-- memos reuse meeting_intelligence.extract as-is (the transcript becomes
-- that meeting's minutes), so this template is only invoked for a memo with
-- no meeting_id.
INSERT INTO compliance.prompt_templates (template_key, display_name, description) VALUES
  ('voice_ticket.extract', 'Voice Tickets: Extraction Prompt', 'Extracts a summary/suggested action items from a standalone voice memo transcript (voice-ticket-service.ts)')
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You analyze the transcript of a short voice memo recorded by a user of a compliance/operations management platform and extract structured intelligence. The transcript is informal spoken language transcribed by a speech-to-text engine -- it may contain filler words, false starts, or minor transcription errors; interpret intent, don't quote it verbatim in your output. Respond with ONLY JSON matching: { "summary": string, "suggestedActionItems": [{ "title": string, "assignee": string | null, "dueDateHint": string | null }] }. "summary" is 1-3 sentences capturing what the memo is about. "suggestedActionItems" are concrete follow-up tasks implied by the memo (empty array if the memo is just a note with no action implied) -- "assignee" is a name clearly mentioned as responsible, else null; "dueDateHint" is a plain-language deadline mentioned (e.g. "by Friday") if any, else null. These are suggestions for a human to review, never assume they will be auto-created.$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'voice_ticket.extract'
ON CONFLICT (prompt_template_id, version) DO NOTHING;

-- RLS -- mirrors veri_meetings / veri_meeting_action_items exactly
-- (app_runtime_org_scoped USING org_id = compliance.current_org_id() for
-- the org-scoped parent table, a join-through-parent USING clause for the
-- child join table, plus a service_role_bypass USING (true) policy on
-- both, same 2-policy-per-table shape every other tenant-scoped table in
-- this codebase uses).
ALTER TABLE compliance.voice_memos ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.voice_memos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_runtime_org_scoped ON compliance.voice_memos;
CREATE POLICY app_runtime_org_scoped ON compliance.voice_memos
  FOR ALL TO app_runtime
  USING (org_id = compliance.current_org_id());
DROP POLICY IF EXISTS service_role_bypass_voice_memos ON compliance.voice_memos;
CREATE POLICY service_role_bypass_voice_memos ON compliance.voice_memos
  FOR ALL TO service_role
  USING (true);

ALTER TABLE compliance.voice_memo_action_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.voice_memo_action_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_runtime_org_scoped ON compliance.voice_memo_action_items;
CREATE POLICY app_runtime_org_scoped ON compliance.voice_memo_action_items
  FOR ALL TO app_runtime
  USING (voice_memo_id IN (SELECT id FROM compliance.voice_memos WHERE org_id = compliance.current_org_id()));
DROP POLICY IF EXISTS service_role_bypass_voice_memo_action_items ON compliance.voice_memo_action_items;
CREATE POLICY service_role_bypass_voice_memo_action_items ON compliance.voice_memo_action_items
  FOR ALL TO service_role
  USING (true);
