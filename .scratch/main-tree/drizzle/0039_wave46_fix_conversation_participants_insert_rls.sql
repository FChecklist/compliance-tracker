-- Wave 46 testing pass, part 2: fixes a second, deeper layer of the same
-- chicken-and-egg RLS problem migration 0038 already fixed for
-- `conversations`. Once conversations' own INSERT was fixed,
-- conversation_participants' INSERT still failed -- its WITH CHECK
-- subquery ("conversation_id IN (SELECT id FROM conversations WHERE
-- org_id = current_org_id())") is itself a SELECT against `conversations`,
-- and is therefore filtered by conversations' OWN SELECT policy
-- (app_runtime_select_participant), which requires is_conversation_
-- participant() -- impossible to be true yet, since we're in the middle
-- of inserting the very first participant. Confirmed live via the
-- temporary test harness: the real VERI Chat call path got past the
-- conversations insert (fixed by 0038) only to fail identically on
-- conversation_participants.
--
-- Fix: a SECURITY DEFINER helper (matching the existing
-- is_conversation_participant() convention) that reads conversations.org_id
-- directly, bypassing conversations' own RLS for this one internal lookup
-- (SECURITY DEFINER functions run as their owner, not the caller -- same
-- mechanism is_conversation_participant() itself already relies on).

CREATE OR REPLACE FUNCTION compliance.conversation_org_id(conv_id text)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'compliance', 'pg_temp'
AS $$
  SELECT org_id FROM compliance.conversations WHERE id = conv_id;
$$;

DROP POLICY IF EXISTS app_runtime_insert_own_org_conversation ON compliance.conversation_participants;
CREATE POLICY app_runtime_insert_own_org_conversation ON compliance.conversation_participants
  FOR INSERT TO app_runtime
  WITH CHECK (compliance.conversation_org_id(conversation_id) = compliance.current_org_id());
