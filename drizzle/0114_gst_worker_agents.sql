-- Renumbered from 0101 to 0114 on 2026-07-09 (AUDIT_2026-07-09.md gap
-- closure) -- this file and 0101_wave115_construction_boq_progress_diary.sql
-- both used migration number 0101; this is the one that was renumbered,
-- since 0102/0103 continue that other file's wave115-117 construction
-- sequence. No content changed, no re-application needed -- this codebase's
-- real migration-tracking is Supabase MCP execute_sql/apply_migration, not
-- drizzle-kit's journal (confirmed: drizzle/meta/_journal.json has no entry
-- referencing either 0101 file).
--
-- GST Reconciliation Engine worker agents, dispatchable from the Mode
-- Pills + Chain Selector (VeriComposer) via the same structured (non-LLM)
-- dispatch mechanism Wave 114 built for update_compliance_status. See
-- task-execution-engine.ts's dispatchTool() for the handlers and
-- capability-tree-service.ts's buildGstReconciliationNodes() for the tree.
-- code_reference has no unique constraint, so each insert is guarded with
-- a NOT EXISTS check for idempotency (same pattern as other seed passes).

INSERT INTO compliance.worker_agents (id, tier, name, domain, description, code_reference, lifecycle_status)
SELECT gen_random_uuid()::text, 'global', 'List GST Import Batches', 'Finance > GST Reconciliation',
  'List this organisation''s GST import batches (Excel/CSV/Tally/Busy/Zoho Books) with status.', 'list_gst_import_batches', 'published'
WHERE NOT EXISTS (SELECT 1 FROM compliance.worker_agents WHERE code_reference = 'list_gst_import_batches');

INSERT INTO compliance.worker_agents (id, tier, name, domain, description, code_reference, lifecycle_status)
SELECT gen_random_uuid()::text, 'global', 'List GST Returns', 'Finance > GST Reconciliation',
  'List this organisation''s generated GSTR-1/GSTR-3B returns.', 'list_gst_returns', 'published'
WHERE NOT EXISTS (SELECT 1 FROM compliance.worker_agents WHERE code_reference = 'list_gst_returns');

INSERT INTO compliance.worker_agents (id, tier, name, domain, description, code_reference, lifecycle_status)
SELECT gen_random_uuid()::text, 'global', 'Confirm GST Import Batch', 'Finance > GST Reconciliation',
  'Confirms a staged GST import batch into canonical invoices and runs the deterministic validation engine.', 'confirm_gst_batch', 'published'
WHERE NOT EXISTS (SELECT 1 FROM compliance.worker_agents WHERE code_reference = 'confirm_gst_batch');

INSERT INTO compliance.worker_agents (id, tier, name, domain, description, code_reference, lifecycle_status)
SELECT gen_random_uuid()::text, 'global', 'Run GST 2B Reconciliation', 'Finance > GST Reconciliation',
  'Reconciles a confirmed purchase-register batch against a confirmed GSTR-2B batch.', 'run_gst_reconciliation', 'published'
WHERE NOT EXISTS (SELECT 1 FROM compliance.worker_agents WHERE code_reference = 'run_gst_reconciliation');

INSERT INTO compliance.worker_agents (id, tier, name, domain, description, code_reference, lifecycle_status)
SELECT gen_random_uuid()::text, 'global', 'Generate GST Return', 'Finance > GST Reconciliation',
  'Generates GSTR-1 or GSTR-3B JSON for a period from confirmed canonical invoices.', 'generate_gst_return', 'published'
WHERE NOT EXISTS (SELECT 1 FROM compliance.worker_agents WHERE code_reference = 'generate_gst_return');

INSERT INTO compliance.worker_agents (id, tier, name, domain, description, code_reference, lifecycle_status)
SELECT gen_random_uuid()::text, 'global', 'Generate GST AI Review', 'Finance > GST Reconciliation',
  'Generates the plain-language AI risk-review report over a generated GST return''s deterministic findings.', 'generate_gst_ai_review', 'published'
WHERE NOT EXISTS (SELECT 1 FROM compliance.worker_agents WHERE code_reference = 'generate_gst_ai_review');
