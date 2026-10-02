-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-02 in a live Claude Code session ("complete this 100%"); this is the rollback of the push-ledger migration of that work.
-- Down-migration for drizzle/0681_projexa_sync_push.sql. Run deliberately by the PM, not by any script.
-- DATA LOSS: the push ledger (the record of which laptop ops were applied, rejected or uncertain). The business records those ops wrote are NOT touched. After this a laptop's push route answers 503 and an op already applied could be re-sent as new, so run it only with the sync Edge function's push route disabled.
BEGIN;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.projexa_sync_push_finish(text, text, text, jsonb, text, text, text);
DROP FUNCTION IF EXISTS public.projexa_sync_push_begin(text, text, text, jsonb);
DROP TABLE IF EXISTS platform.projexa_sync_op;

COMMIT;
