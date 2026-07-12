-- tree4-unified/50-completion-plan Priority 2 item 3 (subagent/audit-lifecycle),
-- D15/U-D15.B1.S4 "L4 Executive Audit Review": a real, live gap found on
-- direct verification -- audit-cadence.ts's classifyAuditCadence() already
-- computes requiresExecutiveEscalation=true for BOTH 'high' and 'critical'
-- riskLevel, but guardrail-registrations.ts's closureReviewCheck only ever
-- acted on it when riskLevel === 'critical' (already redundant with that
-- branch's own condition) -- so a 'high'-risk closure was classified
-- L4-escalation-worthy and then surfaced nowhere, every time. Not a second
-- real-time gate (L1 correctly stays the only hard block on 'critical') --
-- this is the source doc's own periodic 3-hour REVIEW cadence's missing
-- query/acknowledge surface, same shape as 0145's re-audit columns.
--
-- NOT applied to the live database by this PR -- a human orchestrator
-- applies it after review, same posture as every other migration this
-- session.
--
-- All 3 columns nullable/additive -- existing activity_log rows are
-- unaffected. Set only via activity-log-service.ts's
-- acknowledgeExecutiveEscalation(); read via listPendingExecutiveEscalations().

ALTER TABLE compliance.activity_log ADD COLUMN IF NOT EXISTS executive_reviewed_at timestamp;
ALTER TABLE compliance.activity_log ADD COLUMN IF NOT EXISTS executive_reviewed_by text;
ALTER TABLE compliance.activity_log ADD COLUMN IF NOT EXISTS executive_review_notes text;

CREATE INDEX IF NOT EXISTS idx_activity_log_pending_executive_review ON compliance.activity_log(risk_level) WHERE executive_reviewed_at IS NULL AND risk_level IN ('high', 'critical');
