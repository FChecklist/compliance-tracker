# VERIDIAN AI OS — Critical Gaps (running punch list)

Flat, severity-sorted list synthesized from [`AUDIT_2026-07-09.md`](AUDIT_2026-07-09.md) plus everything already surfaced this session before the formal audit. This is the list to actually act on — see the audit doc for full context/evidence per item. Updated 2026-07-09.

**Execution status:** autonomous gap-closure in progress per Boss instruction (2026-07-09) — closable items are being fixed one by one, documented in [`GAP_CLOSURE_LOG.md`](GAP_CLOSURE_LOG.md) as each closes. Items marked ✅ below are done. Items needing a product/architecture decision are explicitly left open and flagged in the final status report rather than guessed at.

**Legend:** 🔵 = verified live against production (Supabase MCP or direct HTTP). 🟡 = verified by direct code reading. Effort: S = hours, M = days, L = weeks+.

---

## 🔴 CRITICAL

| # | Finding | Evidence | Fix effort | AI-automatable |
|---|---|---|---|---|
| 1 | **Worker agent execution engine doesn't execute worker agents** — outside ~20 hardcoded branches, an approved/published agent is only ever planned against, never invoked. Self-documented in code comments and `/orchestra` UI copy. | 🟡 `task-execution-engine.ts` inline comment | L (3-4 weeks) | Partial |
| 2 | **The Firm practice module never applies per-client access scoping** — ~25 routes never pass `clientIds` into `withTenantContext`; a staffer restricted to one client can read another client's full data through this module today. Root cause of the CA evaluator's 5.5/10 rating. | 🟡 grep confirmed 0 of ~25 routes pass `clientIds` | M (3-5 days) | Partial |
| 3 | ✅ **CLOSED** ~~MCP write tool `create_compliance_item` has no cross-tenant FK validation~~ — externally reachable by any write-scoped API key holder; `department_id`/`assigned_to_id` accepted with no org check. | 🟡 `api/mcp/route.ts` ~line 423-440 | S (1-2 hrs) | Yes |
| 4 | ✅ **CLOSED (claim only — real integration still open, see roadmap)** ~~No payment processor exists, and the pricing page falsely claims Razorpay processing.~~ | 🟡 full-repo grep, zero payment code | S (claim) / L (real integration) | Partial |

---

## 🟠 HIGH

| # | Finding | Evidence | Fix effort | AI-automatable |
|---|---|---|---|---|
| 5 | Policy Enforcement Engine covers only 3 of 13 real LLM call sites — gap has *widened* since the last check (7+ new surfaces shipped unwired). | 🟡 grep of `enforcePolicy(` call sites | M (1-2 days) | Yes |
| 6 | Foreign-key integrity ~99% unenforced at DB level — 11 of 972 FK-shaped columns have a real constraint. General ledger, invoices, payroll-tax categories included. | 🟡 parsed `schema.ts`, all 356 tables | L (multi-wave) | Partial |
| 7 | Zero explicit indexes in `schema.ts`; 🔵 203 unindexed FKs across 136 tables confirmed live, including 58 ERP indexes never once hit by a query. | 🔵 `get_advisors(performance)` | M | Yes |
| 8 | ✅ **CLOSED** ~~Capability Registry embeddings confirmed stale right now — 13/27 worker agents, 38/99 modules missing embeddings~~ — reconciliation loop added, wired into the daily cron; one-time catch-up run against production still needs triggering post-deploy. | 🔵 live query | S (2-4 hrs) | Yes |
| 9 | ✅ **CLOSED** ~~`MODEL_PRICING` missing all 3 of the AI Dev Team's GLM models~~ (`z-ai/glm-5.2`, `z-ai/glm-5v-turbo`, `z-ai/glm-5-turbo`). | 🟡 verified via direct grep, zero matches in `MODEL_PRICING` | S (15 min) | Yes |
| 10 | PROJEXA's fully-built backend (55 routes, AI features) has zero consuming UI. | 🟡 no `(app)/construction` or `/projexa` directory | M-L | Partial |
| 11 | PROJEXA expenses/labour costs never post to the General Ledger — Finance and Construction report different numbers for the same project. | 🟡 `construction-expense-service.ts` header comment | M | Partial |
| 12 | Live financial report aggregation has an unaddressed performance cliff — no index on `erp_journal_entries(status, posting_date)` despite universal filtering on exactly that; unbounded "from inception" scans; a confirmed N+1 in vendor scorecards. | 🟡 read `erp-financial-report-service.ts` + migrations | S (index) / L (snapshot design) | Mixed |
| 13 | No APM/error tracking anywhere — 527 files of `console.error` vanish into ephemeral Vercel logs with no alerting. | 🟡 `package.json` dependency scan | M (1-2 days) | Yes |
| 14 | No generalized "secrets present" deploy check — the CRON_SECRET/GROQ_API_KEY silent-failure class remains fully possible for any other secret. | 🟡 no such script found | S (half day) | Yes |
| 15 | CI and Vercel auto-deploy are unlinked — a red CI run doesn't block or revert a same-commit production deploy; full-access agents can push directly to `main`. | 🟡 `ci.yml` trigger analysis | S | Yes |
| 16 | Two full-access AI agents can run migrations directly against a 460+-table production DB with no confirmed rollback mechanism (no down-migrations, Supabase branching unavailable, PITR status unconfirmed). | 🟡 `AGENTS.md` + no down-migration files | S (PITR check) / process | Partial |
| 17 | Zero E2E/integration test coverage — Playwright wired but intentionally empty, self-disclosed. | 🟡 `playwright.config.ts` | M (2-4 days for smoke suite) | Partial |
| 18 | No data export/portability endpoint anywhere — real GDPR/DPDP procurement blocker. | 🟡 full-repo grep | M (1-2 weeks for first cut) | Yes |
| 19 | Broader multi-client UX is shallow — no client detail page, no client-context switcher anywhere in the product, most of ~460 tables have no client-scoping dimension. (Distinct from #2, which is the access-control bug specifically.) | 🟡 read `/clients/page.tsx` + component grep | L (multi-week, needs product decision) | No (decision) / Partial (execution) |

---

## 🟡 MEDIUM (selected — see AUDIT_2026-07-09.md for the complete set)

- ✅ **CLOSED** ~~Middleware route allowlist drifted a **4th time** (4 more unprotected pages)~~ — now generated from the real directory listing (`scripts/generate-protected-routes.mjs`, wired into predev/prebuild) instead of hand-maintained; this bug class cannot recur. (S, Yes)
- 🔵 Migration files aren't a trustworthy record of live security state — 3 critical tables have live RLS with zero corresponding migration. (M, Partial)
- ✅ **CLOSED** ~~🔵 `FORCE ROW LEVEL SECURITY` enabled on 0 of 357 tables~~ — now 357/357, verified live. (S, Yes)
- No role-change or emergency deactivation API/UI for users. (S, Yes)
- VCEL: only 15 of ~247 registered engine functions (1 of 25 files) wired into dispatch. (M per file, Partial)
- `CLAUDE.md` claims shared `DataTable`/`StatusBadge`/`DashboardCard` components that don't exist; 21+ pages hand-roll status maps. (M, Yes)
- Zod schemas are OpenAPI-documentation-only, not runtime validation. (S-M, Yes)
- `/api/v1/openapi.json` covers a minority of real domains (~45-50 of ~90). (L cumulative, Yes)
- Two independent hand-maintained tool-dispatch surfaces (MCP vs. internal engine) with no shared registry. (M, Yes)
- ✅ **CLOSED** ~~16 of 597 route handlers silently downgrade `ServiceError` status codes to generic 500~~ — all 16 fixed, repo-wide sweep re-confirms zero remaining. (S, Yes)
- Unit test coverage narrow (3 files); zero coverage of ERP/financial-math logic. (M, Yes)
- No automated regression test for RLS cross-tenant isolation (each wave's proof is manual, one-time). (M, Yes)
- Knowledge Base search has no semantic/RAG layer — plain ILIKE. (M, Yes)
- ✅ **CLOSED** ~~LLM response cache fully built, zero callers~~ — wired into VERI FDE via a new `callLLMJsonCached()`, plus the purge cron. (S, Partial)
- ✅ **CLOSED** ~~Chat history token growth bounded by message count, not content size~~ — added a 12K-char aggregate budget with oldest-first trim. (S, Yes)
- `orchestra_changes.md` is 60+ waves stale (last entry: Wave 71, 2026-07-05) — no current single source of truth for "what got built when." (M for regeneration, Yes)
- ✅ **CLOSED** ~~`product_branches` catalog confirmed stale live (Construction shown as `planned` despite being substantially shipped)~~ — corrected to `building` (matching FM's already-accurate status; both honestly lack an internal management UI still). (S data / process, Yes/Partial)
- 🟡 **PARTIALLY CLOSED** Systemic 203-unindexed-FK backlog across 136 tables — the 4 confirmed *duplicate* indexes are dropped and the single highest-leverage missing index (`erp_journal_entries`) is added; the remaining ~150+ FK-index backlog across the other tables is still open (large, multi-batch effort, correctly left for the roadmap). (M, Yes)
- ✅ **CLOSED** ~~🔵 Orphaned live table `firm_client_portal_links`~~ — investigated (0 rows, 0 code references), dropped. (S investigation, Partial)
- ✅ **CLOSED** ~~One migration numbering collision (`0101` used twice)~~ — renamed to `0114`. (S, Yes)
- ~7 undocumented denormalized total columns on ERP documents (grandTotal/totalAmount/outstandingAmount). (S, Yes)
- Confirmed redundant table pairs: `contactSubmissions`/`forgeProjectRequests`, and `pmsTimeEntries`+`pmsBillableRates`/`firmTimeEntries`+`firmBillableRates`. (S-M, Yes)
- No rate limiting on session-authenticated routes or 18 AI-backed routes. (M, Yes)
- ✅ **CLOSED** ~~Payroll: `percentage_of_gross` earning component silently computes as zero; PT-slab lookup silently falls back to highest slab on misconfiguration~~ — real two-pass gross calculation implemented; PT now surfaces "enter manually" instead of guessing a rate. (S each, Yes)
- ✅ **CLOSED** ~~`DOMAIN_ALLOWED_TOOLS` for the `compliance` domain (3 tools) is narrower than `dispatchTool()`'s actual read-only implementation (13+ tools), and construction/PROJEXA isn't a key in the map at all~~ — added the 5 missing read-only compliance/GST tools to the `compliance` entry and a new `construction` entry with all 7 read-only PROJEXA tools; write actions (`update_compliance_status` etc.) deliberately left off, per the allowlist's own structured-dispatch-only design for writes. (S, Yes)
- No customer-facing status page/uptime history. (M, Yes)
- ✅ **CLOSED** ~~`findSimilarCapabilities`/`findSimilarPromptPatterns` have no relevance floor~~ — added the same 0.5 threshold `assistant-memory-service.ts` already uses. (Trivial, Yes)
- ✅ **CLOSED** ~~`analyzeFunnelWithAI`'s system prompt is hardcoded inline instead of using the Prompt OS~~ — migrated to `sales_ai.funnel_analysis`, seeded live via migration `0120_wave138_...sql`. (S, Yes)
- ✅ **CLOSED** ~~`ServiceError` is independently redefined in two places (`compliance-service.ts` and `sales-engine-service.ts`)~~ — `sales-engine-service.ts` now re-exports the canonical class instead of defining its own. (S, Yes)

---

## 🟢 Confirmed FIXED — do not re-flag

- `SET LOCAL app.current_org_id = $1` bind-parameter bug (fixed Wave 7)
- Original ~20-route IDOR/"first org in DB" fallback sweep (fixed Wave 1)
- Two originally-unauthenticated endpoints, `documents/extract` and `search/semantic` (fixed Wave 1)
- `CRON_SECRET` empty in production, silently disabling all cron jobs (fixed, found via `TEST_LOG.md`)
- Supavisor pooler wrong-region bug, the real root cause of "BUG-002" (fixed Wave 45/103 — though one dormant copy remains, see Critical-Gaps list above under performance findings)
- Pricing comparison page incompleteness (confirmed fixed this session's audit)
- Hardcoded org-name display bug (confirmed fixed this session's audit)
- Landed cost allocation (confirmed built, Wave 85 — only barcode/QR remains open from that original deferral)
- `ignoreBuildErrors`/`ignoreDuringBuilds` in `next.config.ts` (confirmed absent, hasn't crept back)

---

## Positive findings worth preserving (don't let future audits re-litigate these)

- Multi-tenant RLS isolation is the single strongest-verified guarantee in the system — independently re-proven with live switched-role tests across dozens of waves.
- Module-reuse discipline across ERP/PMS/PROJEXA has genuinely held — near-byte-identical scaffolding despite no shared generator.
- Lint/type-suppression debt is minimal (zero `@ts-ignore`, zero TODO/FIXME anywhere).
- API error-handling convention (`ServiceError`) is 97.3% consistently applied across 573 routes.
- Prompt-construction structure is already cache-friendly (stable prefix, variable suffix) — just missing the provider-specific caching directive.
- Memory write-then-read loop is genuinely closed and bidirectional, not just scaffolded.
- HNSW indexing is complete across every real vector column.
- A real 6-workflow CI pipeline exists, including a genuinely well-designed sandboxed AI-agent-to-PR pipeline with a documented, fixed shell-injection vulnerability.
- VERI Reward has a complete, polished UI, not backend-only.
- The 3-4 chat surfaces are a deliberately-scoped, well-managed architecture, not organic duplication.
