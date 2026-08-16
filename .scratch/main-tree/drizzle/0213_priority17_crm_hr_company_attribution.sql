-- Priority 17 remaining gap (2026-07-15): office/company attribution for
-- crm_leads, employee_profiles, leave_requests -- confirmed via schema.ts
-- these 3 tables carried orgId but no company/office dimension at all, so
-- Priority 17 Wave 1's company/office selector (erp_companies,
-- compliance-tracker#342) had nothing to filter on for CRM/HR data even
-- after PROJEXA exposed a selector UI. Additive, nullable, no DB-level FK
-- (matches every other companyId column already in this schema --
-- erp_budgets.companyId, erp_journal_entries.companyId,
-- erp_sales_invoices.companyId -- all bare text columns, app-level
-- validation only, never a drizzle .references() to erp_companies).
--
-- Backfill: an org with EXACTLY ONE erp_companies row is the common case
-- for a firm that hasn't set up multi-office yet -- every existing
-- lead/employee-profile/leave-request unambiguously belongs to that one
-- company, so this backfills those rows. An org with ZERO or MORE THAN ONE
-- erp_companies row has no safe, unambiguous single answer for which
-- existing row belongs to which company -- those rows are deliberately
-- left NULL rather than guessed. New rows going forward are attributed at
-- create time by the application (crm-service.ts/hr-service.ts), not by
-- this migration. Idempotent: safe to re-run (IF NOT EXISTS + a
-- `company_id IS NULL` guard on every backfill UPDATE).

ALTER TABLE compliance.crm_leads ADD COLUMN IF NOT EXISTS company_id text;
ALTER TABLE compliance.employee_profiles ADD COLUMN IF NOT EXISTS company_id text;
ALTER TABLE compliance.leave_requests ADD COLUMN IF NOT EXISTS company_id text;

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
UPDATE compliance.crm_leads cl
SET company_id = sco.company_id
FROM single_company_orgs sco
WHERE cl.org_id = sco.org_id AND cl.company_id IS NULL;

WITH single_company_orgs AS (
  SELECT org_id, min(id) AS company_id
  FROM compliance.erp_companies
  GROUP BY org_id
  HAVING count(*) = 1
)
UPDATE compliance.employee_profiles ep
SET company_id = sco.company_id
FROM single_company_orgs sco
WHERE ep.org_id = sco.org_id AND ep.company_id IS NULL;

WITH single_company_orgs AS (
  SELECT org_id, min(id) AS company_id
  FROM compliance.erp_companies
  GROUP BY org_id
  HAVING count(*) = 1
)
UPDATE compliance.leave_requests lr
SET company_id = sco.company_id
FROM single_company_orgs sco
WHERE lr.org_id = sco.org_id AND lr.company_id IS NULL;
