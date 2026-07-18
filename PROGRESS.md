# PROGRESS -- task-20260718-084006-checks---balances--audit-trail---immutab

VERIDIAN Review Framework gap-closure: Checks & Balances / Audit Trail &
Immutable Logging. 4 findings received, 2 distinct issues (each a duplicate
pair): "Complete Audit Trail" (Medium) and "Immutable Activity Logs" (High).

## Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml` and registered a claim for this
      task before starting real work (no conflicting active claim found).
- [x] Read the actual current implementation before assuming the gap
      description was still accurate: `src/lib/audit.ts` (`logActivity()`),
      `schema.ts`'s `auditLogs` table, and every `drizzle/*.sql` file that
      touches `audit_logs`.
- [x] Found "Immutable Activity Logs" was **already partially fixed**:
      `drizzle/0005_wave7_hierarchy_and_audit_foundation.sql` already ran
      `REVOKE UPDATE, DELETE ON compliance.audit_logs FROM app_runtime`
      (2026-07-02) -- the gap description's premise ("no database-level
      immutability guarantee exists") is stale for `app_runtime`.
- [x] Found the gap was nonetheless **genuinely still open** for a
      different reason: `drizzle/0008_wave10_grant_service_role_
      compliance_schema.sql` (2026-07-03, fixing an unrelated MCP-auth bug)
      did a blanket `GRANT ... UPDATE, DELETE ON ALL TABLES IN SCHEMA
      compliance TO service_role`, which silently re-opened the exact hole
      0005 had closed, for the `service_role` credential (used by
      `/api/mcp`, `esignature-service.ts`, and ~10 other call sites).
      `service_role` also has `rolbypassrls=true`, so RLS gives no backstop
      either.
- [x] Wrote `drizzle/0225_audit_trail_immutability_and_backstop_
      triggers.sql`:
      - Part A: `REVOKE UPDATE, DELETE ON compliance.audit_logs FROM
        service_role` -- closes the reopened gap. Documents the one
        remaining, *not* closable-by-this-migration limitation: the
        `postgres` role (`DATABASE_URL`, used by `src/lib/db/index.ts`'s
        plain `db` export) owns the `compliance` schema/tables (per
        `orchestra_changes.md` entry #17), and REVOKE cannot strip an
        owner's implicit privileges -- only retiring `DATABASE_URL`'s use
        of `postgres` (already flagged as open debt at the end of
        `orchestra_changes.md` entry #57, pre-existing and out of scope
        here) fully closes this. No code path currently updates/deletes
        `audit_logs` rows (re-confirmed via grep), so both REVOKEs are
        safe no-ops today, purely closing off future possibility.
      - Part B: generic `AFTER INSERT/UPDATE/DELETE` backstop trigger
        (`compliance.fn_audit_trail_backstop()`) on the 4 tables matching
        the finding's own recommended scope ("financial, compliance,
        user/role"): `users`, `compliance_items`, `erp_journal_entries`,
        `erp_payment_entries`. Writes a `db_trigger.<op>`-prefixed row into
        the same `audit_logs` table (not a separate table), resolves actor
        identity from the `app.current_user_id`/`app.current_org_id` GUCs
        `withTenantContext` sets, with safe fallbacks for writes that go
        through the plain `db` export instead. Entire body wrapped in
        `EXCEPTION WHEN OTHERS` so a backstop failure can never break the
        primary write it's shadowing. Deliberately NOT applied schema-wide
        (would be mostly noise on high-churn/derived tables) -- additive
        list, same convention as `ERP_ACTION_ROLES`.
- [x] Updated `schema.ts`'s `auditLogs` comment to point at the new
      migration and summarize both fixes + the honest limitation.
- [x] Updated `ai-os/boss/ACTIVE-CLAIMS.yaml` with the full claim writeup.

## Remaining
- [ ] **Live migration step**: this session has no `DATABASE_URL`/Supabase
      MCP access -- `drizzle/0225_audit_trail_immutability_and_backstop_
      triggers.sql` has been authored and reviewed against the schema but
      **not yet applied to the live database**. A supervising session with
      DB access needs to run it (same convention as every other
      hand-authored migration in this repo since 0005) and verify:
      - `information_schema.role_table_grants` shows `service_role` with no
        UPDATE/DELETE on `compliance.audit_logs`.
      - A real insert/update/delete against each of the 4 backstop tables
        produces a corresponding `db_trigger.*` row in `audit_logs`.
      - `get_advisors` / a quick smoke test shows no regression on normal
        write paths (the `EXCEPTION WHEN OTHERS` guard should make this a
        non-issue, but worth confirming live once).
- [ ] PR review + audit by a supervising session (not self-merged, per
      AGENTS.md Rule 7(c)/Rule 10) -- this session did not open a PR itself
      as part of this work; confirm whether the orchestration harness opens
      one automatically or whether that's a follow-up step.
- [ ] No `bun`/`node_modules` available in this sandbox -- `tsc --noEmit`,
      `eslint`, and `bun test` could not be run locally. The only
      application-code change is a comment in `schema.ts` (no logic
      change), and the new file is a pure `.sql` migration, so risk is low,
      but a supervising session with a working toolchain should still run
      the normal `tsc`/`eslint`/`bun test` gate before merge.
