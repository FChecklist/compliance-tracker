-- Priority 14 (GAP-DCMD, next real slice after Wave 173's governance slice
-- and Priority 10/14's graph edges). See ai-os/DCMD-SCHEMA-DESIGN.md for the
-- full per-sub-field reasoning. Adds 7 more additive, nullable columns
-- covering 7 of the remaining 8 named DCMD sub-fields (business,
-- classification, inputs, outputs, AI, workflow, knowledge). The 8th
-- (software) is deliberately NOT a new column -- re-scoped onto the
-- pre-existing linked_module_refs column, see the design doc for why.
-- All nullable or empty-array-defaulted; existing rows are unaffected.
-- No entity_relationships graph edges are added this migration (schema
-- only -- see design doc's "no real chokepoint" reasoning per field).
--
-- E-103 fix (2026-08-28): these 7 ALTER TABLE lines target
-- compliance.dynamic_chains, matching what this migration actually applied
-- historically -- dynamic_chains does not move to the platform schema until
-- 0245_create_platform_schema_compartment.sql, ~46 journal entries later,
-- which carries these columns across via ALTER TABLE ... SET SCHEMA. Commit
-- 9288746 (26 Jul 2026, "Fix PR #563 CI: ... correct stale migration schema
-- refs") had rewritten these lines to platform.dynamic_chains to match the
-- then-current live schema -- silently breaking a from-scratch replay
-- (platform.dynamic_chains doesn't exist yet at this point in the journal)
-- and desynchronising this file from the hash already recorded in
-- drizzle.__drizzle_migrations for this entry, in violation of this repo's
-- own "never edit an already-applied migration" rule (see
-- platform.error_log E-103's prevention_rule). Reverted here to the
-- historically-correct, hash-matching form. No live database action needed
-- -- production already has these columns on platform.dynamic_chains from
-- when 0245 ran there.

ALTER TABLE compliance.dynamic_chains ADD COLUMN IF NOT EXISTS classification jsonb;
ALTER TABLE compliance.dynamic_chains ADD COLUMN IF NOT EXISTS owner_department_id text;
ALTER TABLE compliance.dynamic_chains ADD COLUMN IF NOT EXISTS input_contract jsonb;
ALTER TABLE compliance.dynamic_chains ADD COLUMN IF NOT EXISTS output_contract jsonb;
ALTER TABLE compliance.dynamic_chains ADD COLUMN IF NOT EXISTS ai_config jsonb;
ALTER TABLE compliance.dynamic_chains ADD COLUMN IF NOT EXISTS workflow_steps_config jsonb;
ALTER TABLE compliance.dynamic_chains ADD COLUMN IF NOT EXISTS linked_knowledge_base_page_ids jsonb NOT NULL DEFAULT '[]';
