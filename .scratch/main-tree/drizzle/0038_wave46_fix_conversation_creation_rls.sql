-- Wave 46 testing pass: fixes a real, previously-undiscovered production bug
-- found while load-testing VERI Chat's OpenRouter-backed AI thread creation.
--
-- conversations/conversation_participants both had a single FOR ALL policy
-- with only a USING clause -- Postgres reuses USING as the WITH CHECK for
-- INSERT when none is given separately. USING required
-- is_conversation_participant(id)/is_conversation_participant(conversation_id)
-- to already be true, but a brand-new conversation's participant row is
-- only created in the NEXT statement (ensureAiThread()/createConversation()
-- in chat-service.ts insert conversations first, then
-- conversation_participants) -- so no conversation could ever be created at
-- all, for anyone, in production. Confirmed live: org_001's conversations
-- table had zero rows despite Wave 36/37/39 all having claimed to test chat.
--
-- Fix: split each FOR ALL policy into explicit per-command policies. SELECT/
-- UPDATE/DELETE keep the exact same "must be an existing participant"
-- requirement as before (no access-control regression). INSERT gets its own,
-- looser WITH CHECK that only requires the conversation to belong to the
-- caller's own org -- tenant isolation is preserved, but doesn't require a
-- row that cannot exist yet. Actual participant-membership control for who
-- gets added stays an application-layer decision (see createConversation()/
-- ensureAiThread()), same as before this fix.

DROP POLICY IF EXISTS app_runtime_participant_only ON compliance.conversations;

CREATE POLICY app_runtime_select_participant ON compliance.conversations
  FOR SELECT TO app_runtime
  USING (org_id = compliance.current_org_id() AND compliance.is_conversation_participant(id));

CREATE POLICY app_runtime_update_participant ON compliance.conversations
  FOR UPDATE TO app_runtime
  USING (org_id = compliance.current_org_id() AND compliance.is_conversation_participant(id))
  WITH CHECK (org_id = compliance.current_org_id() AND compliance.is_conversation_participant(id));

CREATE POLICY app_runtime_delete_participant ON compliance.conversations
  FOR DELETE TO app_runtime
  USING (org_id = compliance.current_org_id() AND compliance.is_conversation_participant(id));

CREATE POLICY app_runtime_insert_own_org ON compliance.conversations
  FOR INSERT TO app_runtime
  WITH CHECK (org_id = compliance.current_org_id());


DROP POLICY IF EXISTS app_runtime_participant_only ON compliance.conversation_participants;

CREATE POLICY app_runtime_select_participant ON compliance.conversation_participants
  FOR SELECT TO app_runtime
  USING (
    compliance.is_conversation_participant(conversation_id)
    AND conversation_id IN (SELECT id FROM compliance.conversations WHERE org_id = compliance.current_org_id())
  );

CREATE POLICY app_runtime_update_participant ON compliance.conversation_participants
  FOR UPDATE TO app_runtime
  USING (
    compliance.is_conversation_participant(conversation_id)
    AND conversation_id IN (SELECT id FROM compliance.conversations WHERE org_id = compliance.current_org_id())
  )
  WITH CHECK (
    compliance.is_conversation_participant(conversation_id)
    AND conversation_id IN (SELECT id FROM compliance.conversations WHERE org_id = compliance.current_org_id())
  );

CREATE POLICY app_runtime_delete_participant ON compliance.conversation_participants
  FOR DELETE TO app_runtime
  USING (
    compliance.is_conversation_participant(conversation_id)
    AND conversation_id IN (SELECT id FROM compliance.conversations WHERE org_id = compliance.current_org_id())
  );

-- The one genuinely relaxed check: adding participants to a brand-new
-- conversation only requires that conversation to already exist in the
-- caller's own org (guaranteed true once the conversations INSERT above
-- commits, even within the same transaction/request) -- NOT that the caller
-- is already a participant, which is the exact chicken-and-egg this fixes.
CREATE POLICY app_runtime_insert_own_org_conversation ON compliance.conversation_participants
  FOR INSERT TO app_runtime
  WITH CHECK (
    conversation_id IN (SELECT id FROM compliance.conversations WHERE org_id = compliance.current_org_id())
  );
