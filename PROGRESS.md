# PROGRESS -- task-20260718-081006-crm---sales-modules--opportunities

## Context
This task's own `prompt.txt`/spec was never actually written to the workspace
(referenced by the resume note but absent on disk; `task.yaml` has no spec
field beyond the title). The task has failed/blocked for weeks (see
`task.yaml` checkpoint history: repeated `credit_accountant_rejected`
pre-flight failures, a `blocked` status, 15 `failed`/`in_progress` cycles)
with zero real work landed across 13 prior invocations.

Given the title ("CRM & Sales Modules: Opportunities") and no other spec to
go on, audited the existing CRM/Sales module for a genuine open gap rather
than inventing busywork or re-doing already-shipped functionality (the
lead-to-opportunity pipeline, AI scoring/analysis, follow-up-task chaining,
and the Sales Pipeline dashboard/KPI widget are all already built and
working -- confirmed via `src/app/(app)/crm/page.tsx`,
`src/lib/services/crm-service.ts`, and recent git log).

**Real gap found:** `crm-accounts-service.ts` got a real owner-or-manager
RBAC gate in Wave 4 (2026-07-17: `canEditAccount`/
`canReassignOrDeleteAccount`/`canCreateCrmRecord`), but `crm_leads`/
`crm_opportunities` -- the sibling tables one wave earlier -- never did. Any
authenticated org member, including viewer/client_viewer/external_auditor
rank, could create/edit any lead or opportunity and could silently reassign
ownership via a plain `PATCH { ownerId }` with **zero** rank check at all,
through the native CRM UI's own `/api/crm/leads*` and
`/api/crm/opportunities*` routes (confirmed by reading those route files --
no RBAC call of any kind before this fix). The `v1/projexa/**` alias routes
were left untouched -- they already gate at "member"/"manager" role via
`requireRoleOrScope()` at the route layer (including API-key auth, which has
no `dbUser.role` to thread through a stricter owner-scoped gate without
risking breaking that integration), so they were not a zero-gate hole,
unlike the native CRM UI routes.

## Completed
- [x] Added `canEditLead`/`canReassignOrDeleteLead`/`canEditOpportunity`/
      `canReassignOrDeleteOpportunity`/`canCreateCrmRecord` pure RBAC gate
      functions to `src/lib/services/crm-service.ts`, same shape as
      `crm-accounts-service.ts`'s Wave 4 precedent (member rank to
      create/edit-own, manager rank to edit-any or reassign ownership).
- [x] `CrmContext` gained an optional `role?: string` field -- gates only
      fire when a caller passes it, so the many other call sites of
      `CrmContext` in this file (scoreLead, analyzeOpportunity, convert,
      follow-up-task chaining, the already-route-gated bulk-reassign
      functions, and all `v1/projexa/**` routes) are untouched/unaffected.
- [x] Wired the gates into `createLead`/`updateLead`/`createOpportunity`/
      `updateOpportunity` (update distinguishes an ownerId-reassignment PATCH
      from a regular field edit, same split as `updateAccount`).
- [x] Updated the 4 native CRM route files
      (`api/crm/leads/route.ts`, `api/crm/leads/[id]/route.ts`,
      `api/crm/opportunities/route.ts`, `api/crm/opportunities/[id]/route.ts`)
      to pass `role: dbUser.role` into the service calls.
- [x] Added `src/lib/services/crm-service.test.ts` (27 tests, pure/no-DB,
      same pattern as `crm-accounts-service.test.ts`) covering all 5 new gate
      functions across every role rank.
- [x] Verified: `bun test` on both crm test files -- 65 pass, 0 fail.
      `eslint` on all touched files -- clean, zero warnings/errors.
- [ ] Full-repo `tsc --noEmit` -- in progress in background (repo is large
      enough that it needs an increased Node heap and doesn't finish inside
      a single tool-call timeout window); will record the result here once
      it returns, before opening the PR.

## Remaining
- [ ] Confirm full-repo `tsc --noEmit` is clean.
- [ ] Commit + push branch, open PR, let CI run.
- [ ] Register/close this task's entry per `ai-os/boss/ACTIVE-CLAIMS.yaml`
      protocol.
