-- R71 Phase 7 (U7-03), per binding ruling R-IMG-29: compliance.memory_versions
-- IS the audit trail (every superseded revision of a memory record) and
-- currently has NO triggers of any kind -- an editable audit trail is not an
-- audit trail. Insert-only: no UPDATE, no DELETE, no exception, not even
-- break-glass (R-IMG-29 is explicit that this table gets no bypass -- erasure
-- operates on memory_records, never on the history of what happened).
--
-- Same role-gating convention as the other guards in this schema: only
-- app_runtime is checked, so a migration/superuser session is unaffected.
CREATE OR REPLACE FUNCTION compliance.fn_memory_versions_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'compliance', 'pg_temp'
AS $function$
BEGIN
  IF current_user <> 'app_runtime' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  RAISE EXCEPTION 'compliance.memory_versions is insert-only: no UPDATE, no DELETE, no exception, not even break-glass (R-IMG-29). It is the audit trail; erasure operates on memory_records, never on the history of what happened.'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$function$;

CREATE TRIGGER trg_memory_versions_no_update
BEFORE UPDATE ON compliance.memory_versions
FOR EACH ROW EXECUTE FUNCTION compliance.fn_memory_versions_immutable_guard();

CREATE TRIGGER trg_memory_versions_no_delete
BEFORE DELETE ON compliance.memory_versions
FOR EACH ROW EXECUTE FUNCTION compliance.fn_memory_versions_immutable_guard();
