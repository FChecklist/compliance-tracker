-- Wave 167 (ai-os/tree4-unified/10-merged-governance-layer.yaml,
-- U-D17.B1.S1, confirmed_gap): "Mandatory structured handover -- no AI
-- Agent may simply say 'Done'." Confirmed absent by direct code search --
-- task_agent_executions tracked worker-agent execution steps but had no
-- handover-acknowledgement concept at all. All 11 columns nullable and
-- additive -- existing rows are unaffected; a row with
-- handover_task_status IS NULL simply has no handover recorded yet.
--
-- The 9 handover_* fields map 1:1 to the governance spec's required
-- Output: Task Status, Output Produced, Validation Passed, Known Risks,
-- Pending Items, Confidence, Next Responsible AI, Required Action,
-- Escalation Required. handover_accepted_by / handover_accepted_at are the
-- separate acceptance pair the spec's Guardrail requires ("Ownership
-- transfers only after the receiving agent explicitly acknowledges
-- acceptance -- a handover sent but not acknowledged does not transfer
-- ownership") -- both start null and are only ever set by an explicit
-- acceptHandover() call (src/lib/handover-protocol.ts), never implicitly
-- alongside the submission columns above.
--
-- NOT applied to the live database by this PR -- see this migration's
-- accompanying PR description. A human orchestrator applies it after
-- review.

ALTER TABLE compliance.task_agent_executions ADD COLUMN IF NOT EXISTS handover_task_status text;
ALTER TABLE compliance.task_agent_executions ADD COLUMN IF NOT EXISTS handover_output_produced text;
ALTER TABLE compliance.task_agent_executions ADD COLUMN IF NOT EXISTS handover_validation_passed text; -- 'yes' | 'no' | 'partial'
ALTER TABLE compliance.task_agent_executions ADD COLUMN IF NOT EXISTS handover_known_risks text;
ALTER TABLE compliance.task_agent_executions ADD COLUMN IF NOT EXISTS handover_pending_items text;
ALTER TABLE compliance.task_agent_executions ADD COLUMN IF NOT EXISTS handover_confidence text; -- 'high' | 'medium' | 'low'
ALTER TABLE compliance.task_agent_executions ADD COLUMN IF NOT EXISTS handover_next_responsible_ai text;
ALTER TABLE compliance.task_agent_executions ADD COLUMN IF NOT EXISTS handover_required_action text;
ALTER TABLE compliance.task_agent_executions ADD COLUMN IF NOT EXISTS handover_escalation_required text; -- 'yes' | 'no'
ALTER TABLE compliance.task_agent_executions ADD COLUMN IF NOT EXISTS handover_accepted_by text;
ALTER TABLE compliance.task_agent_executions ADD COLUMN IF NOT EXISTS handover_accepted_at timestamp;
