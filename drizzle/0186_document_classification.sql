-- Priority 13 (Document Correspondent/Type Auto-Classification, Paperless-
-- ngx pattern). Confirmed gap: zero hits for "correspondent"/"autoClassif"/
-- "matchingRule" anywhere in src/lib/services/ before this migration.
-- documents.category (Wave 61) already covers Paperless-ngx's "DocumentType"
-- concept (nullable free text, advisory) -- this migration does NOT fork
-- that into a parallel document_types entity table. What's genuinely added:
--   1. document_correspondents -- a real, org-managed correspondent register
--      (who sent/issued a document), which nothing in this schema modeled
--      before.
--   2. document_matching_rules -- org-scoped rules (any_word/all_words/
--      exact/regex against filename and/or extracted text) that auto-set a
--      document's category/correspondentId/tags on ingest.
--   3. documents gains correspondent_id (nullable FK), tags (jsonb string[],
--      default []), and auto_classified (boolean, default false) -- all
--      additive, every existing row defaults to unclassified/no-tags/manual,
--      exactly as before this migration.
--
-- See document-classification-service.ts for the (deterministic, no-AI-call)
-- rule-matching logic and its "never override an explicit value" discipline.

CREATE TABLE IF NOT EXISTS compliance.document_correspondents (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  name text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.document_correspondents ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.document_correspondents FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_document_correspondents ON compliance.document_correspondents FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.document_correspondents TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.document_correspondents TO service_role;

CREATE INDEX IF NOT EXISTS idx_document_correspondents_org_id ON compliance.document_correspondents(org_id);

DO $$ BEGIN
  CREATE TYPE compliance.document_matching_rule_type AS ENUM ('any_word', 'all_words', 'exact', 'regex');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.document_matching_rule_field AS ENUM ('filename', 'content', 'both');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS compliance.document_matching_rules (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  match_field compliance.document_matching_rule_field NOT NULL DEFAULT 'both',
  rule_type compliance.document_matching_rule_type NOT NULL,
  pattern text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  target_correspondent_id text REFERENCES compliance.document_correspondents(id) ON DELETE SET NULL,
  target_category text,
  target_tags jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.document_matching_rules ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.document_matching_rules FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_document_matching_rules ON compliance.document_matching_rules FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.document_matching_rules TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.document_matching_rules TO service_role;

CREATE INDEX IF NOT EXISTS idx_document_matching_rules_org_id ON compliance.document_matching_rules(org_id);
CREATE INDEX IF NOT EXISTS idx_document_matching_rules_priority ON compliance.document_matching_rules(priority);

ALTER TABLE compliance.documents ADD COLUMN IF NOT EXISTS correspondent_id text REFERENCES compliance.document_correspondents(id) ON DELETE SET NULL;
ALTER TABLE compliance.documents ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]';
ALTER TABLE compliance.documents ADD COLUMN IF NOT EXISTS auto_classified boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_documents_correspondent_id ON compliance.documents(correspondent_id);

-- Universal Metadata Registry (UMR) registration -- same auto-register
-- pattern as every other org-scoped, genuinely-named business table added
-- in prior waves (see drizzle/0180's own header for the mechanism).
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('document_correspondents', 'other', 'name', NULL, NULL, 'org_id', NULL, NULL),
  ('document_matching_rules', 'rule', 'name', NULL, NULL, 'org_id', NULL, 'is_active')
ON CONFLICT (source_table) DO NOTHING;

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.document_correspondents
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.document_matching_rules
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('document_classification', 'Document Correspondent/Type Auto-Classification', 'document_matching_rules', 'documents', 'TOOLS', false, 'Priority 13: Paperless-ngx-inspired correspondent register + org-scoped matching rules (any_word/all_words/exact/regex against filename/extracted text) that auto-tag a document''s category/correspondent/tags on ingest, additive-only -- never overrides a value a user already set.')
ON CONFLICT (module_key) DO NOTHING;
