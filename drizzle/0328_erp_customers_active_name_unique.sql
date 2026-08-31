-- A4S14_customers_01: /customers listed the same customer twice.
--
-- Root cause: createCustomer() (erp-selling-service.ts) did a raw insert
-- with zero uniqueness check -- nothing in the app or the DB stopped the
-- same org from creating two ACTIVE erp_customers rows with the identical
-- name. Verified live in compliance.erp_customers: Demo Organization
-- (org_id ve45lczmkodbiq1m20fy48r5) held two rows named
-- "Meridian Hospitality Group", both is_active=true, created 5 weeks apart
-- (2026-07-18 16:50:55 and 2026-08-24 18:04:48) -- a real repeat create,
-- not a double-submit race.
--
-- Checked every table that could point at either id (erp_quotations,
-- erp_sales_orders, erp_sales_invoices, erp_sales_credit_notes,
-- erp_sales_returns, erp_payment_entries, erp_contacts, erp_addresses):
-- the older row (pyr1bytwy7gwnp9gx2x2raoo) carries the real history -- 1
-- quotation, 1 sales order, 2 sales invoices. The newer row
-- (hqe4wb5a65vs26b97ybv0bdy) has ZERO references anywhere. Data fix below
-- deactivates that newer row -- the exact same "deactivate the loser, don't
-- delete it, don't rewrite historical documents" semantics
-- mdm-quality-service.ts's own mergeDuplicates() already uses for confirmed
-- customer/supplier duplicates (this is a one-time backend correction, not
-- a user-initiated merge, so it does not go through
-- mdm_duplicate_candidates/mdm_merge_log, which require a real acting user
-- id for merged_by_id).
--
-- Checked ALL orgs, not just this one, before adding the constraint below:
--   select org_id, lower(trim(customer_name)), count(*)
--   from compliance.erp_customers where is_active = true
--   group by 1, 2 having count(*) > 1;
-- returned exactly this one pair. Safe to add without violating existing
-- data once the row below is deactivated.
UPDATE compliance.erp_customers
SET is_active = false
WHERE id = 'hqe4wb5a65vs26b97ybv0bdy' AND is_active = true;

-- Enforcement, so this can't recur (from this UI, a script, or any other
-- caller of createCustomer/erp_customers). Partial index -- only ACTIVE
-- rows must be unique per org, so a name freed up by mergeDuplicates()
-- (which deactivates rather than deletes) stays reusable for a genuinely
-- new customer. IF NOT EXISTS makes this safe to re-run.
CREATE UNIQUE INDEX IF NOT EXISTS erp_customers_org_active_name_unique
  ON compliance.erp_customers (org_id, lower(trim(customer_name)))
  WHERE is_active = true;
