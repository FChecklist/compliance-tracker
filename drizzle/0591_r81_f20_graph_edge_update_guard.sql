-- R81_F20 part 1 (owner ruling D95/D96, 2026-09-11): platform.graph_edge is
-- missing an update-immutability guard.
--
-- WHAT WAS FOUND, verified live against pcrjmlpuqsbocqfwoxod. graph_edge has
-- two existing triggers: graph_edge_guard_trg (BEFORE INSERT OR UPDATE,
-- SECURITY DEFINER, runs platform.graph_edge_guard()) and
-- trg_graph_edge_delete_guard (BEFORE DELETE, runs
-- platform.fn_graph_edge_delete_guard()). graph_edge_guard() does
-- referential/cross-org/tier VALIDATION on both insert and update -- source
-- and target nodes must exist, must not cross an org boundary, and a
-- platform-tier node may not point at an instance-tier one -- but it has no
-- immutability branch anywhere in its body: nothing stops an UPDATE that
-- still passes those checks from silently rewriting an edge's other columns
-- in place. Only DELETE is guarded against direct app_runtime writes today.
-- platform.graph_node's own guard (fn_graph_node_guard) already blocks BOTH
-- update and delete for app_runtime the same way -- graph_edge is the one
-- asymmetric case.
--
-- THE FIX. A NEW, separate BEFORE UPDATE trigger -- not a change to
-- graph_edge_guard() itself, which is SECURITY DEFINER and already does
-- real, working validation that has no reason to be touched. Mirrors
-- fn_graph_edge_delete_guard's own shape exactly (app_runtime-scoped, same
-- app.graph_delete_authorized escape hatch reused rather than inventing a
-- second setting) -- an authorized caller (a logged erasure request, or a
-- break-glass action) still works exactly as it already does for deletes;
-- self-healing reconciliation (graph_full_resync/graph_reconcile_platform_tier,
-- which run as postgres) is unaffected, same as every other guard in this
-- family.
--
-- Explicitly NOT changed here, per owner ruling D95 part 2: whether
-- service_role/postgres should get their own GATED bypass (instead of being
-- unconditionally exempt from every one of these guards) is a real
-- architecture question, parked for the owner, not folded into this
-- mechanical fix.
--
-- PROVEN, NOT JUST WRITTEN. Ran this exact DDL inside BEGIN...ROLLBACK
-- against the live database (2026-09-11), then attempted an UPDATE against
-- a real graph_edge row as each case before rolling everything back:
--   SET LOCAL ROLE app_runtime; UPDATE ... (no authorization flag)
--     -> REFUSED: integrity_constraint_violation
--   SET LOCAL ROLE app_runtime; SET LOCAL app.graph_delete_authorized='true'; UPDATE ...
--     -> SUCCEEDED
--   (no role change) UPDATE ... as postgres
--     -> SUCCEEDED (reconciliation path unaffected, as designed)
--   ROLLBACK; trigger/function both confirmed absent afterward -- nothing persisted.
--
-- Idempotent: DROP TRIGGER IF EXISTS before CREATE TRIGGER, matching this
-- schema's own established technique for every guard trigger before it.
CREATE OR REPLACE FUNCTION platform.fn_graph_edge_update_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'platform', 'pg_temp'
AS $function$
BEGIN
  IF current_user <> 'app_runtime' THEN
    RETURN NEW;
  END IF;

  IF current_setting('app.graph_delete_authorized', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'platform.graph_edge rows may not be updated directly. Lawful paths (R-IMG-29): a logged erasure request, or a break-glass action with logged authorisation -- both must SET LOCAL app.graph_delete_authorized = ''true'' before the UPDATE. The self-healing reconciliation functions (graph_full_resync/graph_reconcile_platform_tier) run as postgres and are unaffected by this guard.'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_graph_edge_update_guard ON platform.graph_edge;
CREATE TRIGGER trg_graph_edge_update_guard
  BEFORE UPDATE ON platform.graph_edge
  FOR EACH ROW
  EXECUTE FUNCTION platform.fn_graph_edge_update_guard();
