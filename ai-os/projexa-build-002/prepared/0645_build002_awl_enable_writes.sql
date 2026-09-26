-- PROJEXA-BUILD-002 WP-09b (register row AW-511; spec 10.9): THE SWITCH. This file turns platform.ai_work_link_settings.writes_enabled ON: from the
-- moment it commits, every link whose person has role rank 2 or more and whose level is 1 may make its level-1 changes directly, and every
-- confirmed draft is applied. It is PREPARED and NOT APPLIED: it lives here, outside drizzle/, and is in no journal, so no migration runner
-- picks it up. Only the OWNER applies it, and only after the owner steps of ai-os/projexa-build-002/OWNER_SWITCH_ON_GUIDE.md passed (the two secrets are set,
-- scripts/verify/awl-exec-preflight.sh printed AWL_EXEC_READY db_role=app_runtime, and the ai-work-link function was redeployed with EXEC_FUNCTION_PRESENT true).
-- Nothing else in the repository sets this column to true.
--
-- WHAT
--   1. Refuses (RAISE, so the whole transaction rolls back) unless the write path is really in the database: the claim and finish functions of drizzle/0629
--      and the provenance columns of drizzle/0630 exist. A flip without them would turn every write into an error.
--   2. Sets writes_enabled = true and stamps updated_at.
--
-- DATA LOSS: none. One row of one table changes.
--
-- HOW IT IS APPLIED: by the owner, through the Supabase SQL editor or the Supabase MCP, as one transaction (BEGIN and COMMIT are in the file). Idempotent: running
--   it while the switch is already on changes nothing but updated_at.
--
-- THE KILL SWITCH (no migration needed, takes effect on the next request of every link at once, drafts keep recording, an intent that is executing finishes):
--     update platform.ai_work_link_settings set writes_enabled = false, updated_at = now() where id;
--   The same statement is the down file: ai-os/projexa-build-002/prepared/0645_build002_awl_enable_writes.down.sql.
--
-- VERIFY AFTER:  select writes_enabled from platform.ai_work_link_settings;   -- t

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regprocedure('public.ai_work_link_intent_claim(text)') IS NULL
     OR to_regprocedure('public.ai_work_link_intent_finish(text, text, text, jsonb, jsonb)') IS NULL
     OR to_regprocedure('public.ai_work_link_draft_state(text, text, text)') IS NULL THEN
    RAISE EXCEPTION 'AWL_ENABLE_REFUSED: drizzle/0629 (claim, finish, draft_state) is not applied' USING ERRCODE = 'AW500';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'compliance' AND table_name = 'submissions' AND column_name IN ('via', 'ai_link_id')) <> 2 THEN
    RAISE EXCEPTION 'AWL_ENABLE_REFUSED: drizzle/0630 (compliance.submissions.via and ai_link_id) is not applied' USING ERRCODE = 'AW500';
  END IF;
END
$guard$;

UPDATE platform.ai_work_link_settings SET writes_enabled = true, updated_at = now() WHERE id;

DO $check$
BEGIN
  IF NOT (SELECT writes_enabled FROM platform.ai_work_link_settings WHERE id) THEN
    RAISE EXCEPTION 'AWL_ENABLE_REFUSED: the settings row did not change' USING ERRCODE = 'AW500';
  END IF;
END
$check$;

COMMIT;
