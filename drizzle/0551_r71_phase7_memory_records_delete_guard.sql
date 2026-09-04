-- R71 Phase 7 (U7-02), per binding ruling R-IMG-29: compliance.memory_records
-- currently blocks tampering UPDATEs (trg_memory_records_append_only) but has
-- NO delete protection at all -- an app-level DELETE permanently destroys a
-- row, which R70 found live and unfixed.
--
-- Same role-gating convention as fn_memory_records_append_only_guard(): only
-- app_runtime is checked, so a migration/superuser session (this one) is
-- unaffected. The lawful bypass is a session-scoped GUC,
-- app.memory_delete_authorized, that only an authorised erasure or
-- break-glass code path is expected to SET LOCAL before its own DELETE --
-- never a role name, per R-IMG-29's own requirement.
CREATE OR REPLACE FUNCTION compliance.fn_memory_records_delete_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'compliance', 'pg_temp'
AS $function$
BEGIN
  IF current_user <> 'app_runtime' THEN
    RETURN OLD;
  END IF;

  IF current_setting('app.memory_delete_authorized', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'compliance.memory_records rows may not be deleted directly. Lawful paths (R-IMG-29): a logged erasure request, or a break-glass action with logged authorisation -- both must SET LOCAL app.memory_delete_authorized = ''true'' before the DELETE.'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN OLD;
END;
$function$;

CREATE TRIGGER trg_memory_records_delete_guard
BEFORE DELETE ON compliance.memory_records
FOR EACH ROW EXECUTE FUNCTION compliance.fn_memory_records_delete_guard();
