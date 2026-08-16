-- Found during Wave 32-34 RLS verification: compliance.is_conversation_
-- participant(conv_id) (Wave 12) checks ONLY conversation_participants.
-- user_id = current_user_id() -- it never independently verifies
-- current_org_id() at all. messages/conversation_participants (Wave 12)
-- and the new message_attachments/conversation_share_links (Wave 32) all
-- rely on this helper alone for their RLS policies, so none of them
-- independently confirm the conversation actually belongs to the caller's
-- org. Not exploitable through this app's own code paths today --
-- withTenantContext's orgId always comes server-side from the
-- authenticated user's real org via requireAuth(), never client-supplied
-- -- but it is a real defense-in-depth gap in the RLS layer itself: any
-- future bug elsewhere that mismatches orgId/userId would leak cross-org
-- conversation data through a check that only verifies participation, not
-- org boundary. Fix: every one of these 4 policies now ALSO joins back to
-- conversations.org_id = current_org_id(), not just is_conversation_
-- participant() alone. is_conversation_participant() itself is left
-- unchanged (still used, just no longer relied on in isolation).

DROP POLICY IF EXISTS app_runtime_participant_only ON compliance.messages;
CREATE POLICY app_runtime_participant_only ON compliance.messages FOR ALL TO app_runtime
  USING (
    compliance.is_conversation_participant(conversation_id)
    AND conversation_id IN (SELECT id FROM compliance.conversations WHERE org_id = compliance.current_org_id())
  );

DROP POLICY IF EXISTS app_runtime_participant_only ON compliance.conversation_participants;
CREATE POLICY app_runtime_participant_only ON compliance.conversation_participants FOR ALL TO app_runtime
  USING (
    compliance.is_conversation_participant(conversation_id)
    AND conversation_id IN (SELECT id FROM compliance.conversations WHERE org_id = compliance.current_org_id())
  );

DROP POLICY IF EXISTS app_runtime_participant_only ON compliance.message_attachments;
CREATE POLICY app_runtime_participant_only ON compliance.message_attachments FOR ALL TO app_runtime
  USING (
    message_id IN (
      SELECT m.id FROM compliance.messages m
      JOIN compliance.conversations c ON c.id = m.conversation_id
      WHERE compliance.is_conversation_participant(m.conversation_id) AND c.org_id = compliance.current_org_id()
    )
  );

DROP POLICY IF EXISTS app_runtime_participant_only ON compliance.conversation_share_links;
CREATE POLICY app_runtime_participant_only ON compliance.conversation_share_links FOR ALL TO app_runtime
  USING (
    compliance.is_conversation_participant(conversation_id)
    AND conversation_id IN (SELECT id FROM compliance.conversations WHERE org_id = compliance.current_org_id())
  );
