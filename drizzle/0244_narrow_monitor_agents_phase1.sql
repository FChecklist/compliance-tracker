-- PLATFORM_STRATEGY.md section 29.3, Phase 1 ("expand event coverage via
-- the registry -- each remaining event is a registry row + one
-- instrumentation call at its real source, no new architecture per
-- event"). Seeds 5 new monitor_agents rows for the 5 new Tier-1
-- rule-engine monitors this phase wires (see src/lib/monitors/
-- rule-engine-monitor.ts and the 5 event-specific files that call it).
-- No schema change -- monitor_agents/monitor_task_state already exist
-- (drizzle/0173_narrow_monitor_agents_phase0.sql).
--
-- NOT applied to the live database by this PR -- a human orchestrator
-- applies it after review, same posture as 0173 and every other migration
-- this session.

INSERT INTO compliance.monitor_agents (
  name, description, event_types, execution_tier,
  owner, report_to, escalate_to, escalation_level,
  max_retry, max_execution_time_ms, timeout_ms,
  failure_action, success_action, next_agent, is_active
) VALUES
(
  'workflow_completion_timeliness_monitor',
  'Tier 1 rule-engine monitor: checks an approval_workflow_instances decision (approved or rejected) was made within the expected timeframe of the instance being started. Fires on WORKFLOW_STARTED and WORKFLOW_COMPLETED -- see src/lib/monitors/workflow-completion-monitor.ts.',
  'workflow_started,workflow_completed',
  'rule_engine',
  'chief_operating_officer', 'chief_operating_officer', 'chief_operating_officer', 1,
  3, 86400000, 21600000,
  'escalate', 'log_only', NULL, true
),
(
  'task_completion_timeliness_monitor',
  'Tier 1 rule-engine monitor: checks a task marked completed was completed on or before its own dueDate (when a dueDate was set -- a task with no dueDate has no SLA to violate). Fires on TASK_CREATED and TASK_COMPLETED -- see src/lib/monitors/task-completion-monitor.ts.',
  'task_created,task_completed',
  'rule_engine',
  'chief_operating_officer', 'chief_operating_officer', 'chief_operating_officer', 1,
  3, 86400000, 21600000,
  'escalate', 'log_only', NULL, true
),
(
  'board_meeting_hold_timeliness_monitor',
  'Tier 1 rule-engine monitor: checks a board_meetings row was recorded as held within a reasonable window of its own planned meetingDate. Fires on MEETING_SCHEDULED and MEETING_COMPLETED -- see src/lib/monitors/board-meeting-hold-monitor.ts.',
  'meeting_scheduled,meeting_completed',
  'rule_engine',
  'chief_operating_officer', 'chief_operating_officer', 'chief_operating_officer', 1,
  3, 604800000, 21600000,
  'escalate', 'log_only', NULL, true
),
(
  'meeting_intelligence_generation_monitor',
  'Tier 1 rule-engine monitor: checks whether a real VERI Meeting Intelligence generation attempt (generateMeetingIntelligence) succeeded or failed. Fires on MOM_GENERATED -- see src/lib/monitors/meeting-intelligence-generation-monitor.ts.',
  'mom_generated',
  'rule_engine',
  'chief_operating_officer', 'chief_operating_officer', 'chief_operating_officer', 1,
  3, 86400000, 21600000,
  'escalate', 'log_only', NULL, true
),
(
  'webhook_delivery_outcome_monitor',
  'Tier 1 rule-engine monitor: checks whether a webhook delivery (all retry attempts) ultimately succeeded or failed. Fires on API_SUCCESS and API_FAILED -- see src/lib/monitors/webhook-delivery-outcome-monitor.ts.',
  'api_success,api_failed',
  'rule_engine',
  'chief_operating_officer', 'chief_operating_officer', 'chief_operating_officer', 1,
  3, 86400000, 21600000,
  'escalate', 'log_only', NULL, true
)
ON CONFLICT (name) DO NOTHING;
