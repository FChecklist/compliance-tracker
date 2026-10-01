-- PRE-APPROVED-LIVE-DDL: rollback of the 2026-10-02 owner-requested first-user self-heal (drizzle/0675_awl_first_user_self_heal.sql).
-- Down-migration for drizzle/0675. Run deliberately by the PM, not by any script. DATA LOSS: none (a user row it created stays; only the function goes).
BEGIN;
DROP FUNCTION IF EXISTS public.projexa_ensure_first_user(text, uuid, text, text);
COMMIT;
