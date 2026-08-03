# PROGRESS -- task-20260803-103115-pm-decision--authorize-real-fix-of-gap-4

## Completed
- [x] Read ACTIVE-CLAIMS.yaml, MASTER-TRACKER.yaml (GAP-403-VS-500-CLM-HR-PERFORMANCE,
      GAP-EMAIL-INTELLIGENCE-500-VS-403, MIGRATION-DRIFT-0264-EMAIL-INTEL-500-FIX)
- [x] Registered claim in ai-os/boss/ACTIVE-CLAIMS.yaml, no conflicting active claim found
- [x] Root-caused all 5 endpoints, live DB queries + live HTTP repro (not narrated):
      - `/api/clm/templates`, `/api/clm/clauses`: real, persistent, still-reproducing code
        bug -- distinct from migration drift. Service layer (`erp-contract-service.ts`)
        already calls `requireErpEnabled()` correctly, but the two GET route handlers
        (unlike every sibling GET/POST/PATCH/DELETE handler in the same module, e.g.
        `/api/erp/contracts`) had no try/catch, so the intentional 403 `ServiceError`
        threw uncaught -> Next.js turned it into an empty-body 500. Also root-caused the
        gap's secondary "silent JSON-parse exception" finding to the same underlying
        empty 500 body: `erp/clm-library/page.tsx` and `erp/contracts/page.tsx` called
        `.json()` unconditionally without an `res.ok` guard (unlike sibling calls in the
        same files that already do `res.ok ? ... : []`).
      - `/api/hr/attendance` (3 variants), `/api/performance-reviews/reviews`: confirmed via
        direct live-DB query (raw SQL, real schema/table/column existence check) that no
        migration drift exists (`hr_attendance_records.shift_type_id`,
        `performance_reviews.weighted_score` both present live, query executes clean, 0
        rows for the fresh org as expected). Confirmed via a real Playwright live login +
        direct `fetch()` against `https://projexa-ai.com` that these 3 endpoints
        **no longer reproduce the 500 right now** -- all return clean `200`s with correct
        empty/zeroed data. Also confirmed neither HR attendance nor performance-reviews
        has any module-enablement gate in this codebase's design (only
        erp/sales/pms/facilities_management/construction/the_firm have branch-enablement
        services) -- so a 403 was never the intended response shape for these two; the
        original sweep finding was a real but non-persisting artifact (consistent with
        the documented elevated host load around that same sweep window), not a
        reproducible code defect.
- [x] Applied the real fix: added try/catch (matching sibling routes) to
      `src/app/api/clm/templates/route.ts` and `src/app/api/clm/clauses/route.ts` GET
      handlers; added `res.ok` guards to the 2 unconditional `.json()` calls in
      `erp/clm-library/page.tsx` and `erp/contracts/page.tsx`. Lint clean on all 4 files;
      `erp-contract-service.test.ts` (6/6) still passes. No fix applied for HR
      attendance/performance-reviews -- not reproducing, no code defect found.

## Remaining
- [ ] Commit + push, open PR, let CI run, merge
- [ ] Independently retest all 5 endpoints live against the real deployed site once merged
      (confirm CLM now returns 403 with a user-facing explanation, not raw 500)
- [ ] Update MASTER-TRACKER.yaml honestly with the real resolution
- [ ] Move ACTIVE-CLAIMS.yaml entry to recently_completed
