# VERIDIAN AI OS — Consolidated Architecture Reference

Merges four previously-separate governance documents — `MASTER_AI_OS_ARCHITECTURE.md`, `VERIDIAN_AI_CONSTITUTION.md`, `VAIOS_ARCHITECTURE_STRATEGY.md`, `MCP_PROTOCOL.md` — into one navigable reference, plus this session's own structural findings. The four source documents are **not superseded**; they're the primary sources, evidence-graded (`[ENFORCED]`/`[POLICY ONLY]`/`[NOT APPLICABLE YET]` against real file:line citations) to a standard worth preserving. This doc is the map that ties them together and corrects two claims that have gone stale since they were written.

---

## 1. What VERIDIAN AI OS is, structurally

One tenant, one identity, one AI Orchestra, one knowledge graph (still aspirational — see §5). Distinct branded products ("VERI OFFICE AI OS," "VERI GRC AI," future verticals) are **product branches**, not separate applications — an org enables/disables/combines them on top of the same tenancy, AI resolution, and data model. This is enforced by `productBranches` (global catalog, migration-only writes) × `orgProductBranchEnablements` (per-org on/off, default `false` except for a small set of always-on core modules).

**19 named verticals are registered in the catalog** (`MASTER_AI_OS_ARCHITECTURE.md` §10, as of Wave 106), classified by real build effort, not treated as a flat list:

| Tier | Meaning | Members |
|---|---|---|
| `repackage` | Already fully built; work is a catalog row + module linkage + nav | `office`, `procurement`, `cs_firm`, `hr`, `sales`, plus `grc`/`erp`/`pms` (already `status='live'`) |
| `moderate_build` | Real new schema on strong existing primitives (multi-entity, multi-currency, warehouses, HSN-SAC, e-invoicing, client hierarchy, CLM, webhooks) | `law_firm`, `distribution`, `export_import`, `pharma_distribution`, `franchise` |
| `ground_up` | Little to no schema overlap; genuinely new core domain | `ecommerce`, `manufacturing`, `construction` (**PROJEXA — see below, this one shipped since**), `logistics`, `facilities_management` (**also shipped since — see correction below**), `healthcare`, `school`, `hotel`, `restaurant` |

**⚠️ Two corrections to the catalog's own Wave-106 snapshot, found this session:**
1. **Construction (`ground_up`, "not yet started" as of Wave 106) has since shipped as PROJEXA** — 15 real tables, 10 real services, ~55 real API routes, actively developed through the 120s-130s wave range. The catalog's `build_tier`/`status` columns should be re-verified against live data rather than trusted from this document's prose.
2. **Facilities Management (`ground_up`, explicitly stated "NOT built... zero matches for facilities|security_guard|fm_asset" as of Wave 106) has also since shipped** — real `fmAssets`/`fmPpmSchedules`/`fmChecklistTemplates`/`fmAmcContracts`/`fmVisitors` tables and 8 real `fm-*-service.ts` files exist today (confirmed via direct grep this session), plus a live public `/veri-fm-cs` marketing page. This matches a separate memory record ("FM Project... local-only build until approved to migrate") — it was likely built in a parallel track and merged in after this document's Wave-106 snapshot. **Lesson: `product_branches.status`/`build_tier` in the live database is the current source of truth, not this document's prose — query it directly before citing build status.**

## 2. Four architectural rules (`MASTER_AI_OS_ARCHITECTURE.md`)

1. **Branch-key naming** `[ENFORCED via unique constraint]` — lowercase snake_case, internal name not marketing name.
2. **Module reuse, never duplication** `[ENFORCED via many-to-many `productBranchModules`]` — one `moduleKey` can serve N branches; worked example: `procurement` (Wave 106) reuses ERP's existing RFQ/PO/Vendor-Master/GRN modules with zero new tables.
3. **RLS is mandatory** `[ENFORCED by discipline, no CI check yet]` — every new org-scoped table ships both `app_runtime_org_scoped` and `service_role_bypass_<table>` policies in the *same migration* as the table. Verbatim template in the source doc. **Open gap: no automated CI check** — `get_advisors` after every migration is the current catch mechanism, which is manual-trigger, not automatic.
4. **`layerKey` namespacing** `[POLICY, lint-enforced via `assertValidLayerKey()`]` — new orchestra layers named `{branchKey}_{agent}_oa`.
5. **Purpose-Bound-AI domain-per-vertical** `[ENFORCED]` — every branch shipping an AI tool surface adds its key to `DOMAIN_ALLOWED_TOOLS` on day one, even if empty. A live AI feature with no entry is a shipping bug (denies by default).
6. **License discipline** `[POLICY]` — study OSS architecture/features, never copy AGPL/BUSL/SSPL code into the proprietary codebase. Every vertical's research pass produces a per-repo license table before code is written (see §4 below for the pattern in practice).

Full detail, worked examples, and the exact RLS SQL template: `MASTER_AI_OS_ARCHITECTURE.md`.

## 3. The AI Orchestra Engine

**5 layers, seeded since Wave 4** (`orchestraLayers`): `task_oa` (per-task planning), `user_assistant_oa` (per-user), `customer_account_oa` (account-level), `global_intelligence_oa` (cross-customer anonymized), `meta_oa` (self-observing).

**Status, reconciled across sources** (this is the one place `PLATFORM_STRATEGY.md` §5 has visibly drifted — it says "only `task_oa` is active," written before later waves):
- `task_oa` — active since Wave 4, the only layer with call sites in `PLATFORM_STRATEGY.md`'s own original telling
- `user_assistant_oa` — gained a real call site in Wave 12 (VERI Chat's `generateAiReply()`)
- `meta_oa` — gained a real call site in Wave 18 (`loop-engineering-audit.ts`'s synthesis call, via the Shared AI Resource Pool)
- `customer_account_oa`, `global_intelligence_oa` — **confirmed still dormant** (`WAVE_111_MULTI_COMPANY_AI_OS_TEST_REPORT.md` explicitly re-checked and confirmed `global_intelligence_oa` has zero call sites as of Wave 111)

**Model resolution** (`orchestra-model-resolver.ts`): most-specific-scope-wins — personal → client → org → platform default. 5 providers unified behind `llm-client.ts`'s `callLLM`/`callLLMJson`/`callLLMVision` (Groq, OpenAI, Anthropic, Google, OpenRouter — added Wave 45). **Law: every layer is model-agnostic by construction** — this is what makes BYOB (bring-your-own-brain) commercially real, not aspirational.

**Shared AI Resource Pool** (Wave 18) — org-to-**platform** lending only, never org-to-org, explicit per-org opt-in required on the lending side (`shared_pool_eligible`), audited via `shared_pool_allocations` (service-role-only visibility).

## 4. Worker Agents & VCEL

**Worker Agents** — 4 tiers (global/customer/client/user), a real `lifecycleStatus` state machine (draft→proposed→approved→published→retired), RLS-enforced so only migrations/`service_role` can ever write `tier='global'` rows (confirmed live: only 9 pre-seeded global agents exist, zero customer-created, per the AI OS Certification pass). Dispatch: `DISPATCHABLE_TOOLS` allowlist in `task-execution-engine.ts`, read-only tools only — write actions are recorded as plan steps but never auto-invoked without a human.

**VCEL (computation engines)** — 25 files in `src/lib/engines/`, tracked in a `computationEngines` registry table (`status`: implemented/partial/not_started). Dispatch is a deliberately small, explicit `switch` (`dispatchEngine()`), never a generic resolver that dynamic-imports `implementationRef` — that would be a real code-execution injection surface. ~15 of 25 engines (GST-focused) are wired into real dispatch as of this session's Wave 131; the rest have real logic but zero callers.

## 5. MCP Integration (`MCP_PROTOCOL.md`)

**Corrected 2026-07-15** (`ai-os/CONSTITUTION.yaml` DEBT-02 — this section previously described a two-server architecture as both live; re-verified by direct grep of `src/`, not assumed): only **MCP Server 1** (`/api/mcp`, Vercel Edge, public — compliance data reads/writes for customer AI agents) is real. It authenticates via the unified `apiKeys` table (Wave 9-10; `mcp_access_codes` retired but not dropped) and exposes **9 tools live** (`list_notices`, `get_task_status`, `list_compliance_items`, `get_compliance_stats`, `get_overdue_items`, `create_compliance_item`, `update_compliance_status`, `list_departments`, `get_penalty_estimate` — confirmed by reading `src/app/api/mcp/route.ts` directly). **9 of ~40+ modules are MCP-reachable** — everything built since Wave 11 waits on its domain getting a service layer extracted first (`src/lib/services/*.ts` — only ~15 of ~40 domains have one; the rest still have logic inline in route handlers).

"MCP Server 2" (a Supabase Edge Function, internal-only, Groq-orchestrator-driven dev dispatch) is a **design spec only** — `MCP_PROTOCOL.md` describes it in detail, but zero matching code exists anywhere in this repo (no `mcp-dev` function, no `MCP_DEV_SECRET`, no Groq orchestrator dispatcher). Never built, or built-then-removed with no record.

## 6. The VERIDIAN AI Constitution — governance for AI behavior

Distinct from the architecture rules above by design: "this document governs *product/branch/schema architecture*... [the Constitution] governs AI behavior... the two documents do not overlap" (`MASTER_AI_OS_ARCHITECTURE.md` §1). 23 sections, each graded `[ENFORCED]`/`[PARTIALLY ENFORCED]`/`[POLICY ONLY]`/`[NOT APPLICABLE YET]`. The machine-enforceable core:

**The Policy Enforcement Engine** (`src/lib/policy-enforcement-engine.ts`, Wave 46) — a deterministic regex/keyword pre-call gate, deliberately **not** an LLM classifier (costs nothing, adds no latency, can't itself be prompt-injected):

```
Auth → Role/RLS → Domain Validity → Prompt-Injection Check → Business-Purpose Check
  → DENY (logged, zero LLM call, zero cost) or ALLOW → provider call → audit log
```

**Wired call sites (2, Wave 46; was 3 until PageAgent's 2026-07-14 removal):** VERI Chat, VERI FDE — VERIDIAN's remaining surfaces where arbitrary free-text reaches an LLM with real side effects. (The 3rd, Page Agent proxy, was removed from the codebase entirely per Owner directive — see `VERIDIAN_AI_CONSTITUTION.md`'s "PageAgent Removal" note.)

**Explicitly NOT yet wired (honest, stated in the source doc, not hidden):** `src/lib/loops/*.ts` (system-generated, not user-facing), `document-extraction-service.ts` (structured extraction, lower injection surface but untested), `api/ai/orchestrate/route.ts` + `task-execution-engine.ts` (operates on system-generated task descriptions today, not raw chat — should be wired as task-creation surfaces grow). **This is the concrete detail behind the audit's original "policy enforcement only covers 3 of N call sites" finding (now 2 of N, one surface having been removed rather than wired)** — see `CRITICAL_GAPS.md`.

**Real, honestly-graded gaps in the Constitution itself** (not exhaustive — full grading is in the source doc):
- §9 (Coding Governance) — "Level 1 only" is an *organizational* boundary (who has repo access) today, not a runtime AI-level check. No code distinguishes "Claude Code acting as Level 1" from any other authenticated session.
- §10 (Protected Assets) — `auditLogs` is append-only by *convention* (no code path mutates it), not by DB-level `REVOKE`. A future `MASTER_AI_OS_ARCHITECTURE.md`-style RLS discipline for DELETE grants would close this.
- §19 (Auditability) — full prompt/response text isn't stored in `orchestraExecutions` for *allowed* requests (only a 500-char excerpt for *denied* ones, added Wave 46). Explainability is incomplete.
- §14/§15/§16/§21 (Document limits, Internet usage, Image generation, Meeting Intelligence) — `[NOT APPLICABLE YET]`, because the underlying capability doesn't exist yet. Correctly deferred rather than faked as enforced.

## 7. Build-vs-Borrow discipline (`VAIOS_ARCHITECTURE_STRATEGY.md` + 20+ OSS research passes)

The Frappe/ERPNext decision set the pattern every later vertical research pass repeats: **check the real license directly** (GitHub API/LICENSE file, never assumed from a README), **check real infrastructure fit** (this stack is Vercel-serverless — anything needing MariaDB/Redis/a standing Python process/Docker is architecturally excluded regardless of license), then **read source as reference only, re-implement natively**. Frappe itself is MIT; `erpnext`/`hrms` are GPLv3 (SaaS loophole applies but still avoided); `crm`/`builder`/`insights` are AGPL (network-copyleft, hard no). This exact discipline repeats across `PLATFORM_STRATEGY.md` §13 (21 repos), §15 (6 repos), §17 (26 repos, VOAC catalog) — the overwhelming majority of studied repos are rejected as *software* (wrong runtime/architecture) independent of license, with real *patterns* adopted and re-implemented in TypeScript against VERIDIAN's own schema conventions. See `orchestra_changes.md`'s wave entries for the specific adopt/reject verdict on each repo studied.

## 8. Multi-tenancy & RLS enforcement mechanism (the load-bearing pattern everything above depends on)

Two Postgres roles: `postgres` (Drizzle's default connection, `rolbypassrls=true` — genuinely RLS-blind, used only for the few legitimate pre-tenant-context operations like new-org signup) and `app_runtime` (`NOSUPERUSER NOBYPASSRLS`, a separate `APP_RUNTIME_DATABASE_URL` connection — what every tenant-scoped query actually runs as). `withTenantContext()` (`src/lib/db/tenant-scoped.ts`) wraps a request in a transaction that `SELECT set_config('app.current_org_id', ..., true)`s the relevant GUCs (org/client/user id) before the query runs; RLS policies read `compliance.current_org_id()` etc. — **not `auth.uid()` directly**, because Drizzle's raw Postgres connection doesn't carry the request's Supabase JWT.

**This mechanism had a critical, session-long bug (Wave 1 through Wave 7)**: the original `SET LOCAL app.current_org_id = $1` used a bind parameter, which Postgres's `SET LOCAL` syntax doesn't support (`42601` syntax error on every call) — fixed in Wave 7 by switching to `SELECT set_config(...)`. **This is fixed and has been for 100+ waves; do not re-flag it as open.**

**"AI OS Certification" pass verdict on this specific guarantee**: `PRODUCTION_PROVEN` — the strongest-verified constitutional claim in the whole system, independently re-proven with a real switched-role test (not `service_role` simulation) in nearly every subsequent wave that touched a new table.

---

## Source documents (primary, not superseded — read these for full detail)

- [`MASTER_AI_OS_ARCHITECTURE.md`](../../MASTER_AI_OS_ARCHITECTURE.md) — the 6 architectural rules, full RLS SQL template, 19-vertical catalog with build tiers
- [`VERIDIAN_AI_CONSTITUTION.md`](../../VERIDIAN_AI_CONSTITUTION.md) — all 23 sections in full, each with its evidence citation
- [`VAIOS_ARCHITECTURE_STRATEGY.md`](../../VAIOS_ARCHITECTURE_STRATEGY.md) — the original Frappe/ERPNext license+infra decision
- [`MCP_PROTOCOL.md`](../../MCP_PROTOCOL.md) — full two-server spec, all 9 tools, JSON-RPC examples
- [`PLATFORM_STRATEGY.md`](../../PLATFORM_STRATEGY.md) §10-27 — the wave-by-wave design record for every OSS research pass and product-branch design decision referenced above
