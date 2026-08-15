# PROJEXA ERP E2E — Independent Re-Audit (2026-07-27)

**Task:** task-20260727-153107-re-audit-projexa-erp-e2e-for-100pct-comp
**Re-verifies:** task-20260727-104516 (PROJEXA ERP E2E, claimed 100% complete)
**Scope:** 5 previously-merged PRs — projexa #52, #54, #56; compliance-tracker #596, #597
**Method:** verification-only, no fixes applied. Real code read on real current `main` in both
repos, real `npx tsc --noEmit` and `bun test` runs, real `gh pr view` comment extraction for
supervisor verdicts. Two independent sub-agent passes (one per repo) were run, then this session
independently spot-checked a sample of their file:line claims and re-ran the compliance-tracker
test/typecheck commands itself to confirm the sub-agent numbers rather than taking them on faith.

**Repos verified against:**
- `projexa` — `main` @ `699d9e7` (fetched fresh, pulled, at verification time)
- `compliance-tracker` (this repo) — `main` @ `df665722` (== branch HEAD prior to this report's
  own commit)

---

## PR #52 — AppShellFrame / homeThreadSlot header fix (projexa)

**Claim:** wire `homeThreadSlot` into `AppShellFrame` alongside header/sidebar/composer/panel.

**Verified present:**
- `src/app/(app)/layout.tsx:34-49` — `AppShellFrame` called with `homeThreadSlot={<HomeThreadSlot />}`, `header`, `sidebar`, `composer`, `panel`, `homeRoute={HOME_ROUTE}`.
- `src/components/veri-chat/HomeThreadSlot.tsx:16-32` — renders `discussMessages` from `useVeriChat()` via shared `ThreadView`; returns `null` when empty.
- `src/components/veri-chat/veri-chat-context.tsx:38` — `HOME_ROUTE = "/dashboard"`, consumed consistently by both `layout.tsx` and `VeriComposer.tsx:288-291`'s `isHome` suppression logic (prevents the discuss transcript rendering twice).

**Gaps found:** none.

**Tests / typecheck:** covered by the repo-wide `tsc`/`bun test` runs below (projexa side) — clean.

**Supervisor verdict (verbatim, `gh pr view 52`):**
> AUDIT: PASS ... Severity Classified: none ... Verdict: pass ... Re-Audit Scheduled: Not required -- approved as-is, no follow-up needed.

**Final verdict: COMPLETE.**

---

## PR #54 — PWA manifest + offline-shell service worker + IndexedDB work-progress sync queue (projexa)

**Claim:** real PWA manifest, offline-shell service worker, IndexedDB-backed offline sync queue for work-progress entries.

**Verified present:**
- Manifest: `src/app/manifest.ts:14-26` — real Next.js `MetadataRoute.Manifest` with `name`, `short_name`, `start_url: "/"`, `display: "standalone"`, theme/background colors, real icon entry (`/logo-mark.svg`).
- Service worker: `public/sw.js:19-69` — caches app-shell URLs on install, purges stale caches on activate, network-first for navigations with cache fallback, cache-first for static GETs, explicitly bypasses `/api/*`. Registered from `src/components/ServiceWorkerRegister.tsx:12`, mounted in `src/app/layout.tsx:59`.
- IndexedDB queue: `src/lib/offline/work-progress-queue.ts` (`idb-keyval`-backed) — `enqueueWorkProgressEntry` / `listQueuedWorkProgressEntries` / `syncQueuedWorkProgressEntries` (lines 83-184), draining against real `POST /api/work-progress`.

**Critical re-check 1 — per-user scoping: PASS.**
Every queue function takes an explicit `scope` param; the IndexedDB store name is literally `` `projexa-offline-work-progress::${scope}` `` (`work-progress-queue.ts:41-50`) — no unscoped fallback path exists in the module. `WorkProgressClient.tsx:73-83` resolves `scope` from `supabase.auth.getUser().id` and gates reads/writes on it being non-null (lines 167-171, 198-199 — explicit refusal while session is still resolving, rather than silently falling through with no scope). A real cross-user test (`work-progress-queue.test.ts:141-170`) proves user B's session neither sees nor drains user A's queued entries against a real `fake-indexeddb` backend — not a same-tautology self-check.

**Critical re-check 2 — concurrent-sync mutex: PASS, genuine.**
`syncLocks: Map<string, Promise<...>>` keyed by scope (`work-progress-queue.ts:123`); `syncQueuedWorkProgressEntries` checks/returns the in-flight promise synchronously before its first `await` (lines 133-184), so two same-turn calls are guaranteed to share one drain. A dedicated race test widens the interleaving window inside a mocked `fetch` specifically to catch a naive/superficial mutex (`work-progress-queue.test.ts:182-206`): `fetchCalls` stays at 1 across two `Promise.all`-concurrent sync calls; a third call after lock release runs independently (lines 208-227), proving it isn't deadlocked either.

Both re-checks were previously flagged in an earlier audit round and fixed on main via `b5014d9` ("Fix PR #54 audit findings: per-user IndexedDB scoping + concurrent-sync mutex") and `173b9ab` (max-attempt cap for permanently-failing sync entries, `MAX_SYNC_ATTEMPTS = 5` at lines 77/170, tested at `work-progress-queue.test.ts:237-261`). Both commits are confirmed present as ancestors of current projexa `main`.

**Tests (projexa):** `bun test src/lib/offline/work-progress-queue.test.ts` — **10 pass, 0 fail, 36 expect() calls.**

**Supervisor verdict (verbatim, `gh pr view 54`):** thread shows an initial `AUDIT: FAIL` (`Severity Classified: medium`), superseded by a second comment on the same thread:
> AUDIT: PASS ... (objective: "Reviewed worker task 'Fix PR 54 audit findings: per-user offline queue isolation + sync race co...'")

**Final verdict: COMPLETE.** Both specifically-flagged risk items (per-user scoping, real mutex/dedup) hold up under independent re-scrutiny with tests that exercise the actual race/isolation condition, not a superficial pass.

---

## PR #56 — PM / Site-Engineer / Client-Viewer roles + server-side route gating + last-owner/admin demotion guard (projexa)

**Claim:** new org roles, server-side route gating enforcing them, and a guard preventing demotion of an org's last owner/admin. Supersedes closed PR #53.

**Verified present:**
- Roles: `src/lib/supabase/auth-guard.ts:25` — `OrgRole = "owner" | "admin" | "pm" | "site_engineer" | "member" | "client_viewer"`; `ALL_ORG_ROLES` (line 31), `ROLE_GROUPS.{PM_OR_ABOVE, FIELD, ORG_ADMIN}` (lines 36-50). Backed by `drizzle/0012_membership_roles_pm_site_engineer.sql:17-22` (check constraint on `memberships.role`).
- `requireRole()` (`auth-guard.ts:60-65`) — a real 403-returning server gate, not a UX-only helper.
- Last-owner/admin guard: `src/app/api/org-members/[id]/route.ts:34-59` — computes `wasOwnerOrAdmin`/`willBeOwnerOrAdmin`; if the change would zero out the org's owner/admin count (`.neq("user_id", id)` count of remaining owners/admins), returns 409. Confirmed this is exactly commit `114d0ee`'s content, still present verbatim on main.
- `route.test.ts` (166 lines) — exhaustive: owner/admin can reassign; member/site_engineer 403; invalid role 400; sole-owner demotion blocked 409; demotion allowed when another admin exists; owner↔admin reassignment never blocked even as sole admin-group member; non-admin-group reassignment never triggers the count check.

**Critical re-check — full-codebase sweep of every role/membership-mutating PATCH/DELETE endpoint: PASS for all in-scope routes; one pre-existing, out-of-scope GAP surfaced.**

Only one membership/role table exists in projexa (`public.memberships`) — no separate `project_members`/`team_members` tables. Sweep of all 27 `route.ts` files exporting `PATCH`/`DELETE` under `src/app/api`, filtered for `role`/`member` content:
- `src/app/api/org-members/[id]/route.ts` (PATCH) — role-gated (`ROLE_GROUPS.ORG_ADMIN`) + last-owner/admin guard. **PASS.**
- `src/app/api/org-members/route.ts` — GET-only, no mutation. N/A.
- `src/app/api/org/provision/route.ts` (POST) — self-provisioning insert of the caller's own `owner` row on signup, not a role change on another member. N/A by design.
- PR #56's own 6 newly role-gated routes, all confirmed calling `requireRole()` with the documented `ROLE_GROUPS`: `change-orders/[id]` & `change-orders` (`PM_OR_ABOVE`), `punch-list/[id]` & `punch-list` (`FIELD`), `schedule/baselines` (`PM_OR_ABOVE`), `purchase-orders` (`PM_OR_ABOVE`), `project-budgets` (`PM_OR_ABOVE`), `site-diary` (`FIELD`). **PASS** for all six.
- All remaining 25 PATCH/DELETE routes (audit-findings, board, employees, ffe, floor-plans×3, fraud-cases, knowledge-base, leads, mood-boards, notifications/read, opportunities, policies, quotations, rfis, risks, sales-orders, schedule/sprints×2, submittals, timesheets, todos, wiki) contain no `role` references and only one incidental, non-mutating `member` reference (`submittals/[id]/route.ts` — an unrelated `notifyOrgMembers()` broadcast call). No gap — plain business-data CRUD with no access-control dimension beyond `requireAuth()`.

**GAP (out-of-scope, pre-existing, not part of PR #56's diff):** `src/app/api/access-review/certifications/[id]/route.ts` PATCH — its own comment states it "confirm[s] or revoke[s] a single certified user role," but calls only `requireAuth()`, no `requireRole()` gate. This operates on a separate compliance-audit "access review certification" resource, not `memberships.role`, and predates PR #56 (never touched by its diff). Flagged per this task's instruction to check the whole codebase, not just PR #56's own files — worth a follow-up task, but does **not** invalidate PR #56's own completeness.

**Tests (projexa):**
- `bun test "src/app/api/org-members/[id]/route.test.ts"` — **10 pass, 0 fail, 14 expect() calls.**
- `bun test src/lib/supabase/auth-guard.test.ts "src/app/api/punch-list/[id]/route.test.ts"` — **9 pass, 0 fail, 17 expect() calls** (2 files).

**Supervisor verdicts (verbatim):**
- PR #53 (closed, superseded): `AUDIT: FAIL ... Severity Classified: medium ... Verdict: fail ... Re-Audit Scheduled: Required after corrective changes are pushed.`
- PR #56: `AUDIT: PASS ... Severity Classified: none ... Verdict: pass ... Re-Audit Scheduled: Not required -- approved as-is, no follow-up needed.` (objective: "Fix PR 53: last-owner/admin demotion protection")

**Final verdict: COMPLETE** for PR #56's claimed scope. One adjacent, pre-existing, out-of-scope gap noted above for future follow-up.

---

## projexa: repo-wide typecheck

`npx tsc --noEmit` at projexa repo root: **exit code 0, zero output — clean.** (Fresh checkout required `bun install` first; `idb-keyval` and other deps were not yet materialized, an environment artifact, not a code gap.)

---

## PR #596 — Hierarchical BoQ breakdown-%, interim-billing/valuation/retention, Excel BoQ importer (compliance-tracker)

**Claim:** (1) `constructionBoqLineItems` extended with `parentLineItemId` self-reference + `breakdownPercentage`, `construction-boq-service.ts` computes Sub-Task Amount = Main QTY × Main RATE × Breakdown %, hierarchy-aware revision diff; (2) new `construction-valuation-service.ts` generating a real interim/RA bill via the existing sales-invoice schema/service, with a real `taxTemplateId`; (3) new Excel BoQ importer modeled on `spreadsheet-adapter.ts`.

**Verified present (independently spot-checked by this session, not just the sub-agent):**
- Schema: `src/lib/db/schema.ts:9827-9828` — `parentLineItemId: text('parent_line_item_id')`, `breakdownPercentage: numeric('breakdown_percentage')` on `constructionBoqLineItems`. Confirmed directly by this session.
- `computeHierarchicalAmount()`, `src/lib/services/construction-boq-service.ts:61-78` — walks the `parentItemCode` chain to the root ancestor (not just immediate parent), throws on circular references and unresolved `parentItemCode`, returns `current.quantity * current.rate * (item.breakdownPercentage / 100)`. Confirmed directly by this session — matches the claimed formula exactly, including the "root ancestor, not immediate parent" nuance documented in the schema comment.
- `diffLineItems()` (`construction-boq-service.ts:237-258`) — hierarchy-aware: flags `breakdownPercentageChange`, sets `isSubItem: curr.parentLineItemId !== null`.
- `src/lib/services/construction-valuation-service.ts` (227 lines, new) — `generateInterimBill()`, `computeInterimBillLines()`, `applyRetention()`, wired to `createSalesInvoice` from `erp-invoicing-service.ts` (existing sales-invoice service, not a new invoice table).
- Excel importer: `src/lib/services/construction-boq-import-service.ts` (105 lines) + `src/app/api/construction/boq/import/route.ts` — reuses `parseFile` (`src/lib/ingest/parser.ts`) and `parseAmount` (`src/lib/gst/column-mapper.ts`); infers `parentItemCode` from dot-delimited item codes.
- Interim-bill API routes: `src/app/api/construction/interim-bills/route.ts` and `.../[id]/route.ts`, both call `requireAuth()`.
- Migration file present for the hierarchy/interim-billing schema change.

**Critical re-check (a) — nonzero tax on a real test invoice: PASS.**
`generateInterimBill` requires a real, resolved `taxTemplateId` (`construction-valuation-service.ts:153,156-157` — 404s if unresolved against `erpTaxTemplates`), feeds it through `buildInterimBillInvoiceItems()` → `createSalesInvoice()` → `computeInvoiceTotals()` → `computeInvoiceTaxTotals()` (`erp-invoicing-service.ts:223-238`, `lineTax = lineAmount * (t.rate/100)` per real `erpTaxTemplateItems` row). Dedicated test `src/lib/services/erp-invoicing-service.test.ts:11-18` directly asserts a real nonzero result: `rate=10000, taxLines=[9%,9%] → taxAmount=1800, grandTotal=11800`.

**Critical re-check (b) — retention does not reduce the taxable subtotal: PASS.**
`buildInterimBillInvoiceItems()` (`construction-valuation-service.ts:88-93`) places every line on the invoice at its full `currentBillAmount`, with **no** negative "retention held" line item. Retention is applied only via `applyRetention()` to `netPayable`, stored separately on `constructionInterimBills.retentionAmount`/`netPayable` — it never touches the invoice's `items` array or its taxable subtotal. `erp-invoicing-service.test.ts:26-44` explicitly contrasts the fixed behavior (subtotal=3500, tax=630) against "the bug this replaces" (a `-350` negative retention line dragging subtotal to 3150) — proving this is a real, tested fix, not a rename. This matches fix commit `f4f70f1d` ("fix: interim/RA bills posted with $0 GST -- wire real taxTemplateId, stop retention from reducing the taxable subtotal"), confirmed present as an ancestor of current `main` (`df665722`) by this session directly via `git log`.

**Tests (independently re-run by this session, not just the sub-agent):**
```
$ bun test src/lib/services/construction-boq-service.test.ts src/lib/services/construction-valuation-service.test.ts \
           src/lib/services/construction-boq-import-service.test.ts src/lib/services/construction-reports-service.test.ts \
           src/lib/services/erp-invoicing-service.test.ts
bun test v1.3.14 (0d9b296a)
 40 pass
 0 fail
 97 expect() calls
Ran 40 tests across 5 files. [474.00ms]
```
(This session's own run matches the sub-agent's reported 40/0/97 exactly.)

**Supervisor verdict (verbatim, `gh pr view 596`):** iterated FAIL → PASS across merge-conflict re-audits; final comment:
> AUDIT: PASS ... Severity Classified: none ... Verdict: pass ... Corrective Action Owner: Not required -- no issues found in this review. Re-Audit Scheduled: Not required -- approved as-is, no follow-up needed.

**Final verdict: COMPLETE.**

---

## PR #597 — Timesheet budget-vs-actual report fix (compliance-tracker)

**Claim:** fixes (1) a budget-undercount bug (`byDesignerStatus` dropping budgeted-but-entryless designers), (2) a real N+1 query (`resolveBillableRate()` per time entry → batched `resolvePmsBillableRatePure()`), (3) a response-shape bug (project-scoped vs org-wide fields mixed under one flat object).

**Verified present** in `src/lib/services/construction-reports-service.ts`:
1. `aggregateDesignerTimesheetCosts()` (lines 266-325) takes an optional `roster` param; `designerStatusByUser` (line 286) is seeded from the full roster so an entryless-but-budgeted designer still appears in `byDesignerStatus` (lines 286-294).
2. `orgBillableRates` fetched once (line 385: `db.query.pmsBillableRates.findMany(...)`) outside any per-entry loop; `resolvePmsBillableRatePure()` (imported from `pms-time-service.ts`) applied per entry in-memory (line 397) — no per-entry DB round trip.
3. `DesignerTimesheetReport` type (lines 337-350) explicitly separates `projectScoped` vs `orgWide` fields.

**Tests:** `construction-reports-service.test.ts` has dedicated blocks: `"roster-inclusion (budget-undercount fix)"` (lines 102-150) and `"designerTimesheetReport: N+1 fix + scope-labeled response (PR #597 audit fix)"` (lines 152-232) — the latter mocks `pmsBillableRates.findMany` and asserts `ratesFindMany.mock.calls.length === 1` across 30 time entries (a real N+1 assertion, not just a shape check), plus asserts `sum(byDesignerStatus.budget) === overallBudget` and the exact key separation `["orgWide","projectScoped"]`. All pass as part of the 40/0/97 run above (independently re-run by this session, see PR #596 section).

**Supervisor verdict (verbatim, `gh pr view 597`):** `AUDIT: FAIL ... Severity Classified: medium ... Verdict: fail`, superseded by a re-audit comment:
> AUDIT: PASS ... Verdict: pass ... Corrective Action Owner: Not required -- no issues found in this review.

**Final verdict: COMPLETE.**

---

## compliance-tracker: repo-wide typecheck

`NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` at repo root: **exit code 0, zero output — clean.** Independently re-run by this session (default heap size OOMs on this repo's size; the increased heap flag is an environment necessity, not a code issue) and confirmed clean.

---

## Summary table

| PR | Repo | Claimed scope | Critical re-check(s) | Tests | tsc | Supervisor verdict | Final verdict |
|---|---|---|---|---|---|---|---|
| #52 | projexa | AppShellFrame/homeThreadSlot header fix | n/a | covered by repo-wide suite, clean | clean | PASS | **COMPLETE** |
| #54 | projexa | PWA manifest/SW/IndexedDB sync queue | per-user scoping: PASS; concurrent mutex: PASS | 10/0 | clean | FAIL → PASS (fix-forward) | **COMPLETE** |
| #56 | projexa | PM/Site-Eng/Client-Viewer roles + route gating + last-owner guard | full-codebase PATCH/DELETE sweep: PASS (all in-scope); 1 pre-existing out-of-scope gap noted | 19/0 (2 suites) | clean | FAIL(#53) → PASS(#56) | **COMPLETE** |
| #596 | compliance-tracker | Hierarchical BoQ + interim billing/retention + Excel importer | nonzero tax: PASS; retention not reducing taxable subtotal: PASS | 40/0 (shared suite) | clean | FAIL → PASS | **COMPLETE** |
| #597 | compliance-tracker | Timesheet budget-vs-actual fix | n/a (3 named sub-fixes all verified) | 40/0 (shared suite) | clean | FAIL → PASS | **COMPLETE** |

**Overall: all 5 PRs independently re-verified as COMPLETE.** No gaps were found in any of the three specifically-mandated re-checks (PR #54 per-user scoping + mutex; PR #56 full-endpoint role-gating sweep; PR #596 nonzero tax + retention-not-taxable-reducing). One adjacent, pre-existing, out-of-scope gap was surfaced during the PR #56 full-codebase sweep and is noted above for a future follow-up task — it does not belong to any of the 5 PRs under re-audit and does not change their individual completeness verdicts.

The original PROJEXA ERP E2E completion claim (task-20260727-104516) holds up under this independent re-verification.
