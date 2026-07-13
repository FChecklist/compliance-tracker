-- GAP-UNIFIED-SOT-REMAINDER slice (d) (ai-os/MASTER-TRACKER.yaml). Real
-- landing place for audit-protocol.ts's AuditProtocolFields -- that module's
-- validateAuditProtocolFields() and its one real call site,
-- scripts/validate-audit-verdict.ts (PR #248), already CI-validate the 8
-- required fields on every PR's audit-verdict comment, but validated a
-- SUBMISSION and then discarded it: nothing persisted a validated verdict
-- anywhere queryable. This table is that missing sink -- one row per
-- successfully-validated audit-verdict comment, written by
-- validate-audit-verdict.ts itself immediately after validation passes (see
-- that script's persistAuditFinding(), additive, non-fatal to the actual
-- pass/fail gate if the write fails).
--
-- Named `audit_protocol_findings`, NOT the more obvious `audit_findings` --
-- that table name (and the `auditFindings` Drizzle export) is already taken
-- in schema.ts by a pre-existing, unrelated, org-scoped internal-audit-
-- engagement CAPA findings table (audit_engagement_id, capa_status,
-- retest_result, owner_id, due_date -- a finding against a company's own
-- risk register from `/api/audit-findings/[id]`, nothing to do with AI-agent
-- PR review). Verified by direct grep of schema.ts before naming this, not
-- assumed distinct -- creating a second `audit_findings` table/export would
-- have been a silent, compiling-but-wrong collision.
--
-- Columns objectiveUnderstood..reAuditScheduled map 1:1, same names, to
-- audit-protocol.ts's AuditProtocolFields type -- single source of truth for
-- the shape, not a reimplementation. prNumber/prUrl/branchName/submittedBy
-- are the correlation metadata the validator script has on hand
-- (PR_NUMBER/REPO env vars it already requires, GITHUB_HEAD_REF/
-- GITHUB_ACTOR which Actions sets automatically for a pull_request-triggered
-- run -- no new workflow env vars needed for those three).
--
-- PLATFORM-WIDE by design (no org_id column): an audit-protocol finding is
-- about a PR/branch in this single repository, not about any one tenant
-- org's data -- same reasoning drizzle/0172_priority11_deployment_events.sql
-- used for deployment_events (a Vercel deployment belongs to this app's own
-- single Vercel project, not to a tenant), which this migration's RLS/GRANT
-- shape mirrors exactly: app_runtime gets read-only SELECT (for the new
-- work-item/[id] read route and status-source-of-truth.ts's
-- auditFindingsSummary), the validator script itself writes via the plain
-- `postgres`-role DATABASE_URL client (src/lib/db/index.ts, table owner,
-- bypasses RLS by default same as every other route not yet migrated to
-- withTenantContext), RLS is still enabled per AGENTS.md Rule 9 ("every new
-- table gets real RLS, not just an org_id column"), and service_role keeps
-- its standard full-bypass policy. See
-- ai-os/registry/asset-registry-coverage.yaml's exemption entry for this
-- table (added same PR, Owner-authorized ai-os/ edit -- see that entry's
-- reason field and this PR's description for the quoted authorization).
--
-- NOT applied to the live database by this PR -- per this repo's
-- established convention (see drizzle/0172_priority11_deployment_events.sql
-- and every other migration this session), a separate audit step (Super
-- Boss / Claude Desktop) reviews and applies this via the Supabase MCP
-- after review, then merges.

CREATE TABLE IF NOT EXISTS compliance.audit_protocol_findings (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  pr_number integer,
  pr_url text,
  branch_name text,
  -- --- Before (audit-protocol.ts's AuditProtocolFields, 1:1 column names) ---
  objective_understood text,
  standards_reviewed text,
  scope_confirmed text,
  -- --- During ---
  evidence_recorded text,
  severity_classified text, -- 'critical' | 'high' | 'medium' | 'low' | 'none'
  -- --- After ---
  verdict text, -- 'pass' | 'fail'
  corrective_action_owner text,
  re_audit_scheduled text,
  submitted_by text,
  submitted_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_protocol_findings_pr_number ON compliance.audit_protocol_findings(pr_number);
CREATE INDEX IF NOT EXISTS idx_audit_protocol_findings_verdict ON compliance.audit_protocol_findings(verdict);
CREATE INDEX IF NOT EXISTS idx_audit_protocol_findings_submitted_at ON compliance.audit_protocol_findings(submitted_at);

ALTER TABLE compliance.audit_protocol_findings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_read_audit_protocol_findings ON compliance.audit_protocol_findings FOR SELECT TO app_runtime USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_audit_protocol_findings ON compliance.audit_protocol_findings FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT ON compliance.audit_protocol_findings TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.audit_protocol_findings TO service_role;
