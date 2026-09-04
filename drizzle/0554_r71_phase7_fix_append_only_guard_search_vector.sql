-- R71 Phase 7 (U7-05 adversarial proof), REAL PRE-EXISTING DEFECT FOUND AND
-- FIXED. compliance.memory_records.search_vector is a GENERATED ALWAYS column
-- (to_tsvector('english', coalesce(content,''))). PostgreSQL does not compute
-- a GENERATED column's value until AFTER a row's BEFORE triggers return --
-- inside fn_memory_records_append_only_guard() (BEFORE UPDATE), NEW.search_
-- vector reads as NULL while OLD.search_vector holds the real stored
-- tsvector. search_vector was never added to the guard's allowed-columns
-- strip list, so to_jsonb(OLD) vs to_jsonb(NEW) always differed on this one
-- column -- meaning EVERY update via app_runtime has been rejected since this
-- guard was created (R68 Phase 1), including the legitimate supersede path
-- (touching only effective_to/superseded_by_id/lifecycle_state/updated_at/
-- metadata) the guard is explicitly supposed to still permit. Confirmed live
-- via an instrumented probe trigger (dropped immediately after, no residue):
-- OLD.search_vector=['fixtur':2 'probe':1], NEW.search_vector=[NULL], on a
-- bare metadata-only UPDATE that touched nothing else.
--
-- FIX: search_vector is derived entirely from `content`, which the guard
-- already protects directly -- if content is unchanged, search_vector's real
-- value cannot meaningfully change either, so excluding it from the diff
-- loses no real protection. Added to the same allowed-columns array the
-- other system-managed columns already use, rather than inventing a special
-- case.
CREATE OR REPLACE FUNCTION compliance.fn_memory_records_append_only_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'compliance', 'pg_temp'
AS $function$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_allowed text[] := ARRAY['effective_to', 'superseded_by_id', 'lifecycle_state', 'updated_at', 'metadata', 'search_vector'];
  v_key text;
BEGIN
  IF current_user <> 'app_runtime' THEN
    RETURN NEW;
  END IF;

  v_old := to_jsonb(OLD);
  v_new := to_jsonb(NEW);

  FOREACH v_key IN ARRAY v_allowed LOOP
    v_old := v_old - v_key;
    v_new := v_new - v_key;
  END LOOP;

  IF v_old IS DISTINCT FROM v_new THEN
    RAISE EXCEPTION 'compliance.memory_records is append-only for app_runtime: an UPDATE may only change effective_to, superseded_by_id, lifecycle_state, updated_at, or metadata. Close this row and INSERT a new one instead (see supersedeMemoryRecord() in src/lib/services/memory-service.ts).'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$function$;
