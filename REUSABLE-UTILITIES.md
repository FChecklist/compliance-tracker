# Reusable Utilities Index

VERIDIAN Review Framework gap-closure (2026-08-01, Component Reusability): a
short, deliberately non-exhaustive pointer to this codebase's most-reused
cross-cutting helpers and components, so a new feature reaches for one of
these instead of re-implementing the same primitive. Every "used in N files"
count below is real, measured against the current tree (2,004 `.ts`/`.tsx`
source files under `src/`), not estimated -- re-count with a grep/import
scan before trusting an old number here, this file will drift as the
codebase grows and is not itself CI-enforced.

Entries below ~5 real call sites were deliberately excluded -- not yet an
established reuse candidate, however reusable the API looks on paper (see
the Honorable Mentions note at the bottom).

## Core cross-cutting `src/lib/` helpers

| Helper | Purpose | Used in |
|---|---|---|
| `src/lib/db.ts` | Main Drizzle Postgres client entry point (re-exports `db/index.ts` + `db/schema.ts`) | 356 files |
| `src/lib/supabase/auth-guard.ts` | `requireAuth()` session guard, API-key auth, invite/join-code auto-provisioning -- see `AGENTS.md`'s "All API routes MUST call requireAuth()" rule | 934 files |
| `src/lib/db/tenant-scoped.ts` | RLS-safe tenant-scoped db wrapper (`withTenantContext`, `app_runtime` role) | 305 files |
| `src/lib/audit.ts` | `logActivity()` -- the single call-site for writing audit/activity log rows | 105 files |
| `src/lib/utils.ts` | `cn()` -- clsx + tailwind-merge className helper | 81 files |
| `src/lib/llm-client.ts` | Provider-agnostic LLM client (Groq/OpenAI/Anthropic/Google/OpenRouter) with token/cost tracking | 39 files |
| `src/lib/orchestra-model-resolver.ts` | Resolves which LLM/model config applies per org/Orchestra Layer | 29 files |
| `src/lib/orchestra-execution-logger.ts` | Shared fire-and-forget AI-call observability logger | 23 files |
| `src/lib/prompt-os-resolver.ts` | Resolves versioned/labeled system-prompt templates instead of hardcoded prompt strings | 21 files |
| `src/lib/purpose-bound-ai.ts` | Enforces per-assistant business-purpose/tool/domain allowlist | 17 files |
| `src/lib/policy-enforcement-engine.ts` | Deterministic policy + prompt-injection/jailbreak gate | 16 files |

## Shared UI components (`src/components/`)

| Component | Used in |
|---|---|
| `src/components/ui/button.tsx` | 187 files |
| `src/components/ui/card.tsx` | 167 files |
| `src/components/ui/input.tsx` | 146 files |
| `src/components/ui/badge.tsx` | 141 files |
| `src/components/ui/label.tsx` | 113 files |
| `src/components/ui/dialog.tsx` | 87 files |
| `src/components/ui/skeleton.tsx` | 40 files |
| `src/components/SimpleModulePage.tsx` -- generic list/create/edit CRUD page chrome | 27 files |
| `src/components/ProjectPicker.tsx` -- shared "pick a project / empty state" selector (site-diary, RFIs, submittals, punch-list, labour, expenses) | 11 files |

## Other cross-domain service helpers

Reused across genuinely unrelated feature areas (CRM, ERP, Firm, PMS,
compliance), not just within one module:

| Helper | Purpose | Used in |
|---|---|---|
| `src/lib/currency-format.ts` | Shared org-base-currency display formatter (CRM opportunity value, Firm engagement billing, KPI Hub revenue stats, PMS budgets/resource rates) | 12 files |
| `src/lib/embeddings.ts` | Vector-embeddings read/write helper (raw SQL -- Drizzle has no vector type) backing asset/vector search | 10 files |
| `src/lib/activity-log-service.ts` | Universal activity-envelope write path (mirrors `audit.ts`'s posture) | 9 files |
| `src/lib/webhook-deliver.ts` | Shared outbound webhook delivery/signing (ERP sales invoices, payroll, procurement, journal entries, compliance recur) | 8 files |
| `src/lib/org-license-service.ts` | Org per-seat license assign/revoke/active-user enforcement | 7 files |

## Honorable mentions (reusable by design, not yet widely reused)

`src/components/ui/status-badge.tsx` and `src/components/ui/data-table.tsx`
both exist as clean, generic components (`StatusBadge`, `DataTable`) but are
currently wired into only 2-3 pages -- genuine reuse candidates for any new
list/status-driven screen, called out here specifically so they get reached
for instead of a page rolling its own status-pill or table markup again.

## Maintaining this file

This is a periodic index, not a CI-enforced registry (unlike
`ai-os/registry/asset-registry-coverage.yaml`) -- there is no automated
check keeping it in sync with the codebase. Refresh the counts and add new
entries when they clear the ~5-call-site bar; there is no obligation to
keep every number exact between refreshes.
