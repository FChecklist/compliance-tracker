# Reusable Utilities Index

VERIDIAN Review Framework gap-closure (AI Engineering Quality / Component
Reusability, Low): "No component/service registry documenting reuse
candidates." This is a short, honest pointer to the cross-cutting helpers
that are *already* the most-reused code in this repo, not a new abstraction
layer -- everything below already exists and is already in wide use; this
file just makes that discoverable in one place instead of by memory/grep.

Counts are real import-site counts as of this writing (`git grep -oh 'from
"@/lib/...'`/`"@/components/...'" | sort | uniq -c`), not estimates -- re-run
that grep if this file goes stale rather than trusting the numbers below
verbatim.

**When you need X, reuse the file below instead of writing a new one.**

## Auth & tenant isolation

| File | Import sites | What it's for |
|---|---|---|
| `src/lib/supabase/auth-guard.ts` | 834 | `requireAuth()`/`requireAuthOrApiKey()` -- every authenticated API route's entry point. Also the real `UserRole`/`ROLE_RANK`/`hasRole()`/`requireRole()`/`requireRoleOrScope()` primitives -- see "Design Pattern Consistency" below for the lint rule that now enforces `requireAuth()` usage. |
| `src/lib/db/tenant-scoped.ts` | 258 | `withTenantContext()` -- the only way a query should run scoped to an org's real Postgres RLS policy (`app_runtime` role, not the bypass-capable `postgres` role). |
| `src/lib/services/permission-service.ts` | 59 | `ERP_ACTION_ROLES` (single source of truth for "which role can do X") + `requirePermission()`/`requirePermissionForUser()`, wrapping `auth-guard.ts`'s primitives rather than inventing a second role system. New entries are additive-only -- see this repo's own CLAUDE.md/AGENTS.md for why. |

## Data access

| File | Import sites | What it's for |
|---|---|---|
| `src/lib/db` (barrel, re-exports `db/schema.ts` + `db/index.ts`) | 338 | The Drizzle client + every table/enum. Prefer this over importing `db/schema` directly (only ~10 files do, mostly scripts). |
| `src/lib/audit.ts` | 94 | `logActivity()` -- the single call site every route uses to write an audit/activity-log row inside the same `withTenantContext` transaction as the write it's logging (commit/rollback together). |

## AI / LLM orchestration

| File | Import sites | What it's for |
|---|---|---|
| `src/lib/llm-client.ts` | 32 | `callLLMJson()` -- the one place that actually calls a model. |
| `src/lib/orchestra-model-resolver.ts` | 26 | Model/tier resolution (`resolveModelConfig`, `escalatedPlatformConfig`) -- see AGENTS.md Rule 10 for the judgment-tier eligibility gate this feeds. |
| `src/lib/prompt-os-resolver.ts` | 21 | Prompt template resolution. |
| `src/lib/orchestra-execution-logger.ts` | 20 | `recordOrchestraExecution()` -- the execution audit trail for every AI dispatch. |
| `src/lib/purpose-bound-ai.ts` | 13 | `buildPurposeClause`/`isToolAllowedForDomain` -- the allowlist an LLM-driven plan is checked against before a tool actually runs. |
| `src/lib/policy-enforcement-engine.ts` | 13 | `enforcePolicy()`/`refusalMessageFor()` -- the Policy Enforcement Engine guardrail named in AGENTS.md Rule 9's manifest. |

## Dispatch (task/engine execution)

| File | What it's for |
|---|---|
| `src/lib/task-execution-engine.ts` | Task-execution orchestration: LLM planning, guardrails, memory, reflection, escalation. Re-exports `dispatchTool` from `tool-dispatch-service.ts` for backward compatibility. |
| `src/lib/services/tool-dispatch-service.ts` | `dispatchTool()` -- the small global read-only (+ a few narrowly-scoped write) agent allowlist. |
| `src/lib/services/engine-dispatch-service.ts` | `dispatchEngine()` -- the ~185-entry VCEL computation-engine allowlist switch (GST, Math, Costing, Payroll, Inventory, ...). |

(These three were consolidated out of a single 2,438-line file in this same
gap-closure pass -- see PROGRESS.md and git history for that change.)

## UI primitives (shadcn/ui, `src/components/ui/`)

Highest-reuse components, by real import count: `button` (162),
`card` (139), `input` (122), `badge` (115), `label` (93), `select` (76),
`dialog` (68), `skeleton` (38), `tabs` (27), `textarea` (21), `table` (14).
These are the standard shadcn/ui primitives -- reach for them before
building a bespoke equivalent; `src/components/SimpleModulePage.tsx`
(27 import sites) is the reusable shell most simple CRUD module pages are
built from.

## Formatting / misc

| File | Import sites | What it's for |
|---|---|---|
| `src/lib/utils.ts` | 79 | `cn()` -- Tailwind class-merging helper (`clsx` + `tailwind-merge`), used in nearly every component that takes a `className` prop. |

## Error handling (currently 2 distinct `ServiceError` classes -- known gap, not fixed here)

`src/lib/services/compliance-service.ts` and
`src/lib/services/workspace-memory-service.ts` each define their own
`ServiceError extends Error`. Neither is re-exported as a shared primitive
today. The Design Pattern Consistency lint rule added in this same
gap-closure pass (see `eslint.config.mjs`) checks that a *some* recognized
`ServiceError` (or `requireAuth()`) pattern is present in new
routes/services, not that a single canonical class is used everywhere --
consolidating the two into one shared `src/lib/service-error.ts` is a real,
separate follow-up, not done here to avoid touching every existing
`catch (e instanceof ServiceError)` call site as an unplanned drive-by in
this pass.
