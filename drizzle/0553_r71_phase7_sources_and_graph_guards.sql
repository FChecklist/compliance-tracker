-- R71 Phase 7 (U7-04), per binding ruling R-IMG-29.

-- 1. compliance.memory_sources IS the provenance record (where a memory came
-- from). Same insert-only posture as memory_versions, same reasoning: a
-- provenance record that can be edited or removed is not provenance.
CREATE OR REPLACE FUNCTION compliance.fn_memory_sources_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'compliance', 'pg_temp'
AS $function$
BEGIN
  IF current_user <> 'app_runtime' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  RAISE EXCEPTION 'compliance.memory_sources is insert-only: no UPDATE, no DELETE, no exception, not even break-glass (R-IMG-29). It is the provenance record.'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$function$;

CREATE TRIGGER trg_memory_sources_no_update
BEFORE UPDATE ON compliance.memory_sources
FOR EACH ROW EXECUTE FUNCTION compliance.fn_memory_sources_immutable_guard();

CREATE TRIGGER trg_memory_sources_no_delete
BEFORE DELETE ON compliance.memory_sources
FOR EACH ROW EXECUTE FUNCTION compliance.fn_memory_sources_immutable_guard();

-- 2. platform.graph_edge: extend to DELETE. graph_edge_guard() (existing,
-- BEFORE INSERT OR UPDATE) is a referential-integrity check keyed on NEW --
-- it has no NEW on a DELETE and is not reused here (confirmed by reading its
-- source in R71 U6-03). This is a SEPARATE guard, same authorisation
-- convention as memory_records' DELETE guard: role-gated on app_runtime, with
-- a session-GUC escape hatch for the same two lawful paths (R-IMG-29).
-- platform.graph_full_resync()/graph_reconcile_platform_tier() are
-- SECURITY DEFINER owned by postgres (confirmed live, R71 pre-check) -- their
-- internal DELETEs run as postgres, not app_runtime, so this guard does not
-- touch that self-healing reconciliation path at all.
CREATE OR REPLACE FUNCTION platform.fn_graph_edge_delete_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'platform', 'pg_temp'
AS $function$
BEGIN
  IF current_user <> 'app_runtime' THEN
    RETURN OLD;
  END IF;

  IF current_setting('app.graph_delete_authorized', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'platform.graph_edge rows may not be deleted directly. Lawful paths (R-IMG-29): a logged erasure request, or a break-glass action with logged authorisation -- both must SET LOCAL app.graph_delete_authorized = ''true'' before the DELETE. The self-healing reconciliation functions (graph_full_resync/graph_reconcile_platform_tier) run as postgres and are unaffected by this guard.'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN OLD;
END;
$function$;

CREATE TRIGGER trg_graph_edge_delete_guard
BEFORE DELETE ON platform.graph_edge
FOR EACH ROW EXECUTE FUNCTION platform.fn_graph_edge_delete_guard();

-- 3. platform.graph_node currently has ZERO triggers of any kind -- 608 nodes
-- deletable and editable without trace. Same authorisation convention as
-- graph_edge's new DELETE guard, covering both UPDATE and DELETE (no existing
-- "which columns are safe to change" convention exists for a node the way
-- memory_records has one, so this is a single symmetric authorisation gate
-- rather than an invented column allowlist).
CREATE OR REPLACE FUNCTION platform.fn_graph_node_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'platform', 'pg_temp'
AS $function$
BEGIN
  IF current_user <> 'app_runtime' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF current_setting('app.graph_delete_authorized', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'platform.graph_node rows may not be updated or deleted directly. Lawful paths (R-IMG-29): a logged erasure request, or a break-glass action with logged authorisation -- both must SET LOCAL app.graph_delete_authorized = ''true'' before the write. The self-healing reconciliation functions run as postgres and are unaffected by this guard.'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE TRIGGER trg_graph_node_update_guard
BEFORE UPDATE ON platform.graph_node
FOR EACH ROW EXECUTE FUNCTION platform.fn_graph_node_guard();

CREATE TRIGGER trg_graph_node_delete_guard
BEFORE DELETE ON platform.graph_node
FOR EACH ROW EXECUTE FUNCTION platform.fn_graph_node_guard();
