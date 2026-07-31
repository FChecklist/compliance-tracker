-- Task #46 (CRM feature-parity gap analysis): projects.lead_user_id only
-- ever carried a single owner -- no way to represent a multi-person project
-- team, the same shape gap user_client_access/conversation_participants/
-- pms_meeting_participants each already closed for their own parent entity.
-- Copies that exact junction-table shape (id/parent_id/user_id + one
-- discriminator column -- role here, response_status there), org-scoped
-- directly with its own org_id column rather than a join through projects,
-- matching the pms_meetings precedent: pms_meetings is a direct child of
-- org+project and carries org_id directly for a single-column RLS policy,
-- rather than the two-hop EXISTS-join pms_meeting_participants (a child of
-- pms_meetings, one level deeper) needs -- this table is the same single
-- hop off projects that pms_meetings is.
--
-- lead_user_id on projects is left completely untouched for backward
-- compatibility. The service layer (product-service.ts's addProjectTeamMember/
-- removeProjectTeamMember/listProjectTeamMembers) keeps it consistent with
-- this table: adding a member with role='lead' also updates
-- projects.lead_user_id, and every existing project with a non-null
-- lead_user_id but zero team-member rows is backfilled below so the two
-- never silently disagree for pre-existing data.
--
-- Hand-written, NOT drizzle-kit's raw `generate` output -- same reason as
-- 0269_construction_progress_claims_workflow.sql's own header (drizzle/meta/
-- is missing per-migration snapshots between 0001 and 0264). No REFERENCES
-- FK constraints, matching this schema's established app-level-only FK
-- convention (only 20 of the schema's columns use drizzle .references()
-- today; project_team_members' own userId/projectId columns don't either).

CREATE TABLE IF NOT EXISTS compliance.project_team_members (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  user_id text NOT NULL,
  role text NOT NULL DEFAULT 'member', -- free text: 'lead' | 'member' | 'contributor'
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(project_id, user_id)
);

CREATE INDEX IF NOT EXISTS project_team_members_project_id_idx ON compliance.project_team_members (project_id);
CREATE INDEX IF NOT EXISTS project_team_members_user_id_idx ON compliance.project_team_members (user_id);
CREATE INDEX IF NOT EXISTS project_team_members_org_id_idx ON compliance.project_team_members (org_id);

-- Backfill: every existing project with a lead_user_id but no team-member
-- row yet gets a real role='lead' row, so leadUserId and the junction table
-- agree for pre-existing data from the moment this migration lands.
INSERT INTO compliance.project_team_members (org_id, project_id, user_id, role)
SELECT p.org_id, p.id, p.lead_user_id, 'lead'
FROM compliance.projects p
WHERE p.lead_user_id IS NOT NULL
ON CONFLICT (project_id, user_id) DO NOTHING;

-- Row Level Security -- matching 0269_construction_progress_claims_workflow.sql's
-- established app_runtime_tenant_isolation + service_role_bypass pattern
-- (direct org_id policy, this table carries its own org_id). No explicit
-- app_runtime GRANT needed: ALTER DEFAULT PRIVILEGES IN SCHEMA compliance
-- (drizzle/0010) already covers every future table in this schema.
ALTER TABLE compliance.project_team_members ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.project_team_members FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_project_team_members ON compliance.project_team_members FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
