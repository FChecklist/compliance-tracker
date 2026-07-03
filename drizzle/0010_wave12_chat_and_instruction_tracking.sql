-- Wave 12: Chat + instruction tracking (backend). New scope per
-- PLATFORM_STRATEGY.md's Waves 9-15 plan -- see orchestra_changes.md.
--
-- One `messages` table serves both human threads and each user's private
-- VERIDIAN AI thread (via conversations.is_ai_thread). `comments` and
-- `task_chat_messages` already exist for their own distinct purposes and
-- aren't reused here.
--
-- RLS design: conversations/conversation_participants/messages are scoped to
-- "is the current user a participant of this conversation." A naive
-- self-referential policy on conversation_participants (checking membership
-- by querying conversation_participants again) is a known Postgres RLS
-- footgun -- the standard fix is a SECURITY DEFINER helper function that
-- queries the table directly, bypassing its own RLS for that one internal
-- check, so the policy itself never has to recurse through RLS on the
-- membership table it's protecting.
--
-- instruction_commitments is scoped to its two named parties (assigner OR
-- assignee), not the whole org -- an instruction between two people isn't
-- everyone's business. instruction_mismatch_detections is scoped to the
-- assigner ONLY, per the product rule that "did they actually do what I
-- asked" judgments are never shown to the assignee or a third party.

CREATE TABLE IF NOT EXISTS compliance.conversations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  type text NOT NULL DEFAULT 'direct',
  is_ai_thread boolean NOT NULL DEFAULT false,
  title text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.conversation_participants (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  conversation_id text NOT NULL REFERENCES compliance.conversations(id),
  user_id text NOT NULL REFERENCES compliance.users(id),
  last_read_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.messages (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  conversation_id text NOT NULL REFERENCES compliance.conversations(id),
  sender_id text REFERENCES compliance.users(id),
  content text NOT NULL,
  is_instruction boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.instruction_commitments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  message_id text NOT NULL UNIQUE REFERENCES compliance.messages(id),
  assigner_id text NOT NULL REFERENCES compliance.users(id),
  assignee_id text NOT NULL REFERENCES compliance.users(id),
  described_action text NOT NULL,
  due_date timestamp,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.instruction_mismatch_detections (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  commitment_id text NOT NULL REFERENCES compliance.instruction_commitments(id),
  detected_at timestamp NOT NULL DEFAULT now(),
  comparison_summary text NOT NULL,
  related_task_id text REFERENCES compliance.tasks(id),
  resolution text NOT NULL DEFAULT 'unresolved',
  resolved_at timestamp,
  resolved_by_user_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now()
);

-- SECURITY DEFINER: intentionally bypasses conversation_participants' own
-- RLS for this one internal membership check, so the policies below don't
-- have to re-enter RLS on the same table they're protecting. Owned by the
-- migration-running role (postgres), not app_runtime -- app_runtime can
-- EXECUTE it but the function body runs with the owner's (bypass) privilege.
CREATE OR REPLACE FUNCTION compliance.is_conversation_participant(conv_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = compliance, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM compliance.conversation_participants cp
    WHERE cp.conversation_id = conv_id AND cp.user_id = compliance.current_user_id()
  );
$$;

REVOKE ALL ON FUNCTION compliance.is_conversation_participant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION compliance.is_conversation_participant(text) TO app_runtime;

ALTER TABLE compliance.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.instruction_commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.instruction_mismatch_detections ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_participant_only ON compliance.conversations FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id() AND compliance.is_conversation_participant(id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_conversations ON compliance.conversations FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_participant_only ON compliance.conversation_participants FOR ALL TO app_runtime
    USING (compliance.is_conversation_participant(conversation_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_conversation_participants ON compliance.conversation_participants FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_participant_only ON compliance.messages FOR ALL TO app_runtime
    USING (compliance.is_conversation_participant(conversation_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_messages ON compliance.messages FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- instruction_commitments: visible only to its two named parties, not the
-- whole org -- narrower than plain org-scoping on purpose.
DO $$ BEGIN
  CREATE POLICY app_runtime_parties_only ON compliance.instruction_commitments FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id() AND (assigner_id = compliance.current_user_id() OR assignee_id = compliance.current_user_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_instruction_commitments ON compliance.instruction_commitments FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- instruction_mismatch_detections: assigner-only, enforced at the DB layer,
-- not just a UI filter -- this is the literal "did they actually do what I
-- asked" judgment, which must never reach the assignee or a third party.
DO $$ BEGIN
  CREATE POLICY app_runtime_assigner_only ON compliance.instruction_mismatch_detections FOR ALL TO app_runtime
    USING (EXISTS (
      SELECT 1 FROM compliance.instruction_commitments ic
      WHERE ic.id = instruction_mismatch_detections.commitment_id
        AND ic.assigner_id = compliance.current_user_id()
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_instruction_mismatch_detections ON compliance.instruction_mismatch_detections FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_conversations_org_id ON compliance.conversations(org_id);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_conversation_id ON compliance.conversation_participants(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_user_id ON compliance.conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON compliance.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_instruction_commitments_org_id ON compliance.instruction_commitments(org_id);
CREATE INDEX IF NOT EXISTS idx_instruction_commitments_assigner_id ON compliance.instruction_commitments(assigner_id);
CREATE INDEX IF NOT EXISTS idx_instruction_commitments_assignee_id ON compliance.instruction_commitments(assignee_id);
CREATE INDEX IF NOT EXISTS idx_instruction_commitments_status ON compliance.instruction_commitments(status);
CREATE INDEX IF NOT EXISTS idx_instruction_mismatch_detections_commitment_id ON compliance.instruction_mismatch_detections(commitment_id);

-- Grant service_role the same explicit privileges Wave 10 had to add for the
-- rest of this schema (rolbypassrls only bypasses RLS, not GRANT/REVOKE --
-- see orchestra_changes.md Wave 10's bug #1). ALTER DEFAULT PRIVILEGES from
-- that migration already covers *future* tables in this schema, so these 5
-- explicit grants are the only ones needed here.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.conversations,
  compliance.conversation_participants,
  compliance.messages,
  compliance.instruction_commitments,
  compliance.instruction_mismatch_detections
TO service_role;
