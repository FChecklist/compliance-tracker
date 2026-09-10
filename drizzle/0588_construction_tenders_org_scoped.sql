-- Creates the three construction-tender tables that drizzle/0336 has been
-- claiming since 2026-08 but never actually created in this database.
--
-- WHY THIS EXISTS INSTEAD OF JUST APPLYING 0336. W-GAP found, while expanding
-- INST-A coverage, that every tender report throws 42P01: the tables are absent
-- (confirmed by to_regclass and a full pg_class scan, which rules out a
-- privilege false-negative). A check of every table any migration from 0300
-- onward claims to create found 76 claimed, 73 present, and exactly these 3
-- missing. So the 93-entry journal/ledger gap is almost entirely bookkeeping --
-- one migration is the whole product-visible cost of it.
--
-- 0336 IS NOT SAFE TO APPLY AS WRITTEN, and this is the important part. It
-- would have created all three tables with
--     CREATE POLICY "app_runtime_full_access" ... FOR ALL TO app_runtime
--       USING (true) WITH CHECK (true)
-- which is precisely the unqualified-policy shape that produced today's P0
-- cross-tenant investigation and cost three migrations (0583, 0584, and the
-- reverted 0587) to clean up. Its own header comment says the quiet part aloud:
-- "Tenant isolation is enforced at the application layer ... RLS here just needs
-- to not block app_runtime's own real access." That belief is what the last
-- eight hours were spent disproving.
--
-- It would also have regressed DOD-T8 on the same day it was closed: 0336
-- declares created_at, updated_at and won_at as bare `timestamp`, and migration
-- 0586 had just finished converting all 831 remaining naive columns in this
-- schema to timestamptz.
--
-- Anyone "fixing the migration drift" by replaying the backlog would therefore
-- have reopened two closed gates at once. That is the concrete argument for the
-- preflight in PR #1622: the danger of the backlog is not its size, it is that
-- nobody reads what is in it before it runs.
--
-- WHAT THIS MIGRATION DOES DIFFERENTLY, and only this:
--   1. every temporal column is timestamptz, not timestamp
--   2. each policy is org-scoped to compliance.current_org_id(), matching the
--      app_runtime_org_scoped pattern 0583 and 0584 established today
-- The columns, types, defaults, foreign keys, indexes and enums are otherwise
-- exactly 0336's, so the ORM schema and the eight report definitions that
-- depend on these tables need no change.
--
-- 0336 remains in the journal and on disk, unapplied. It is not deleted here:
-- reconciling it is PM-T12's job, and doing it in this migration would hide the
-- history that makes the above legible.

CREATE TYPE compliance.construction_tender_stage AS ENUM
  ('identified', 'pre_bid', 'costing', 'submitted', 'won', 'lost', 'awarded');
CREATE TYPE compliance.construction_tender_emd_status AS ENUM
  ('not_paid', 'paid', 'refunded', 'forfeited');

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
  won_at timestamptz,
  contract_award_sales_order_id text,
  created_by_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
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
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_construction_tenders_org_id
  ON compliance.construction_tenders(org_id);
CREATE INDEX IF NOT EXISTS idx_construction_tenders_stage
  ON compliance.construction_tenders(stage);
CREATE INDEX IF NOT EXISTS idx_construction_tender_boq_items_tender_id
  ON compliance.construction_tender_boq_items(tender_id);
CREATE INDEX IF NOT EXISTS idx_construction_tender_pre_bid_meetings_tender_id
  ON compliance.construction_tender_pre_bid_meetings(tender_id);

ALTER TABLE compliance.construction_tenders ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_tender_boq_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_tender_pre_bid_meetings ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_runtime_org_scoped ON compliance.construction_tenders
  FOR ALL TO app_runtime
  USING (org_id = compliance.current_org_id())
  WITH CHECK (org_id = compliance.current_org_id());

CREATE POLICY app_runtime_org_scoped ON compliance.construction_tender_boq_items
  FOR ALL TO app_runtime
  USING (org_id = compliance.current_org_id())
  WITH CHECK (org_id = compliance.current_org_id());

CREATE POLICY app_runtime_org_scoped ON compliance.construction_tender_pre_bid_meetings
  FOR ALL TO app_runtime
  USING (org_id = compliance.current_org_id())
  WITH CHECK (org_id = compliance.current_org_id());

CREATE POLICY service_role_bypass_construction_tenders ON compliance.construction_tenders
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_bypass_construction_tender_boq_items ON compliance.construction_tender_boq_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_bypass_construction_tender_pre_bid_meetings ON compliance.construction_tender_pre_bid_meetings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.construction_tenders TO app_runtime, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.construction_tender_boq_items TO app_runtime, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.construction_tender_pre_bid_meetings TO app_runtime, service_role;
