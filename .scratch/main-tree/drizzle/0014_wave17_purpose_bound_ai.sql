-- Wave 17 (VAIOS Purpose-Bound AI Enforcement) -- see PLATFORM_STRATEGY.md
-- §10-11. NULL = unconstrained, preserving every existing key's current
-- behavior with zero migration risk.
ALTER TABLE compliance.api_keys ADD COLUMN IF NOT EXISTS domain_scope text;
