-- GRC automation (deterministic, no LLM): real SLA/deadline computation
-- for incidents/whistleblower/POSH (over existing date columns, no new
-- columns needed there) and a real weighted risk score for vendor risk
-- profiles (which previously had only a manually-picked riskTier).
ALTER TABLE compliance.vendor_risk_profiles ADD COLUMN IF NOT EXISTS risk_score integer;
ALTER TABLE compliance.vendor_risk_profiles ADD COLUMN IF NOT EXISTS risk_factors jsonb;

-- Whistleblower investigation SLA (company policy, not statute -- so this
-- is module-rule-configurable per the incidents module's existing
-- precedent, not hardcoded). Platform default: 90 days.
INSERT INTO compliance.module_rule_configs (module_key, rule_key, rule_value, scope_type, scope_id)
VALUES ('whistleblower_cases', 'investigation_sla_days', '{"days": 90}'::jsonb, 'platform', NULL)
ON CONFLICT (module_key, rule_key, scope_type, scope_id) DO NOTHING;
