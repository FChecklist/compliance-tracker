-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-03 in a live Claude Code session: "if the download is happening, and due to any reason it stops, we should know at our end ... we cannot lose customer"; this is the rollback of the e2e-account exclusion (drizzle/0690_projexa_prepare_e2e_excluded.sql).
-- ROLLBACK of 0690: re-run the CREATE OR REPLACE FUNCTION public.projexa_prepare_health(integer, integer, integer) block of drizzle/0689_projexa_prepare_stuck.sql (no test-account exclusion).
BEGIN;
SELECT 1;
COMMIT;
