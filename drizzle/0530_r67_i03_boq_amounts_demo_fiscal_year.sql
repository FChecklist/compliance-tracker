-- R67 lane I, item I-03 -- BOQ line material/manpower amounts, plus the demo
-- organisation's missing fiscal year and chart of accounts.
--
-- Numbered 0530, the next free number after this lane's own 0529 (and
-- 0527_r65_parte_billing_contracts.sql on origin/main). Never renumbered once
-- applied; the number is re-checked against origin/main immediately before
-- merge.
--
-- Hand-written rather than `bun run db:generate` output because the second
-- half is seed DATA, which drizzle-kit never emits. The two columns in part
-- (1) ARE declared in src/lib/db/schema.ts, so the Migration Schema Drift gate
-- sees them once applied and db:generate produces no further diff.
--
-- INSERT-ONLY AND NON-DESTRUCTIVE: not one existing row is updated or deleted
-- anywhere in this file. Every seed statement is guarded by NOT EXISTS, so
-- applying it twice is a no-op.
--
-- POST-APPLY VERIFICATION SQL (for the PR description):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'compliance' AND table_name = 'construction_boq_line_items'
--      AND column_name IN ('material_amount', 'manpower_amount');
--   -- expect 2 rows
--
--   SELECT count(*) FROM compliance.erp_fiscal_years
--    WHERE org_id = (SELECT org_id FROM compliance.users WHERE email = 'democeo@projexa-ai.com');
--   -- expect 1
--
--   SELECT count(*) FROM compliance.erp_accounts
--    WHERE org_id = (SELECT org_id FROM compliance.users WHERE email = 'democeo@projexa-ai.com');
--   -- expect 6 (or 6 more than the org already had, if it had any)
--
--   SELECT id, material_amount, manpower_amount FROM compliance.construction_boq_line_items LIMIT 5;
--   -- expect the two columns present and NULL on every pre-existing line

-- ---------------------------------------------------------------------------
-- (1) The material/manpower split of a BOQ line's budget.
--
-- Nullable with NO default, deliberately: a line the QS has not split is a
-- real and common state, and it has to stay distinguishable from a line
-- genuinely split as 0/0. Defaulting to 0 would make every one of the ~hundreds
-- of existing lines read as "costed at zero" in C03-21/C03-22's report columns.
--
-- These are NOT material_cost/labour_cost (Wave 125, drizzle/0247-era): those
-- are per-UNIT rate-analysis inputs that computedRate() multiplies up to
-- justify a rate. These two are whole-line AMOUNTS on the budget side of the
-- row, next to budget_percentage/vendor_amount. See the schema.ts comment on
-- both pairs for why one pair cannot serve both meanings.
ALTER TABLE compliance.construction_boq_line_items ADD COLUMN IF NOT EXISTS material_amount numeric;
ALTER TABLE compliance.construction_boq_line_items ADD COLUMN IF NOT EXISTS manpower_amount numeric;

-- ---------------------------------------------------------------------------
-- (2) The demo organisation's fiscal year and chart of accounts.
--
-- WHY THIS EXISTS AT ALL: PROJEXA's Annual Budget create screen needs a fiscal
-- year AND at least one account before Save can be enabled. Today the demo org
-- (democeo@projexa-ai.com) has neither, so no demo user can complete a single
-- step of create -> object -> edit -> submit, and the chain has never been
-- screenshotted (correction C-15). src/lib/services/org-fiscal-year-provisioning.ts
-- fixes this for every FUTURE org from provisioning time; code cannot fix an
-- org that already exists, which is what this half does.
--
-- The org is resolved through its owner's email rather than hardcoding
-- bc689d97-2dd8-47ab-b5f7-5eb3d696ad34, so this cannot silently seed the wrong
-- tenant if that id is ever wrong -- and if the email resolves to nothing, both
-- statements insert nothing at all rather than failing.
--
-- The six accounts mirror DEFAULT_CHART_OF_ACCOUNTS in that same TypeScript
-- module exactly (1000 Assets / 2000 Liabilities / 3000 Equity group nodes,
-- plus postable 4000 Revenue / 5000 Direct Costs / 6000 Overheads). Direct
-- Costs and Overheads are separate because Budget vs Actual's byHead
-- breakdown is meaningless if every construction cost posts to one row.
--
-- FY2026 (01-01-2026 -> 31-12-2026) is the calendar year, matching
-- currentFiscalYearWindow()'s own rule: erp_fiscal_years carries no
-- start-month setting anywhere in this codebase, so there is no per-org
-- preference to read and none is invented. is_closed false = open.

INSERT INTO compliance.erp_fiscal_years (id, org_id, year_name, start_date, end_date, is_closed)
SELECT gen_random_uuid()::text, u.org_id, 'FY2026', DATE '2026-01-01', DATE '2026-12-31', false
  FROM compliance.users u
 WHERE u.email = 'democeo@projexa-ai.com'
   AND u.org_id IS NOT NULL
   AND NOT EXISTS (
         SELECT 1 FROM compliance.erp_fiscal_years fy
          WHERE fy.org_id = u.org_id AND fy.year_name = 'FY2026'
       );

INSERT INTO compliance.erp_accounts (id, org_id, account_name, account_number, root_type, account_type, is_group)
SELECT gen_random_uuid()::text, u.org_id, seed.account_name, seed.account_number,
       seed.root_type::compliance.erp_account_root_type, seed.account_type, seed.is_group
  FROM compliance.users u
 CROSS JOIN (VALUES
         ('1000', 'Assets',       'asset',     NULL,      true),
         ('2000', 'Liabilities',  'liability', NULL,      true),
         ('3000', 'Equity',       'equity',    NULL,      true),
         ('4000', 'Revenue',      'income',    'income',  false),
         ('5000', 'Direct Costs', 'expense',   'expense', false),
         ('6000', 'Overheads',    'expense',   'expense', false)
       ) AS seed(account_number, account_name, root_type, account_type, is_group)
 WHERE u.email = 'democeo@projexa-ai.com'
   AND u.org_id IS NOT NULL
   AND NOT EXISTS (
         SELECT 1 FROM compliance.erp_accounts a
          WHERE a.org_id = u.org_id AND a.account_number = seed.account_number
       );
