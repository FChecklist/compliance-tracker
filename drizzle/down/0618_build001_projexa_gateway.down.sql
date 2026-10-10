-- Down-migration for drizzle/0618_build001_projexa_gateway.sql (PROJEXA-BUILD-001 U-25, PMD-01). Convention: docs/ROLLBACK_RUNBOOK.md
-- section 3. Not auto-applied by any script or CI job; the PM runs it deliberately, after the same always-aborted rehearsal as the
-- forward file (section 4a).
--
-- WHAT IT RESTORES: the database as it was before 0618 -- the three functions public.projexa_read_boq_lines,
--   public.projexa_read_resolve_user and public.projexa_read_enabled are dropped, and so is the table
--   platform.projexa_gateway_settings. Schema platform itself is left alone (it existed before 0618; the forward file only creates
--   it where it is missing, as in the PGlite replay).
--
-- DATA LOSS: the one row of platform.projexa_gateway_settings (the switch values enabled and email_fallback, and updated_at). That
--   row is configuration, not business data; re-applying the forward file recreates it with both switches OFF, so a gateway that
--   was switched on stays off until a new reviewed migration switches it on again. No compliance.* row is read or written by
--   this file. With the functions gone the Edge Function projexa-read, if still deployed, answers 503 to every verified caller
--   (its switch RPC fails, which it treats as off), so undeploy it separately.
--
-- WHEN IT REFUSES: it does not.
--
-- Safe to run twice: every step checks for its own object first.

BEGIN;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.projexa_read_boq_lines(text, text, text, text, integer);
DROP FUNCTION IF EXISTS public.projexa_read_resolve_user(text, text);
DROP FUNCTION IF EXISTS public.projexa_read_enabled();
DROP TABLE IF EXISTS platform.projexa_gateway_settings;

COMMIT;
