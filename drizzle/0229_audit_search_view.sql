-- VERIDIAN Review Framework gap-closure (2026-07-18), "Audit Trail & Change
-- History" finding: "No unified cross-table audit query/search interface."
-- Confirmed by reading the schema: audit_logs (application-level CRUD/
-- login/export events), orchestra_executions (every AI/LLM call), and
-- activity_log (the universal AI-dispatch lifecycle envelope, TASK-04) are
-- three independent, differently-shaped audit trails today with no single
-- place to search "everything that happened, in order" across all three.
-- This view unions a common projection of each -- one more source (a real
-- 4th log table) can be added later with a single new UNION ALL branch, no
-- application code change required.
--
-- SECURITY (read this before touching this view): `security_invoker = true`
-- (PG15+) makes RLS apply as the QUERYING role, not this view's owner --
-- without it, a view owned by a bypass-RLS role would leak every org's
-- audit trail to any app_runtime caller. Belt-and-suspenders on top of
-- that: every branch below ALSO filters explicitly on
-- `org_id = compliance.current_org_id()` (the exact same expression every
-- other RLS policy in this schema already uses) rather than relying on
-- security_invoker alone -- if that GUC is ever unset (a caller that forgot
-- withTenantContext, or a future Postgres change to view RLS semantics),
-- current_org_id() returns null and every branch returns zero rows
-- (fail-closed), never "every org" (fail-open). Only app_runtime is granted
-- SELECT -- service_role already has direct table access and has no need
-- for a scoped view.
CREATE OR REPLACE VIEW compliance.audit_search
WITH (security_invoker = true) AS
SELECT
  'audit_logs' AS source_table,
  id,
  org_id,
  user_id,
  actor_name AS actor_label,
  action,
  entity_type,
  entity_id,
  details,
  created_at
FROM compliance.audit_logs
WHERE org_id = compliance.current_org_id()

UNION ALL

SELECT
  'orchestra_executions' AS source_table,
  id,
  org_id,
  user_id,
  COALESCE(provider || ':' || model, provider, model) AS actor_label,
  event_type AS action,
  'orchestra_execution' AS entity_type,
  task_id AS entity_id,
  status AS details,
  created_at
FROM compliance.orchestra_executions
WHERE org_id = compliance.current_org_id()

UNION ALL

SELECT
  'activity_log' AS source_table,
  id,
  org_id,
  user_id,
  role_key AS actor_label,
  activity_type || ':' || lifecycle_stage AS action,
  detail_table AS entity_type,
  detail_id AS entity_id,
  objective AS details,
  created_at
FROM compliance.activity_log
WHERE org_id = compliance.current_org_id();

COMMENT ON VIEW compliance.audit_search IS
  'Unified cross-table audit query/search surface (VERIDIAN Review Framework gap-closure, 2026-07-18) -- unions audit_logs, orchestra_executions, and activity_log into one common {source_table, id, org_id, user_id, actor_label, action, entity_type, entity_id, details, created_at} shape. security_invoker + an explicit current_org_id() filter on every branch -- see audit-search-service.ts for the query layer and this file''s own header for the RLS reasoning.';

GRANT SELECT ON compliance.audit_search TO app_runtime;
