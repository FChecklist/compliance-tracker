# Reusable Utilities Index

VERIDIAN Review Framework gap-closure, AI Engineering Quality / Code
Structure & Modularity ([Low] "Component Reusability" finding: *"No
component/service registry documenting reuse candidates"*). This is a
short, honest index of the cross-cutting helpers that are already the
most-reused in the codebase, pointed to by real import counts (`git grep
-c`, re-derive with the same commands below any time this drifts stale --
do not hand-maintain a count that can silently rot).

This is deliberately NOT a full catalog of all ~1,500+ modules under
`src/lib/` and `src/components/` -- see `ai-os/DATABASE_CATALOG.json` /
`ai-os/FUNCTION_CATALOG.json` for exhaustive machine-generated inventories.
This file is the opposite: a short, curated pointer to the handful of
helpers a new feature almost always needs, so a session building one more
API route or service doesn't reinvent auth, tenant scoping, or error
shaping from scratch.

## Backend / API-route layer

| Helper | Import count | What it's for |
|---|---|---|
| `requireAuth()` — `@/lib/supabase/auth-guard` | ~1,068 call sites | Mandatory on every API route per `AGENTS.md`/`CLAUDE.md` — resolves the authenticated Supabase user + org context or throws/redirects. Start every new route handler with this. |
| `ServiceError` — `@/lib/services/*-service.ts` (pattern, not one file) | ~3,736 references | The established typed-error shape services throw; routes catch it and translate to `NextResponse.json({ error }, { status })`. See `src/lib/services/compliance-service.ts` for the canonical definition + usage. |
| `withTenantContext()` / `TenantDb` — `@/lib/db/tenant-scoped` | ~1,760 references | Wraps a Drizzle query in the org-scoped tenant context (Postgres RLS-backed multi-tenant isolation). Any new DB read/write in a service should go through this, not a bare `db.query`. |
| `logActivity()` — `@/lib/audit` | ~266 call sites | Writes to the audit trail. Use for any user-initiated mutation that should be reconstructible later (compliance/audit requirement, not optional polish). |
| `detectHighImpactAction()` — `@/lib/high-impact-action-detector` | 13 call sites (deliberately narrow — high-impact-action confirmation gate, see `ai-os/CONSTITUTION.yaml` / AGENTS.md Rule 9) | Flags an action (bulk delete, financial posting, etc.) as needing explicit confirmation before executing. Extend this, don't build a parallel confirmation mechanism. |
| `evaluateGuardrails()` / `recordGuardrailViolation()` — `@/lib/guardrail-engine` | 7 direct call sites (mostly through `task-execution-engine.ts`) | The Policy Enforcement Engine's guardrail hook — see `scripts/check-guardrail-presence.mjs`'s manifest for what's currently wired and AGENTS.md Rule 9 before touching. |

## Frontend / UI layer

| Helper | Import count | What it's for |
|---|---|---|
| `cn()` — `@/lib/utils` | 81 files | The shadcn/Tailwind class-merge helper (`clsx` + `tailwind-merge`). Use instead of manual template-string class concatenation. |
| shadcn/ui primitives — `@/components/ui/*` | ~1,141 import sites across `.tsx` files | Button/Card/Table/Dialog/etc. — the design-system layer (Navy/Saffron/Teal/Cream tokens, DM Serif Display + Inter). New UI should compose these, not hand-roll equivalents. |
| `AppSidebar` / `AppTopbar` — `@/components/AppSidebar`, `@/components/AppTopbar` | app-shell only (one call site each, by design — see `src/app/(app)/layout.tsx`) | The authenticated-app chrome. Not a per-page reuse candidate, listed here so a new top-level nav item is added in the one right place instead of a page-local duplicate. |
| `search-command.tsx` — `@/components/search-command` | app-shell only | Cmd-K global search/nav palette. Extend its source list for a new searchable entity rather than building a page-local search box. |

## Engine dispatch layer (new, this gap-closure)

| Helper | What it's for |
|---|---|
| `src/lib/engine-handlers/*.ts` | Per-domain `dispatchXEngine()` handlers extracted out of `task-execution-engine.ts`'s `dispatchEngine()` (see that file's own header). New engine categories should land here as a new file + `Set` of engine keys, not as more inline cases in the monolith. |
| `src/lib/task-execution/*.ts` | Per-domain `dispatchXTool()` handlers extracted out of `task-execution-engine.ts`'s sibling `dispatchTool()` (same finding, different function — see that file's own header for why `dispatchEngine()` above and `dispatchTool()` here were split by two different rebases of the same gap-closure task without colliding). New structured-dispatch tool codes for compliance/GST/construction should land here, not as more inline cases in the monolith. |

## AI / LLM layer

| Helper | Import count | What it's for |
|---|---|---|
| `callLLMJson()` / `estimateCostUsd()` / `MODEL_PRICING` — `@/lib/llm-client` | ~43 files import from it, 5 direct `callLLMJson(` call sites | The single provider-dispatch + cost-accounting chokepoint for every LLM call in the app (Anthropic/Groq/Cerebras/OpenRouter). Don't hand-roll a fetch to a model provider; go through this. |

## How the counts above were produced

```sh
git grep -c "requireAuth(" -- '*.ts' | awk -F: '{s+=$2} END{print s+0}'
git grep -c "ServiceError" -- '*.ts' | awk -F: '{s+=$2} END{print s+0}'
git grep -c "withTenantContext" -- '*.ts' | awk -F: '{s+=$2} END{print s+0}'
git grep -c "logActivity(" -- '*.ts' | awk -F: '{s+=$2} END{print s+0}'
git grep -c 'from "@/lib/utils"' -- '*.tsx' '*.ts' | awk -F: '{s+=$2} END{print s+0}'
git grep -c 'from "@/components/ui/' -- '*.tsx' | awk -F: '{s+=$2} END{print s+0}'
```

Re-run these before trusting a stale number here — this file is a curated
pointer, not a live dashboard.
