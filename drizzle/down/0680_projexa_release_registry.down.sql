-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-02 in a live Claude Code session ("each file in user to have proper number, version and recorded in backend"); this is the rollback of the release-registry migration of that work.
-- Down-migration for drizzle/0680_projexa_release_registry.sql. Run deliberately by the PM, not by any script.
-- DATA LOSS: the whole registry: every registered release, every file number and file version, the min_compatible floor, and the install history of every laptop. Nothing else is touched.
BEGIN;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.projexa_install_record(text, text, text, text, text, text, timestamptz, timestamptz, integer, bigint, text, text);
DROP FUNCTION IF EXISTS public.projexa_release_set_min_compatible(text);
DROP FUNCTION IF EXISTS public.projexa_release_current();
DROP FUNCTION IF EXISTS public.projexa_release_register(jsonb);
DROP TABLE IF EXISTS platform.projexa_client_install;
DROP TABLE IF EXISTS platform.projexa_release_policy;
DROP TABLE IF EXISTS platform.projexa_release_file;
DROP TABLE IF EXISTS platform.projexa_file;
DROP TABLE IF EXISTS platform.projexa_release;

COMMIT;
