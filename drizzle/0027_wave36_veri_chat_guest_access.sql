-- Wave 36: VERI Chat guest access. The original VERI Chat spec named
-- "customers, vendors" as chat parties, but conversation_participants.
-- user_id is NOT NULL against the internal users table -- there was no
-- way for an external party without a VERIDIAN account to participate.
-- Mattermost/Zulip/Rocket.Chat/Element/Chatwoot were evaluated and
-- rejected as software (every one needs its own standalone server); their
-- guest-role/Omnichannel/customer-chat concepts independently confirmed
-- this real gap. See PLATFORM_STRATEGY.md §17.8-17.9.
--
-- Same shape as conversation_share_links (Wave 32), but write-capable.
-- RLS applies the org+participant-scoping fix from migration 0025
-- (is_conversation_participant() alone is not enough) from the start this
-- time, rather than being discovered live a third time.

CREATE TABLE IF NOT EXISTS compliance.conversation_guest_access (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  conversation_id text NOT NULL REFERENCES compliance.conversations(id),
  token text NOT NULL UNIQUE,
  guest_name text NOT NULL,
  guest_email text,
  invited_by_id text NOT NULL REFERENCES compliance.users(id),
  expires_at timestamp NOT NULL,
  revoked_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.messages ADD COLUMN IF NOT EXISTS guest_access_id text REFERENCES compliance.conversation_guest_access(id);

ALTER TABLE compliance.conversation_guest_access ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_participant_only ON compliance.conversation_guest_access FOR ALL TO app_runtime
    USING (
      compliance.is_conversation_participant(conversation_id)
      AND conversation_id IN (SELECT id FROM compliance.conversations WHERE org_id = compliance.current_org_id())
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_conversation_guest_access ON compliance.conversation_guest_access FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.conversation_guest_access TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.conversation_guest_access TO service_role;

CREATE INDEX IF NOT EXISTS idx_conversation_guest_access_conversation_id ON compliance.conversation_guest_access(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_guest_access_token ON compliance.conversation_guest_access(token);
CREATE INDEX IF NOT EXISTS idx_messages_guest_access_id ON compliance.messages(guest_access_id);
