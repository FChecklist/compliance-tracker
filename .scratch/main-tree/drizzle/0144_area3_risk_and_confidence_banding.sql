-- tree4-unified/50-completion-plan area 3 "Guardrails", PLAN-16 re-scoped
-- item (d) Risk Classification + D18/PLAN-20 Confidence Banding.
--
-- NOT applied to the live database by this PR -- see the accompanying PR
-- description. A human orchestrator applies it after review, same posture
-- as 0139_wave167_handover_protocol.sql / 0142_wave172_loop_engineering.sql.
--
-- All 3 columns nullable/additive -- existing activity_log rows are
-- unaffected. risk_level is computed at dispatch time (risk-classification.ts's
-- classifyRisk(), Guardrail 10); confidence_percentage/confidence_band are
-- computed at closure time (confidence-banding.ts's bandConfidence(),
-- Guardrail 9) when a numeric self-assessed confidence is supplied.

ALTER TABLE compliance.activity_log ADD COLUMN IF NOT EXISTS risk_level text;
ALTER TABLE compliance.activity_log ADD COLUMN IF NOT EXISTS confidence_percentage numeric;
ALTER TABLE compliance.activity_log ADD COLUMN IF NOT EXISTS confidence_band text;

CREATE INDEX IF NOT EXISTS idx_activity_log_risk_level ON compliance.activity_log(risk_level) WHERE risk_level IS NOT NULL;
