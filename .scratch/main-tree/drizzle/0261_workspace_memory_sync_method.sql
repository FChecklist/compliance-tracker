-- Priority 21, Layer 2 Workspace Memory -- extends drizzle/0211's
-- workspace_memory_capsule_events with which of the 3 sync-transport
-- options (ai-os/priority21_workspace_memory_design.md §4) produced each
-- row: Option 1 'manual' (download/upload, PR #367), Option 2
-- 'google_drive' (auto-sync via the user's connected Drive account), Option
-- 3 'veridian_pull' (first-party GET /api/workspace-memory/latest, no
-- manual file handling). Purely additive -- nullable column, existing rows
-- left NULL rather than assuming they were all 'manual' at migration time.
-- No RLS change needed: this table's RLS (app_runtime_org_scoped +
-- service_role_bypass) already applies at the row level and already covers
-- every column, per ARCH-03 -- a new column on an already-RLS-enabled table
-- is not itself a new RLS surface. NOT applied live -- left for the
-- supervising session, same convention as every other schema-touching claim
-- in ai-os/boss/ACTIVE-CLAIMS.yaml.
ALTER TABLE compliance.workspace_memory_capsule_events
  ADD COLUMN IF NOT EXISTS sync_method text;
