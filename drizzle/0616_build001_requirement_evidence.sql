-- PROJEXA-BUILD-001 U-22 (Phase 3, WO 3.1 / 3.6): two evidence columns on
-- the Sumeet requirement register. Schema only; no row is written, changed or
-- deleted by this file.
--
-- WHAT
--   platform.sumeet_requirements, extended in place:
--     + verify_command text, NULLABLE: one runnable, re-runnable command that
--       checks the requirement, run from the compliance-tracker repo root. One
--       of four forms (register rows BR-308, BR-309, BR-310):
--         bun test --isolate <test file(s)> [-t "<pattern>"]
--         node scripts/verify/sql-assert.mjs --project ct --sql "<one SELECT>" --equals <v>   (or --gte, ...)
--         test "$(git grep -c -F '<text>' -- <file> | awk -F: '{s+=$2} END {print s+0}')" = "<n>"
--         bash scripts/verify/<script>
--     + evidence_ref text, NULLABLE: what a DONE status rests on. One of three
--       forms (register row BR-311): a commit SHA (7 to 40 hex), PR#<n>, or
--       SQL <yyyy-mm-dd>: <value> for a query result recorded on that date.
--   Neither column has a CHECK: the forms are checked by the register rows,
--   which read the columns through to_jsonb(r) so the queries run before and
--   after this file alike.
--
-- WHY
--   The status column is free text and had become the only thing certifying a
--   requirement (F-A02-2, F-A11-3): WO 3.1 and 3.6 query columns that did not
--   exist. drizzle/0617_build001_requirement_evidence_data.sql fills them and
--   adds the 31 exceptions-directive rows EXC-ITEM-01..31 (PMD-17).
--
-- NOT IN THIS FILE: no Drizzle declaration (platform.sumeet_requirements is not
--   declared in src/lib/db/schema.ts; it is read and written with SQL only), no
--   index (80 to 111 rows), no change to RLS, policies or grants (the new
--   columns inherit the table's: RLS on, one service_role policy, table-level
--   grants to app_runtime and service_role).
--
-- HOW IT IS APPLIED: through the Supabase MCP (apply_migration) by the PM, after
--   the always-aborted rollback rehearsal (ai-os/projexa-build-001/
--   ROLLBACK_REHEARSALS.md, its error text must begin PASS_ROLLED_BACK) and after
--   the PGlite proofs pass (bash scripts/verify/rollback-replay.sh and
--   src/lib/services/sumeet-requirements-evidence-migration.pglite.test.ts).
--   Idempotent: ADD COLUMN IF NOT EXISTS, so a second run changes nothing.
--
-- DATA LOSS: none. Two nullable columns with no default; every existing row
--   keeps every value it has.
--
-- ROLLBACK: drizzle/down/0616_build001_requirement_evidence.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE platform.sumeet_requirements
  ADD COLUMN IF NOT EXISTS verify_command text,
  ADD COLUMN IF NOT EXISTS evidence_ref text;

COMMIT;
