-- Priority 5 (10-priority5-software-orchestrator-tracker.yaml): the
-- Software Orchestrator's capability-memory substrate -- 3 new tables,
-- platform-wide (no RLS needed beyond app_runtime grants, mirroring
-- platform_assets' own mixed-tier posture, since capability LEARNING is
-- deliberately shared across every org).

CREATE TABLE compliance.task_capabilities (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  capability_key text NOT NULL UNIQUE,
  mode_pill text,
  path_keys jsonb,
  status text NOT NULL DEFAULT 'ai_only',
  needs_improvement text NOT NULL DEFAULT 'no',
  version integer NOT NULL DEFAULT 1,
  last_audited_at timestamp,
  last_audited_version integer,
  occurrence_count integer NOT NULL DEFAULT 0,
  prompt_word_index jsonb,
  full_software_count integer NOT NULL DEFAULT 0,
  package_available_count integer NOT NULL DEFAULT 0,
  novel_count integer NOT NULL DEFAULT 0,
  org_id text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT task_capabilities_status_check CHECK (status IN ('ai_only', 'partial', 'full_software')),
  CONSTRAINT task_capabilities_needs_improvement_check CHECK (needs_improvement IN ('no', 'yes', 'in_progress'))
);

CREATE INDEX idx_task_capabilities_status ON compliance.task_capabilities(status);
CREATE INDEX idx_task_capabilities_needs_improvement ON compliance.task_capabilities(needs_improvement);
CREATE INDEX idx_task_capabilities_mode_pill ON compliance.task_capabilities(mode_pill);
-- GIN for prompt_word_index containment queries (same jsonb-array pattern platform_assets.tags already uses)
CREATE INDEX idx_task_capabilities_prompt_word_index ON compliance.task_capabilities USING GIN (prompt_word_index);

COMMENT ON TABLE compliance.task_capabilities IS
  'Priority 5: capability-memory substrate -- one row per distinct capability, platform-wide by design (orgId nullable), tracking rolling X/Y/A/B classification history and Needs-Improvement/version state for the Auditor->Higher-AI learning loop.';

CREATE TABLE compliance.instruction_packages (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  capability_id text NOT NULL REFERENCES compliance.task_capabilities(id),
  package_type text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft',
  steps jsonb NOT NULL,
  required_variables jsonb,
  created_by_role text,
  approved_at timestamp,
  success_rate integer,
  usage_count integer NOT NULL DEFAULT 0,
  last_used_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT instruction_packages_type_check CHECK (package_type IN ('task_execution', 'dialogue_script')),
  CONSTRAINT instruction_packages_status_check CHECK (status IN ('draft', 'approved', 'deprecated')),
  CONSTRAINT instruction_packages_success_rate_check CHECK (success_rate IS NULL OR (success_rate >= 0 AND success_rate <= 100))
);

CREATE INDEX idx_instruction_packages_capability ON compliance.instruction_packages(capability_id);
CREATE INDEX idx_instruction_packages_status ON compliance.instruction_packages(status);
-- The real hot-path lookup: "give me the approved package for this capability" --
-- a partial index (status='approved' only) since that's the only status Lower AI ever queries for.
CREATE INDEX idx_instruction_packages_approved_lookup ON compliance.instruction_packages(capability_id) WHERE status = 'approved';

COMMENT ON TABLE compliance.instruction_packages IS
  'Priority 5: the Approved Lower AI Instruction Package -- only status=approved rows are executable. packageType discriminates task_execution steps from dialogue_script steps on the same shape, avoiding a duplicate table for VERI Chat.';

CREATE TABLE compliance.capability_improvement_proposals (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  capability_id text NOT NULL REFERENCES compliance.task_capabilities(id),
  capability_version integer NOT NULL,
  findings jsonb NOT NULL,
  occurrence_count integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'open',
  dispatched_to_role text,
  dispatched_at timestamp,
  pr_url text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT capability_improvement_proposals_status_check CHECK (status IN ('open', 'dispatched', 'resolved', 'rejected')),
  CONSTRAINT uq_capability_improvement_proposals_capability_version UNIQUE (capability_id, capability_version)
);

CREATE INDEX idx_capability_improvement_proposals_status ON compliance.capability_improvement_proposals(status);

COMMENT ON TABLE compliance.capability_improvement_proposals IS
  'Priority 5: what Auditor AI writes when a real, software-closable gap is found. UNIQUE(capability_id, capability_version) means a repeat finding increments occurrence_count instead of duplicating the row.';

-- app_runtime grants -- these tables are read/written by application
-- services (software-coverage-service.ts, capability-audit-service.ts),
-- same posture as platform_assets/asset_registration_config.
GRANT SELECT, INSERT, UPDATE ON compliance.task_capabilities TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON compliance.instruction_packages TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON compliance.capability_improvement_proposals TO app_runtime;
