-- PROJEXA-BUILD-001 U-32 part A (Phase 4, one record on four surfaces): the
-- surface an audit row was written from. Schema only; no row is written,
-- changed or deleted by this file.
--
-- WHAT
--   compliance.audit_logs, extended in place:
--     + surface text, NULLABLE, no default
--         CHECK audit_logs_surface_check: NULL, or one of the four surface
--         keys of ai-os/projexa-build-001/FOUR_SURFACE_CONTRACT.md section 2
--           s1_one_page_ai_prepared   the one-page approval view, AI-prepared
--           s2_erp_screen_prefilled   the record's own ERP screen, prefilled
--           s3_ai_link_chat           an outside AI through an AI Work Link
--           s4_email_inbox            mail, confirmed by the person
--   The table goes from 18 to 19 columns. Register row BR-415 checks that the
--   column exists; BR-410 (a surface 1 approve writes one audit row with
--   surface s1_one_page_ai_prepared and a non-null user_id) reads it.
--
-- WHY
--   One record can be created or changed from four surfaces, and each audit
--   row must say which surface the write came from (contract rule 4, finding
--   F-A04-2: the convergence check BR-417 had no column to read).
--   logActivity() (src/lib/audit.ts) gains an optional surface that is
--   written here; a call that does not pass it stores NULL, as every row
--   does today.
--
-- NOT IN THIS FILE: no index (the column is read per row, not searched), no
--   backfill (every existing row keeps NULL: the surface of a past write is
--   not known), no change to row-level security, the two policies
--   (app_runtime_tenant_isolation, service_role_bypass_audit_logs) or the
--   grants (the new column inherits the table's), no trigger. No caller passes
--   a surface yet: the surface routes of units U-29 and U-47 do that later.
--
-- SEQUENCING: src/lib/db/schema.ts declares the column, so every Drizzle
--   insert into audit_logs names it (with DEFAULT when no value is given). A
--   build carrying that declaration must not serve traffic before this file
--   is applied.
--
-- HOW IT IS APPLIED: through the Supabase MCP (apply_migration) by the PM,
--   after the always-aborted rollback rehearsal (ai-os/projexa-build-001/
--   ROLLBACK_REHEARSALS.md, its error text must begin PASS_ROLLED_BACK) and
--   after the PGlite proofs pass (bash scripts/verify/rollback-replay.sh and
--   src/lib/services/audit-surface-migration.pglite.test.ts). Idempotent: ADD
--   COLUMN IF NOT EXISTS, and the check is added only when no constraint of
--   that name exists, so a second run changes nothing.
--
-- DATA LOSS: none. One nullable column with no default; every existing row
--   keeps every value it has and reads NULL in the new column, which the
--   check allows. Adding the check reads the table once (about 8,600 rows)
--   under the ACCESS EXCLUSIVE lock the ALTER takes; lock_timeout bounds the
--   wait for that lock.
--
-- ROLLBACK: drizzle/down/0619_build001_audit_surface.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE compliance.audit_logs
  ADD COLUMN IF NOT EXISTS surface text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'compliance.audit_logs'::regclass
                   AND conname = 'audit_logs_surface_check') THEN
    ALTER TABLE compliance.audit_logs
      ADD CONSTRAINT audit_logs_surface_check
      CHECK (surface IS NULL
             OR surface IN ('s1_one_page_ai_prepared',
                            's2_erp_screen_prefilled',
                            's3_ai_link_chat',
                            's4_email_inbox'));
  END IF;
END $$;

COMMIT;
