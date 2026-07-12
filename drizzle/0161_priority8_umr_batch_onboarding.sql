-- Priority 8 (14-priority8-close-tree1-remaining-gaps.yaml, GAP-UMR-TABLE-
-- COVERAGE): a real batch of additional tables onboarded onto the generic
-- auto-registration trigger built in drizzle/0152. Not literally all 359
-- remaining grandfather-exempted tables in one pass (an intentionally
-- ongoing tail, per its own framing in MASTER-TRACKER.yaml) -- 7 genuinely
-- valuable, real business-object tables picked from the exempted list.
-- Column names verified against each table's real definition in
-- src/lib/db/schema.ts, never guessed.

-- ─── clients ────────────────────────────────────────────────────────────
-- isActive is a genuine TRUE-means-active flag (matches the trigger's
-- assumed polarity). No purpose-shaped column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('clients', 'other', 'name', NULL, NULL, 'org_id', NULL, 'is_active');

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.clients
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── veri_meetings ──────────────────────────────────────────────────────
-- status is 'draft'|'published' (no boolean active flag) -- active_column
-- left NULL rather than force-fit. minutes is the closest purpose-shaped
-- text column.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('veri_meetings', 'document', 'title', 'minutes', NULL, 'org_id', 'published_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.veri_meetings
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── erp_customers ──────────────────────────────────────────────────────
-- isActive is a genuine TRUE-means-active flag.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('erp_customers', 'other', 'customer_name', NULL, NULL, 'org_id', NULL, 'is_active');

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.erp_customers
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── erp_purchase_orders ────────────────────────────────────────────────
-- status is a 5-value workflow enum, not boolean -- active_column NULL.
-- po_number is an integer, per-org sequence, but the generic trigger's
-- `to_jsonb(NEW) ->> name_column` extraction handles a numeric JSON value
-- fine (returns its unquoted text representation) -- confirmed by re-
-- reading auto_register_asset()'s extraction logic before writing this
-- row, not assumed. Real, useful identifying value (e.g. "1042"), better
-- than the generic "table:id" fallback.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('erp_purchase_orders', 'other', 'po_number', NULL, NULL, 'org_id', 'created_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.erp_purchase_orders
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── leave_requests ─────────────────────────────────────────────────────
-- status is a 4-value workflow enum, not boolean -- active_column NULL.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('leave_requests', 'task', 'leave_type', 'reason', NULL, 'org_id', 'user_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.leave_requests
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── crm_leads ──────────────────────────────────────────────────────────
-- status is a 5-value workflow enum, not boolean -- active_column NULL.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('crm_leads', 'other', 'name', 'ai_score_reasoning', NULL, 'org_id', 'owner_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.crm_leads
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── crm_opportunities ──────────────────────────────────────────────────
-- stage is a 5-value workflow enum, not boolean -- active_column NULL.
-- owner_column = owner_id (nullable) rather than created_by_id (NOT NULL
-- but the creator, not necessarily who the opportunity "belongs to").
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('crm_opportunities', 'other', 'name', 'ai_recommended_action', NULL, 'org_id', 'owner_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.crm_opportunities
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();
