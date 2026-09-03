-- R68 (Institutional Memory Graph) Phase 1: bitemporal ENFORCEMENT on
-- compliance.memory_records / compliance.memory_versions (R65 Part C
-- Phase 1: drizzle/0520_r65_partc_phase1_memory_schema.sql). Per R-IMG-01
-- (binding, do not re-litigate): the bitemporal COLUMNS already exist
-- (effective_from/effective_to/version/superseded_by_id) -- this migration
-- is enforcement + a recall path, not a fourth parallel memory schema.
-- Both tables are still at 0 rows in production as of this migration, so
-- every constraint/backfill choice below is safe against real data by
-- construction (verified live via the Supabase MCP immediately before
-- writing this file, not assumed from the directive).
--
-- Five net-new items, each depending on the one before:
--   1. BEFORE UPDATE append-only guard trigger on memory_records
--   2. Lifecycle transition guard (SUPERSEDED requires superseded_by_id)
--   3. As-of recall (implemented in TypeScript, see below -- no SQL here)
--   4. model_id/prompt_hash columns on memory_versions
--   5. Erasure-as-redaction (implemented in TypeScript, see below -- no
--      SQL here beyond the columns this file already touches)
--
-- ============================================================
-- ITEM 1 -- Append-only guard (BEFORE UPDATE trigger)
-- ============================================================
--
-- Today app_runtime holds real UPDATE on memory_records (Phase 1's own
-- "app_runtime_org_scoped_update" policy + GRANT) with nothing at the DB
-- level stopping a caller from rewriting `content`, `scope_type`, or any
-- other historical field in place -- the whole point of this table's
-- design (append-only: "never rewrite history, close the row and insert a
-- new one") was previously enforced only by service-layer discipline
-- (src/lib/services/memory-service.ts's supersedeMemoryRecord(), which
-- already only ever UPDATEs effective_to/superseded_by_id/lifecycle_state/
-- updated_at on an old row -- see that function's own UPDATE statement).
-- This trigger makes that a real DB-level guarantee instead of a
-- convention a future caller could silently violate.
--
-- Disclosed, deliberate deviation from the literal 4-column list in the
-- originating directive ("effective_to, superseded_by_id, lifecycle_state,
-- updated_at"): `metadata` is ALSO allowed to change. Reason: this
-- codebase's own already-shipped R65 Part C Phase 3 lifecycle functions
-- (promoteMemoryRecord()/archiveMemoryRecord() in memory-service.ts, which
-- predate this migration) legitimately append an audit trail entry to
-- `metadata.lifecycleHistory` on every lifecycle transition -- that is
-- itself a real, already-tested, already-shipped append-only-respecting
-- pattern (it appends to a JSON array inside metadata, never touches
-- content/scope/etc), not a loophole. A strict 4-column trigger would have
-- broken those two already-live functions outright. Metadata is therefore
-- added to the allow-list; every other column (content, scope_type,
-- scope_id, org_id, user_id, memory_type, content_hash, provenance_type,
-- confidence, source_type/source_id, registry_ref, version, effective_from,
-- created_at, id) remains blocked exactly as the directive specifies. See
-- this PR's description for the same disclosure.
--
-- Implementation note: compares `to_jsonb(OLD)` against `to_jsonb(NEW)`
-- with the allow-listed keys stripped from both sides, rather than an
-- explicit IS DISTINCT FROM chain per disallowed column. This is
-- deliberately fail-safe against schema drift: a FUTURE column added to
-- memory_records that nobody remembers to add to this trigger is
-- automatically caught (not automatically allowed), the opposite failure
-- mode of an explicit allow-list of DISALLOWED columns.
--
-- Role scoping: only enforced when current_user = 'app_runtime' -- the
-- role every ordinary application write path uses (src/lib/db/tenant-
-- scoped.ts's TenantDb/withTenantContext). `service_role` and the
-- `postgres` table-owner role (src/lib/db/index.ts's plain `db` export,
-- DATABASE_URL -- see drizzle/0236's own header for the precedent of this
-- exact role owning every table in this schema and RLS/REVOKE not being
-- able to strip that) are exempt. This is not a hole opened for
-- convenience: it is the one, deliberately narrow, already-precedented
-- channel item 5's redaction function (redactMemoryRecordLineage() in
-- memory-service.ts) needs to legally rewrite `content`/`content_hash` on
-- an already-existing row for a genuine right-to-erasure request --
-- exactly the same "two connections, two privilege levels, one narrow
-- documented exception" shape this file's own embedAndMirror() already
-- established for writing memory_records.embedding (a column app_runtime's
-- RLS policies were never designed to gate either). A trigger fires for
-- every role including the table owner (unlike RLS, which a table owner
-- bypasses by default) -- see drizzle/0236's own header on that exact
-- distinction -- so this role check is the only way to carve out that one
-- legitimate exception without disabling the guard for app_runtime too.
--
-- `SET search_path = compliance, pg_temp` (same fixed-search-path
-- convention as drizzle/0010, 0152, 0157, 0284, 0296's own plpgsql
-- functions in this schema): Supabase's post-apply security advisor
-- flagged this function's search_path as mutable the same session this
-- migration was first applied live -- fixed immediately via `ALTER
-- FUNCTION ... SET search_path` before this PR was opened, and folded
-- back into this file's own CREATE so a fresh apply of this migration
-- never reopens the gap. This function has no schema-unqualified table
-- reference in its body (only `to_jsonb(OLD/NEW)` and array operations),
-- so the mutable search_path had no real exploitable effect here -- fixed
-- as defense-in-depth/lint hygiene, not because a live vulnerability was
-- found.
CREATE OR REPLACE FUNCTION compliance.fn_memory_records_append_only_guard()
RETURNS trigger AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_allowed text[] := ARRAY['effective_to', 'superseded_by_id', 'lifecycle_state', 'updated_at', 'metadata'];
  v_key text;
BEGIN
  IF current_user <> 'app_runtime' THEN
    RETURN NEW;
  END IF;

  v_old := to_jsonb(OLD);
  v_new := to_jsonb(NEW);

  FOREACH v_key IN ARRAY v_allowed LOOP
    v_old := v_old - v_key;
    v_new := v_new - v_key;
  END LOOP;

  IF v_old IS DISTINCT FROM v_new THEN
    RAISE EXCEPTION 'compliance.memory_records is append-only for app_runtime: an UPDATE may only change effective_to, superseded_by_id, lifecycle_state, updated_at, or metadata. Close this row and INSERT a new one instead (see supersedeMemoryRecord() in src/lib/services/memory-service.ts).'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = compliance, pg_temp;
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_memory_records_append_only ON compliance.memory_records;
--> statement-breakpoint
CREATE TRIGGER trg_memory_records_append_only
  BEFORE UPDATE ON compliance.memory_records
  FOR EACH ROW EXECUTE FUNCTION compliance.fn_memory_records_append_only_guard();
--> statement-breakpoint

-- ============================================================
-- ITEM 2 -- Lifecycle transition guard (SUPERSEDED requires a pointer)
-- ============================================================
--
-- A stateless invariant (not a state-to-state transition rule -- it does
-- not care what the PREVIOUS lifecycle_state was, only that the CURRENT
-- row is never left in an inconsistent SUPERSEDED-but-orphaned state), so
-- a CHECK constraint fits this table's own existing shape better than a
-- trigger -- Phase 1's migration already expresses every other lifecycle
-- rule this way (memory_records_lifecycle_state_check, memory_records_
-- org_id_scope_consistency_check), and unlike the item 1 guard above, this
-- rule has no legitimate role-scoped exception to carve out: it must hold
-- for every writer, service_role/postgres included, matching Phase 1's own
-- CHECK constraints, which are not exempted by role either.
--
-- Safe to add directly (no NOT VALID/VALIDATE two-step): 0 rows exist in
-- production today (verified live immediately before this migration).
ALTER TABLE "compliance"."memory_records"
  ADD CONSTRAINT "memory_records_superseded_requires_pointer_check"
  CHECK ("lifecycle_state" <> 'SUPERSEDED' OR "superseded_by_id" IS NOT NULL);
--> statement-breakpoint

-- ============================================================
-- ITEM 4 -- model_id / prompt_hash on memory_versions
-- ============================================================
--
-- Nullable, additive -- matches this table's own already-established
-- per-version attribution shape (changed_by_type/changed_by_id/
-- change_reason/content_hash, R65 Part C Phase 1). Not backfilled (no
-- historical rows exist to backfill -- 0 rows today, verified live) and
-- not yet written by any INSERT -- src/lib/services/memory-service.ts's
-- supersedeMemoryRecord() is extended in the same PR as this migration to
-- accept and persist them going forward when a caller supplies them
-- (both remain optional there too, since not every content revision is
-- AI/LLM-driven -- a USER or SYSTEM-originated change legitimately has no
-- model_id/prompt_hash to record).
--
-- ITEM 3 (as-of recall) and ITEM 5 (erasure-as-redaction) are NOT SQL --
-- both are implemented as real TypeScript functions in
-- src/lib/services/memory-service.ts (getMemoryRecordAsOf() /
-- redactMemoryRecordLineage()), matching this file's own already-
-- established convention for memory_records reads/writes (raw
-- sql``/tx.execute(), never a stored SQL function -- see searchMemories()/
-- supersedeMemoryRecord() in that file, and this migration's own header
-- for why a SQL function was NOT chosen for item 3 despite being offered
-- as an option). See that file for both functions' full documentation,
-- including the item-5 disclosure that no callable "CRR-201" erasure
-- cascade function was found anywhere in this codebase to extend (searched
-- for "CRR-201", "erasure cascade", "P10-DPDP" -- the real, nearest
-- precedent is compliance.source_object's CRR-226 tombstone-not-delete
-- design, docs/CRR_SCHEMA.md, which redactMemoryRecordLineage() follows).
ALTER TABLE "compliance"."memory_versions"
  ADD COLUMN "model_id" text,
  ADD COLUMN "prompt_hash" text;
