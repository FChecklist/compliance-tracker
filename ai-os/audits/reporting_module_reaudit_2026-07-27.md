# Re-audit: reporting_module_end_user scope (2026-07-27)

**Task**: task-20260727-153104-re-audit-reporting-module-end-user-for-1
**Scope re-verified**: task-20260727-093931's claimed 100%-complete
reporting_module_end_user work -- PROJEXA pivot/chart reporting UI (PR #51,
repo `projexa`) and the compliance-tracker external-AI-facing reporting API
gateway + CSV-export security fix (PR #601, repo `compliance-tracker`).
**Method**: read real current `main`-branch code in both repos (compliance-tracker
checked out directly; projexa checked out via a disposable `git worktree` against
`origin/main` so the shared clone's own uncommitted local state was never touched),
ran real test suites and `tsc --noEmit` in both, read the real merged PR diffs and
their real audit-bot PR comments via `gh`. Verification-only -- no fixes applied,
nothing changed outside this one file.

## Executive summary

Both PRs are real, merged, and their own literal, narrowly-scoped claims hold up
under direct inspection -- no fabricated code, no stub components, no fake tests,
both have genuine `AUDIT: PASS` verdicts. **However, the broader question this
task actually asks -- is the reporting_module_end_user scope *genuinely 100%
complete* -- is INCOMPLETE-WITH-GAPS**, for two concrete, independently
confirmed reasons:

1. **A real CSV-formula-injection bypass still exists in the reporting module**,
   just not in the file PR #601 touched. PR #601's own CSV path is fully fixed.
   A separate, pre-existing "Export CSV" button on the main internal Reports
   dashboard builds CSV manually with zero escaping.
2. **The "real, automated cross-org tenant-isolation penetration test" that this
   initiative's own task claim named as top priority does not exist** at the
   database/RLS level anywhere in this codebase, for this route or any other --
   only an application-level, mocked-database unit test exists.
3. (PR #51 only) **The pivot/chart E2E test has never actually been run** --
   this is honestly self-disclosed by the PR's own tech-decision doc, not
   something this audit had to dig for, but it means SCOPE item (1)'s specific
   ask ("confirm it actually exercises pivot/chart rendering against real
   data") is not actually satisfied by a passing E2E run; it's satisfied by a
   different, narrower compensating check.

---

## PART 1 -- compliance-tracker: reporting API gateway + CSV-injection fix (PR #601)

### Claimed items verified present

| Claim | Verified | Evidence |
|---|---|---|
| `csvEscape()` exists, prefixes `=`,`+`,`-`,`@` | YES | `src/lib/report-export-shared.ts:23,25-31` -- `FORMULA_INJECTION_PREFIX = /^[=+\-@]/`; `csvEscape()` prepends `'` when matched, then quotes/escapes `"`,`,`,`\n` |
| `rowsToCSV()` calls `csvEscape()` for every cell | YES | `src/lib/report-export-shared.ts:33-40` -- every header/row cell passed through `csvEscape(row[h] ?? "")` |
| External-AI reporting gateway routes exist, scoped by auth | YES | `src/app/api/v1/reports/catalog/route.ts`, `src/app/api/v1/reports/definitions/[id]/run/route.ts` -- both call `requireAuthOrApiKey()` + `requireReportsReadAccess()`, both derive `orgId` **only** from `ctx.orgId` (never from request body/query) |
| `read:reports` scope mintable | YES | `src/app/api/settings/api-keys/route.ts:56-59` whitelist includes `"read:reports"` |
| PR #601 merged to `main` | YES | `8e57644a Merge pull request #601...` in `git log --oneline`; `mergedAt: 2026-07-27T14:31:26Z` |

### GAP 1 (real, confirmed): CSV-export bypass exists elsewhere in the reporting module

`grep -rn "rowsToCSV\|csvEscape" src/` shows **exactly one call site** for the
new, escaped CSV builder: `src/app/api/v1/reports/definitions/[id]/run/route.ts:40`.
That route and its underlying function are correctly protected -- no bypass
*of that function*.

But a second, older, wholly separate CSV-export code path exists and is
**not** protected: `src/app/(app)/reports/page.tsx:296-320`, the "Export CSV"
button on the main internal compliance Reports dashboard:

```
const rows = items.map((item) => [
  `"${item.title}"`,
  item.complianceType,
  ...
]);
const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
```

`item.title`, `item.department.name`, `item.assignedTo?.name` are
user-controlled free text. None of it is passed through `csvEscape()` or any
equivalent -- a title beginning with `=`, `+`, `-`, or `@` (e.g.
`=cmd|'/c calc'!A1`) would be written verbatim into the exported CSV and
interpreted as a live formula by Excel/Sheets on open. Confirmed via
`gh pr view 601 --json files` that PR #601 never touched `reports/page.tsx`
(its 14 changed files are all under `src/app/api/v1/reports/**`,
`src/app/api/settings/api-keys/route.ts`, `src/lib/report-export-shared.ts`
and its tests, `src/lib/db/schema.ts`, `src/lib/openapi/generate.ts`,
`src/lib/supabase/auth-guard.ts` and its tests, plus governance files) --
so this is not a regression introduced by #601, it's a pre-existing exposure
in the same "reporting module" this task asks about, still present on
current `main`.

**Answer to the task's explicit ask** ("state whether any CSV-export code
path was found that bypasses `csvEscape()`"): **Yes -- `exportCSV()` in
`src/app/(app)/reports/page.tsx` (lines 296-320).**

### GAP 2 (real, confirmed): the promised real cross-org tenant-isolation penetration test is mocked, not real

`task-20260727-101145`'s own registered claim (the task that produced PR
#601) stated: *"Top priority per Owner: a real, automated cross-org
tenant-isolation penetration test (Org B's API key must not be able to read
Org A's report data through the new route) -- part of the PR's test suite,
not a manual check."*

What actually exists, verified by reading the test file itself:
`src/app/api/v1/reports/definitions/[id]/run/route.test.ts` mocks
`executeReportDefinition()` entirely (`mock.module` / `jest.fn`-style stub)
and asserts only that the **route** always passes `ctx.orgId` (never a
request-body value) into that mocked call -- e.g. lines ~67-96, `mockAuth({
orgId: "org-b" })` then asserting the captured call argument's `orgId` is
`"org-b"` even when the POST body claims `orgId: "org-a"`.

That is a real and correctly-written test, but it is an **application-level**
test of the route's own plumbing, not a test that two different orgs'
API keys are actually prevented from reading each other's report rows at the
database layer. This codebase's own existing
`src/lib/services/tenant-isolation.test.ts` says so explicitly in its own
header comment: *"The real isolation guarantee has two layers: ... 2.
Database-level: withTenantContext() sets Postgres RLS GUCs ... This test
does NOT exercise the DB-level layer."* No test file anywhere in
compliance-tracker (`grep -rl "current_org_id" src --include="*.test.ts"`
finds only that same file) runs a real query against a real/test Postgres
instance to prove RLS actually blocks a cross-org read. This is a systemic,
pre-existing limitation of the codebase's whole test suite, not unique to
this PR -- but it means the Owner's explicitly named top-priority
requirement for *this* task was not literally met; a real DB-level
penetration test does not exist, was not added, and the PR's own claim that
tenant isolation is "already relied on at ~30 other call sites" is true but
doesn't change that none of those ~30 call sites have a real-DB pen test
either.

### Tests / typecheck (run live, this session)

- `bun test src/lib/report-export-shared.test.ts` → **7 pass, 0 fail, 25 expect() calls**
- `npx tsc --noEmit` (repo root, `NODE_OPTIONS=--max-old-space-size=6144`, default heap OOM'd) → **clean, zero errors**

### Real audit verdict (quoted from PR #601's GitHub comments via `gh pr view 601`)

```
AUDIT: PASS
Objective Understood: Reviewed worker task 'Reporting API gateway: real CSV-injection fix (v2, correct source)' ...
Standards Reviewed: AGENTS.md Operating Rule 7c structured audit protocol; risk-tier.py's deterministic tier classifi...
Scope Confirmed: [14 files, 671 insertions(+), 3 deletions(-) -- matches gh's own file list]
Evidence Recorded: This diff adds a generic, external-AI-facing reporting API gateway (GET /api/v1/reports/catalog, P...
Severity Classified: none
Verdict: pass
Corrective Action Owner: Not required -- no issues found in this review.
Re-Audit Scheduled: Not required -- approved as-is, no follow-up needed.
```

This verdict is real (confirmed present on the real merged PR), but its
"Scope Confirmed" is limited to the 14 files PR #601 itself touched --
consistent with it not catching GAP 1 above, since that gap lives in a file
(`reports/page.tsx`) outside that diff.

### Verdict -- PR #601

- **As narrowly scoped** (the new `/api/v1/reports/**` gateway + its own CSV
  path): **COMPLETE**. Code is real, correctly tenant-scoped at the
  application layer, correctly CSV-escaped, tested (7/7 unit tests pass),
  typechecks clean, and carries a real `AUDIT: PASS`.
- **As the broader "reporting_module_end_user scope, genuinely 100%
  complete" question this task actually asks**: **INCOMPLETE-WITH-GAPS** --
  GAP 1 (unescaped CSV export still reachable elsewhere in the same module)
  and GAP 2 (no real DB-level tenant-isolation pen test anywhere, despite it
  being named the task's own top priority) are both real, both currently
  open on `main`.

---

## PART 2 -- projexa: pivot/chart reporting UI (PR #51)

### Claimed items verified present

Checked out via a disposable `git worktree add /tmp/projexa-audit-wt
origin/main --detach` (kept the shared `/opt/veridian/repos/projexa` clone's
own pre-existing local changes untouched; worktree removed after use).

| Claim | Verified | Evidence |
|---|---|---|
| PR #51 merged to `main` | YES | `git merge-base --is-ancestor 5441c50 origin/main` → true; `5441c50 Merge pull request #51 ...` |
| Real pivot-table component (not a stub) | YES | `src/components/reports/PivotTable.tsx`, 116 lines |
| Real chart component (not a stub) | YES | `src/components/reports/ReportChart.tsx`, 132 lines |
| Real result-view tab switcher | YES | `src/components/reports/ReportResultView.tsx`, 70 lines |
| Real generic filter controls | YES | `src/components/reports/ReportFilters.tsx`, 100 lines |
| Real pure aggregation logic | YES | `src/components/reports/pivot-utils.ts`, 110 lines |
| Actually wired into both existing entry points, not orphaned | YES | `ReportCatalogRunner.tsx:39` imports `ReportResultView`, `:130` renders `<ReportResultView result={result} />`; `ReportOutput.tsx:3-4` imports `PivotTable`/`ReportChart`, `:49,52` renders both |

### GAP 3 (real, self-disclosed by the PR's own doc, confirmed still unresolved): the pivot/chart E2E test has never actually run

`e2e/pivot-chart-reports.spec.ts` (50 lines, real Playwright test, confirmed
via `git cat-file -p origin/main:e2e/pivot-chart-reports.spec.ts`) does
assert real pivot/chart behavior when it runs: switches to the Pivot tab and
checks for `Rows`/`Aggregate` controls, switches to the Chart tab and checks
for a rendered `.recharts-wrapper`/`.recharts-responsive-container` element,
then switches back to Table and checks the raw grid is still there.

But per the same PR's own `ai-os/PIVOT_CHART_TECH_DECISION_2026-07-27.md`
("Real-data verification" section, lines 105-130):

> `https://projexa-ai.com/login` currently renders compliance-tracker's login
> UI ... not PROJEXA's own ... a real, pre-existing production
> deployment/routing issue outside this repo, discovered while trying to log
> in for live E2E verification. This blocked driving the real site through a
> browser in this environment. ... `e2e/pivot-chart-reports.spec.ts` is
> written and ready to run once the login-routing issue above is fixed.

This is an honest, explicit disclosure by the implementing session itself,
not something this audit uncovered independently -- but it does mean SCOPE
item (1)'s literal ask for this task ("confirm it actually exercises
pivot/chart rendering against real data") is **not** satisfied by a passing
E2E run, because there has never been one. `git log --oneline --all | grep
-i "login-routing"` returns only the original disclosure commit
(`8cf5cab`) -- no later fix exists on `main` as of this audit. `gh pr checks
51` confirms no CI job runs Playwright at all for this repo/PR (`Build`,
`Lint`, `Type Check`, `Vercel`, `Vercel Preview Comments` -- no `E2E`
entry), so this was never going to be caught by CI either.

Two additional, narrower observations on the same test file:
- It contains two `test.skip(...)` escape hatches (line 23: no runnable
  report found in the catalog; line 30: report returned zero rows) -- even
  once the login-routing bug is fixed and it does run, it can still pass by
  silently skipping rather than exercising the real assertions, depending on
  what data exists in whatever environment runs it.
- The compensating verification that *was* actually performed (documented in
  the same doc, lines 117-130) is real and legitimate: calling
  compliance-tracker's real `executeReportDefinition()` directly against the
  real production database for one report per domain (Sales/Construction/
  Interior Design), feeding the real `{columns, rows}` results into
  `computePivot()`/`computeChartData()`, and confirming correct aggregates.
  This proves the pure aggregation math is correct against real data. It
  does not prove the actual rendered UI (tabs, controls, chart SVG) works in
  a live browser -- a materially different and narrower claim than "the E2E
  test exercises pivot/chart rendering against real data."

### Tests / typecheck (run live, this session, against the real `origin/main` worktree)

- `bun test src/components/reports/pivot-utils.test.ts` → **9 pass, 0 fail, 24 expect() calls**
- `npx tsc --noEmit` (repo root, `NODE_OPTIONS=--max-old-space-size=6144`) → **clean, zero errors**
- The E2E test itself was **not** executed by this audit either (same
  login-routing blocker applies here; this was a read-only re-audit, not a
  fix task, and CI has never run it) -- this audit can confirm the test is
  real and well-formed, not that it currently passes end-to-end.

### Real audit verdict (quoted from PR #51's GitHub comments via `gh pr view 51`)

```
AUDIT: PASS
Objective Understood: Reviewed worker task 'PROJEXA pivot table + chart UI for reports' (risk tier: tier1) by reading...
Standards Reviewed: AGENTS.md Operating Rule 7c structured audit protocol; risk-tier.py's deterministic tier classifi...
Scope Confirmed: [12 files, 901 insertions(+), 87 deletions(-) -- matches gh's own file list]
Evidence Recorded: This is a clean, well-scoped additive UI feature: client-side pivot-table and chart view modes ove...
Severity Classified: none
Verdict: pass
Corrective Action Owner: Not required -- no issues found in this review.
Re-Audit Scheduled: Not required -- approved as-is, no follow-up needed.
```

This verdict is real. Its visible "Evidence Recorded" text characterizes the
change as clean and well-scoped, consistent with the code-quality findings
above -- but nothing in the comment (as retrieved) specifically flags the
never-run E2E test or the still-open production login-routing bug as a
residual item, despite both being disclosed in the PR's own tech-decision
doc sitting in the same diff the auditor reviewed.

### Verdict -- PR #51

- **Component/logic implementation**: **COMPLETE** -- real, substantial,
  correctly wired into both existing entry points, unit-tested (9/9 pass),
  typechecks clean, carries a real `AUDIT: PASS`.
- **The specific "E2E test ... actually exercises pivot/chart rendering
  against real data" claim this task was asked to confirm**:
  **INCOMPLETE-WITH-GAPS** -- the test is real and well-written but has
  never actually executed successfully (or at all) due to a disclosed,
  still-unresolved production login-routing bug; compensating backend-only
  verification was done and is legitimate but is not equivalent to the
  literal claim.

---

## Cross-cutting notes

- Neither task-20260727-101145 (PR #601) nor task-20260727-101157 (PR #51)
  has a corresponding entry in `ai-os/boss/COMPLETED.yaml` or
  `ai-os/MASTER-TRACKER.yaml` under the `reporting_module_end_user` /
  `CRITICAL_ERP_REPORTING_MODULE_WITH_AI_API_INTEGRATION` name at the time of
  this audit (grepped both files, zero matches) -- neither PR's own
  doer+auditor documentation entries (required by AGENTS.md Rule 7(d)) were
  found in the expected ledger. Not re-verified further as it's outside this
  task's SCOPE, but noted since it affects how discoverable this task's own
  findings will be to a future session.
- This task's own CONSTRAINTS (no cron/systemd timer state changes; no file
  changes outside `ai-os/audits/` in either repo) were honored -- the only
  non-report change made was registering this session's claim in
  `ai-os/boss/ACTIVE-CLAIMS.yaml` per Rule 11's own mandatory protocol
  (committed separately, before this report).
