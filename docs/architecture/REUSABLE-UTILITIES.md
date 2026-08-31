# Reusable Utilities Index

VERIDIAN Review Framework gap-closure ([Low] Component Reusability, AI
Engineering Quality / Code Structure & Modularity): "No component/service
registry documenting reuse candidates." This is that registry -- a short
index of the cross-cutting helpers that are already reused widely across
`src/`, so a new route/service reaches for the existing one instead of
re-implementing it.

Usage counts below are real, generated via `git grep -c` / `git grep -l`
against the current tree at the time this doc was written (2026-08-15) --
re-run the commands yourself if this doc is old and you don't trust the
numbers; don't trust them blindly forever. This is a **pointer to what
already exists**, not a new abstraction layer -- every helper listed here
already existed before this doc did.

## Auth & authorization

| Helper | File | Real usage |
|---|---|---|
| `requireAuth()` | `src/lib/supabase/auth-guard.ts` | ~941 files import from `auth-guard.ts`; ~981 files reference `requireAuth` -- the standard first line of every authenticated API route (`AGENTS.md`/`CLAUDE.md` both mandate it). |
| `ServiceError` | `src/lib/services/compliance-service.ts` (the pattern's origin) | ~945 files reference `ServiceError` -- the standard shape every service throws and every route's `catch` block translates to a `NextResponse.json({ error }, { status })`. See `scripts/check-route-error-handling.mjs` for the CI check that keeps new routes honoring this, and `scripts/check-route-requireauth.mjs` (added alongside this doc) for the `requireAuth()` equivalent. |
| `permission-service.ts` (`ERP_ACTION_ROLES`, role-check helpers) | `src/lib/services/permission-service.ts` | ~61 files import it. Shared, sensitive table -- additive-only changes (new keys), never restructure existing entries without explicit owner sign-off (multiple in-flight tasks depend on this contract; see `ai-os/boss/ACTIVE-CLAIMS.yaml`). |

## Data layer

| Helper | File | Real usage |
|---|---|---|
| `withTenantContext()` / `TenantDb` | `src/lib/db/tenant-scoped.ts` | ~292 files import from it -- the RLS-safe, org-scoped DB handle every service/route that touches tenant data is expected to use instead of the raw `db` client. |
| `logActivity()` | `src/lib/audit.ts` | ~102 files import from it -- the standard audit-log writer for create/update/delete/status-change actions (feeds the real `audit_logs` compliance tables, distinct from the newer operational `logger.ts` below). |

## AI / Orchestra layer

| Helper | File | Real usage |
|---|---|---|
| `callLLMJson()` / `estimateCostUsd()` / `MODEL_PRICING` | `src/lib/llm-client.ts` | ~39 files import from it -- the single provider-dispatch + cost-accounting chokepoint for every LLM call in the app (Anthropic/Groq/Cerebras/OpenRouter). Don't hand-roll a fetch to a model provider; go through this. |
| `evaluateGuardrails()` / `recordGuardrailViolation()` | `src/lib/guardrail-engine.ts` | ~7 files import from it directly (most guardrail coverage is registered once via `registerAllGuardrails()` in `guardrail-registrations.ts` and then evaluated centrally, not called ad hoc per site) -- see `scripts/check-guardrail-presence.mjs` for the CI check protecting this. |

## Operational logging

| Helper | File | Real usage |
|---|---|---|
| `logger` (structured, correlation-ID aware) | `src/lib/logger.ts` | New (2026-08-15, task-20260718-065003's "Logging Quality" gap-closure, PR #1219) -- ~4 files so far. Listed here specifically because it's new and easy to miss / duplicate: this is the intended home for structured *operational* logging (distinct from `audit.ts`'s compliance audit trail above). |

## What's deliberately not listed here

UI components (`DataTable`, `StatusBadge`, `DashboardCard`, etc., named in
`CLAUDE.md`'s component list) were checked for real reuse density before
listing and came back low (`src/components/ui/data-table.tsx`: 3 real
call-sites) -- not yet reuse candidates worth indexing. Re-check if that
changes.

## Maintenance

This list is not meant to be exhaustive or auto-generated -- add an entry
when a helper crosses roughly the same order of magnitude of real reuse as
the ones above (tens of call sites, not one or two), with a real usage
count, not a guess.
