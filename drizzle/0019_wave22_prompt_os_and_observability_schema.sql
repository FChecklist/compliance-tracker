-- Wave 22 (VERIDIAN AI OS, OSS research pass -- see PLATFORM_STRATEGY.md §13):
-- Prompt Operating System (Langfuse-inspired) + AI Observability schema
-- foundations + two small additive items (MemPalace-inspired temporal
-- memory versioning, Agent Skills/Awesome-LLM-Apps-inspired secondary
-- Worker Agent Library taxonomy axis).
--
-- Pure additive infrastructure -- no existing call site behavior changes
-- yet. Seeded prompt content below is copied VERBATIM from today's
-- hardcoded strings (confirmed by reading each file directly) so nothing
-- in AI behavior changes until Wave 23 wires actual consumption.
-- {{PURPOSE_CLAUSE}} is a literal placeholder token preserved in 2 of the
-- 8 seeded templates, marking exactly where buildPurposeClause(DEFAULT_DOMAIN)
-- is spliced in today -- Wave 23's call sites do a simple string .replace()
-- at that token, preserving the exact interpolation point those 2 prompts
-- already have.

CREATE TABLE IF NOT EXISTS compliance.prompt_templates (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  template_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  description text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.prompt_versions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  prompt_template_id text NOT NULL REFERENCES compliance.prompt_templates(id),
  version integer NOT NULL,
  content text NOT NULL,
  label text, -- 'production' | 'staging' | NULL
  is_active boolean NOT NULL DEFAULT true,
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(prompt_template_id, version)
);

ALTER TABLE compliance.prompt_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.prompt_versions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_read_prompt_templates ON compliance.prompt_templates FOR SELECT TO app_runtime USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_prompt_templates ON compliance.prompt_templates FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_read_prompt_versions ON compliance.prompt_versions FOR SELECT TO app_runtime USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_prompt_versions ON compliance.prompt_versions FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Wave 22: veridian_admin may create new prompt versions through the app
-- (prompt-os-service.ts's createPromptVersion) -- content is a
-- platform-governed asset, same authority bar as publishing a worker
-- agent, so app_runtime gets INSERT too (role-gated in the service layer,
-- same pattern as every other admin-only write in this codebase).
GRANT SELECT, INSERT ON compliance.prompt_versions TO app_runtime;
GRANT SELECT ON compliance.prompt_templates TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.prompt_templates, compliance.prompt_versions TO service_role;

CREATE INDEX IF NOT EXISTS idx_prompt_versions_template_id ON compliance.prompt_versions(prompt_template_id);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_label ON compliance.prompt_versions(label);

-- ============================================================
-- Seed: 8 prompt templates, v1='production', verbatim from today's
-- hardcoded strings.
-- ============================================================
INSERT INTO compliance.prompt_templates (template_key, display_name, description) VALUES
  ('chat.ai_thread_system', 'Chat: AI Thread System Prompt', 'The pinned VERIDIAN AI conversation thread''s system prompt (chat-service.ts)'),
  ('task_execution.planning_system', 'Task Execution: Planning System Prompt', 'The Task Orchestra Agent''s plan-generation system prompt (task-execution-engine.ts)'),
  ('loop_engineering.meta_synthesis', 'Loop Engineering: Meta Synthesis Prompt', 'Loop 1''s meta_oa platform-health synthesis prompt (loop-engineering-audit.ts)'),
  ('instruction_mismatch.judgment', 'Instruction Mismatch: Judgment Prompt', 'Judges whether recorded activity matches a given instruction (instruction-mismatch-audit.ts)'),
  ('orchestrate.document_uploaded', 'Orchestrate: Document Uploaded', 'Event-specific orchestration prompt for document.uploaded (api/ai/orchestrate)'),
  ('orchestrate.item_overdue', 'Orchestrate: Item Overdue', 'Event-specific orchestration prompt for item.overdue (api/ai/orchestrate)'),
  ('orchestrate.notice_received', 'Orchestrate: Notice Received', 'Event-specific orchestration prompt for notice.received (api/ai/orchestrate)'),
  ('orchestrate.deadline_approaching', 'Orchestrate: Deadline Approaching', 'Event-specific orchestration prompt for deadline.approaching (api/ai/orchestrate)')
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You are VERIDIAN AI, a helpful assistant embedded in a compliance management platform. Keep replies concise and practical. {{PURPOSE_CLAUSE}}$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'chat.ai_thread_system'
ON CONFLICT (prompt_template_id, version) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You are the Task Orchestra Agent for a compliance management platform. {{PURPOSE_CLAUSE}} Given a task and a list of real worker agents available to this organisation, produce a short execution plan (2-4 steps). Each step should reference the single most relevant agent by its exact name from the list, or null if none fit. Respond with ONLY JSON matching: { "summary": string, "steps": [{ "agentName": string | null, "description": string }] }$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'task_execution.planning_system'
ON CONFLICT (prompt_template_id, version) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You are the Meta Orchestra Agent for an AI-native platform. Given per-loop health stats, write a 1-2 sentence plain-language synthesis of overall platform health for a human operator. Respond with ONLY JSON: { "synthesis": string }$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'loop_engineering.meta_synthesis'
ON CONFLICT (prompt_template_id, version) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You judge whether a person's actual recorded activity matches an instruction they were given. Respond with ONLY JSON matching: { "matches": boolean, "summary": string, "relatedTaskIndex": number | null }. `summary` is 1-2 sentences explaining your judgment, written for the person who gave the instruction. `relatedTaskIndex` is the [N] index of the single task (from the list below) that most directly fulfills or relates to the instruction, or null if none of the listed tasks are related.$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'instruction_mismatch.judgment'
ON CONFLICT (prompt_template_id, version) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You are Veridian AI, an intelligent compliance orchestration agent for an Indian compliance management platform.
You analyze compliance events and suggest actionable next steps.
You MUST respond with a JSON object containing: { context, actions } where actions is an array of { type, label, description, priority, payload }.
Keep descriptions concise (1-2 sentences). Priority must be one of: low, medium, high, critical.
Return ONLY valid JSON, no markdown or extra text.

When a document is uploaded:
- Analyze what type of document it might be (GST notice, TDS challan, PF return, etc.)
- If it looks like a notice or demand, suggest extracting its details
- If it references a compliance type, suggest creating or linking a compliance item
- Suggest assigning it to the right team based on the compliance type$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'orchestrate.document_uploaded'
ON CONFLICT (prompt_template_id, version) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You are Veridian AI, an intelligent compliance orchestration agent for an Indian compliance management platform.
You analyze compliance events and suggest actionable next steps.
You MUST respond with a JSON object containing: { context, actions } where actions is an array of { type, label, description, priority, payload }.
Keep descriptions concise (1-2 sentences). Priority must be one of: low, medium, high, critical.
Return ONLY valid JSON, no markdown or extra text.

When a compliance item is overdue:
- Calculate the potential penalty exposure based on the compliance type and days overdue
- Suggest an escalation action (notify manager, escalate to leadership)
- Suggest drafting a reply or filing the compliance ASAP
- Flag if there are associated notices that need immediate attention
- Prioritize based on penalty severity$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'orchestrate.item_overdue'
ON CONFLICT (prompt_template_id, version) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You are Veridian AI, an intelligent compliance orchestration agent for an Indian compliance management platform.
You analyze compliance events and suggest actionable next steps.
You MUST respond with a JSON object containing: { context, actions } where actions is an array of { type, label, description, priority, payload }.
Keep descriptions concise (1-2 sentences). Priority must be one of: low, medium, high, critical.
Return ONLY valid JSON, no markdown or extra text.

When a government notice/SCN is received:
- Suggest extracting all key fields (notice number, authority, demand amount, PAN, GSTIN, period)
- Calculate the reply deadline (typically 30 days from receipt)
- Suggest assigning to the compliance team or a specific person
- Flag the urgency based on demand amount and deadline proximity
- Suggest creating a compliance item if one doesn't exist$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'orchestrate.notice_received'
ON CONFLICT (prompt_template_id, version) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You are Veridian AI, an intelligent compliance orchestration agent for an Indian compliance management platform.
You analyze compliance events and suggest actionable next steps.
You MUST respond with a JSON object containing: { context, actions } where actions is an array of { type, label, description, priority, payload }.
Keep descriptions concise (1-2 sentences). Priority must be one of: low, medium, high, critical.
Return ONLY valid JSON, no markdown or extra text.

When a compliance deadline is approaching (within 3-7 days):
- Suggest sending a reminder notification to the assignee
- Suggest notifying the department head
- Calculate if there are any dependencies (e.g., pending approvals, documents needed)
- Suggest priority actions to complete before the deadline
- Keep urgency proportional to days remaining$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'orchestrate.deadline_approaching'
ON CONFLICT (prompt_template_id, version) DO NOTHING;

-- ============================================================
-- AI Observability: extend orchestra_executions with real, queryable
-- model/token/cost columns (Langfuse-inspired) -- all nullable/additive.
-- ============================================================
ALTER TABLE compliance.orchestra_executions ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE compliance.orchestra_executions ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE compliance.orchestra_executions ADD COLUMN IF NOT EXISTS prompt_tokens integer;
ALTER TABLE compliance.orchestra_executions ADD COLUMN IF NOT EXISTS completion_tokens integer;
ALTER TABLE compliance.orchestra_executions ADD COLUMN IF NOT EXISTS cost_usd numeric;

CREATE INDEX IF NOT EXISTS idx_orchestra_executions_model ON compliance.orchestra_executions(model);
CREATE INDEX IF NOT EXISTS idx_orchestra_executions_provider ON compliance.orchestra_executions(provider);

-- ============================================================
-- Memory Fabric: temporal validity-window columns on assistant_memories
-- (MemPalace-inspired) -- built ahead of need per explicit user
-- confirmation; no consumer wired this wave. Every pre-existing row
-- backfills to validFrom=createdAt, validUntil=NULL (still current),
-- the correct non-lossy default.
-- ============================================================
ALTER TABLE compliance.assistant_memories ADD COLUMN IF NOT EXISTS valid_from timestamp NOT NULL DEFAULT now();
ALTER TABLE compliance.assistant_memories ADD COLUMN IF NOT EXISTS valid_until timestamp;
ALTER TABLE compliance.assistant_memories ADD COLUMN IF NOT EXISTS superseded_by_memory_id text REFERENCES compliance.assistant_memories(id);

UPDATE compliance.assistant_memories SET valid_from = created_at WHERE valid_from IS DISTINCT FROM created_at;

-- ============================================================
-- Worker Agent Library: secondary tool-type taxonomy axis on
-- module_registry (Agent Skills / Awesome LLM Apps-inspired), orthogonal
-- to the existing free-text `domain` path.
-- ============================================================
ALTER TABLE compliance.module_registry ADD COLUMN IF NOT EXISTS tool_type text;

UPDATE compliance.module_registry SET tool_type = 'data_access' WHERE module_key IN (
  'compliance_items', 'challans', 'notices', 'board_meetings', 'committees', 'related_party_transactions',
  'delegation_of_authority', 'directors_kmp', 'cap_table_entries', 'cap_table_events', 'company_charges',
  'legal_vendors', 'litigation_matters', 'ip_portfolio', 'legal_opinions', 'hr_compliance_items',
  'leave_policy_entries', 'holiday_list_filings', 'posh_committee', 'posh_complaints', 'risks',
  'sebi_compliance_items', 'rbi_compliance_items', 'irdai_compliance_items', 'vendor_risk_profiles',
  'whistleblower_cases', 'contract_compliance_items', 'incidents'
) AND tool_type IS NULL;

UPDATE compliance.module_registry SET tool_type = 'validation' WHERE module_key IN (
  'audit_points', 'secretarial_audits', 'mca_filings', 'compliance_frameworks', 'framework_controls',
  'audit_engagements', 'audit_findings', 'bcm_plans'
) AND tool_type IS NULL;

UPDATE compliance.module_registry SET tool_type = 'reporting' WHERE module_key IN (
  'board_evaluations', 'posh_annual_reports', 'esg_metrics'
) AND tool_type IS NULL;

UPDATE compliance.module_registry SET tool_type = 'orchestration' WHERE module_key IN (
  'policies'
) AND tool_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_module_registry_tool_type ON compliance.module_registry(tool_type);
