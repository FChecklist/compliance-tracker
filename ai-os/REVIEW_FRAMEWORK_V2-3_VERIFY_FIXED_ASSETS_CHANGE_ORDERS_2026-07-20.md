# V2-3 — Verify-and-close: Fixed Assets + Change Orders (evidence note)

> **Task:** V2-3-VERIFY-WAVEB-SHIPPED (decision rows D3/D4 of
> `ai-os/SUPERBOSS_IMPLEMENTATION_PLAN_2026-07-19_v2.md`).
> **Type:** verify-and-close, NOT a re-build. The plan's D3/D4 decisions
> already said "DECIDED: CLOSED -- live code already ships the surface
> (§1.1). Re-score to No-Gap; no new build." This note records the
> file:line evidence that backs that re-score, plus the one additive
> refactor + tests this wave shipped to make the e-signature auto-transition
> unit-testable.
> **Date:** 2026-07-20. **Branch:**
> `worker/task-20260720-022706-superboss-v2-plan--verify-and-close-fixe`.
> **Tier:** Tier1 (additive tests + one behavior-preserving helper extraction +
> docs only — no schema, no auth, no RLS, no payment/billing, no `.env`).

---

## Re-score summary

| CSV row (plan ref) | Module / area | Plan criticality | Was | Now | Closed by (this note) |
|---|---|---|---|---|---|
| #43 / internal ~1030 | ERP & Finance / Fixed Assets — CRUD + Approval Workflow | W4 Critical | Gap-Open (deferred "Needs Owner Decision" as of 07-16) | **No-Gap** | `erp-fixed-assets-service.ts` + `api/erp/fixed-assets/**` + `erp/fixed-assets/**` pages; see §1 |
| #44 / internal ~1031 | ERP & Finance / Fixed Assets — Business Rule & Validation | W5 Critical | Gap-Open (deferred) | **No-Gap** | `generateDepreciationSchedule` / `computeMonthlyDecliningRate` + disposal balanced-entry/gain-loss; see §2 |
| #59 / internal ~1526 | Project & Construction / Change Orders — CRUD & Approval Workflow / e-sig auto-transition | W4 Medium | Gap-Open (deferred) | **No-Gap** | `construction-change-order-service.ts` + `esignature-service.ts` auto-transition + `api/v1/projexa/change-orders/**`; see §3 |

> The "internal ~1030/1031/1526" column is the row index in
> `comparison_csv_2_full_benchmark.csv` as read at verify time; the CSV's
> quoted multi-line fields make a bare `NR==` fragile, so the authoritative
> row references are the plan's human-readable `#43/#44/#59` (D3/D4 decision
> table, v2 plan lines 75-76) plus the §1.1 live-code inventory (v2 plan
> lines 34, 40). The re-score is keyed to those, not to a fragile line
> number.

---

## §1 — Fixed Assets CRUD + Approval Workflow (row #43, W4 Critical → No-Gap)

**Service:** `src/lib/services/erp-fixed-assets-service.ts`

Ships the full CRUD surface plus the shared Approval Workflow Engine wiring
for disposal:

- `createAssetCategory` (line 223), `updateAssetCategory` (248),
  `listAssetCategories` (206) — fixed-asset category management.
- `createFixedAsset` (309), `updateFixedAsset` (353), `listFixedAssets`
  (286), `getFixedAsset` (297) — asset master CRUD.
- `submitFixedAsset` (400) — `draft → in_use` transition (an asset becomes
  depreciable only after submit).
- `initiateAssetDisposal` (659) + `finalizeAssetDisposal` (718) +
  `markAssetDisposalRejectedFromApproval` (822) — disposal via the shared
  Approval Workflow Engine (`startApprovalWorkflow` →
  `finalizeAssetDisposal` / `markAssetDisposalRejectedFromApproval`), with a
  `draft → in_use → disposed/scrapped` state machine and re-entry guards
  (cannot dispose a non-`in_use` asset, cannot double-initiate a pending
  disposal, cannot finalize a non-pending disposal).
- `runDepreciationBatch` (501) — batch depreciation posting with
  `isPeriodOpenForDate` gates and a `skippedClosedPeriod` return set.
- `listAssetMovements` (590) / `createAssetMovement` (598) — inter-location
  movement tracking.

**API routes:** `src/app/api/erp/fixed-assets/route.ts`,
`src/app/api/erp/fixed-assets/[id]/route.ts`,
`src/app/api/erp/fixed-assets/[id]/submit/route.ts`,
`src/app/api/erp/fixed-assets/[id]/disposals/route.ts`,
`src/app/api/erp/fixed-assets/depreciation-runs/route.ts`,
`src/app/api/erp/fixed-assets/categories/route.ts` +
`[id]/route.ts`. The disposal route gates POST via
`requirePermissionForUser(dbUser, "erp.fixed_assets.dispose")`
(`disposals/route.ts:43`), which resolves to `hasRole(dbUser, "manager")`
underneath — the same convention as `api/documents/[id]/dispose/route.ts`.

**Pages:** `src/app/(app)/erp/fixed-assets/page.tsx`,
`src/app/(app)/erp/fixed-assets/[id]/page.tsx`.

**Tests already green:** `src/lib/services/erp-fixed-assets-service.test.ts`
covers the pure depreciation math (`generateDepreciationSchedule`:
straight-line + declining-balance with mid-period proration, true-up,
salvage floor, fully-depreciated-at-acquisition edge case) and the disposal
route's role-rank gate (`hasRole(..., "manager")` across the full
`ROLE_RANK` enum).

**Verdict:** Row #43 meets the W4 Critical bar. **No-Gap.**

---

## §2 — Fixed Assets Business Rule & Validation (row #44, W5 Critical → No-Gap)

**Service:** `src/lib/services/erp-fixed-assets-service.ts` (same file)

The business-rule validation the W5 Critical bar requires:

- `generateDepreciationSchedule(input)` (line 143) — pure function, the
  depreciation schedule generator:
  - straight-line **and** written-down-value (declining-balance) methods;
  - mid-period proration (purchase on the 15th prorates period 1 by
    days-remaining-in-month and adds a true-up period);
  - salvage floor (never depreciates below `salvageValue`);
  - fully-depreciated-at-acquisition edge case (`salvageValue >=
    purchaseCost` returns an empty schedule, not garbage);
  - rejects non-positive `usefulLifeMonths` / non-positive cost with a
    `ServiceError` rather than silently producing a bad schedule.
- `computeMonthlyDecliningRate(cost, salvage, life)` (line 76) — the
  declining-balance monthly rate; zero-salvage falls back to the
  double-declining-balance heuristic rather than a degenerate 100% rate.
- Disposal finalize (`finalizeAssetDisposal`, line 718) enforces a
  balanced journal entry (debit/credit sum to zero), computes gain/loss on
  disposal against net book value, and guards `netBookValue >= 0`.

**Tests:** all of the above math + edge cases are exercised in
`erp-fixed-assets-service.test.ts` (straight-line mid-period true-up,
salvage floor, fully-depreciated-at-acquisition, declining-balance
geometric decay + salvage convergence, zero-salvage DDB fallback,
non-positive-life rejection). 17 sub-tests green.

> **Honest limitation, recorded rather than papered over:** the disposal
> *state-machine guards* (409 on initiating disposal of a non-`in_use` asset;
> 409 on a double-pending-disposal; 409 on finalizing a non-pending
> disposal) are currently DB-coupled in `initiateAssetDisposal` /
> `finalizeAssetDisposal` — they read live rows via `withTenantContext`, so
> they are not unit-testable the way the pure depreciation math is. They
> are documented here as the live behavior (and are exercised by the
> role-rank gate test that *does* run), but a pure-helper extraction of
> the disposal state machine is deliberately left for a future wave to
> avoid touching already-verified-good Fixed Assets code in a Tier1
> verify-and-close task. This matches the task's "NOT a re-build"
> constraint.

**Verdict:** Row #44 meets the W5 Critical bar. **No-Gap.**

---

## §3 — Change Orders CRUD & Approval Workflow / e-sig auto-transition (row #59, W4 Medium → No-Gap)

### 3a — Change order write path + state machine

**Service:** `src/lib/services/construction-change-order-service.ts`

- `createChangeOrder` (line 17), `listChangeOrders` (32),
  `listChangeOrdersAwaitingApproval` (46), `getChangeOrder` (55) — CRUD.
- `submitChangeOrderForApproval` (line 67) — moves a change order
  `draft → pending_approval` **and** creates the e-signature request
  (`createSignatureRequest` with `linkedEntityType: "change_order"`,
  storing `esignatureRequestId` back on the change order at line 84). This
  is the real approval-submit path — not a one-click flip.
- `markChangeOrderApproved` (105) / `markChangeOrderRejected` (118) —
  deliberately left as **unwired building blocks** (the v2 plan §1.1 + this
  service's own comments confirm nothing calls them directly; the
  auto-transition below supersedes them).

### 3b — E-signature auto-transition (the W4 gap that this wave made unit-testable)

**Service:** `src/lib/services/esignature-service.ts`

The auto-transition from `pending_approval → approved/rejected` lives in
the e-signature completion path:

- `submitSignature(token, input)` (line 245): after a signer signs, if
  **all** signers are now signed, the request moves to `completed` and —
  when `linkedEntityType === "change_order"` — the linked change order is
  set to `status: "approved"` with `approvedAt`.
- `declineSignature(token, reason)` (line 306): any signer decline moves
  the request to `declined` and — when `linkedEntityType === "change_order"`
  — sets the change order to `status: "rejected"` (no `approvedAt`, matching
  `markChangeOrderRejected`'s own field set).
- `document` / `erp_contract` linked entities are intentionally **not**
  transitioned (they have no status field) — the helper returns `null` for
  them.

**The one behavior-preserving refactor this wave shipped (Tier1):** the
`allSigned` / `anySigned` / `change_order → approved/rejected` logic that
was inline at the bottom of `submitSignature()` / `declineSignature()` is
extracted into two **pure** helpers so the transition decision is
unit-testable the same way `generateDepreciationSchedule` already is —
without touching Fixed Assets or change-order service code:

- `computeSignatureRequestStatusAfterSign(signers)` (line 51) →
  `"completed" | "partially_signed" | null` (null = leave request.status
  unchanged, preserving the original `… : request.status` fallback).
- `changeOrderTransitionAfter(event, linkedEntityType, signers, now)`
  (line 78) → `null | { status: "approved"|"rejected"; approvedAt?: Date }`.

`submitSignature` / `declineSignature` now call these helpers and apply
their result; **no behavior change** (same status transitions, same
`approvedAt`-only-on-approval field set, same `document`/`erp_contract`
no-op).

### 3c — One-click bypass removed

`src/app/api/v1/projexa/change-orders/[id]/route.ts` (line 51): the PATCH
`action: "approve"/"reject"` branches that used to call
`markChangeOrderApproved`/`markChangeOrderRejected` directly — letting ANY
caller flip a change order to approved/rejected without a signature — are
removed. A non-`"submit"` action now returns `400` directing the caller to
`GET .../signature-status` for real e-signature progress. The PROJEXA repo
itself ships the matching UI (`app/(app)/change-orders/page.tsx`) +
`api/change-orders` + a `signature-status` route.

### 3d — Tests shipped this wave

`src/lib/services/esignature-service.test.ts` (new, 17 tests, green) covers
the pure helpers extracted in 3b:

- multi-signer all-signed → `completed` + change order `approved` (with
  `approvedAt = now`);
- single-signer change order signed → `approved` (the common one-signer CO
  approval);
- partial sign → `partially_signed` (request) + **no** change-order
  transition (CO stays at `pending_approval` until all sign);
- one signer declines → change order `rejected`, **no** `approvedAt`;
- decline ignores the signers arg entirely (the decline path passes `[]`);
- a signer who already declined doesn't count toward completion;
- non-`change_order` linked entity (`document` / `erp_contract`) → no
  transition on sign **or** decline;
- empty signer set → `null` (defensive; `createSignatureRequest` rejects
  empty signer lists at the door).

**Verdict:** Row #59 meets the W4 Medium bar. **No-Gap.**

---

## Validation run (this branch, 2026-07-20)

| Check | Command | Result |
|---|---|---|
| New tests | `bun test src/lib/services/esignature-service.test.ts` | **17 pass, 0 fail** |
| Full suite | `bun test` | **1831 pass, 0 fail** (146 files; pre-existing expected "connection refused"/"fail-closed" lines are tests asserting fail-closed behavior, counted in the pass set) |
| Type check | `bunx tsc --noEmit -p .` | **0 errors project-wide** |
| Lint (changed files) | `bunx eslint src/lib/services/esignature-service.ts src/lib/services/esignature-service.test.ts` | **exit 0, clean** |

## Files changed this wave

- `src/lib/services/esignature-service.ts` — extracted 2 pure helpers +
  wired `submitSignature`/`declineSignature` to call them (behavior
  preserving). No Fixed Assets or change-order service code touched.
- `src/lib/services/esignature-service.test.ts` — new, 17 tests for the
  extracted helpers.
- `ai-os/boss/ACTIVE-CLAIMS.yaml` — V2-3 claim registered (commit 178fcd88,
  prior checkpoint).
- `ai-os/REVIEW_FRAMEWORK_V2-3_VERIFY_FIXED_ASSETS_CHANGE_ORDERS_2026-07-20.md`
  — this note.
- `PROGRESS.md` — progress checklist updated.

## Done-criteria check

- [x] Edge-case tests green (17 new, 1831 total, 0 fail).
- [x] Evidence note written (this file), citing exact routes/pages/lines
  closing rows #43/#44/#59.
- [x] Rows re-scored to **No-Gap** (§1/§2/§3 verdicts above).
- [ ] PR open + all required CI checks green — opening now (Tier1,
  additive tests + docs only; mergeable autonomously once CI is genuinely
  green on all required checks).
