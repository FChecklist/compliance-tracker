-- Wave 42: VERI FDE -- Forward Deployed AI (PLATFORM_STRATEGY.md §23).
-- Adds NO new creation power over what proposeWorkerAgent() (Wave 16)
-- already allows -- a natural-language front-end to that existing
-- role-gated, human-approval-gated pipeline, not a bypass of it. Closes
-- the exact gap §11 already named: "if none exists, the governing layer
-- may create a new Worker Agent Proposal" (refinement #4).

CREATE TABLE IF NOT EXISTS compliance.fde_requests (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  user_id text NOT NULL REFERENCES compliance.users(id),
  request_text text NOT NULL,
  status text NOT NULL DEFAULT 'matched_existing',
  matched_worker_agent_id text REFERENCES compliance.worker_agents(id),
  matched_label text,
  created_worker_agent_id text REFERENCES compliance.worker_agents(id),
  response_text text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.fde_requests ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.fde_requests FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_fde_requests ON compliance.fde_requests FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.fde_requests TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.fde_requests TO service_role;

CREATE INDEX IF NOT EXISTS idx_fde_requests_org_id ON compliance.fde_requests(org_id);
CREATE INDEX IF NOT EXISTS idx_fde_requests_user_id ON compliance.fde_requests(user_id);

INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('fde_requests', 'VERI FDE', 'fde_requests', 'ai_governance', 'TOOLS', true, 'Natural-language capability requests, evaluated against the existing worker-agent/module/automation-rule catalog and, if no match, drafted as a Worker Agent proposal through the existing human-approval pipeline')
ON CONFLICT (module_key) DO NOTHING;

INSERT INTO compliance.prompt_templates (template_key, display_name, description) VALUES
  ('fde.evaluate_request', 'VERI FDE: Evaluate Capability Request', 'Given a user''s plain-language request and the org''s existing worker agent/module/automation-rule catalog, decides whether an existing capability already satisfies it or drafts a new Worker Agent proposal (fde-service.ts)')
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You are VERI FDE, VERIDIAN AI OS's Forward Deployed AI. A user has described a business capability they want. You are given a JSON catalog of the organisation's existing worker agents, enabled modules, and automation rules. Your job: decide whether an existing item in that catalog already does what the user is asking for, or whether a genuinely new Worker Agent should be proposed.

Respond with ONLY JSON matching: { "matchType": "existing_agent" | "existing_module" | "existing_rule" | "no_match", "matchedId": string | null, "matchedLabel": string | null, "proposal": { "name": string, "domain": string, "description": string, "promptTemplate": string } | null, "responseToUser": string }.

Prefer an existing match whenever the catalog genuinely covers the request -- never propose a duplicate of something that already exists. Only set "proposal" (and matchType "no_match") when nothing in the catalog reasonably covers the request. "responseToUser" is a short, direct message telling the user what you found or what you are proposing, written as if you are a helpful engineer who just looked into their request -- never invent capabilities you did not actually find in the catalog.$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'fde.evaluate_request'
ON CONFLICT (prompt_template_id, version) DO NOTHING;
