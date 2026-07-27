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
      `payslips/[id]/pdf/route.ts` fix pattern); (b) test-file cross-contamination between
      `catalog/route.test.ts` and `run/route.test.ts`'s `mock.module()` calls on the same
      `report-engine-service` specifier (both now stub the other file's export too); (c) a test-only
      bug in the CSV-escaping test (was splitting the whole CSV string on `\n`, which broke a
      legitimately-quoted embedded newline); (d) `run/route.test.ts`'s request helper used a plain
      `Request` instead of `NextRequest`, so `request.nextUrl` was undefined for `?format=` tests.
- [x] Full verification pass: `npx tsc --noEmit` clean, `bun test` 2072/2072 passing (repo-wide, not
      just new files), `bun run lint` 0 errors, `node scripts/check-guardrail-presence.mjs` (88/88),
      `node scripts/check-terminology-guardrail.mjs --diff-only` clean (fixed one new hardcoded-date
      finding by rewording, no exemption-registry edit needed), Supabase `get_advisors(security)`
      against the `verdian-ai` project shows only pre-existing findings (views/functions/extensions
      unrelated to `api_keys`/`report_definitions`) -- zero new findings from this change.

## Remaining
- [ ] Write PR description with the real `curl` example (using a real `built`-status report id
      confirmed live via Supabase MCP, e.g. `rptdef_safety_incident`) and the honest note that no
      self-service API-key-creation UI exists yet (only the `POST /api/settings/api-keys` endpoint) --
      flagged as a smaller, non-blocking follow-up per the task spec.
- [ ] Commit, push branch, open PR (expected tier2/HOLD_FOR_OWNER_SIGNOFF per task spec, given
      STRICT_TENANT_ISOLATION is the Owner's top concern for this task -- that classification is
      correct/expected, not something to route around).
