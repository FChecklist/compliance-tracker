-- DOD-T6 (D28). compliance.departments carries both org_id and head_id, but
-- its only uniqueness constraint (departments_head_id_key) is on head_id
-- ALONE -- found via live schema query 2026-09-10, W-GAP W20260910-1302.
-- Effect today: one person can be the head of only ONE department across the
-- ENTIRE system, across every organisation, not just within their own org.
-- Every comparable tenant-scoped uniqueness constraint in this schema
-- (erp_purchase_orders_org_id_po_number_key, erp_sales_orders_org_id_so_
-- number_key, erp_journal_entries_org_id_entry_number_key, and ~30 others)
-- correctly scopes by (org_id, X); this is the one that does not.
--
-- COLLISION CHECK BEFORE WRITING THIS MIGRATION (per PM instruction --
-- report before, not after): live query this session,
--   SELECT head_id, count(*) FROM compliance.departments
--   WHERE head_id IS NOT NULL GROUP BY head_id HAVING count(*) > 1;
-- returned ZERO rows. No person is currently head of more than one
-- department system-wide, so there is no existing-data violation to clean up
-- -- this migration is a pure schema tightening, safe to apply directly.
--
-- NOT APPLIED. Sent to PM for a D48 per-migration ruling before landing.
-- Dry-run proof (apply inside BEGIN, verify, ROLLBACK -- never committed)
-- run this session: the collision check above returns 0 rows before AND
-- after a synthetic test attempt to insert two departments in different orgs
-- with the same head_id, which the NEW constraint correctly allows (org-
-- scoped) while a same-org duplicate correctly raises a unique-violation --
-- see the test states relayed to PM alongside this file.

ALTER TABLE compliance.departments
  DROP CONSTRAINT departments_head_id_key;

ALTER TABLE compliance.departments
  ADD CONSTRAINT departments_org_id_head_id_key UNIQUE (org_id, head_id);
