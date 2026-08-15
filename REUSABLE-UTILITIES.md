# Reusable utilities & services -- index

VERIDIAN Review Framework gap-closure (AI Engineering Quality / Component
Reusability, 2026-08-15): a short, grep-derived index of the most-reused
cross-cutting helpers under `src/lib/`, so a new feature reaches for one of
these instead of re-implementing the same primitive. Ranked by real distinct-
importer count (`git grep` across `src/`, counted 2026-08-15 -- re-derive
rather than trust blindly if a lot of time has passed, same caveat as
`ai-os/STATUS-REPORT.md`).

Deliberately excludes single-domain service files (e.g. `erp-payroll-
service.ts`, `crm-service.ts`) even when their own importer count is
non-trivial -- those counts reflect fan-out from one domain's own routes,
not genuine reuse across unrelated domains. This index is for infrastructure
every feature area reaches for, not domain business logic.

| Utility | Distinct importers | Use it for |
|---|---|---|
| `src/lib/supabase/auth-guard.ts` | 951 | Every API route's auth gate -- `requireAuth()`, `requireAuthOrApiKey()`, `UserRole`/`ROLE_RANK`, `hasRole()`/`requireRole()`/`requireRoleOrScope()`. Required by `CLAUDE.md`'s own rule on every API route. |
| `ServiceError` (`src/lib/services/compliance-service.ts`, re-exported by ~50 domain services) | 916 | The one real business-vs-system exception type in this codebase (retryable flag, error-catalog-linked friendly message). Throw this, not a bare `Error`, from any service a route needs to map to the right HTTP status. |
| `src/lib/db.ts` | 371 | Barrel re-export of the Drizzle `db` client + full schema -- the normal way to reach the DB layer (`import { db, users, ... } from "@/lib/db"`), not `db/index`/`db/schema` directly. |
| `src/lib/db/tenant-scoped.ts` | 305 | `withTenantContext`/`TenantDb` -- the required transaction boundary for any multi-tenant write (real RLS-backed isolation via a dedicated `app_runtime` connection). Every write path must go through this, not a bare `db` call. |
| `src/lib/audit.ts` | 112 | `logActivity()` -- the single shared call site for `auditLogs` rows. Must run inside the same `withTenantContext` transaction as the write it's logging. |
| `src/lib/utils.ts` | 81 | `cn()` -- clsx + tailwind-merge className helper for every UI component. |
| `src/lib/services/permission-service.ts` | 59 | Action-level RBAC on top of auth-guard's role check (`ERP_ACTION_ROLES` etc.) -- closes the "role membership checked, specific action not" gap. See that file's own header before editing its shared table -- add new keys only, additive. |
| `src/lib/llm-client.ts` | 41 | `callLLM`/`callLLMJson` -- the provider-agnostic LLM client (Groq/OpenAI/Anthropic/Google/OpenRouter) with unified token-usage/cost reporting. Never call a provider SDK directly from a route/service. |
| `src/lib/orchestra-model-resolver.ts` | 31 | Resolves which provider/model/API key a given Orchestra layer or customer config should use, including BYOK key decryption and cost-guardrail checks. |
| `src/lib/orchestra-execution-logger.ts` | 23 | `recordOrchestraExecution()` -- fire-and-forget AI-observability logging every real LLM call site uses. |
| `src/lib/prompt-os-resolver.ts` | 22 | Resolves versioned/labeled prompt templates + the shared VERI persona directive, instead of a hardcoded system-prompt string. |
| `src/lib/purpose-bound-ai.ts` | 16 | Hard, server-enforced tool/domain allowlist restricting an AI surface to its assigned business purpose. |
| `src/lib/policy-enforcement-engine.ts` | 16 | `enforcePolicy()` -- deterministic pre-call gate (purpose scoping + prompt-injection/jailbreak resistance) every LLM call site should run through. |
| `src/lib/currency-format.ts` | 13 | Shared org-base-currency display helper (real currency from `erp_currencies`) for any non-statutory monetary amount -- not a hardcoded ₹/locale format. |
| `src/lib/escalation-ladder.ts` | 11 | Deterministic executive escalation ladder (CSEO -> CEE -> COO/etc.) for AI-reachable failure routing. |
| `src/lib/embeddings.ts` | 11 | Raw-SQL pgvector client for embedding reads/writes (Drizzle itself has no vector-type support). |
| `src/lib/activity-log-service.ts` | 10 | Universal activity-envelope write path, same fire-and-forget posture as the orchestra execution logger. |
| `src/lib/audit-event-triggers.ts` | 9 | Wires automatic audit triggers off named lifecycle events (Code Changed, Feature Completed, SOP Changed, etc.). |
| `src/lib/api-keys.ts` | 9 | Shared API-key hashing/generation (`hashSHA256` etc.) so key-minting and key-validation never drift apart. |
| `src/lib/webhook-deliver.ts` | 8 | Looks up an org's active webhooks and delivers a signed event payload. |

Also see `src/app/api/README.md` for the API surface's own navigation aid,
and `ai-os/OS.yaml` for the equivalent index over `ai-os/`'s governance
docs.
