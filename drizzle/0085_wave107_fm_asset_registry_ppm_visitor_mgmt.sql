-- Wave 107 (VERI FM & CS AI OS -- Facilities Management & Corporate
-- Services): first real schema for the `facilities_management` product
-- branch registered as 'planned' in Wave 106's catalog. See
-- MASTER_AI_OS_ARCHITECTURE.md and the FM.md memory doc for the real
-- source-document analysis (Shiv Nadar School PPM/AMC register, checklist
-- library, WO/PO paperwork already solved by the existing `procurement`
-- branch) this schema is built from. NOT applied to Supabase this wave --
-- written and reviewed locally first, per explicit instruction.

-- ============================================================
-- 0. Extensions (pg_trgm already created by Wave 93 -- idempotent restate
--    with the correct schema clause, needed for fm_assets' name-dedup index)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- ============================================================
-- 1. Enums
-- ============================================================
DO $$ BEGIN
  CREATE TYPE compliance.fm_ppm_frequency AS ENUM ('daily', 'weekly', 'fortnightly', 'monthly', 'quarterly', 'half_yearly', 'annually');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.fm_ppm_occurrence_status AS ENUM ('due', 'in_progress', 'completed', 'overdue', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.fm_amc_payment_frequency AS ENUM ('monthly', 'quarterly', 'half_yearly', 'annually', 'one_time');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.fm_visitor_log_status AS ENUM ('checked_in', 'checked_out', 'denied');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. Tables (dependency order)
-- ============================================================

-- Small, platform-governed lookup (~28 seeded rows) -- the join key that
-- fixes the #1 confirmed data-quality problem (category-level naming
-- drift) at the level where it actually matters.
CREATE TABLE IF NOT EXISTS compliance.fm_asset_categories (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  category_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  typical_spec_unit text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.fm_assets (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  location_label text,
  category_id text NOT NULL REFERENCES compliance.fm_asset_categories(id),
  asset_name text NOT NULL,
  normalized_name text NOT NULL,
  asset_code text,
  capacity_spec text,
  make text,
  model text,
  serial_number text,
  installed_date date,
  status text NOT NULL DEFAULT 'active',
  qr_code_value text UNIQUE,
  amc_contract_id text,
  notes text,
  is_duplicate_of text,
  source_type text NOT NULL DEFAULT 'manual',
  source_document_id text REFERENCES compliance.documents(id),
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
ALTER TABLE compliance.fm_assets ADD CONSTRAINT fm_assets_is_duplicate_of_fkey FOREIGN KEY (is_duplicate_of) REFERENCES compliance.fm_assets(id);

CREATE TABLE IF NOT EXISTS compliance.fm_checklist_templates (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text,
  category_id text NOT NULL REFERENCES compliance.fm_asset_categories(id),
  frequency compliance.fm_ppm_frequency NOT NULL,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.fm_checklist_template_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  template_id text NOT NULL REFERENCES compliance.fm_checklist_templates(id),
  sequence_order integer NOT NULL DEFAULT 0,
  item_text text NOT NULL,
  item_type text NOT NULL DEFAULT 'checkbox',
  is_mandatory boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.fm_ppm_schedules (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  asset_id text NOT NULL REFERENCES compliance.fm_assets(id),
  checklist_template_id text NOT NULL REFERENCES compliance.fm_checklist_templates(id),
  is_active boolean NOT NULL DEFAULT true,
  next_due_date date NOT NULL,
  last_generated_occurrence_id text,
  default_assignee_id text REFERENCES compliance.users(id),
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(asset_id, checklist_template_id)
);

CREATE TABLE IF NOT EXISTS compliance.fm_ppm_occurrences (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  schedule_id text NOT NULL REFERENCES compliance.fm_ppm_schedules(id),
  asset_id text NOT NULL REFERENCES compliance.fm_assets(id),
  due_date date NOT NULL,
  status compliance.fm_ppm_occurrence_status NOT NULL DEFAULT 'due',
  assignee_id text REFERENCES compliance.users(id),
  started_at timestamp,
  completed_at timestamp,
  completed_by_id text REFERENCES compliance.users(id),
  completion_notes text,
  overdue_notified_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(schedule_id, due_date)
);
ALTER TABLE compliance.fm_ppm_schedules ADD CONSTRAINT fm_ppm_schedules_last_generated_occurrence_id_fkey FOREIGN KEY (last_generated_occurrence_id) REFERENCES compliance.fm_ppm_occurrences(id);

CREATE TABLE IF NOT EXISTS compliance.fm_ppm_occurrence_item_results (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  occurrence_id text NOT NULL REFERENCES compliance.fm_ppm_occurrences(id),
  template_item_id text NOT NULL REFERENCES compliance.fm_checklist_template_items(id),
  is_checked boolean NOT NULL DEFAULT false,
  numeric_value numeric,
  text_note text,
  org_id text NOT NULL,
  completed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.fm_amc_contracts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  asset_id text NOT NULL REFERENCES compliance.fm_assets(id),
  vendor_id text NOT NULL REFERENCES compliance.erp_suppliers(id),
  contract_start_date date NOT NULL,
  contract_end_date date NOT NULL,
  payment_frequency compliance.fm_amc_payment_frequency NOT NULL,
  contracted_yearly_service_count integer NOT NULL,
  first_service_date date,
  contract_value numeric,
  status text NOT NULL DEFAULT 'active',
  notes text,
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
ALTER TABLE compliance.fm_assets ADD CONSTRAINT fm_assets_amc_contract_id_fkey FOREIGN KEY (amc_contract_id) REFERENCES compliance.fm_amc_contracts(id);

CREATE TABLE IF NOT EXISTS compliance.fm_asset_duplicate_candidates (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  asset_id_a text NOT NULL REFERENCES compliance.fm_assets(id),
  asset_id_b text NOT NULL REFERENCES compliance.fm_assets(id),
  match_score numeric NOT NULL,
  match_reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by_id text REFERENCES compliance.users(id),
  reviewed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.fm_register_digitization_batches (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  source_document_id text NOT NULL REFERENCES compliance.documents(id),
  source_type text NOT NULL,
  status text NOT NULL DEFAULT 'extracted',
  total_rows_extracted integer NOT NULL DEFAULT 0,
  total_rows_committed integer NOT NULL DEFAULT 0,
  created_by_id text NOT NULL REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  reviewed_at timestamp
);

CREATE TABLE IF NOT EXISTS compliance.fm_register_digitization_rows (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  batch_id text NOT NULL REFERENCES compliance.fm_register_digitization_batches(id),
  org_id text NOT NULL,
  source_row_number integer,
  extracted_data jsonb NOT NULL,
  confidence numeric,
  review_status text NOT NULL DEFAULT 'pending',
  edited_data jsonb,
  committed_asset_id text REFERENCES compliance.fm_assets(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.fm_visitors (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  full_name text NOT NULL,
  phone_number text,
  id_type text,
  id_number_last4 text,
  company_or_org text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.fm_visitor_logs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  visitor_id text NOT NULL REFERENCES compliance.fm_visitors(id),
  host_user_id text NOT NULL REFERENCES compliance.users(id),
  purpose text,
  check_in_at timestamp NOT NULL DEFAULT now(),
  check_out_at timestamp,
  status compliance.fm_visitor_log_status NOT NULL DEFAULT 'checked_in',
  host_notified_at timestamp,
  logged_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now()
);

-- ============================================================
-- 3. Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_fm_assets_org_id ON compliance.fm_assets(org_id);
CREATE INDEX IF NOT EXISTS idx_fm_assets_category_id ON compliance.fm_assets(category_id);
CREATE INDEX IF NOT EXISTS idx_fm_assets_normalized_name_trgm ON compliance.fm_assets USING gin (normalized_name extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_fm_checklist_templates_org_id ON compliance.fm_checklist_templates(org_id);
CREATE INDEX IF NOT EXISTS idx_fm_checklist_templates_category_freq ON compliance.fm_checklist_templates(category_id, frequency);
CREATE INDEX IF NOT EXISTS idx_fm_checklist_template_items_template_id ON compliance.fm_checklist_template_items(template_id);
CREATE INDEX IF NOT EXISTS idx_fm_ppm_schedules_org_id ON compliance.fm_ppm_schedules(org_id);
CREATE INDEX IF NOT EXISTS idx_fm_ppm_schedules_next_due ON compliance.fm_ppm_schedules(is_active, next_due_date);
CREATE INDEX IF NOT EXISTS idx_fm_ppm_occurrences_org_id ON compliance.fm_ppm_occurrences(org_id);
CREATE INDEX IF NOT EXISTS idx_fm_ppm_occurrences_status_due ON compliance.fm_ppm_occurrences(org_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_fm_ppm_occurrence_item_results_occurrence_id ON compliance.fm_ppm_occurrence_item_results(occurrence_id);
CREATE INDEX IF NOT EXISTS idx_fm_amc_contracts_org_id ON compliance.fm_amc_contracts(org_id);
CREATE INDEX IF NOT EXISTS idx_fm_amc_contracts_asset_id ON compliance.fm_amc_contracts(asset_id);
CREATE INDEX IF NOT EXISTS idx_fm_asset_duplicate_candidates_org_id ON compliance.fm_asset_duplicate_candidates(org_id);
CREATE INDEX IF NOT EXISTS idx_fm_register_digitization_batches_org_id ON compliance.fm_register_digitization_batches(org_id);
CREATE INDEX IF NOT EXISTS idx_fm_register_digitization_rows_batch_id ON compliance.fm_register_digitization_rows(batch_id);
CREATE INDEX IF NOT EXISTS idx_fm_visitors_org_id ON compliance.fm_visitors(org_id);
CREATE INDEX IF NOT EXISTS idx_fm_visitor_logs_org_id ON compliance.fm_visitor_logs(org_id);
CREATE INDEX IF NOT EXISTS idx_fm_visitor_logs_visitor_id ON compliance.fm_visitor_logs(visitor_id);

-- ============================================================
-- 4. RLS
-- ============================================================

-- Platform-owned lookup: readable by every org (no org_id column at all),
-- writable only by service_role (migration-only catalog mutation, same
-- posture as module_registry).
ALTER TABLE compliance.fm_asset_categories ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_read_fm_asset_categories ON compliance.fm_asset_categories FOR SELECT TO app_runtime USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_fm_asset_categories ON compliance.fm_asset_categories FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT ON compliance.fm_asset_categories TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.fm_asset_categories TO service_role;

-- Nullable-org tables: an org sees the platform-seeded rows (org_id IS
-- NULL) PLUS its own rows -- the resolved-at-runtime pattern §2 of the
-- design relies on.
ALTER TABLE compliance.fm_checklist_templates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.fm_checklist_templates FOR ALL TO app_runtime
    USING (org_id IS NULL OR org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_fm_checklist_templates ON compliance.fm_checklist_templates FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.fm_checklist_templates TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.fm_checklist_templates TO service_role;

-- Template items have no org_id of their own -- visibility follows the
-- parent template via a subquery (mirrors how client_entities' RLS
-- already follows its parent client, per Wave 7's own precedent).
ALTER TABLE compliance.fm_checklist_template_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.fm_checklist_template_items FOR ALL TO app_runtime
    USING (EXISTS (
      SELECT 1 FROM compliance.fm_checklist_templates t
      WHERE t.id = fm_checklist_template_items.template_id
        AND (t.org_id IS NULL OR t.org_id = compliance.current_org_id())
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_fm_checklist_template_items ON compliance.fm_checklist_template_items FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.fm_checklist_template_items TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.fm_checklist_template_items TO service_role;

-- Every remaining table: standard org-scoped RLS pair, verbatim template.
-- Each CREATE POLICY is wrapped in its own BEGIN/EXCEPTION so a duplicate
-- on one table (e.g. a partial prior run) never aborts the rest of the
-- loop -- unlike a single exception handler around the whole loop, which
-- would stop processing at the first already-existing policy.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'fm_assets', 'fm_ppm_schedules', 'fm_ppm_occurrences', 'fm_ppm_occurrence_item_results',
    'fm_amc_contracts', 'fm_asset_duplicate_candidates', 'fm_register_digitization_batches',
    'fm_register_digitization_rows', 'fm_visitors', 'fm_visitor_logs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE compliance.%I ENABLE ROW LEVEL SECURITY', t);
    BEGIN
      EXECUTE format('CREATE POLICY app_runtime_org_scoped ON compliance.%I FOR ALL TO app_runtime USING (org_id = compliance.current_org_id())', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.%I TO app_runtime', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.%I TO service_role', t);
  END LOOP;
END $$;

-- ============================================================
-- 5. Seed: asset categories (confirmed real categories from the source
--    documents -- see FM.md memory)
-- ============================================================
INSERT INTO compliance.fm_asset_categories (category_key, display_name, typical_spec_unit) VALUES
  ('dg_set', 'DG Set', 'KVA'),
  ('hsd_tank', 'HSD Tank', 'Ltr'),
  ('lt_panel', 'LT Panel', 'Amp'),
  ('ht_panel', 'HT Panel', 'Amp'),
  ('transformer', 'Transformer', 'KVA'),
  ('ups', 'UPS', 'KVA'),
  ('vrv_ac', 'VRV AC (Outdoor Unit)', 'HP'),
  ('non_vrv_ac', 'Non-VRV AC', 'NA'),
  ('ahu', 'AHU (Air Handling Unit)', 'NA'),
  ('chiller', 'Chiller', 'NA'),
  ('cooling_tower', 'Cooling Tower', 'HP'),
  ('condenser_pump', 'Condenser Pump', 'KW'),
  ('borewell', 'Borewell', 'HP'),
  ('water_tank', 'Water Tank', 'Ltr'),
  ('ro_system', 'RO System', 'LPH'),
  ('uv_sterilizer', 'UV Sterilizer', 'NA'),
  ('water_filter', 'Water Filter', 'NA'),
  ('softener', 'Water Softener', 'NA'),
  ('fire_fighting', 'Fire Fighting System', 'HP'),
  ('passenger_lift', 'Passenger Lift', 'NA'),
  ('earthing_pit', 'Earthing Pit', 'NA'),
  ('lightning_arrestor', 'Lightning Arrestor', 'NA'),
  ('kitchen_exhaust', 'Kitchen Exhaust System', 'KW'),
  ('pneumatic_pump', 'Pneumatic Pump', 'HP'),
  ('sound_av_system', 'Sound/AV System', 'NA'),
  ('solar_system', 'Solar System', 'KW'),
  ('carpentry_furniture', 'Carpentry & Furniture', 'NA'),
  ('cctv', 'CCTV/Security System', 'NA')
ON CONFLICT (category_key) DO NOTHING;

-- ============================================================
-- 6. Seed: module registry + product_branch_modules links
-- ============================================================
INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('fm_asset_registry', 'FM Asset Registry', 'fm_assets', 'facilities_management', 'ASSET_MANAGEMENT', false, 'Physical asset register (DG sets, AC units, pumps, lifts, etc.) with QR tagging and AMC linkage'),
  ('fm_checklist_templates', 'FM Checklist Templates', 'fm_checklist_templates', 'facilities_management', 'ASSET_MANAGEMENT', false, 'Platform-owned PPM checklist library, resolved per asset category + frequency'),
  ('fm_ppm_scheduling', 'FM PPM Scheduling', 'fm_ppm_schedules', 'facilities_management', 'MAINTENANCE', false, 'Planned Preventive Maintenance scheduling supporting multiple simultaneous frequencies per asset, and task occurrence tracking'),
  ('fm_amc_contracts', 'FM AMC Contracts', 'fm_amc_contracts', 'facilities_management', 'VENDOR_MANAGEMENT', false, 'Annual Maintenance Contract tracking per asset, linked to the existing vendor master'),
  ('fm_visitor_management', 'FM Visitor Management', 'fm_visitor_logs', 'facilities_management', 'CORPORATE_SERVICES', false, 'Front-desk visitor check-in/check-out with host notification')
ON CONFLICT (module_key) DO NOTHING;

INSERT INTO compliance.product_branch_modules (product_branch_id, module_key, is_enabled)
SELECT pb.id, mr.module_key, true
FROM compliance.product_branches pb, compliance.module_registry mr
WHERE pb.branch_key = 'facilities_management'
  AND mr.module_key IN ('fm_asset_registry', 'fm_checklist_templates', 'fm_ppm_scheduling', 'fm_amc_contracts', 'fm_visitor_management')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 7. Seed: orchestra layer for register digitization
-- ============================================================
INSERT INTO compliance.orchestra_layers (layer_key, name, description, layer_order, default_model_config)
VALUES (
  'facilities_management_register_digitize_oa',
  'FM Register Digitization',
  'Extracts structured asset rows from an uploaded Excel/CSV asset register or a photo of a physical register, staged for mandatory human review before commit (fm-register-digitization-service.ts)',
  7,
  '{"provider":"openrouter","model":"openai/gpt-4o-mini"}'::jsonb
)
ON CONFLICT (layer_key) DO NOTHING;

-- ============================================================
-- 8. Seed: prompt template for register digitization
-- ============================================================
INSERT INTO compliance.prompt_templates (template_key, display_name, description) VALUES
  ('fm.register_digitize_extract', 'FM Register Digitization: Extraction Prompt', 'Extracts structured asset rows (name/category hint/capacity/make/model/location/confidence) from a parsed Excel/CSV row or a photo of a physical asset register (fm-register-digitization-service.ts)')
ON CONFLICT (template_key) DO NOTHING;

INSERT INTO compliance.prompt_versions (prompt_template_id, version, content, label)
SELECT id, 1, $tpl$You digitize physical facilities-management asset registers for a facilities management platform. Given either a parsed spreadsheet row or a photograph of a physical register page, extract ONE asset per identifiable entry and respond with ONLY JSON matching: { "assetName": string, "categoryHint": string, "capacitySpec": string | null, "make": string | null, "model": string | null, "locationLabel": string | null, "confidence": number, "warnings": string[] }. Preserve the source asset name exactly as written, including apparent typos or inconsistent casing -- do NOT normalize or correct it yourself, that is handled separately by a human-reviewed deduplication step. "categoryHint" should be your best-guess plain-language category (e.g. "DG Set", "VRV AC", "Borewell") -- it will be matched against a fixed category list by a human reviewer, not auto-committed. "capacitySpec" preserves the original unit text verbatim (e.g. "180 KVA", "18 HP", "NA") -- never convert units or invent a value that is not legible in the source. "confidence" is your own estimate (0-1) of how legible/certain this specific row's extraction is. "warnings" lists anything ambiguous, illegible, or contradictory about this specific row (empty array if none). Every extracted row is staged for human review before it becomes a real asset record -- never state or imply certainty you do not have.$tpl$, 'production'
FROM compliance.prompt_templates WHERE template_key = 'fm.register_digitize_extract'
ON CONFLICT (prompt_template_id, version) DO NOTHING;

-- ============================================================
-- 9. Promote facilities_management from 'planned' to 'building'
-- ============================================================
UPDATE compliance.product_branches SET status = 'building' WHERE branch_key = 'facilities_management';
