-- Down-migration for drizzle/0742_construction_material_orders.sql. Convention: docs/ROLLBACK_RUNBOOK.md section 3. Not auto-applied.
-- WHAT IT RESTORES: the schema before 0742. DATA LOSS: every material order row is dropped. Run it only before the table holds orders you need.

BEGIN;

SET LOCAL lock_timeout = '5s';

DROP TABLE IF EXISTS compliance.construction_material_orders;

COMMIT;
