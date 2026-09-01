# Delegation Expiry Enforcement Audit — V2-11-DELEGATION-EXPIRY

**Date:** 2026-07-26
**Task:** V2-11 — Delegation expiry enforcement audit + test (CSV row #11)
**Author:** claude-code (task-20260726-171939-delegation-expiry-enforcement-audit---te)

## Background

`scopedDelegations` (Wave 173, GAP-DELEGATION-AUTHORITY) lets one person
(`delegatorUserId`) formally hand their own authority over a specific scope
to someone else (`delegateUserId`) or to any holder of a given role
(`delegateRoleKey`), for a bounded or open-ended time, revocably —
`src/lib/db/schema.ts`'s own comment on the table gives the canonical
example: *"while I'm on leave, my manager approves anything scoped to
Project X on my behalf."*

`src/lib/services/delegation-service.ts` ships real, tested, expiry-correct
logic for this:
- `isDelegationActive(delegation, now)` — false if revoked, false if
  `expiresAt <= now` (strict).
- `delegationGrantsUser(delegation, userId, userRoleKeys)` — does this row
  grant this specific user or role?
- `isDelegated(db, orgId, scopeType, scopeId, userId, userRoleKeys)` — the
  DB-touching combination of both, the function other code is meant to call
  before treating a delegate's action as authorized.

**Finding confirmed before any code was written this session:**
`grep -rn "isDelegated(" src` outside `delegation-service.ts` itself
returned **zero hits**. The CRUD routes (`POST/GET /api/delegations`,
`DELETE /api/delegations/[id]`) let a user create, list, and revoke
delegation records — but nothing ever *consulted* one to actually grant
authority. The expiry logic was correct; it was simply never wired to any
real authorization decision. This audit's job was to find every
authorization checkpoint that legitimately could consult delegation, and
wire the real ones in.

## Methodology

Enumerated every non-listing authorization checkpoint in the codebase via:

```
grep -rln "requireRole(\|hasRole(\|ROLE_RANK\[" src/lib/services src/app/api --include=*.ts
grep -rln "requireRoleOrScope(\|requirePermission(" src/app/api --include=*.ts
```

This surfaced ~100 call sites across ~70 files. `DELEGATION_SCOPE_TYPES` is
`["task", "workflow", "project", "module", "communication_type",
"approval_type"]` — delegation only makes sense at a checkpoint that (a)
gates a specific person's authority to act on a specific scoped item (not a
static "must be admin to configure X" platform setting), and (b) maps to
one of those six scope kinds. Each hit was checked against that bar.

## Findings, checkpoint by checkpoint

### Wired this session

1. **`approval-workflow-service.ts`'s `decideApprovalStep()`** — the
   generalized Approval Workflow Engine's per-step decision function. Was:
   `if (userRank < requiredRank) throw 403`, with no delegation fallback at
   all. This is the direct, load-bearing consumer of the `'approval_type'`
   scope — a specific, scoped ("this entityType"), per-instance decision, not
   a listing view (`listMyPendingApprovals` is the listing view for the same
   data and was deliberately left alone — the task brief explicitly says
   "not just listing views"). **Wired**: on a rank-insufficient decider, now
   calls `isDelegated(db, orgId, "approval_type", step.instance.entityType,
   userId, [role])` before rejecting. An expired or revoked delegation
   returns `false` from `isDelegated()` exactly like having none at all, so
   the 403 stands.

2. **`erp-payment-entries-service.ts`'s `canDecidePaymentEntry()` /
   `decidePaymentEntry()`** — a second, independent, hard-coded mandatory
   manager-rank approval gate for payment entries, explicitly documented in
   that file's own header as mirroring `decideApprovalStep()`'s exact two
   checks (self-approval, then rank) rather than routing through the
   configurable engine (an Owner decision from 2026-07-16, made specifically
   so payment approval can never silently auto-approve via "no workflow
   configured"). Same shape, same gap: no delegation fallback existed.
   **Wired**: `decidePaymentEntry()` now computes
   `hasDelegatedAuthority = actorRank < MANAGER_RANK && await isDelegated(db,
   orgId, "approval_type", "erp_payment_entry", userId, [role])` and passes
   it into `canDecidePaymentEntry()`, which still unconditionally blocks
   self-approval regardless of delegation. This does **not** reintroduce the
   "auto-approve with no gate" fallback that file's header explicitly
   rejects — a rank-insufficient actor is only ever let through if a real,
   currently-active (non-expired, non-revoked) delegation record already
   grants them that specific authority; approval is still mandatory, it can
   just now be mandatorily provided by an authorized delegate instead of
   only by someone who already holds the rank.

Both are **additive**: a user who already meets `requiredRank`/`MANAGER_RANK`
never reaches the delegation branch, so behavior for every non-delegated
decision is byte-for-byte unchanged. Verified by the full existing test
suite (2042 tests, 0 failures, see Verification below) — no pre-existing
test's expectations changed.

### Reviewed, no delegation scope applies (not wired, with reasons)

- **`permission-service.ts`'s `ERP_ACTION_ROLES` / `requirePermission()` /
  `requireRoleOrScope()`** (~51 API routes across every ERP module: sales,
  fixed assets, journal entries, purchase invoices, etc.) — this is a
  single, universal, per-action minimum-role table keyed by `ErpAction`
  (`create`/`edit`/`delete`/`approve`/…), not a per-instance, per-scope
  authority a specific person holds and could hand off. It's the closest
  thing to a `'module'`-scope checkpoint in spirit, but wiring delegation
  into it would mean auditing and changing the authorization semantics of
  every ERP route in the platform in one pass — a much larger, higher-blast-
  radius change than this task's scope, and not what CSV row #11 or the
  original task brief ("audit... add a regression test," singular in
  emphasis) called for. Flagged here as a legitimate follow-up if the
  `'module'` delegation scope is meant to have a real consumer.
- **Fixed admin/manager role gates with no per-instance scope** —
  `product-service.ts`, `product-branch-service.ts`,
  `pms-taxonomy-service.ts`, `module-rule-service.ts`,
  `fm-checklist-service.ts` (creating products/projects/branches/issue
  types/workflow transitions/module rules/checklist templates): these all
  require a static role (`admin` or `manager`) to configure global,
  org-wide resources. There is no specific scoped instance or delegator
  whose authority is being exercised — these are platform configuration
  gates, not delegable personal authority, and don't correspond to any of
  the six `DELEGATION_SCOPE_TYPES`.
- **`client-access-service.ts`, `hr-attendance-access.ts`,
  `home-service.ts`, `crm-accounts-service.ts`, `sales-engine-service.ts`,
  `stage0-service.ts`, `support-session-service.ts`,
  `worker-agent-service.ts`, `fde-service.ts`, `prompt-governance-service.ts`,
  `abac-policy-service.ts`** — reviewed; each is either a data-visibility
  filter (who can *see* which rows, the "not just listing views" carve-out
  applies in spirit even where it isn't a literal list endpoint), a
  fixed-role admin gate as above, or (ABAC) a separate, already
  general-purpose deny-policy engine with no relationship to the
  delegation table. None reference `task`/`workflow`/`project`/`module`/
  `communication_type` scoped, per-instance authority in a way
  `scopedDelegations` was built to cover.
- **`communication_type` scope** — already has a real, working, *different*
  mechanism: `approval-preference-service.ts`'s `checkApprovalPreference`
  (a self-service "always approve this category for me" preference, Wave
  161 — explicitly documented in `delegation-service.ts`'s own header as a
  distinct, narrower concept from delegation). No checkpoint hands off
  *communication-type* approval authority to a different person today, so
  there is nothing to wire.
- **`task` / `workflow` / `project` scope types** — no authorization
  checkpoint in the current codebase gates a specific task, generic
  workflow, or project instance by a role-rank-style check that a
  delegation could plausibly override (task assignment/reprioritization in
  `task-service.ts`/`task-reprioritization-service.ts` has no role gate at
  all today — anyone with basic task access can act on tasks they're
  assigned or related to). These scope types exist in the schema for future
  use; there is genuinely nothing to wire them into yet.

## Verification

```
$ grep -rln "isDelegated(\|isDelegationActive(" src --include=*.ts | grep -v "delegation-service"
lib/services/erp-payment-entries-service.test.ts
lib/services/approval-workflow-service.ts
lib/services/erp-payment-entries-service.ts
lib/services/approval-workflow-service.test.ts
```

Non-empty, as required — two real (non-listing) authorization checkpoints
outside `delegation-service.ts` now call the shared expiry check, each with
regression test coverage proving an **expired** delegation does not grant
authority (`delegation-service.test.ts`'s `resolveDelegatedAuthority`
suite, `approval-workflow-service.test.ts`'s new
`decideApprovalStep's delegation fallback` suite, and
`erp-payment-entries-service.test.ts`'s new `hasDelegatedAuthority` cases).

```
$ bun test
2042 pass, 0 fail, 4000 expect() calls, across 166 files
$ bunx tsc --noEmit -p .
(clean, no output)
```

## What changed vs. what didn't

- `delegation-service.ts`: pure refactor only — `isDelegated()`'s decision
  logic (the `candidates.some(...)` line) is now the separately-exported
  `resolveDelegatedAuthority()`, so it's unit-testable without a DB. No
  change to `isDelegated()`'s behavior or signature.
- `approval-workflow-service.ts`: additive delegation fallback in
  `decideApprovalStep()`, described above.
- `erp-payment-entries-service.ts`: additive `hasDelegatedAuthority` param
  (default `false`, so every pre-existing caller/test is unaffected) on
  `canDecidePaymentEntry()`, wired from `decidePaymentEntry()`, described
  above.
- No schema/migration changes — `scopedDelegations` already existed with
  everything this needed.
- No behavior change for any user with no active delegation, and no way to
  create a delegation that grants authority its creator didn't already
  need to have held in the first place — this task audited and wired
  *expiry enforcement at consumption time*, not delegation *creation*
  authority validation (a different, not-yet-flagged gap: `createDelegation`
  doesn't currently verify the delegator holds the authority they're
  handing off — out of scope for V2-11, noted here for a future pass).
