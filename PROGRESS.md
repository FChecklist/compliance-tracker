# PROGRESS -- task-20260727-122632-projexa-e2e--hierarchical-boq-breakdown
# PROGRESS -- task-20260727-101145-reporting-api-gateway--external-ai-scope
## Completed
- [x] Read governance docs (CLAUDE.md/AGENTS.md/CONSTITUTION.yaml/ACTIVE-CLAIMS.yaml), claim
      already registered (`ai-os/boss/ACTIVE-CLAIMS.yaml` line ~43) from invocation 1.
- [x] Built `src/app/api/v1/reports/catalog/route.ts` (GET) -- lists the caller's visible
      report_definitions catalog. Auth via `requireAuthOrApiKey()` + new
      `requireReportsReadAccess()` gate (accepts `read` OR the new `read:reports` scope).
      Zero new execution logic: wraps the existing `getFullReportCatalog({ orgId })`.
- [x] Built `src/app/api/v1/reports/definitions/[id]/run/route.ts` (POST) -- executes a
      report_definitions row via the existing `executeReportDefinition()`. STRICT_TENANT_ISOLATION:
      `orgId` is always `ctx.orgId` from the authenticated caller, never from the request body/query
      (verified by an automated spoofing test, see below). Supports `?format=json|csv|xlsx`.
- [x] `src/lib/report-export-shared.ts` -- server-safe (no browser APIs) `rowsToCSV`/
      `rowsToXLSXBuffer` builders, same `xlsx` package + ExportRow[] convention as
      `report-export.ts`/`reports/page.tsx`, just without the client-side download trigger so an
      API route can return the bytes directly.
- [x] `requireReportsReadAccess()` added to `src/lib/supabase/auth-guard.ts` -- OR-semantics gate
      (broad `read` OR narrow `read:reports`), session always passes.
- [x] `compliance.api_keys.scopes` extended (comma-separated) to accept `read:reports` in
      `POST /api/settings/api-keys` -- no schema/table change needed, the existing free-text
      scopes column already expresses it (`src/lib/db/schema.ts` comment updated to document it).
- [x] `src/lib/openapi/generate.ts` -- documented `/reports/catalog` and
      `/reports/definitions/{id}/run` in the public OpenAPI doc.
- [x] Tests: `catalog/route.test.ts` (3), `definitions/[id]/run/route.test.ts` (6, incl. the
      required tenant-isolation spoofing test + cross-org test), `report-export-shared.test.ts` (5),
      `auth-guard.test.ts` (6 for `requireReportsReadAccess`). All pure-mock, no live DB, matching
      repo convention.
- [x] Fixed bugs found while verifying inherited invocation-1 work: (a) `NextResponse` body-type
      TS error on the raw XLSX `Buffer` (wrapped in `Blob`+`Uint8Array.from`, matching the existing
... more files changed

# PROGRESS -- task-20260727-153107-re-audit-projexa-erp-e2e-for-100pct-comp

## Completed
- [x] Read ai-os/boss/ACTIVE-CLAIMS.yaml, registered this session's claim, committed+pushed
- [x] Located both repos: /opt/veridian/repos/projexa, this workspace (compliance-tracker)
- [x] Confirmed projexa main HEAD includes PR #52, #54, #56 merges + fix-forward commits
       (b5014d9 PR54 per-user/mutex fix, 114d0ee last-owner/admin demotion guard)
- [x] Verified projexa PR #52 (AppShellFrame/homeThreadSlot header fix) -- COMPLETE
- [x] Verified projexa PR #54 (PWA/SW/IndexedDB sync queue) incl. per-user scoping +
      concurrent-sync mutex re-checks -- both PASS, COMPLETE
- [x] Verified projexa PR #56 (role gating) incl. full-codebase PATCH/DELETE endpoint
      sweep -- all in-scope PASS, COMPLETE; 1 pre-existing out-of-scope gap noted
      (access-review/certifications/[id] PATCH has no requireRole() gate)
- [x] Verified compliance-tracker PR #596 (BoQ/valuation) incl. nonzero-tax and
      retention-not-taxable-reducing re-checks -- both PASS, COMPLETE
- [x] Verified compliance-tracker PR #597 (timesheet budget-vs-actual) -- COMPLETE
- [x] Ran npx tsc --noEmit in both repos -- clean in both
- [x] Ran bun test scoped to touched files in both repos -- projexa: 10+10+9 pass/0 fail
      across 3 suites; compliance-tracker: 40 pass/0 fail across 5 suites (independently
      re-run by this session, matches sub-agent report exactly)
- [x] Collected real supervisor PASS/FAIL verdicts (PR comments) for all 5 PRs, quoted
- [x] Wrote ai-os/audits/projexa_erp_e2e_reaudit_2026-07-27.md -- all 5 PRs COMPLETE

## Remaining
- [ ] Commit report + PROGRESS.md, push, open PR (report-only, no other file changes)
