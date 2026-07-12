-- Wave 173 (GAP-DCMD, next real slice after Wave 171's rich-metadata pass).
-- Honest scope: this does NOT build the source doc's full 10-sub-object
-- schema (business/classification/inputs/outputs/software/AI/workflow/
-- governance/knowledge per chain) -- see schema.ts's dynamicChains comment
-- for why that stays deliberately deferred. This migration adds 3 more
-- genuinely useful, additive, nullable/defaulted columns and is paired with
-- the first real entity_relationships graph edge for chains, written by
-- application code (approval-workflow-service.ts's startApprovalWorkflow(),
-- called from task-service.ts's createTask() when a chain-originated task
-- triggers a real approval workflow) rather than a DB trigger. All existing
-- rows are unaffected.

ALTER TABLE compliance.dynamic_chains ADD COLUMN IF NOT EXISTS linked_approval_workflow_ids jsonb NOT NULL DEFAULT '[]';
ALTER TABLE compliance.dynamic_chains ADD COLUMN IF NOT EXISTS governance_notes text;
ALTER TABLE compliance.dynamic_chains ADD COLUMN IF NOT EXISTS deprecation_reason text;
