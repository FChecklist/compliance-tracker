-- Wave 44: VERI Minutes of Meetings -- auditability merge from
-- FChecklist/MeetTrack + FChecklist/meettrack-v2. See PLATFORM_STRATEGY.md
-- §25 for the full evaluation and adopt/reject record. Publish/lock workflow
-- + reference ID on veri_meetings; a due_date on the shared tasks table
-- (meettrack-v2's per-action-item target_date, generalized); a share-link
-- table mirroring Wave 36's conversation_share_links exactly (Wave 36's
-- pattern was judged strictly better than meettrack-v2's own
-- is_published=true=world-readable-forever RLS policy). Field-level audit
-- trail reuses the existing compliance.audit_logs table via logActivity() --
-- no new audit table, unlike meettrack-v2's bespoke meeting_history.

ALTER TABLE compliance.veri_meetings ADD COLUMN IF NOT EXISTS system_id text UNIQUE;
ALTER TABLE compliance.veri_meetings ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft';
ALTER TABLE compliance.veri_meetings ADD COLUMN IF NOT EXISTS published_at timestamp;
ALTER TABLE compliance.veri_meetings ADD COLUMN IF NOT EXISTS published_by_id text REFERENCES compliance.users(id);

ALTER TABLE compliance.tasks ADD COLUMN IF NOT EXISTS due_date timestamp;

CREATE TABLE IF NOT EXISTS compliance.veri_meeting_share_links (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  meeting_id text NOT NULL REFERENCES compliance.veri_meetings(id),
  token text NOT NULL UNIQUE,
  created_by_id text NOT NULL REFERENCES compliance.users(id),
  expires_at timestamp NOT NULL,
  revoked_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.veri_meeting_share_links ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.veri_meeting_share_links FOR ALL TO app_runtime
    USING (meeting_id IN (SELECT id FROM compliance.veri_meetings WHERE org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_veri_meeting_share_links ON compliance.veri_meeting_share_links FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.veri_meeting_share_links TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.veri_meeting_share_links TO service_role;

CREATE INDEX IF NOT EXISTS idx_veri_meeting_share_links_meeting_id ON compliance.veri_meeting_share_links(meeting_id);
CREATE INDEX IF NOT EXISTS idx_veri_meeting_share_links_token ON compliance.veri_meeting_share_links(token);
CREATE INDEX IF NOT EXISTS idx_veri_meetings_status ON compliance.veri_meetings(status);
