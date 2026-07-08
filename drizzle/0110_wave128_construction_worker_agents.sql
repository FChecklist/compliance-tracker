-- Construction Intelligence, Wave 128 (2026-07-08): worker agents for the
-- PROJEXA AI Copilot, dispatchable via the same structured (non-LLM)
-- dispatch mechanism the GST Reconciliation Engine wave built (see
-- task-execution-engine.ts's dispatchTool() for the handlers and
-- capability-tree-service.ts's buildConstructionNodes() for the tree).
-- Same idempotent NOT-EXISTS-guarded insert pattern as
-- 0101_gst_worker_agents.sql.

INSERT INTO compliance.worker_agents (id, tier, name, domain, description, code_reference, lifecycle_status)
SELECT gen_random_uuid()::text, 'global', 'Construction Project Dashboard', 'Construction > Project Intelligence',
  'Budget, revenue, expenses, progress%, delay, photo count, and task count for one construction project.', 'get_construction_project_dashboard', 'published'
WHERE NOT EXISTS (SELECT 1 FROM compliance.worker_agents WHERE code_reference = 'get_construction_project_dashboard');

INSERT INTO compliance.worker_agents (id, tier, name, domain, description, code_reference, lifecycle_status)
SELECT gen_random_uuid()::text, 'global', 'List Delayed Activities', 'Construction > Project Intelligence',
  'Lists all active construction projects with at least one task past its due date.', 'list_delayed_activities', 'published'
WHERE NOT EXISTS (SELECT 1 FROM compliance.worker_agents WHERE code_reference = 'list_delayed_activities');

INSERT INTO compliance.worker_agents (id, tier, name, domain, description, code_reference, lifecycle_status)
SELECT gen_random_uuid()::text, 'global', 'Construction Budget Status', 'Construction > Project Intelligence',
  'Budget vs actual expense variance for one construction project, broken down by expense head.', 'get_construction_budget_status', 'published'
WHERE NOT EXISTS (SELECT 1 FROM compliance.worker_agents WHERE code_reference = 'get_construction_budget_status');

INSERT INTO compliance.worker_agents (id, tier, name, domain, description, code_reference, lifecycle_status)
SELECT gen_random_uuid()::text, 'global', 'List Over-Budget Projects', 'Construction > Project Intelligence',
  'Lists all active construction projects whose actual expenses exceed their budget.', 'list_over_budget_projects', 'published'
WHERE NOT EXISTS (SELECT 1 FROM compliance.worker_agents WHERE code_reference = 'list_over_budget_projects');

INSERT INTO compliance.worker_agents (id, tier, name, domain, description, code_reference, lifecycle_status)
SELECT gen_random_uuid()::text, 'global', 'Construction KPI Status', 'Construction > Project Intelligence',
  'KPI definitions and their submitted/approved entries for one construction project.', 'get_construction_kpi_status', 'published'
WHERE NOT EXISTS (SELECT 1 FROM compliance.worker_agents WHERE code_reference = 'get_construction_kpi_status');

INSERT INTO compliance.worker_agents (id, tier, name, domain, description, code_reference, lifecycle_status)
SELECT gen_random_uuid()::text, 'global', 'AI Progress Summary', 'Construction > Project Intelligence',
  'AI-generated narrative progress summary for one construction project, grounded in its real aggregated dashboard numbers.', 'generate_construction_progress_summary', 'published'
WHERE NOT EXISTS (SELECT 1 FROM compliance.worker_agents WHERE code_reference = 'generate_construction_progress_summary');

INSERT INTO compliance.worker_agents (id, tier, name, domain, description, code_reference, lifecycle_status)
SELECT gen_random_uuid()::text, 'global', 'AI Budget/Schedule Risk Detection', 'Construction > Project Intelligence',
  'AI-generated budget-overrun and schedule-delay risk assessment for one construction project, grounded in real budget/actual and delay numbers.', 'detect_construction_budget_schedule_risk', 'published'
WHERE NOT EXISTS (SELECT 1 FROM compliance.worker_agents WHERE code_reference = 'detect_construction_budget_schedule_risk');
