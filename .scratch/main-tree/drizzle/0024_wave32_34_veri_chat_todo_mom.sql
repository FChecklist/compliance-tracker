-- Waves 32-34: VERI Chat, VERI To Do, VERI Minutes of Meetings. Extends
-- Wave 12's conversations/messages (does not replace them). See
-- PLATFORM_STRATEGY.md §16 for the full gap analysis and design record.
-- VERI To Do has no schema of its own -- it's a service-layer rule fix
-- (see task-service.ts's listMyTodos()).

-- ============================================================
-- VERI Chat: conversations/messages gain context + attribution + share
-- ============================================================
ALTER TABLE compliance.conversations ADD COLUMN IF NOT EXISTS context_entity_type text;
ALTER TABLE compliance.conversations ADD COLUMN IF NOT EXISTS context_entity_id text;

ALTER TABLE compliance.messages ADD COLUMN IF NOT EXISTS assistant_id text REFERENCES compliance.ai_assistants(id);
ALTER TABLE compliance.messages ADD COLUMN IF NOT EXISTS source_platform text;
ALTER TABLE compliance.messages ADD COLUMN IF NOT EXISTS source_ref text;

CREATE INDEX IF NOT EXISTS idx_conversations_context ON compliance.conversations(context_entity_type, context_entity_id);

CREATE TABLE IF NOT EXISTS compliance.message_attachments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  message_id text NOT NULL REFERENCES compliance.messages(id),
  document_id text NOT NULL REFERENCES compliance.documents(id),
  created_at timestamp NOT NULL DEFAULT now()
);

-- Tokenized, time-limited, read-only public share -- the safe mechanism
-- §16.2 concluded is the only sound way to put a conversation "into" a
-- wa.me/t.me link (no web link can extract an existing WhatsApp/Telegram
-- chat, and raw chat content must never sit in a URL).
CREATE TABLE IF NOT EXISTS compliance.conversation_share_links (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  conversation_id text NOT NULL REFERENCES compliance.conversations(id),
  token text NOT NULL UNIQUE,
  created_by_id text NOT NULL REFERENCES compliance.users(id),
  expires_at timestamp NOT NULL,
  revoked_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.message_attachments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_participant_only ON compliance.message_attachments FOR ALL TO app_runtime
    USING (message_id IN (SELECT id FROM compliance.messages WHERE compliance.is_conversation_participant(conversation_id)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_message_attachments ON compliance.message_attachments FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.message_attachments TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.message_attachments TO service_role;

ALTER TABLE compliance.conversation_share_links ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_participant_only ON compliance.conversation_share_links FOR ALL TO app_runtime
    USING (compliance.is_conversation_participant(conversation_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_conversation_share_links ON compliance.conversation_share_links FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.conversation_share_links TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.conversation_share_links TO service_role;

CREATE INDEX IF NOT EXISTS idx_message_attachments_message_id ON compliance.message_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_conversation_share_links_conversation_id ON compliance.conversation_share_links(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_share_links_token ON compliance.conversation_share_links(token);

-- ============================================================
-- VERI Minutes of Meetings: genuinely new, general-purpose (same call as
-- Knowledge Base in Wave 29) -- board_meetings and pms_meetings are both
-- real but scope-locked to governance and PMS respectively.
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance.veri_meetings (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  context_entity_type text,
  context_entity_id text,
  title text NOT NULL,
  meeting_type text NOT NULL DEFAULT 'team',
  scheduled_at timestamp NOT NULL,
  attendees jsonb NOT NULL DEFAULT '[]',
  agenda jsonb NOT NULL DEFAULT '[]',
  minutes text,
  minutes_history jsonb NOT NULL DEFAULT '[]',
  created_by_id text NOT NULL REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.veri_meeting_action_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  meeting_id text NOT NULL REFERENCES compliance.veri_meetings(id),
  task_id text NOT NULL REFERENCES compliance.tasks(id),
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.veri_meetings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.veri_meetings FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_veri_meetings ON compliance.veri_meetings FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.veri_meetings TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.veri_meetings TO service_role;

ALTER TABLE compliance.veri_meeting_action_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.veri_meeting_action_items FOR ALL TO app_runtime
    USING (meeting_id IN (SELECT id FROM compliance.veri_meetings WHERE org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_veri_meeting_action_items ON compliance.veri_meeting_action_items FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.veri_meeting_action_items TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.veri_meeting_action_items TO service_role;

CREATE INDEX IF NOT EXISTS idx_veri_meetings_org_id ON compliance.veri_meetings(org_id);
CREATE INDEX IF NOT EXISTS idx_veri_meetings_context ON compliance.veri_meetings(context_entity_type, context_entity_id);
CREATE INDEX IF NOT EXISTS idx_veri_meeting_action_items_meeting_id ON compliance.veri_meeting_action_items(meeting_id);
CREATE INDEX IF NOT EXISTS idx_veri_meeting_action_items_task_id ON compliance.veri_meeting_action_items(task_id);

-- ============================================================
-- Module Registry: register all 3 as core modules.
-- ============================================================
INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('veri_chat', 'VERI Chat', 'conversations', 'communication', 'TOOLS', true, 'Enterprise AI chat connecting users, modules, worker agents, and external share-in/share-out'),
  ('veri_todo', 'VERI To Do', 'tasks', 'communication', 'TOOLS', true, 'Unified pending-work view across tasks, instruction commitments, and assigned PMS issues'),
  ('veri_meetings', 'VERI Minutes of Meetings', 'veri_meetings', 'communication', 'TOOLS', true, 'General-purpose meeting minutes with AI-assisted structuring and task-linked action items')
ON CONFLICT (module_key) DO NOTHING;
