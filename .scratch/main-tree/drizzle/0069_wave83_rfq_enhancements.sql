-- Wave 83 (RFQ enhancements, per COMPARISON_CSV_GAP_ANALYSIS.md backlog
-- item 4). erp_rfqs/erp_supplier_quotations (Wave 55) only had price-only
-- comparison. Adds formal weighted scoring, a structured negotiation-round
-- log, and a reverse auction (suppliers bid via their existing Wave 80
-- vendor-portal token, no second invite mechanism).

CREATE TABLE IF NOT EXISTS compliance.erp_rfq_scoring_criteria (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  rfq_id text NOT NULL REFERENCES compliance.erp_rfqs(id) ON DELETE CASCADE,
  name text NOT NULL,
  weight numeric NOT NULL DEFAULT 1,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_rfq_quotation_scores (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  quotation_id text NOT NULL REFERENCES compliance.erp_supplier_quotations(id) ON DELETE CASCADE,
  criterion_id text NOT NULL REFERENCES compliance.erp_rfq_scoring_criteria(id) ON DELETE CASCADE,
  score numeric NOT NULL,
  scored_by_id text,
  notes text,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT score_range CHECK (score BETWEEN 0 AND 10)
);

CREATE TABLE IF NOT EXISTS compliance.erp_rfq_negotiation_rounds (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  quotation_id text NOT NULL REFERENCES compliance.erp_supplier_quotations(id) ON DELETE CASCADE,
  round_number integer NOT NULL,
  proposed_rate numeric NOT NULL,
  notes text,
  created_by_id text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_rfq_reverse_auctions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  rfq_id text NOT NULL REFERENCES compliance.erp_rfqs(id) ON DELETE CASCADE,
  start_at timestamp NOT NULL,
  end_at timestamp NOT NULL,
  status text NOT NULL DEFAULT 'scheduled',
  current_lowest_bid numeric,
  current_leader_supplier_id text,
  winning_supplier_id text,
  closed_at timestamp,
  created_by_id text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_rfq_auction_bids (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  auction_id text NOT NULL REFERENCES compliance.erp_rfq_reverse_auctions(id) ON DELETE CASCADE,
  supplier_id text NOT NULL REFERENCES compliance.erp_suppliers(id),
  bid_amount numeric NOT NULL,
  submitted_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_erp_rfq_scoring_criteria_rfq_id ON compliance.erp_rfq_scoring_criteria(rfq_id);
CREATE INDEX IF NOT EXISTS idx_erp_rfq_quotation_scores_quotation_id ON compliance.erp_rfq_quotation_scores(quotation_id);
CREATE INDEX IF NOT EXISTS idx_erp_rfq_negotiation_rounds_quotation_id ON compliance.erp_rfq_negotiation_rounds(quotation_id);
CREATE INDEX IF NOT EXISTS idx_erp_rfq_reverse_auctions_rfq_id ON compliance.erp_rfq_reverse_auctions(rfq_id);
CREATE INDEX IF NOT EXISTS idx_erp_rfq_auction_bids_auction_id ON compliance.erp_rfq_auction_bids(auction_id);

ALTER TABLE compliance.erp_rfq_scoring_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.erp_rfq_quotation_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.erp_rfq_negotiation_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.erp_rfq_reverse_auctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.erp_rfq_auction_bids ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_rfq_scoring_criteria FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_rfq_quotation_scores FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_rfq_negotiation_rounds FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_rfq_reverse_auctions FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_rfq_auction_bids FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_rfq_scoring_criteria', 'erp_rfq_quotation_scores', 'erp_rfq_negotiation_rounds',
    'erp_rfq_reverse_auctions', 'erp_rfq_auction_bids'
  ])
  LOOP
    EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.erp_rfq_scoring_criteria, compliance.erp_rfq_quotation_scores, compliance.erp_rfq_negotiation_rounds,
  compliance.erp_rfq_reverse_auctions, compliance.erp_rfq_auction_bids
  TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.erp_rfq_scoring_criteria, compliance.erp_rfq_quotation_scores, compliance.erp_rfq_negotiation_rounds,
  compliance.erp_rfq_reverse_auctions, compliance.erp_rfq_auction_bids
  TO service_role;
