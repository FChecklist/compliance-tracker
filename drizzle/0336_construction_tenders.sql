-- R65 gap-closure: tender/bid/EMD tracking (closes 8 report_definitions
-- data_gap rows: Tender Register, Tender Pipeline, Tender Win/Loss Report,
-- Tender Costing Report, BOQ Submission Report, Pre-Bid Meeting Report,
-- EMD Tracking Report, Contract Award Report). Genuinely distinct from
-- erp_rfqs (procurement, this org buying) -- a tender is this org bidding
-- to win a client contract. See schema.ts's own header comment above
-- constructionTenders for the full rationale.

CREATE TYPE compliance.construction_tender_stage AS ENUM ('identified', 'pre_bid', 'costing', 'submitted', 'won', 'lost', 'awarded');
CREATE TYPE compliance.construction_tender_emd_status AS ENUM ('not_paid', 'paid', 'refunded', 'forfeited');

CREATE TABLE IF NOT EXISTS compliance.construction_tenders (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  project_id text,
  tender_number text NOT NULL,
  issuing_authority text NOT NULL,
  title text NOT NULL,
  estimated_value numeric NOT NULL DEFAULT 0,
  emd_amount numeric NOT NULL DEFAULT 0,
  emd_status compliance.construction_tender_emd_status NOT NULL DEFAULT 'not_paid',
  submission_deadline date,
  stage compliance.construction_tender_stage NOT NULL DEFAULT 'identified',
  loss_reason text,
  won_at timestamp,
  contract_award_sales_order_id text,
  created_by_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.construction_tender_boq_items (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  tender_id text NOT NULL REFERENCES compliance.construction_tenders(id),
  item_code text,
  description text NOT NULL,
  unit text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  rate numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS compliance.construction_tender_pre_bid_meetings (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  tender_id text NOT NULL REFERENCES compliance.construction_tenders(id),
  meeting_date date NOT NULL,
  queries_raised text,
  clarifications_received text,
  created_by_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_construction_tenders_org_id ON compliance.construction_tenders(org_id);
CREATE INDEX IF NOT EXISTS idx_construction_tenders_stage ON compliance.construction_tenders(stage);
CREATE INDEX IF NOT EXISTS idx_construction_tender_boq_items_tender_id ON compliance.construction_tender_boq_items(tender_id);
CREATE INDEX IF NOT EXISTS idx_construction_tender_pre_bid_meetings_tender_id ON compliance.construction_tender_pre_bid_meetings(tender_id);

-- Tenant isolation is enforced at the application layer (org_id filtered in
-- every query, matching this codebase's real, existing convention) --
-- RLS here just needs to not block app_runtime's own real access, same
-- pattern as drizzle/0333_r63_enable_rls_platform_tables.sql.
ALTER TABLE compliance.construction_tenders ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_tender_boq_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_tender_pre_bid_meetings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_runtime_full_access" ON compliance.construction_tenders
  FOR ALL TO app_runtime USING (true) WITH CHECK (true);
CREATE POLICY "app_runtime_full_access" ON compliance.construction_tender_boq_items
  FOR ALL TO app_runtime USING (true) WITH CHECK (true);
CREATE POLICY "app_runtime_full_access" ON compliance.construction_tender_pre_bid_meetings
  FOR ALL TO app_runtime USING (true) WITH CHECK (true);
