-- PRE-APPROVED-LIVE-DDL: rollback of the 2026-10-02 owner-directed local-first sync read side (drizzle/0677_projexa_sync_read.sql).
-- Down-migration for drizzle/0677. Run deliberately by the PM, not by any script. DATA LOSS: none (functions only).
BEGIN;
DROP FUNCTION IF EXISTS public.projexa_sync_pull(text, text, text, text, text, text, integer);
DROP FUNCTION IF EXISTS public.projexa_sync_manifest(text, text);
DROP FUNCTION IF EXISTS public.projexa_sync__ctx(text, text);
DROP FUNCTION IF EXISTS public.projexa_sync__cursor_field(text);
DROP FUNCTION IF EXISTS public.projexa_sync__src(text);
COMMIT;
