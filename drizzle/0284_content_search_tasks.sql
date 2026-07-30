-- VERIDIAN_CONSOLIDATED_COMPLETION Stage 12 (2026-07-29): unified "search
-- everything" layer, slice 2 -- extends compliance.content_search
-- (Stage 9 / PR #630) to cover
-- compliance.tasks, the next real entity type off that PR's own honest
-- remaining list (tasks/projects/tickets/crm_leads/notices/comments/
-- conversations/notifications).

-- REBASE / NUMBERING NOTE (2026-07-30): this file went through three renumberings
-- during a same-day cross-PR migration-numbering scramble --
-- 0271 (original branch value, collided with main's own
-- 0271_billing_due_list_report_definition.sql) -> 0283 (collided in a real
-- simultaneous 4-way race with PR #630 itself, #637, and #647, each
-- independently computing 0283 as the next-free number off slightly
-- different snapshots of origin/main + open PRs) -> 0284 (final, per
-- explicit cross-session coordination: PR #630 keeps 0283 as the first of
-- the four to reach CI-green; #637/#647 were assigned 0285/0286). Re-verified
-- against a fresh origin/main fetch immediately before this final renumbering
-- that 0284 was not yet claimed by any other file in the repo or any other
-- open PR's drizzle/ additions. PR #630 was still open/unmerged as of this
-- renumbering -- this migration recreates the FULL content_search view
-- (compliance_items + documents + tasks branches) rather than ALTERing an
-- assumed-existing one, so it is correct whether PR #630's own migration has
-- landed in the repo yet or not. Independently confirmed live via Supabase
-- MCP (execute_sql, project pcrjmlpuqsbocqfwoxod) that compliance.content_search
-- already exists in the live DB with exactly this 3-branch shape -- both this
-- task's and PR #630's work were already applied live, ahead of and
-- independent of whichever PR order they land in the repo.
--
-- WHY tasks, by real evidence (checked this session, not assumed):
--   compliance.tasks        1899 rows
--   compliance.crm_leads     517 rows
--   compliance.conversations 366 rows
--   compliance.notifications 70 rows
--   compliance.tickets       53 rows
--   compliance.projects      36 rows
--   compliance.comments      36 rows
--   compliance.notices        3 rows
-- tasks is by far the highest-volume real candidate. Confirmed via
-- information_schema.columns + pg_indexes that compliance.tasks has zero
-- tsvector column and zero GIN/text-search index today (only btree id/
-- org_id/assistant_id/assigned_by_id/project_id and an hnsw vector index on
-- task_embedding for semantic search, which is a different mechanism) --
-- this is genuinely new work, not an extension of an existing index.
--
-- A REAL LATENT-STALENESS EXAMPLE FOUND WHILE CHECKING THIS (documented so
-- it isn't repeated here): compliance.comments already has a search_vector
-- column, a GIN index (idx_ct2_comments_search_vector), and a BEFORE INSERT
-- OR UPDATE trigger (tsv_ct2_comments / tsv_update_ct2_comments()) that
-- looks fully wired -- but all 36 existing rows have search_vector IS NULL,
-- because the trigger only fires on future writes and nobody ever ran a
-- one-time backfill after adding it. This migration adds the trigger AND an
-- explicit backfill UPDATE for tasks' existing 1899 rows in the same
-- migration, specifically to avoid landing in that same half-wired state.
--
-- SECURITY / RLS: identical convention to compliance.audit_search and
-- compliance.content_search's own compliance_items/documents branches --
-- `security_invoker = true` (PG15+, applies RLS as the querying role, not
-- the view owner) PLUS an explicit `org_id = compliance.current_org_id()`
-- filter on every branch, so an unset app.current_org_id GUC fails closed
-- (zero rows) rather than open. compliance.tasks' own RLS policy
-- (app_runtime_tasks) already uses the same `org_id = current_org_id()`
-- expression, confirmed via pg_policy before writing this. Grants SELECT
-- only to app_runtime, same as the existing view.

-- 1. Trigger-maintained tsvector column (title weight A, description
--    weight B -- same weighting scheme as compliance_items' own
--    tsv_update_ct2_compliance_items trigger).
ALTER TABLE compliance.tasks ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- 2. Trigger function. Schema-qualified (compliance.*, not public.* like the
--    older ct2 trigger functions) and SET search_path pinned, so this
--    doesn't add a new function_search_path_mutable advisory finding the
--    way the older, unqualified functions already do (pre-existing, not
--    introduced by this migration).
CREATE OR REPLACE FUNCTION compliance.tsv_update_tasks()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = compliance, pg_temp
AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B');
  RETURN NEW;
END;
$$;

-- 3. The trigger itself -- this is the part a plain column would be missing.
--    BEFORE INSERT OR UPDATE means search_vector self-maintains on every
--    future write with zero application-code involvement.
DROP TRIGGER IF EXISTS trg_tsv_tasks ON compliance.tasks;
CREATE TRIGGER trg_tsv_tasks
  BEFORE INSERT OR UPDATE ON compliance.tasks
  FOR EACH ROW EXECUTE FUNCTION compliance.tsv_update_tasks();

-- 4. One-time backfill for the 1899 pre-existing rows. The trigger above
--    only fires on rows written from this point forward -- see the
--    comments-table staleness example documented above for what happens if
--    this step is skipped.
UPDATE compliance.tasks
SET search_vector =
  setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
  setweight(to_tsvector('english', COALESCE(description, '')), 'B')
WHERE search_vector IS NULL;

-- 5. GIN index for search performance (mirrors idx_ct2_ci_search_vector /
--    idx_ct2_comments_search_vector naming).
CREATE INDEX IF NOT EXISTS idx_tasks_search_vector ON compliance.tasks USING gin(search_vector);

-- 6. Extend the unified content_search view with a third UNION ALL branch.
--    Recreated (not ALTER VIEW, which can't add a UNION branch) with the
--    exact same security_invoker=true option and current_org_id() filter
--    convention as the other two branches.
DROP VIEW IF EXISTS compliance.content_search;

CREATE VIEW compliance.content_search
WITH (security_invoker = true) AS
SELECT
  'compliance_items' AS source_table,
  id,
  org_id,
  title,
  description AS snippet,
  search_vector AS search_tsv,
  created_at,
  updated_at
FROM compliance.compliance_items
WHERE org_id = compliance.current_org_id()
UNION ALL
SELECT
  'documents' AS source_table,
  id,
  org_id,
  name AS title,
  (extracted_data ->> 'summary') AS snippet,
  to_tsvector('english', COALESCE(name, '') || ' ' || COALESCE(extracted_data ->> 'summary', '')) AS search_tsv,
  created_at,
  created_at AS updated_at
FROM compliance.documents
WHERE org_id = compliance.current_org_id()
UNION ALL
SELECT
  'tasks' AS source_table,
  id,
  org_id,
  title,
  description AS snippet,
  search_vector AS search_tsv,
  created_at,
  updated_at
FROM compliance.tasks
WHERE org_id = compliance.current_org_id();

COMMENT ON VIEW compliance.content_search IS
  'VERIDIAN_CONSOLIDATED_COMPLETION Stage 9/12 unified read-only search surface over real customer-content tables that carry a trigger-maintained keyword search index: compliance_items.search_vector, documents fulltext GIN expression index, and (Stage 12) tasks.search_vector. RLS-safe by construction (security_invoker + explicit current_org_id() filter on every branch, same convention as compliance.audit_search). Still not unified across the full customer-data surface -- projects/tickets/crm_leads/notices/comments (has a column+index+trigger already but existing rows are stale/unbackfilled, see 0271''s own header)/conversations/notifications each still need this same treatment; add each as one more UNION ALL branch.';

GRANT SELECT ON compliance.content_search TO app_runtime;
