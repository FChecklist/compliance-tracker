-- PRE-APPROVED-LIVE-DDL: Owner instruction in chat on 2026-10-10 ("go ahead and build create_material_order"; "apply 0742 and 0743 after CI passes"), within the approved 111-requirements completion plan (M-ORDER).
-- Down-migration for drizzle/0742_construction_material_orders.sql. Convention: docs/ROLLBACK_RUNBOOK.md section 3. Not auto-applied.
-- WHAT IT RESTORES: the schema before 0742. DATA LOSS: every material order row is dropped. Run it only before the table holds orders you need.

BEGIN;

SET LOCAL lock_timeout = '5s';

DROP TABLE IF EXISTS compliance.construction_material_orders;

COMMIT;
