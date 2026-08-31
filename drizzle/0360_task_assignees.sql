-- R65 Part B ("Task Responsibility - Multiple peoples"): tasks.user_id
-- remains the single primary/denormalized owner (every existing query
-- unaffected) -- this is the real multi-assignee CO-assignee source, the
-- identical relationship pms_issue_assignees already establishes for PMS
-- Issues (see that table's own precedent). Additive-only, no backfill
-- needed since it starts empty for every existing task.

CREATE TABLE IF NOT EXISTS compliance.task_assignees (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES compliance.tasks(id),
  user_id text NOT NULL,
  added_by_id text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_assignees_task_id ON compliance.task_assignees(task_id);
CREATE INDEX IF NOT EXISTS idx_task_assignees_user_id ON compliance.task_assignees(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_assignees_task_user ON compliance.task_assignees(task_id, user_id);

-- Tenant isolation is enforced at the application layer (task_id scoped to
-- an org-scoped task in every real query) -- matches this codebase's real,
-- existing convention. RLS here just needs to not block app_runtime's own
-- real access, same pattern as drizzle/0333_r63_enable_rls_platform_tables.sql.
ALTER TABLE compliance.task_assignees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "app_runtime_full_access" ON compliance.task_assignees
  FOR ALL TO app_runtime USING (true) WITH CHECK (true);
