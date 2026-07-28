-- VERIDIAN_Architecture_v2.0 phase_8_dspy_learning_distribution_engines
-- (2026-07-28). Closes the 5 real remaining gap items PR #589 only scoped
-- (engine-prompt-translation, engine-prompt-localization,
-- engine-prompt-marketplace, engine-prompt-export, engine-prompt-import --
-- export/import need no new table, see prompt-export-import-service.ts).
-- Platform-wide, same posture as compliance.prompt_templates/
-- prompt_versions -- no org_id RLS scope; NOT applied live -- left for the
-- supervising session, same convention as drizzle/0262.

CREATE TABLE IF NOT EXISTS compliance.prompt_translations (
  id text PRIMARY KEY,
  prompt_version_id text NOT NULL,
  locale text NOT NULL,
  translated_content text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  created_by_id text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT prompt_translations_version_fk FOREIGN KEY (prompt_version_id)
    REFERENCES compliance.prompt_versions (id) ON DELETE CASCADE
);

-- One cached translation per (version, locale) -- the real cache key
-- prompt-translation-service.ts's "don't re-translate on every request"
-- lookup relies on.
CREATE UNIQUE INDEX IF NOT EXISTS prompt_translations_version_locale_unique
  ON compliance.prompt_translations (prompt_version_id, locale);

CREATE TABLE IF NOT EXISTS compliance.prompt_localizations (
  id text PRIMARY KEY,
  prompt_translation_id text NOT NULL,
  localized_content text NOT NULL,
  formatting_samples jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider text NOT NULL,
  model text NOT NULL,
  created_by_id text,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT prompt_localizations_translation_fk FOREIGN KEY (prompt_translation_id)
    REFERENCES compliance.prompt_translations (id) ON DELETE CASCADE
);

-- One cached localization per translation -- localization is a further
-- adaptation of one specific translation, not keyed by locale again (the
-- translation it points at already carries the locale).
CREATE UNIQUE INDEX IF NOT EXISTS prompt_localizations_translation_unique
  ON compliance.prompt_localizations (prompt_translation_id);

CREATE TABLE IF NOT EXISTS compliance.prompt_marketplace_listings (
  id text PRIMARY KEY,
  prompt_version_id text NOT NULL,
  title text NOT NULL,
  description text,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'listed',
  published_by_org_id text,
  published_by_user_id text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT prompt_marketplace_listings_version_fk FOREIGN KEY (prompt_version_id)
    REFERENCES compliance.prompt_versions (id) ON DELETE CASCADE,
  CONSTRAINT prompt_marketplace_listings_status_check
    CHECK (status IN ('listed', 'unlisted'))
);

CREATE INDEX IF NOT EXISTS prompt_marketplace_listings_status_idx
  ON compliance.prompt_marketplace_listings (status);

-- RLS + GRANT block, following the exact precedent of drizzle/0019
-- (compliance.prompt_templates/prompt_versions -- platform-wide, no
-- org_id/tenant scope) but using FOR ALL policies rather than 0019's
-- SELECT-only policy: app_runtime is NOSUPERUSER NOBYPASSRLS
-- (drizzle/0215), so RLS still applies on top of a table-level GRANT --
-- a SELECT-only policy would silently reject every insert/update the new
-- services make (translatePromptVersion/localizePromptVersion/
-- publishToMarketplace/unlistFromMarketplace) even though the GRANTs
-- below otherwise permit those operations. Using permissive
-- USING (true)/WITH CHECK (true) FOR ALL policies keeps the same
-- non-tenant-scoped posture as 0019 while actually covering every
-- operation the GRANTs allow.

ALTER TABLE compliance.prompt_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.prompt_localizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.prompt_marketplace_listings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_all_prompt_translations ON compliance.prompt_translations FOR ALL TO app_runtime USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_all_prompt_localizations ON compliance.prompt_localizations FOR ALL TO app_runtime USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_all_prompt_marketplace_listings ON compliance.prompt_marketplace_listings FOR ALL TO app_runtime USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE ON compliance.prompt_translations TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON compliance.prompt_localizations TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON compliance.prompt_marketplace_listings TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.prompt_translations, compliance.prompt_localizations, compliance.prompt_marketplace_listings TO service_role;
