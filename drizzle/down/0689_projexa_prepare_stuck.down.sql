-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-03 in a live Claude Code session: "if the download is happening, and due to any reason it stops, we should know at our end ... we cannot lose customer"; this is the rollback of the "stuck" detection (drizzle/0689_projexa_prepare_stuck.sql).
-- ROLLBACK of 0689: removes progress_at and the three-argument health function. The report and the two-argument health function of
-- 0688 are restored by re-running the CREATE OR REPLACE blocks of drizzle/0688_projexa_prepare_monitor.sql (sections 2 and 3).
BEGIN;
DROP FUNCTION IF EXISTS public.projexa_prepare_health(integer, integer, integer);
ALTER TABLE platform.projexa_prepare_state DROP COLUMN IF EXISTS progress_at;
COMMIT;
