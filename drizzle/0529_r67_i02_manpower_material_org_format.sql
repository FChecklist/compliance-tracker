-- R67 lane I, item I-02 -- every schema change the Manpower and Material
-- items need, in one migration.
--
-- Numbered 0529, the next free number after 0528 (this lane's own I-01 file)
-- and 0527_r65_parte_billing_contracts.sql on origin/main. Never renumbered
-- once applied; scripts/check-migration-collision.mjs --base origin/main
-- re-checks the number immediately before merge.
--
-- Hand-written rather than `bun run db:generate` output because this file
-- also carries indexes, RLS policies and two guarded data statements, none of
-- which drizzle-kit emits. Every table/column it declares IS also declared in
-- src/lib/db/schema.ts, so the Migration Schema Drift gate sees them once this
-- is applied, and `bun run db:generate` produces no further diff afterwards.
--
-- ============================================================================
-- PRE-FLIGHT -- RUN THESE THREE SELECTS BEFORE APPLYING. Sections (1) and (2)
-- create UNIQUE indexes over existing data. If either returns rows, the index
-- creation would fail; section (1) removes its own collisions (recoverably --
-- see below), section (2) deliberately does not.
--
--   -- (a) duplicate attendance rows that section 1 will archive + delete:
--   SELECT org_id, roster_id, attendance_date, count(*)
--     FROM compliance.construction_attendance
--    GROUP BY 1,2,3 HAVING count(*) > 1;
--
--   -- (b) duplicate employee codes that would BLOCK section 2:
--   SELECT org_id, employee_code, count(*)
--     FROM compliance.construction_labour_roster
--    WHERE employee_code IS NOT NULL AND btrim(employee_code) <> ''
--    GROUP BY 1,2 HAVING count(*) > 1;
--
--   -- (c) material units that differ only by case, which section 6 collapses:
--   SELECT org_id, project_id, lower(unit), count(DISTINCT unit)
--     FROM compliance.construction_materials
--    GROUP BY 1,2,3 HAVING count(DISTINCT unit) > 1;
--
-- If (b) returns rows, STOP and resolve them by hand first -- an employee code
-- is customer-typed data and this migration must not guess which duplicate is
-- the real one.
--
-- POST-APPLY VERIFICATION SQL (for the PR description):
--   SELECT indexname FROM pg_indexes WHERE schemaname = 'compliance'
--     AND indexname IN ('construction_attendance_org_roster_date_unique',
--                       'construction_labour_roster_org_employee_code_unique',
--                       'construction_material_issues_project_date_idx',
--                       'construction_material_issues_material_idx',
--                       'construction_material_issues_boq_line_idx');
--   -- expect 5 rows
--   SELECT count(*) FROM compliance.construction_material_issues;   -- expect 0 on first apply
--   SELECT DISTINCT unit FROM compliance.construction_materials ORDER BY 1;
--   -- expect no two entries differing only by case
--   SELECT count(*) FROM compliance.organisations WHERE date_format IS NOT NULL;
-- ============================================================================

-- ---------------------------------------------------------------------------
-- (1) Attendance: one row per worker per day, enforced by the database.
--
-- WHY: C03-01's recordAttendanceBatch has to be able to UPSERT (a supervisor
-- correcting this morning's entry must overwrite it, not add a second one).
-- Today construction-labour-service.ts#recordAttendance does a plain INSERT
-- with no guard, so a double submit silently double-counts BOTH the worker-day
-- and the daily_cost in every attendance/manpower/certified-payroll report.
--
-- The archive-then-delete below is the ONLY destructive statement in this
-- lane. It is bounded (it touches nothing that is not a genuine duplicate),
-- recoverable (every removed row is copied first, in full, into
-- compliance.r67_attendance_duplicate_backup), and reversible by the exact
-- statement given at the end of this section. It keeps the row with the
-- LATEST created_at per (org_id, roster_id, attendance_date) -- the most
-- recent correction is the one a supervisor meant to stand -- with the row id
-- as a deterministic tiebreaker so the result does not depend on physical row
-- order.
-- Columns spelled out rather than `LIKE construction_attendance`: a reviewer
-- can read exactly what is preserved, and the reverse INSERT below names the
-- same list. `status` is deliberately plain text here, not the
-- construction_attendance_status enum -- an archive must survive a future
-- change to that enum's values, not be constrained by it.
CREATE TABLE IF NOT EXISTS compliance.r67_attendance_duplicate_backup (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  project_id text NOT NULL,
  roster_id text NOT NULL,
  attendance_date date NOT NULL,
  status text NOT NULL,
  hours_worked numeric,
  daily_cost numeric NOT NULL,
  created_at timestamp NOT NULL,
  archived_at timestamp NOT NULL DEFAULT now()
);
ALTER TABLE compliance.r67_attendance_duplicate_backup ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY app_runtime_tenant_isolation ON compliance.r67_attendance_duplicate_backup FOR ALL TO app_runtime USING (org_id = compliance.current_org_id()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY service_role_bypass_r67_attendance_duplicate_backup ON compliance.r67_attendance_duplicate_backup FOR ALL TO service_role USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY org_id, roster_id, attendance_date
           ORDER BY created_at DESC, id DESC
         ) AS rn
    FROM compliance.construction_attendance
)
INSERT INTO compliance.r67_attendance_duplicate_backup (
  id, org_id, project_id, roster_id, attendance_date, status, hours_worked, daily_cost, created_at
)
SELECT a.id, a.org_id, a.project_id, a.roster_id, a.attendance_date, a.status::text, a.hours_worked, a.daily_cost, a.created_at
  FROM compliance.construction_attendance a
  JOIN ranked r ON r.id = a.id
 WHERE r.rn > 1
    ON CONFLICT (id) DO NOTHING;

DELETE FROM compliance.construction_attendance a
 USING (
   SELECT id,
          row_number() OVER (
            PARTITION BY org_id, roster_id, attendance_date
            ORDER BY created_at DESC, id DESC
          ) AS rn
     FROM compliance.construction_attendance
 ) r
 WHERE r.id = a.id AND r.rn > 1;

-- REVERSE STATEMENT (undo of the delete above -- run only if the dedup must be
-- rolled back; drop the unique index first or it will refuse the collisions):
--   DROP INDEX IF EXISTS compliance.construction_attendance_org_roster_date_unique;
--   INSERT INTO compliance.construction_attendance
--     (id, org_id, project_id, roster_id, attendance_date, status, hours_worked, daily_cost, created_at)
--   SELECT id, org_id, project_id, roster_id, attendance_date,
--          status::compliance.construction_attendance_status, hours_worked, daily_cost, created_at
--     FROM compliance.r67_attendance_duplicate_backup
--    ON CONFLICT (id) DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS construction_attendance_org_roster_date_unique
  ON compliance.construction_attendance (org_id, roster_id, attendance_date);

-- ---------------------------------------------------------------------------
-- (2) Roster: auto-numbered worker codes ('W-0001'), unique per org.
--
-- The counter table is per-org because the numbering is per-org; a Postgres
-- SEQUENCE is a single global object and one-per-org would mean runtime DDL,
-- which the app_runtime role must never do. See the table's own comment in
-- src/lib/db/schema.ts for why max(employee_code)+1 was rejected (it races).
--
-- The index is PARTIAL -- employee_code stays nullable (it was and remains
-- optional, customer-typed data on a pre-existing roster row) and blank
-- strings are excluded too, so "several workers with no code yet" is still a
-- legal state. Only two rows that both carry the SAME real code collide.
-- Unlike section (1) this creates no backup and deletes nothing: a duplicate
-- employee code is customer data and this migration must not guess which one
-- is right (see pre-flight query (b) above).
CREATE TABLE IF NOT EXISTS compliance.construction_employee_code_counters (
  org_id text PRIMARY KEY,
  last_number integer NOT NULL DEFAULT 0,
  updated_at timestamp NOT NULL DEFAULT now()
);
ALTER TABLE compliance.construction_employee_code_counters ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_employee_code_counters FOR ALL TO app_runtime USING (org_id = compliance.current_org_id()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY service_role_bypass_construction_employee_code_counters ON compliance.construction_employee_code_counters FOR ALL TO service_role USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Seed each org's counter from the highest 'W-nnnn' code it already uses, so
-- the first auto-generated number never collides with a hand-typed one.
-- Idempotent: ON CONFLICT keeps whichever value is higher.
INSERT INTO compliance.construction_employee_code_counters (org_id, last_number)
SELECT org_id,
       coalesce(max((substring(employee_code from '^W-([0-9]+)$'))::int), 0)
  FROM compliance.construction_labour_roster
 WHERE employee_code ~ '^W-[0-9]+$'
 GROUP BY org_id
    ON CONFLICT (org_id) DO UPDATE
   SET last_number = greatest(compliance.construction_employee_code_counters.last_number, EXCLUDED.last_number),
       updated_at = now();

CREATE UNIQUE INDEX IF NOT EXISTS construction_labour_roster_org_employee_code_unique
  ON compliance.construction_labour_roster (org_id, employee_code)
  WHERE employee_code IS NOT NULL AND btrim(employee_code) <> '';

-- DECISION, made before generating and kept (the item left it open): NO org
-- trades table. `trade` is already documented in schema.ts as free text,
-- "advisory, not enum-enforced, same posture as documents.category", and the
-- trade pickers need the trades an org ACTUALLY uses -- which is exactly
-- `SELECT DISTINCT trade FROM construction_labour_roster WHERE org_id = $1`.
-- A second, separately-maintained authoritative list would immediately drift
-- from the roster it is supposed to describe, and would have to be seeded from
-- that same DISTINCT query anyway. No table is created here for it.

-- ---------------------------------------------------------------------------
-- (3) Material issues (outbound) + a reorder level on the master.
CREATE TABLE IF NOT EXISTS compliance.construction_material_issues (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  material_id text NOT NULL REFERENCES compliance.construction_materials(id) ON DELETE RESTRICT,
  issued_date date NOT NULL,
  quantity numeric NOT NULL,
  boq_line_item_id text,
  issued_to text,
  note text,
  created_by_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS construction_material_issues_material_idx ON compliance.construction_material_issues (material_id);
CREATE INDEX IF NOT EXISTS construction_material_issues_project_date_idx ON compliance.construction_material_issues (org_id, project_id, issued_date);
CREATE INDEX IF NOT EXISTS construction_material_issues_boq_line_idx ON compliance.construction_material_issues (boq_line_item_id);

-- RLS, copying construction_material_receipts (drizzle/0317) VERBATIM in shape.
ALTER TABLE compliance.construction_material_issues ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_material_issues FOR ALL TO app_runtime USING (org_id = compliance.current_org_id()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY service_role_bypass_construction_material_issues ON compliance.construction_material_issues FOR ALL TO service_role USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE compliance.construction_materials ADD COLUMN IF NOT EXISTS reorder_level numeric;

-- ---------------------------------------------------------------------------
-- (4) Void, never delete, a material receipt (C03-09). See schema.ts's own
-- comment on these three columns for why a goods-receipt note is voided rather
-- than removed. Every consumer that totals stock or cost filters
-- `voided_at IS NULL`; the row itself survives for its audit trail.
ALTER TABLE compliance.construction_material_receipts ADD COLUMN IF NOT EXISTS voided_at timestamp;
ALTER TABLE compliance.construction_material_receipts ADD COLUMN IF NOT EXISTS void_reason text;
ALTER TABLE compliance.construction_material_receipts ADD COLUMN IF NOT EXISTS voided_by_id text;
CREATE INDEX IF NOT EXISTS construction_material_receipts_live_idx
  ON compliance.construction_material_receipts (org_id, project_id, received_date)
  WHERE voided_at IS NULL;

-- ---------------------------------------------------------------------------
-- (5) Per-org date/number formatting (C03-12).
ALTER TABLE compliance.organisations ADD COLUMN IF NOT EXISTS date_format text;
ALTER TABLE compliance.organisations ADD COLUMN IF NOT EXISTS number_locale text;

-- Backfill ONLY orgs whose base currency is AED or INR -- the two markets this
-- product actually serves, where dd-MM-yyyy is the real convention and matches
-- the customer's own sheets. Every other org stays NULL and keeps whatever its
-- callers already do, rather than being assigned a format nobody asked for.
-- `WHERE date_format IS NULL` makes it idempotent and makes it impossible for
-- a re-run to overwrite a value an admin has since chosen by hand.
UPDATE compliance.organisations o
   SET date_format = 'dd-MM-yyyy',
       number_locale = CASE WHEN c.code = 'INR' THEN 'en-IN' ELSE 'en-AE' END,
       updated_at = now()
  FROM compliance.erp_currencies c
 WHERE c.org_id = o.id
   AND c.is_base_currency = true
   AND c.code IN ('AED', 'INR')
   AND o.date_format IS NULL;

-- ---------------------------------------------------------------------------
-- (6) One-off data normalisation: material units, case-insensitively
-- ('Bag' -> 'bag'). Two rows that mean the same unit but differ only in case
-- are two different units to every GROUP BY in the material reports.
--
-- Scoped deliberately: only a unit whose lowercase form is ALREADY used by
-- another material in the SAME (org, project) is changed. A material whose
-- unit is the only spelling in its project is left exactly as the customer
-- typed it -- lowercasing every unit in the table would rewrite correct data
-- ('Nos', 'Cum', 'SqM') for no benefit. Affected rows are captured in full
-- first; the reverse statement is below.
CREATE TABLE IF NOT EXISTS compliance.r67_material_unit_normalisation_backup (
  material_id text PRIMARY KEY,
  org_id text NOT NULL,
  previous_unit text NOT NULL,
  new_unit text NOT NULL,
  archived_at timestamp NOT NULL DEFAULT now()
);
ALTER TABLE compliance.r67_material_unit_normalisation_backup ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY app_runtime_tenant_isolation ON compliance.r67_material_unit_normalisation_backup FOR ALL TO app_runtime USING (org_id = compliance.current_org_id()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY service_role_bypass_r67_material_unit_normalisation_backup ON compliance.r67_material_unit_normalisation_backup FOR ALL TO service_role USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO compliance.r67_material_unit_normalisation_backup (material_id, org_id, previous_unit, new_unit)
SELECT m.id, m.org_id, m.unit, lower(m.unit)
  FROM compliance.construction_materials m
 WHERE m.unit <> lower(m.unit)
   AND EXISTS (
         SELECT 1 FROM compliance.construction_materials m2
          WHERE m2.org_id = m.org_id
            AND m2.project_id = m.project_id
            AND m2.id <> m.id
            AND lower(m2.unit) = lower(m.unit)
            AND m2.unit <> m.unit
       )
    ON CONFLICT (material_id) DO NOTHING;

UPDATE compliance.construction_materials m
   SET unit = b.new_unit
  FROM compliance.r67_material_unit_normalisation_backup b
 WHERE b.material_id = m.id
   AND m.unit <> b.new_unit;

-- REVERSE STATEMENT (undo of section 6):
--   UPDATE compliance.construction_materials m
--      SET unit = b.previous_unit
--     FROM compliance.r67_material_unit_normalisation_backup b
--    WHERE b.material_id = m.id;
