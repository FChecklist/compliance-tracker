-- Priority 17 final gap (2026-07-16): office/company attribution for
-- erp_quotations, erp_sales_orders, erp_purchase_orders -- direct
-- continuation of drizzle/0213_priority17_crm_hr_company_attribution.sql
-- (compliance-tracker#365), which added the same column to crm_leads/
-- employee_profiles/leave_requests and explicitly left this exact gap
-- unwired: "Sales/CRM beyond Leads (Opportunities/Quotations/Sales Orders):
-- those tables have no companyId column in the schema." Confirmed via
-- schema.ts that erpQuotations/erpSalesOrders/erpPurchaseOrders all carry
-- orgId but no company/office dimension. erpPurchaseOrders is the buying
-- side, not literally "Sales", but gets the identical fix here for
-- consistency with #365's own precedent (erp_budgets/erp_journal_entries/
-- erp_sales_invoices all got companyId regardless of module boundary).
--
-- Additive, nullable, no DB-level FK -- matches every other companyId
-- column in this schema (erp_budgets.companyId, erp_journal_entries.
-- companyId, erp_sales_invoices.companyId, crm_leads.companyId, etc.): all
-- bare text columns, app-level validation only, never a drizzle
-- .references() to erp_companies.
--
-- Backfill: same single-company-per-org logic as 0213 -- an org with
-- EXACTLY ONE erp_companies row gets its existing rows attributed to it;
-- an org with ZERO or MORE THAN ONE erp_companies row has no safe,
-- unambiguous single answer for which existing row belongs to which
-- company, so those rows are deliberately left NULL rather than guessed.
-- New rows going forward are attributed at create time by the application
-- (erp-selling-service.ts/erp-buying-service.ts), not by this migration.
-- Idempotent: safe to re-run (IF NOT EXISTS + a `company_id IS NULL` guard
-- on every backfill UPDATE).

ALTER TABLE compliance.erp_quotations ADD COLUMN IF NOT EXISTS company_id text;
ALTER TABLE compliance.erp_sales_orders ADD COLUMN IF NOT EXISTS company_id text;
ALTER TABLE compliance.erp_purchase_orders ADD COLUMN IF NOT EXISTS company_id text;

-- Single-company-per-org backfill, computed at migration-apply time against
-- the real data, not assumed at authoring time. One CTE per statement (not
-- shared across tables) since each table's own `company_id IS NULL` guard
-- must be evaluated independently.
WITH single_company_orgs AS (
  SELECT org_id, min(id) AS company_id
  FROM compliance.erp_companies
  GROUP BY org_id
  HAVING count(*) = 1
)
UPDATE compliance.erp_quotations eq
SET company_id = sco.company_id
FROM single_company_orgs sco
WHERE eq.org_id = sco.org_id AND eq.company_id IS NULL;

WITH single_company_orgs AS (
  SELECT org_id, min(id) AS company_id
  FROM compliance.erp_companies
  GROUP BY org_id
  HAVING count(*) = 1
)
UPDATE compliance.erp_sales_orders eso
SET company_id = sco.company_id
FROM single_company_orgs sco
WHERE eso.org_id = sco.org_id AND eso.company_id IS NULL;

WITH single_company_orgs AS (
  SELECT org_id, min(id) AS company_id
  FROM compliance.erp_companies
  GROUP BY org_id
  HAVING count(*) = 1
)
UPDATE compliance.erp_purchase_orders epo
SET company_id = sco.company_id
FROM single_company_orgs sco
WHERE epo.org_id = sco.org_id AND epo.company_id IS NULL;
