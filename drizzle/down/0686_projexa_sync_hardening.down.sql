-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-02 in a live Claude Code session ("cost near zero FIRST, ease of work SECOND, security THIRD"); this is the rollback of the sync-hardening migration of the PROJEXA local-first work.
-- Down-migration for drizzle/0686_projexa_sync_hardening.sql. Run deliberately by the PM, not by any script.
-- ORDER: roll back FIRST (before 0684 .. 0678; see 0679's header). It has no prerequisites.
-- DATA LOSS: none (functions only; nothing they pruned comes back, and nothing is pruned by this file). Laptops that poll /heads fall back to /manifest + /changes.
BEGIN;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS platform.projexa_sync_prune();
DROP FUNCTION IF EXISTS platform.projexa_prune_sync_tables();
DROP FUNCTION IF EXISTS platform.projexa_prune_record_heads(interval, integer);
DROP FUNCTION IF EXISTS platform.projexa_prune_change_log(interval, integer);
DROP FUNCTION IF EXISTS platform.projexa_tracking_health();
DROP FUNCTION IF EXISTS public.projexa_sync_ids_digest(text, text, text, text[]);
DROP FUNCTION IF EXISTS public.projexa_sync_heads(text, text);

COMMIT;
