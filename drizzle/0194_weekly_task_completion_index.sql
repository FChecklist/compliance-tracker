-- VERI Reward remaining-achievements wiring (follow-up to PR #307's audit
-- finding that 4 of 5 seeded achievement definitions were never checked).
-- weekly_task_5 ("Resolve 5 tasks this week") needs a real "how many
-- compliance items has this user completed in the current ISO week" count,
-- computed in compliance-service.ts's updateComplianceItem() right where
-- first_compliance_item already checks status === 'completed'. That count
-- filters on (org_id, assigned_to_id, status, completed_at) -- only org_id
-- is currently indexed (0004_ai_configurations_and_indexes.sql), so this
-- adds a composite index to keep the per-completion count a real indexed
-- range scan instead of a full table scan.
CREATE INDEX IF NOT EXISTS compliance_items_weekly_completion_idx
  ON compliance.compliance_items (org_id, assigned_to_id, status, completed_at);
