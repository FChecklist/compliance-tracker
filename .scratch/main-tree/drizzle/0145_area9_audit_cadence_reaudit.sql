-- tree4-unified/50-completion-plan area 9 "Auditing", U-D15.B3.S1 ("no task
-- is EVER permanently complete" -- ai-os/audit-tree/02-audit-organization.yaml
-- lines 363-367).
--
-- NOT applied to the live database by this PR -- see the accompanying PR
-- description. A human orchestrator applies it after review, same posture
-- as 0139_wave167_handover_protocol.sql / 0144_area3_risk_and_confidence_banding.sql.
--
-- All 3 columns nullable/additive -- existing activity_log rows are
-- unaffected. Set/cleared via activity-log-service.ts's flagForReAudit()/
-- clearReAuditFlag(); read via listReAuditFlagged().

ALTER TABLE compliance.activity_log ADD COLUMN IF NOT EXISTS re_audit_requested_at timestamp;
ALTER TABLE compliance.activity_log ADD COLUMN IF NOT EXISTS re_audit_reason text;
ALTER TABLE compliance.activity_log ADD COLUMN IF NOT EXISTS re_audit_requested_by text;

CREATE INDEX IF NOT EXISTS idx_activity_log_re_audit_requested_at ON compliance.activity_log(re_audit_requested_at) WHERE re_audit_requested_at IS NOT NULL;
