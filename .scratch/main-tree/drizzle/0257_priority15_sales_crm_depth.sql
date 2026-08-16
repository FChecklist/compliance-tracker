-- Priority 15 (PROJEXA Sales & CRM depth wave, 2026-07-14, Owner directive:
-- "dont just make MVP pages... complete indepth... for a mid size 100
-- employee construction firm... working on 500 projects"). Additive columns
-- for CRM stage-change tracking / next-action follow-up dates / a bridge
-- into the ERP Selling identity space, a new crm_stage_history ledger
-- table, and quotation/sales-order revisioning + project linkage.
--
-- erp_quotations/erp_sales_orders' `status` columns have always been plain
-- text (not a Postgres enum) -- widening the accepted application-level
-- value set (draft/pending_approval/approved/sent/ordered/lost/expired for
-- quotations; draft/confirmed/partially_fulfilled/fulfilled/cancelled for
-- sales orders, see erp-selling-service.ts) needs no ALTER TYPE and no
-- backfill: both tables were shipped in Wave 60 with zero service-layer
-- consumer until this same PR, so there are no live rows using the old
-- status wording to reconcile.

-- crm_leads: next-action follow-up tracking
ALTER TABLE compliance.crm_leads ADD COLUMN IF NOT EXISTS next_action_date date;
ALTER TABLE compliance.crm_leads ADD COLUMN IF NOT EXISTS next_action_note text;

-- crm_opportunities: next-action tracking + bridge into erp_customers (see
-- schema.ts's own comment on this column for why client_id alone doesn't
-- represent a construction firm's real "customer").
ALTER TABLE compliance.crm_opportunities ADD COLUMN IF NOT EXISTS next_action_date date;
ALTER TABLE compliance.crm_opportunities ADD COLUMN IF NOT EXISTS next_action_note text;
ALTER TABLE compliance.crm_opportunities ADD COLUMN IF NOT EXISTS erp_customer_id text;

-- crm_stage_history: new table -- a real stage-change ledger for both leads
-- (status) and opportunities (stage), entity_type/entity_id discriminated
-- rather than two separate tables (see crm-service.ts's comment).
CREATE TABLE IF NOT EXISTS compliance.crm_stage_history (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  from_stage text,
  to_stage text NOT NULL,
  note text,
  changed_by_id text,
  changed_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_stage_history_org_entity_idx
  ON compliance.crm_stage_history (org_id, entity_type, entity_id);

-- RLS -- mandatory in the same migration per ai-os/CONSTITUTION.yaml's
-- ARCH-03, verbatim template from MASTER_AI_OS_ARCHITECTURE.md.
ALTER TABLE compliance.crm_stage_history ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.crm_stage_history FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_crm_stage_history ON compliance.crm_stage_history FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.crm_stage_history TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.crm_stage_history TO service_role;

-- erp_quotations: revisioning (version/revision_of, see
-- createQuotationRevision()'s comment) + project linkage, same convention
-- as erp_sales_invoices.project_id (Wave 120).
ALTER TABLE compliance.erp_quotations ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE compliance.erp_quotations ADD COLUMN IF NOT EXISTS revision_of text;
ALTER TABLE compliance.erp_quotations ADD COLUMN IF NOT EXISTS project_id text;

-- erp_sales_orders: project linkage.
ALTER TABLE compliance.erp_sales_orders ADD COLUMN IF NOT EXISTS project_id text;

-- Data fixup: erp_quotations/erp_sales_orders already had a handful of
-- demo_org seed rows (inserted before this PR's service layer existed, so
-- nothing ever validated their status wording -- one quotation row even
-- used 'accepted', a value schema.ts's own pre-this-wave comment never
-- documented). Remap to the new vocabulary so no pre-existing row is left
-- in an unrecognized/stuck status the new transition table can't move.
UPDATE compliance.erp_quotations SET status = 'sent' WHERE status = 'submitted';
UPDATE compliance.erp_quotations SET status = 'ordered' WHERE status = 'accepted';
UPDATE compliance.erp_sales_orders SET status = 'confirmed' WHERE status = 'submitted';
UPDATE compliance.erp_sales_orders SET status = 'partially_fulfilled' WHERE status = 'partially_delivered';
UPDATE compliance.erp_sales_orders SET status = 'fulfilled' WHERE status = 'completed';
