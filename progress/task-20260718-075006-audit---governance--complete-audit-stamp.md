# PROGRESS -- task-20260718-075006-audit---governance--complete-audit-stamp

VERIDIAN Review Framework gap-closure: Audit & Governance / Complete Audit
Stamp (Medium finding). Gap: no dedicated `session_id` column and no
office/location field on `audit_logs`; "machine" is approximated only by
`userAgent`.

Note on this invocation (14/20): this workspace's git history had
completely diverged from `origin/main` (no common ancestor -- `git
merge-base` returned nothing; local HEAD was still anchored around
~2026-07-20, origin/main was at ~2026-08-15 with 1200+ more commits).
13 prior invocations left no real commits on this task's branch. Recreated
the work on a fresh branch off current `origin/main`
(`worker/task-20260718-075006-audit-governance-audit-stamp-v2`) rather than
building further on the stale/diverged history.

## Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml` -- no existing active claim
      overlaps `src/lib/audit.ts`/`auditLogs`; registering this task's own
      claim as part of this commit.
- [x] Read the real current implementation first (not just the finding
      text): `src/lib/audit.ts` (`logActivity()`), `src/lib/db/schema.ts`'s
      `auditLogs` table, `src/lib/services/session-limit-service.ts`
      (existing `userActiveSessions` session tracking -- only active for
      orgs with `sessionLimitEnforcementEnabled` on, so not a drop-in
      universal session source), and `src/lib/db/schema.ts`'s `branches`
      table (this codebase's existing multi-office/branch concept -- no
      separate "offices" table needed). Confirmed the gap is real and
      still accurate: no `session_id` column, no office field, IP is real
      (`extractIp` reads `x-forwarded-for`/`x-real-ip`) but "machine" is
      genuinely only `userAgent`.
- [x] Added `sessionId`/`officeId` nullable columns to `auditLogs`
      (`src/lib/db/schema.ts`) + hand-authored migration
      `drizzle/0313_audit_logs_session_office_stamp.sql` (this repo's
      established pattern: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`,
      following `drizzle/0312_...`'s precedent) + journal entry.
- [x] `src/lib/audit.ts`: added optional `sessionId`/`officeId` params to
      `LogActivityParams`, plus a new `deriveSessionId(request)` helper
      that auto-populates `sessionId` from the request's `Cookie` header
      (SHA-256 hash via the existing `hashSessionToken` from
      `session-limit-service.ts`, reused not duplicated) when a call site
      doesn't explicitly pass one -- so none of the 150+ existing
      `logActivity()` call sites need to change, matching this file's own
      stated design goal ("lives in one place... not re-implemented at
      13+ call sites"). Deliberately does NOT call
      `@supabase/ssr`'s `createServerClient()`/`getSession()` -- that
      needs `next/headers`' request-scoped `cookies()`, which throws
      outside a real Next.js request, and `logActivity()` is also called
      from `src/lib/monitors/*` (cron/background checks) where `request`
      is frequently absent. Reading an optional `Request`'s headers
      synchronously never throws; absent request/cookie correctly yields
      `sessionId = null` (a monitor-triggered row has no session).
      `officeId` is a plain optional pass-through (like `clientId`) --
      not auto-derived, since branches/office adoption is still nascent
      in this codebase (no `/api/branches` route exists at all yet, only
      `clients.branchId`) and auto-deriving would mean an extra DB lookup
      on every audit write for a field that would be null for most orgs.
- [x] `src/app/api/audit/route.ts`: added `sessionId`/`officeId` to the
      audit-log API response mapping.
- [x] `src/app/(app)/audit/page.tsx`: added a "Session / Office" column
      (xl breakpoint) so the new stamp fields are actually visible, not
      just stored.
- [x] New test `src/lib/audit.test.ts` (5 tests) covering
      `deriveSessionId`: null with no request, null with no Cookie
      header, real SHA-256 digest never containing the raw cookie,
      deterministic for the same cookie, distinct for different cookies.
      All pass (`bun test src/lib/audit.test.ts`).
- [x] Verified: `bun test` (audit.test.ts + audit-event-triggers.test.ts +
      session-limit-service.test.ts, 23/23 pass), `eslint` on all changed
      files (clean), `tsc --noEmit` full project with raised heap (clean,
      0 errors).
- [x] Did NOT touch `src/lib/services/permission-service.ts`'s
      `ERP_ACTION_ROLES` table, per this task's own instructions.

## Remaining
- [ ] Open PR from `worker/task-20260718-075006-audit-governance-audit-stamp-v2`
      against `main`, let CI run, merge once green (per AGENTS.md Rule 6).
- [ ] Move this task's `ai-os/boss/ACTIVE-CLAIMS.yaml` entry from `active:`
      to `recently_completed:` once merged.
