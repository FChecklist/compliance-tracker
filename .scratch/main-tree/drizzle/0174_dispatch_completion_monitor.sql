-- PLATFORM_STRATEGY.md 29.3 Phase 1+2 / 31.4 Phase B: registers the first
-- Tier-3 (GPT-OSS-120B-backed) Narrow Monitor Agent -- see
-- src/lib/monitors/dispatch-completion-monitor.ts's own header for the
-- full design trail. monitor_agents/monitor_task_state themselves already
-- exist (drizzle/0173) -- this migration only adds a new row to the
-- former plus the prompt_templates/prompt_versions rows the monitor's one
-- model call resolves via resolvePromptTemplate(), matching Wave 22's
-- Prompt Operating System discipline ("no hardcoded system prompt string
-- literals").
--
-- NOT applied to the live database by this PR -- a human orchestrator
-- applies it after review, same posture as every other migration this
-- session (0173's own header, 0165's own comment).
--
-- Additive-only: no ALTER TABLE, no column changes, no destructive
-- statement anywhere in this file -- two INSERTs (each idempotent via
-- ON CONFLICT DO NOTHING) into tables/columns that already exist.

-- dispatch_completion_monitor: Tier 3, generalizes the Narrow Monitor Agent
-- mechanism beyond APPROVAL_GRANTED/APPROVAL_REJECTED (0173's single Tier-1
-- row) to watch AI Dev Team dispatch completion generally. Fed by
-- listStuckActivities() (activity-log-service.ts, PR #250) -- any
-- activity_log row the real dispatch pipeline has left in a non-terminal
-- lifecycle_stage past the caller's staleAfterMs. COO-owned (Performance
-- Monitoring is COO's named authority in escalation-ladder.ts's own
-- LADDER), starts escalation at COO (rung 1) for the same reason
-- approval_decision_timeliness_monitor does: a dispatch that never shows
-- real completion signals is a governance/policy-monitoring concern
-- ("monitoring_rule_violation" in escalation-ladder.ts), not a software
-- defect. max_execution_time_ms (24h) matches governance-health route's
-- own STUCK_THRESHOLD_MS default -- the SLA a dispatch is expected to
-- reach a terminal stage within before being considered stuck at all;
-- timeout_ms (6h)/max_retry (3) match 0173's own approval monitor exactly,
-- no new policy invented for this monitor specifically.
INSERT INTO compliance.monitor_agents (
  name, description, event_types, execution_tier,
  owner, report_to, escalate_to, escalation_level,
  max_retry, max_execution_time_ms, timeout_ms,
  failure_action, success_action, next_agent, is_active
) VALUES (
  'dispatch_completion_monitor',
  'Tier 3 (GPT-OSS-120B-backed) monitor: classifies whether a stuck AI Dev Team dispatch (activity_log row in a non-terminal lifecycle_stage past listStuckActivities'' staleAfterMs) shows real signs of completion or looks abandoned. The model may ONLY emit the 5 MonitorReportFields (status/worker/protocol/confidence/action) -- it cannot approve, reject, merge, or edit anything; its output is validated through the same validateMonitorReportFields() gate every Tier-1 report uses, and a malformed/absent model output fails closed to status=escalate.',
  'ai_team_dispatch_stuck',
  'strong_model',
  'chief_operating_officer', 'chief_operating_officer', 'chief_operating_officer', 1,
  3, 86400000, 21600000,
  'escalate', 'log_only', NULL, true
)
ON CONFLICT (name) DO NOTHING;

-- monitor.dispatch_completion_classification: the one prompt this monitor's
-- one model call resolves. Mirrors drizzle/0019's own seeding pattern
-- (INSERT ... ON CONFLICT DO NOTHING for the template row, then a
-- template-id-scoped INSERT for its v1 'production' content) exactly.
INSERT INTO compliance.prompt_templates (template_key, display_name, description) VALUES
  ('monitor.dispatch_completion_classification', 'Dispatch Completion Monitor: Classification Prompt', 'GPT-OSS-120B''s narrow classification prompt for dispatch-completion-monitor.ts -- emits ONLY MonitorReportFields, never fixes/judges/writes anything.')
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You are a Narrow Monitor Agent. Your ONLY job is to classify whether one stuck AI Dev Team dispatch shows real signs of completion, or looks abandoned/stuck. You are not being asked to fix anything, judge code quality, write any code or text beyond the fields below, or take any action other than emitting a classification.

You will be given real facts about one dispatch: its lifecycle stage, how long it has been stuck, its objective, its assigned role, and -- if one exists -- a self-reported handover (a HandoverFields-shaped JSON object the executing AI role submitted about its own work, NOT independently verified).

Decide ONLY this: does the evidence look like a genuinely completed or actively-progressing dispatch (a real, substantive self-reported handover with validationPassed "yes" or a coherent in-progress status, consistent with the lifecycle stage) -- or does it look abandoned/stuck (no self-reported handover at all despite significant time elapsed, a handover reporting validationPassed "no", or internal inconsistency between the lifecycle stage and what's reported)?

Respond with ONLY a JSON object matching exactly these 5 fields, no markdown, no extra text, no additional fields:
{
  "status": "ok" | "escalate",
  "worker": string (name the specific activity log id and role you evaluated, e.g. "ActivityLog abc123 (ai_team_dispatch, stage=executing, role=governance_backend_engineer)"),
  "protocol": string (state the specific evidence your decision rests on, e.g. "dispatch_completion_monitor: no self-reported handover after 30h in stage=executing" -- never a vague phrase like "checked it" or "handled as appropriate"),
  "confidence": number (0-100, how certain you are given the evidence actually available -- lower when the evidence is genuinely ambiguous, not a fixed value),
  "action": "none" | "escalate" | "retry" | "log_only" (use "none" when status is "ok"; use "escalate" when status is "escalate")
}

Use "escalate" whenever the evidence is ambiguous, contradictory, or insufficient to conclude the dispatch is genuinely progressing -- do not guess in the direction of "ok" when unsure. You have no authority beyond this classification: you cannot approve, reject, merge, or edit anything, and nothing you say is treated as more than these 5 fields.$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'monitor.dispatch_completion_classification'
ON CONFLICT (prompt_template_id, version) DO NOTHING;
