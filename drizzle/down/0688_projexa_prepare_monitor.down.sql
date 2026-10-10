-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-03 in a live Claude Code session: "if the download is happening, and due to any reason it stops, we should know at our end ... we cannot lose customer"; this is the rollback of that monitor (drizzle/0688_projexa_prepare_monitor.sql).
-- ROLLBACK of 0688_projexa_prepare_monitor: removes the prepare monitor (its report history is lost; nothing else depends on it).
BEGIN;
DROP FUNCTION IF EXISTS public.projexa_prepare_health(integer, integer);
DROP FUNCTION IF EXISTS public.projexa_prepare_report(text, text, text, text, text, integer, text, integer, text, text);
DROP TABLE IF EXISTS platform.projexa_prepare_event;
DROP TABLE IF EXISTS platform.projexa_prepare_state;
COMMIT;
