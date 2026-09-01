-- R53 / R48_NO_CURRENCY_UI_01 -- make "exactly one base currency per org" a
-- CONSTRAINT rather than a convention.
--
-- THE FAULT ROW SAYS "compliance.organisations has no currency column at
-- all". That is true (33 columns, country but no currency) AND IT IS NOT THE
-- GAP. compliance.erp_currencies already stores the org's currency, with an
-- is_base_currency flag, and it is already written at provisioning time
-- (org-provisioning-service.ts, PR #1382). Measured 26 Aug 2026: 10 rows
-- across 9 orgs, and EVERY org has exactly one base row.
--
-- SO THIS MIGRATION DOES NOT ADD A COLUMN TO organisations. Adding one would
-- create a SECOND source of truth for a fact that already has a home, and
-- the two would drift the first time anyone wrote only one of them -- which
-- is exactly the class of defect (a currency that is implicit and unset in
-- one place while set in another) that R-62/R-63 exist to stop.
--
-- What was genuinely missing is enforcement. createCurrency() unsets the
-- previous base in application code before setting a new one; nothing stops
-- two rows both claiming is_base_currency, and nothing stops an org having
-- none. The first half is now a database constraint. The second half cannot
-- be a constraint (a partial unique index cannot require a row to exist), so
-- it stays the provisioning path's job and is reported honestly by the new
-- GET endpoint as baseCurrency: null rather than being silently defaulted.
--
-- EXPAND ONLY (AR-11): one index, no column dropped, narrowed, renamed or
-- re-typed. Verified before writing that no org currently violates it, so
-- this cannot fail on existing data:
--   select org_id, count(*) filter (where is_base_currency)
--   from compliance.erp_currencies group by org_id;
--   -> every row returned exactly 1.

CREATE UNIQUE INDEX IF NOT EXISTS "erp_currencies_one_base_per_org"
  ON "compliance"."erp_currencies" ("org_id")
  WHERE "is_base_currency";
