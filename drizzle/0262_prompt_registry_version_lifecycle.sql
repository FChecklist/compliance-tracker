-- VERIDIAN_Architecture_v2.0 phase_1_prompt_registry_lifecycle_foundation
-- (2026-07-25). Extends the real, live compliance.prompt_versions table
-- (Wave 22 Prompt Operating System, ~20 production resolvePromptTemplate()
-- call sites) with semantic (MAJOR.MINOR.PATCH) versioning + a real
-- Draft/Review/Staging/Production/Deprecated lifecycle_state column, plus
-- an optional structured metadata blob (PROMPT_METADATA_SCHEMA_2026-07-25.
-- schema.json) and a rollback-provenance pointer. Purely additive: the
-- pre-existing `label`/`version`/`is_active` columns are untouched, so
-- every existing resolvePromptTemplate()/createPromptVersion()/
-- listPromptVersions() call site keeps working unchanged. NOT applied live
-- -- left for the supervising session, same convention as every other
-- schema-touching claim in ai-os/boss/ACTIVE-CLAIMS.yaml.

ALTER TABLE compliance.prompt_versions
  ADD COLUMN IF NOT EXISTS major integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS minor integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS patch integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifecycle_state text NOT NULL DEFAULT 'Draft',
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS rolled_back_from_version_id text;

DO $$ BEGIN
  ALTER TABLE compliance.prompt_versions
    ADD CONSTRAINT prompt_versions_lifecycle_state_check
    CHECK (lifecycle_state IN ('Draft', 'Review', 'Staging', 'Production', 'Deprecated'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backfill: existing rows already carry real lifecycle signal via `label`
-- (the column resolvePromptTemplate() actually reads) -- map it onto the
-- new column rather than leaving every pre-existing version misleadingly
-- 'Draft'. A labeled-but-inactive row is still classified by its label
-- (the label itself is the lifecycle signal here, not is_active, which
-- only gates resolvePromptTemplate()'s own selection).
UPDATE compliance.prompt_versions SET lifecycle_state = 'Production' WHERE label = 'production';
UPDATE compliance.prompt_versions SET lifecycle_state = 'Staging' WHERE label = 'staging';

CREATE INDEX IF NOT EXISTS prompt_versions_template_lifecycle_idx
  ON compliance.prompt_versions (prompt_template_id, lifecycle_state);
