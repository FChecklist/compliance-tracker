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

ALTER TABLE compliance.dynamic_chains ADD COLUMN IF NOT EXISTS classification jsonb;
ALTER TABLE compliance.dynamic_chains ADD COLUMN IF NOT EXISTS owner_department_id text;
ALTER TABLE compliance.dynamic_chains ADD COLUMN IF NOT EXISTS input_contract jsonb;
ALTER TABLE compliance.dynamic_chains ADD COLUMN IF NOT EXISTS output_contract jsonb;
ALTER TABLE compliance.dynamic_chains ADD COLUMN IF NOT EXISTS ai_config jsonb;
ALTER TABLE compliance.dynamic_chains ADD COLUMN IF NOT EXISTS workflow_steps_config jsonb;
ALTER TABLE compliance.dynamic_chains ADD COLUMN IF NOT EXISTS linked_knowledge_base_page_ids jsonb NOT NULL DEFAULT '[]';
