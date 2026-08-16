-- Wave 171 (tree4-unified/50-completion-plan area 1, U-D6): DCMD rich-
-- metadata + version-control fields. U-D6.B2.S2 recommended modeling this
-- as a graph structure rather than an enumerated permutation table -- that
-- recommendation is itself tagged not_applicable_to_code (a modeling
-- suggestion, not a literal requirement), so this stays relational/JSON
-- rather than standing up new graph-DB infrastructure for no functional
-- gain over jsonb arrays the real queries need. All nullable/defaulted --
-- existing rows are unaffected.

ALTER TABLE compliance.dynamic_chains ADD COLUMN IF NOT EXISTS linked_module_refs jsonb NOT NULL DEFAULT '[]';
ALTER TABLE compliance.dynamic_chains ADD COLUMN IF NOT EXISTS business_rules jsonb;
ALTER TABLE compliance.dynamic_chains ADD COLUMN IF NOT EXISTS permissions jsonb;
ALTER TABLE compliance.dynamic_chains ADD COLUMN IF NOT EXISTS workflow_ref text;
ALTER TABLE compliance.dynamic_chains ADD COLUMN IF NOT EXISTS ai_behavior_ref text;
ALTER TABLE compliance.dynamic_chains ADD COLUMN IF NOT EXISTS reports_kpis_slas jsonb;
ALTER TABLE compliance.dynamic_chains ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE compliance.dynamic_chains ADD COLUMN IF NOT EXISTS previous_version_id text;

-- U-D6.B3.S1: extend single-Chain-ID traceability to approval_requests,
-- the 3rd referencing object type wired so far (tasks + conversations were
-- Phase 1; this is the first Phase 2 extension).
ALTER TABLE compliance.approval_requests ADD COLUMN IF NOT EXISTS dynamic_chain_id text;
