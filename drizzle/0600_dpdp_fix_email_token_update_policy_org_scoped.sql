-- Real, confirmed-live bug found while proving WO-DPDP-005/007's vertical
-- slice end to end: dpdp.email_token's ONLY UPDATE policy
-- (app_runtime_preauth_use) requires current_org_id() IS NULL -- but the
-- actual "spend the token" UPDATE in answerTaskViaEmailToken() runs
-- inside withDpdpContext(), which SETS current_org_id() to a real value
-- first. That policy's USING/WITH CHECK therefore both evaluate false,
-- RLS silently matches zero rows (no error, no exception -- a Postgres
-- UPDATE that matches zero RLS-visible rows is not a failure), and the
-- code -- which never checks rowCount -- proceeds to update the task and
-- log the event anyway, returning {ok:true} while used_at stays NULL
-- forever.
--
-- CONFIRMED LIVE: 3 separate real calls to answerTaskViaEmailToken() with
-- the SAME raw token each returned {ok:true, answer:"yes"} and each time
-- dpdp.task.answer was (harmlessly) re-set to "yes" -- but
-- dpdp.email_token.used_at stayed NULL across all three. The single-use /
-- replay-refusal guarantee this whole mechanism exists for (WO-005 §3,
-- WO-007 §4.3, the Owner's own step 6: "clicking the same link again is
-- refused and the refusal is recorded") was not actually enforced.
--
-- Fix: add the missing org-scoped UPDATE policy, using the exact same
-- task-join pattern the table's own existing, correct SELECT policy
-- (app_runtime_via_task_org) already uses -- email_token has no org_id
-- column of its own, so "this org" is only knowable via its task. Applied
-- live via Supabase MCP first (name: fix_email_token_update_policy_org_scoped),
-- then recorded here. Re-verified after applying: the same raw token now
-- succeeds exactly once (used_at set, task answered, event logged) and a
-- second click on it is refused and the refusal is itself recorded as a
-- dpdp.event row -- proven against the real production database, not
-- just asserted.
CREATE POLICY app_runtime_update_via_task_org ON dpdp.email_token
  FOR UPDATE
  USING (EXISTS (SELECT 1 FROM dpdp.task t WHERE t.id = email_token.task_id AND t.org_id = dpdp.current_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM dpdp.task t WHERE t.id = email_token.task_id AND t.org_id = dpdp.current_org_id()));
