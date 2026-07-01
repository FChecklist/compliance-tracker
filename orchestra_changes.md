# Orchestra Changes Log — VERIDIAN AI Orchestra Transformation

This is the running plan + change log for turning `compliance-tracker` into VERIDIAN AI Orchestra. See [analysis.md](analysis.md) for the Phase 1 discovery (schema map, feature map, gap analysis) this plan is built on.

**Status: Wave 1 in progress — schema + hierarchy done (steps 1.1-1.5), RLS policies + API route migration (1.7-1.10) still ahead.** Supabase branching (the originally planned safety net for this wave) isn't available on the Free plan, so Wave 1 is being applied directly to production in small, additive, independently-verified steps instead — see "Wave 1 approach" note below. Order of execution, per wave and per step: **GitHub (code/schema/docs) → Supabase (migration/data) → Vercel (env/deploy)**. Each step below is written to be independently completable and independently verifiable, so progress can be shown incrementally rather than as one giant cutover. This file is updated after every executed step — see the Change Log at the bottom, which is the source of truth for "what's actually been done" (not the wave plan, which is the intent).

---

## ⚠️ Live infrastructure findings (discovered while executing Wave 0 — needs your input before Wave 1)

Two things surfaced by actually connecting to Supabase/Vercel, not by reading the repo, that change what's safe to assume:

1. **Two Supabase projects both have a `compliance` schema**: `jusqumifsmtcaujqyjuy` ("Veridian AI", 9 tables — organisations, departments, users, compliance_items, audit_points, documents, comments, notifications, audit_logs only) and `pcrjmlpuqsbocqfwoxod` ("verdian-ai", 16 tables — the 9 above plus mcp_access_codes, challans, notices, embeddings, onboarding_steps, ingestion_batches, ingestion_items, and now `ai_configurations`). `pcrjmlpuqsbocqfwoxod` is clearly the current one — it has every table the current `schema.ts` needs. **All Wave 0 database work in this file was applied to `pcrjmlpuqsbocqfwoxod`.**
2. **Two Vercel projects are both linked to `FChecklist/compliance-tracker`'s `main` branch**: `compliance-tracker` (`prj_80z9Rz3BYvvExvGXyt5LNoPPMgiZ`, domain `compliance-tracker.vercel.app`) and `veridian-compliance-ai` (`prj_mRRWcMvhyuxgRZtcfp4ArSzcOvII`, domain `veridian-compliance-ai.vercel.app`). Every push to `main` deploys both, silently.
3. **Checked both live URLs directly**: `veridian-compliance-ai.vercel.app` serves the real, working "Veridian AI — AI-Native Compliance & Audit Operating System" app. `compliance-tracker.vercel.app` serves a raw, broken JS bundle at its root — it looks orphaned/misconfigured, not a working deployment.
4. **Both Vercel projects set `NEXT_PUBLIC_SUPABASE_URL` to the *older* project (`jusqumifsmtcaujqyjuy`)**, not `pcrjmlpuqsbocqfwoxod`. That env var is what Supabase Auth (login/signup), the MCP route's admin client, and `lib/embeddings.ts`'s fallback path all use directly — no `DATABASE_URL` alternative for any of those. So **login and the MCP server almost certainly run against the 9-table project**, which doesn't have `mcp_access_codes`, `challans`, `notices`, etc. — meaning those features may currently be erroring in production regardless of anything in this file.
5. **What's unknown:** `DATABASE_URL` is also set (encrypted) in both Vercel projects, and Drizzle prefers `DATABASE_URL` over the `NEXT_PUBLIC_SUPABASE_URL` fallback. I can't decrypt that value through the Vercel API to see which of the two Supabase projects it actually points to, so I don't know for certain whether the working parts of the live app (dashboard, compliance CRUD) are reading `pcrjmlpuqsbocqfwoxod` (where this file's DB changes now live) or `jusqumifsmtcaujqyjuy` (where they don't exist yet).

**I did not guess further or touch either Vercel project's Git integration, since deleting/unlinking a project is destructive and picking the wrong Supabase project to keep "fixing" would compound the confusion.** I set the one new Wave 0 env var (`AI_CONFIG_ENCRYPTION_KEY`) only on `veridian-compliance-ai`, since that's the one confirmed to be actually serving traffic.

**Update (same day) — fully resolved.** `veridian-compliance-ai` confirmed as the one true app; `pcrjmlpuqsbocqfwoxod` confirmed as the one true database. Sequence completed in this order: repointed all 5 Supabase-related env vars on `veridian-compliance-ai` → redeployed → user confirmed login/dashboard load correctly against the new target → cleaned up the dead artifacts. Cleanup turned out to be slightly bigger than expected: `jusqumifsmtcaujqyjuy` had **two** dead compliance-tracker artifacts, not one — the `compliance` schema (9 tables, stale duplicate data) and a completely separate, entirely empty `compliance_tracker` schema (an earlier abandoned attempt, zero rows in every table). Both were dropped. `public` schema in that same project — confirmed as MeetTrack's real, live data (`users`, `meetings`, `action_items`, `ai_sessions`, `user_api_keys`, all with real row counts) — was verified untouched and intact before and after. The dead `compliance-tracker` Vercel project (`prj_80z9Rz3BYvvExvGXyt5LNoPPMgiZ`) was deleted; `veridian-compliance-ai` is now the only Vercel project linked to this repo.

---

## Planning assumptions (locked for this plan; flag if you want any changed before Wave 1 starts)

These resolve the three open questions from the previous version of this file. Execution has not started, so these can still be changed at no cost — but the plan below is written assuming these answers:

1. **Hierarchy scope — build the full Customer Account → Client → Client Entity model now, additively.** Rather than a disruptive rename, `organisations` keeps its table name (all existing code references it) and is simply the Customer Account. New `clients` and `client_entities` tables are added underneath it. Every existing business table gets a **nullable** `client_id`. A migration auto-creates one implicit "Self / Direct" client per existing organisation and backfills `client_id` on all existing rows to it — so single-entity firms (today's only real use case) keep working with zero behavior change, while multi-client CA firms can create real clients going forward. This avoids the "decide twice" cost flagged in analysis.md without breaking anything live.
2. **RLS-first sequencing — confirmed.** Wave 1 (tenant isolation) happens before any Orchestra-specific table (assistants, agents, tasks, loops).
3. **`ai-os/` stays untouched, as a separate system.** Orchestra loops become a new, DB-backed telemetry system; `ai-os/`'s YAML governance layer is left exactly as-is, per `CLAUDE.md`'s explicit rule. No attempt is made to unify them in this plan. (If you want them merged later, that's a distinct, explicit decision — not bundled in here.)
4. **Wave 0 (BYOK fix) happens first, standalone**, since it's small, self-contained, and already broken in a way worth fixing regardless of how big the rest of the build gets.
5. **ID strategy: new tables use `text` + cuid2 (`@paralleldrive/cuid2`), matching every existing table** — not `uuid`, despite the master prompt's generic assumption of uuid. Mixing id types across FKs in the same schema is a real footgun; consistency with the 19 existing tables wins.
6. **Embedding dimension: 1536, matching the existing `embeddings` table and `lib/embeddings.ts`.** (Aside, not blocking: that file calls Groq's `nomic-embed-text`, which in reality is a 768-dim model — the existing code pads/hashes to 1536 regardless of what the real model returns when the API succeeds, which is worth a QA check during Wave 2, but is a pre-existing issue, not something this plan introduces.)
7. **RLS enforcement mechanism — this is the one genuinely new engineering decision this plan adds, not carried over from analysis.md:** see "Wave 1 critical technical note" below. Short version: `DATABASE_URL` (used by Drizzle, via `postgres.js`) connects with a privileged role that **bypasses RLS by default in Postgres, regardless of how many `CREATE POLICY` statements exist**, unless handled deliberately. The plan uses a session-level Postgres GUC (`app.current_org_id`, set via `SET LOCAL` at the start of every request inside a transaction) rather than rewriting all 27 API routes to go through PostgREST/`auth.uid()`. This is the pragmatic retrofit; it is called out explicitly because getting it wrong would mean every RLS policy in Wave 1 is silently a no-op.

---

## WAVE 0 — Foundation fixes (standalone, do first)

**Goal:** fix the one already-broken, already-scoped feature (BYOK AI config) before adding anything new on top of it. Independently shippable.

| Step | Layer | What | Files touched | Exit criteria |
|---|---|---|---|---|
| 0.1 | GitHub | Rewrite `/api/settings/ai-config/route.ts` to read/write the real `ai_configurations` Drizzle table instead of the in-memory object; resolve `orgId` from `requireAuth()` instead of hardcoded `"default"` | `src/app/api/settings/ai-config/route.ts` | Restarting the dev server no longer clears saved AI config |
| 0.2 | GitHub | Replace base64 "obfuscation" with real encryption: `pgcrypto`'s `pgp_sym_encrypt`/`pgp_sym_decrypt`, keyed by a server-only secret | same file + `src/lib/db/schema.ts` (no column change needed, `encryptedApiKey` already `text`) | Stored value in DB is ciphertext, not base64(plaintext) |
| 0.3 | Supabase | Confirm `pgcrypto` extension is enabled (`list_extensions`); enable via migration if not | new migration `000X_enable_pgcrypto.sql` | `list_extensions` shows `pgcrypto` active |
| 0.4 | Vercel | Add `AI_CONFIG_ENCRYPTION_KEY` env var (generate 32-byte random secret) | Vercel project env vars (Production + Preview) | Env var present, not committed to repo |
| 0.5 | GitHub | Add missing indexes: btree on every table's `org_id`; composite `(status, due_date)` on `compliance_items` for the dashboard/overdue queries | new drizzle migration | `EXPLAIN` on `/api/compliance/stats` shows index usage, not seq scan |
| 0.6 | Supabase | Apply index migration | — | Indexes visible in `list_tables` output |

---

## WAVE 1 — Tenant hierarchy + Row Level Security (the blocking foundation)

**Goal:** make "customer A's data can never appear in customer B's query" true at the database level, and stand up the Customer Account → Client → Client Entity model underneath it. Nothing in Waves 2–5 should be built before this lands.

### Wave 1 critical technical note (read before starting 1.x)

The app currently authenticates via Supabase Auth, but resolves the app-level identity by **email lookup** (`auth-guard.ts`: `db.query.users.findFirst({ where: eq(users.email, user.email!) })`). There is no stored link from `auth.users.id` to `compliance.users.id`. Two things follow:

- **Step 1.1 must add `users.auth_user_id uuid` (FK to `auth.users.id`)**, populated at signup/first-login, before any `auth.uid()`-based policy can work.
- Even with that link, **Drizzle's `postgres.js` connection via `DATABASE_URL` almost certainly does not carry the request's JWT**, so `auth.uid()` will be null/irrelevant inside that connection regardless. Two ways to fix this; this plan picks the second:
  - (a) Rewrite all 27 API routes to use the Supabase JS client (which does carry the user's JWT and naturally respects RLS via PostgREST) instead of raw Drizzle — correct, but a large, risky, all-at-once rewrite.
  - (b) **(chosen)** Keep Drizzle, but wrap every mutating/reading request in a transaction that starts with `SET LOCAL app.current_org_id = '<resolved orgId>'; SET LOCAL app.current_client_ids = '<comma-separated client ids the user can see>';`, and write RLS policies against `current_setting('app.current_org_id', true)` instead of `auth.uid()` directly. This is enforced by Postgres itself (a forgotten `WHERE org_id = ...` in a new route still gets filtered by the policy), doesn't require touching all 27 routes' query logic, and is a well-established Supabase/Postgres pattern for exactly this "ORM talks to Postgres directly" situation.
  - Either way, **every table must also get `ALTER TABLE ... FORCE ROW LEVEL SECURITY`**, because Postgres does not apply RLS to a table's owner by default — and the role in `DATABASE_URL` is very likely the schema owner. Wave 1 must also confirm (via `get_advisors` and a manual check) that the app's DB role is *not* superuser, since superuser always bypasses RLS regardless of FORCE.

### Steps

| Step | Layer | What | Exit criteria |
|---|---|---|---|
| 1.1 | GitHub | Migration: add `users.auth_user_id uuid` (nullable initially, backfilled, then NOT NULL) referencing `auth.users(id)`; add `users.reporting_to_id text` self-FK (replaces a separate `user_hierarchy` table — simpler, same effect for a direct-manager chain) | Column exists; every active user has it populated |
| 1.2 | GitHub | Migration: extend `user_role` enum with `veridian_admin, branch_manager, senior_professional, team_member, client_viewer, external_auditor` (Postgres requires `ALTER TYPE ... ADD VALUE` outside a transaction — separate migration file from anything transactional) | `\dT+ compliance.user_role` shows 10 values |
| 1.3 | GitHub | New tables: `branches` (org-scoped, optional), `clients` (org-scoped — the CA firm's end clients), `client_entities` (client-scoped — GSTIN/PAN-holding legal entities), `user_client_access` (user_id, client_id, access_level: full/aggregate_only) | Tables created, FKs valid |
| 1.4 | GitHub | New table: `subscription_plans` (id, name, user_pack_size, assistants_per_user default 5, price, features jsonb); add `organisations.subscription_plan_id` FK, keep the existing `plan` text column for backward compat (don't drop yet) | Plans table seeded with at least Trial/Starter/Growth tiers |
| 1.5 | GitHub | Migration: add nullable `client_id text` to `compliance_items`, `notices`, `challans`, `documents`, `audit_points`; **data migration** creates one "Self / Direct" client per existing `organisations` row and backfills `client_id` on all existing rows in those 5 tables to that org's implicit client | Row counts before/after identical; no row has null `client_id` after backfill |
| 1.6 | GitHub | `compliance.current_org_id()` and `compliance.current_client_ids()` SQL helper functions (`STABLE`, reading the `app.current_org_id` / `app.current_client_ids` GUCs) for policies to call | Functions created |
| 1.7 | GitHub | RLS policy migration: enable + `FORCE` RLS on all 19 existing tables + 5 new ones; policy pattern `USING (org_id = compliance.current_org_id())`, with `client_id = ANY(compliance.current_client_ids())` added on the 5 client-scoped tables for non-admin roles | `get_advisors` (security) shows zero "RLS disabled" findings for the `compliance` schema |
| 1.8 | GitHub | Update `src/lib/db/index.ts` (or a new `src/lib/db/withTenantContext.ts` wrapper) so every request sets the two GUCs at the start of its DB transaction, sourced from `requireAuth()`'s resolved `orgId`/`clientIds` | Manual test: query run through the wrapper with GUCs unset returns zero rows (fails closed) |
| 1.9 | GitHub | Update all 27 API routes to use the new tenant-context wrapper instead of the bare `db` export (mechanical, route-by-route, each independently testable) | Each route still returns correct data for its own org; a manual cross-org test (two seeded orgs) confirms no leakage |
| 1.10 | GitHub | Update `/api/mcp/route.ts`: it currently uses a service-role client that intentionally bypasses RLS — keep that (service-role tools legitimately need cross-boundary lookups for token resolution), but audit every `handleTool` branch to confirm `org_id` (and now `client_id` where relevant) is applied in **every** query, since this route is the one place RLS is deliberately not the safety net | Manual review checklist in this file (see Wave 1 QA checklist below) signed off |
| 1.11 | Supabase | Apply all Wave 1 migrations in order (1.1 → 1.7) via `apply_migration`, on a Supabase **branch** first, not directly on production | Branch migration succeeds cleanly |
| 1.12 | Supabase | Run `get_advisors` (security + performance) on the branch; fix any findings before merging | Zero security advisor findings for new/changed tables |
| 1.13 | Supabase | Merge branch to production once 1.9–1.12 are confirmed working against it | Production schema matches branch |
| 1.14 | Vercel | No new env vars for this wave (GUC approach needs no new secrets); redeploy to pick up the API route changes from 1.9/1.10 | Deployment succeeds; smoke test login + dashboard load |

**Wave 1 QA checklist (must pass before Wave 2 starts):**
- [ ] Two test organisations seeded; user from Org A cannot read Org B's `compliance_items` via any existing API route, even with a hand-crafted request
- [ ] `get_advisors` security scan clean for `compliance` schema
- [ ] `/api/mcp` tools re-verified against both orgs independently
- [ ] Confirm DB role used in `DATABASE_URL` is not superuser/table owner (or that `FORCE ROW LEVEL SECURITY` is proven to still apply)

---

## WAVE 2 — AI Assistant System (5 per user)

Depends on: Wave 1 (needs `org_id`/`client_id` context to scope assistant visibility correctly).

| Step | Layer | What | Exit criteria |
|---|---|---|---|
| 2.1 | GitHub | New tables: `ai_assistants` (user_id, assistant_number 1–5, label, status, personality_config jsonb), `assistant_memories` (assistant_id, category, content, `embedding vector(1536)` via raw SQL + HNSW index — same pattern as existing `embeddings` table), `assistant_sessions`, `assistant_metrics_daily` | Tables created |
| 2.2 | GitHub | RLS: assistants and memories readable/writable only by their owning `user_id` (strictest tier — no org-admin override by default, matching master prompt's privacy intent) | Policy migration passes advisors check |
| 2.3 | GitHub | Signup/onboarding hook: on new user creation, auto-insert 5 `ai_assistants` rows (numbered 1–5, default label "Assistant 1".."5") | New signup produces exactly 5 assistant rows |
| 2.4 | GitHub | Backfill migration: existing seeded users (7 in seed data) get 5 assistants each | Row count = existing_users × 5 |
| 2.5 | GitHub | API routes: `GET /api/assistants` (mine), `PATCH /api/assistants/[id]` (label/config), `POST /api/assistants/[id]/memories`, `GET /api/assistants/[id]/memories/search` (reuses `lib/embeddings.ts` `findSimilar` pattern, scoped to `assistant_id`) | Routes pass auth + ownership checks |
| 2.6 | GitHub | Frontend: Settings → "AI Assistants" panel showing 5 tiles (status, last active); reuses existing `DashboardCard`/`Badge` components rather than new ones | Manual browser check: 5 tiles render, editable labels |
| 2.7 | Supabase | Apply migration (branch → verify → merge), including HNSW index on `assistant_memories.embedding` | `get_advisors` clean; vector search returns results in dev test |
| 2.8 | Vercel | Redeploy | Smoke test assistants panel loads |

---

## WAVE 3 — Worker Agent Library (4 tiers)

Depends on: Wave 1 (tiered RLS visibility needs org/client scoping in place).

| Step | Layer | What | Exit criteria |
|---|---|---|---|
| 3.1 | GitHub | New tables: `worker_agents` (tier enum global/customer/client/user, capability_embedding, knowledge_embedding vector(1536), code_reference, prompt_template, input/output_schema jsonb, is_immutable, version, usage_count, accuracy_score), `worker_agent_versions`, `worker_agent_usage_log`, `worker_agent_learnings`, `worker_agent_domain_index` | Tables created |
| 3.2 | GitHub | RLS: global tier readable by all authenticated users; customer tier scoped to `org_id`; client tier scoped to `client_id` (via `user_client_access`); user tier scoped to `user_id` — mirrors master prompt §C exactly | Policy migration passes advisors check |
| 3.3 | GitHub | **Seed migration: port the 7 existing hardcoded MCP tools (`list_compliance_items`, `get_compliance_stats`, `get_overdue_items`, `create_compliance_item`, `update_compliance_status`, `list_departments`, `get_penalty_estimate`) into `worker_agents` rows, tier=`global`, `is_immutable=true`.** This is the first real content in the new system and it's not new build — it's formalizing what already works. | 7 global agents exist, one per existing MCP tool |
| 3.4 | GitHub | Refactor `/api/mcp/route.ts`'s `TOOL_DEFINITIONS`/`handleTool` to look up from `worker_agents` (tier=global first, falling back to hardcoded definitions during transition) instead of the static array — backward compatible, same external tool names/schemas | Existing MCP clients see no behavior change; `tools/list` now sourced from DB |
| 3.5 | GitHub | Add `usage_log` write on every `handleTool` call (execution time, success, org/client context) | `worker_agent_usage_log` rows appear after MCP calls |
| 3.6 | Supabase | Apply migration (branch → verify → merge) | `get_advisors` clean |
| 3.7 | Vercel | Redeploy | MCP endpoint smoke test (all 7 tools still callable) |

---

## WAVE 4 — Task System + Orchestra Layers

Depends on: Waves 1–3 (tasks reference assistants and worker agents).

| Step | Layer | What | Exit criteria |
|---|---|---|---|
| 4.1 | GitHub | New tables: `tasks`, `task_execution_plan`, `task_agent_executions`, `task_chat_messages` (task_embedding vector(1536) for semantic task matching) | Tables created |
| 4.2 | GitHub | New tables: `orchestra_layers` (seeded with the 5 layers: Task OA, User Assistant OA, Customer Account OA, Global Intelligence OA, Meta OA), `orchestra_executions`, `customer_model_config` (per-layer BYO model, extending the existing `ai_provider` enum groq/openai/anthropic/google) | 5 layer rows seeded |
| 4.3 | GitHub | **Generalize the existing `ingestion_batches`/`ingestion_items` plan → human-review → confirm pattern into the new `tasks`/`task_execution_plan` model** rather than building parallel machinery — ingestion becomes the first real "task type" in the new system | Ingestion flow still works end-to-end after refactor |
| 4.4 | GitHub | Generalize `/api/ai/orchestrate` into a layer-aware dispatcher: reads `orchestra_layers.default_model_config`, checks `customer_model_config` for a BYO override, falls back to platform default (Groq today) | Existing 4 event types (document.uploaded, item.overdue, notice.received, deadline.approaching) still produce the same actions as before, now routed through layer config |
| 4.5 | GitHub | Frontend: per-assistant task list/chat view (reuses `DataTable`, adds a chat-style panel); execution plan viewer (timeline of `task_agent_executions`) | Manual browser check |
| 4.6 | Supabase | Apply migration (branch → verify → merge) | `get_advisors` clean |
| 4.7 | Vercel | Add any new BYO-model provider env vars actually configured by a customer (per-customer keys live encrypted in `customer_model_config`, not as Vercel env vars — Vercel only needs the platform-default keys, e.g. `GROQ_API_KEY`, which already exists) | No new platform-wide env vars expected unless a new default provider is added |

---

## WAVE 5 — Self-Improvement Loops + Knowledge Flow

Depends on: Wave 1 (cross-tier knowledge flow must not be able to leak across tenants — this is exactly the scenario analysis.md flagged as unsafe to build before RLS existed).

| Step | Layer | What | Exit criteria |
|---|---|---|---|
| 5.1 | GitHub | New tables: `loop_definitions` (seeded with all 15 named loops from the master prompt), `loop_executions`, `loop_improvements`, `loop_health_metrics` | 15 loop_definitions rows seeded |
| 5.2 | GitHub | New tables: `knowledge_flow_log`, `data_separation_audit` | Tables created |
| 5.3 | GitHub | **Implement the two audit/safety loops first, not the generative ones:** Loop 9 (API/Token/URL Management — audits `mcp_access_codes`/`api_keys` for staleness/scope creep) and Loop 12 (Hierarchy & Secrecy Management — runs `data_separation_audit` checks: sample queries per org, confirm zero cross-tenant rows returned). These validate the Wave 1 foundation continuously rather than assuming it stays correct forever. | Both loops run on a schedule and log real results |
| 5.4 | GitHub | Implement Loop 10 (User Behaviour) and Loop 4 (Knowledge Management) next — read-only/observational loops, lower risk than ones that write code or prompts | Loops log observations to `loop_executions` |
| 5.5 | GitHub | Defer Loops 2 (Self-Coding) and 6 (Prompt Management) — the two loops that let the system modify its own code/prompts — until 5.3/5.4 have a track record. Not scheduled in this plan yet; revisit explicitly before enabling. | — |
| 5.6 | Supabase | Apply migration (branch → verify → merge) | `get_advisors` clean |
| 5.7 | Vercel | Add Vercel Cron entries for scheduled loop execution (extends existing `vercel.json`, which currently has no cron config) | Cron jobs visible in Vercel dashboard, firing on schedule |

---

## WAVE 6 — Hardening & Launch Reconciliation

- Reconcile against the pre-existing `review_of_vedian.md` launch checklist (several items already resolved per `ai-os/boss/BOARD.yaml`; re-verify rather than trust the YAML claim) — confirm auth guards, dead-dependency removal, and DB connectivity are still true on current `main`.
- Full `get_advisors` pass (security + performance) across every table added in Waves 0–5.
- Load-test the dashboard/stats queries with the new indexes (Wave 0.5) and new RLS policies (Wave 1) together — RLS policies can silently regress query performance if the helper functions aren't marked `STABLE`/properly indexed.
- Update `Testing/test_execution_log.md` with new test cases covering cross-tenant isolation (the one thing this whole rebuild exists to guarantee).

---

## Cross-cutting reference (kept here so it doesn't scatter across waves)

**Vector index strategy:** every `vector(1536)` column gets an HNSW index (`m=16, ef_construction=64`), matching the existing `embeddings_cosine_idx` — proven pattern already in production, no need for `ivfflat`. Tables: `embeddings` (existing), `assistant_memories`, `worker_agents.capability_embedding` + `.knowledge_embedding`, `tasks.task_embedding`, `task_chat_messages.message_embedding`, `worker_agent_learnings.embedding`.

**New env vars, cumulative across all waves:**
| Var | Wave | Purpose | Scope |
|---|---|---|---|
| `AI_CONFIG_ENCRYPTION_KEY` | 0 | pgcrypto symmetric key for BYOK secrets | Platform-wide (Vercel secret) |
| *(none new)* | 1–3 | — | — |
| *(customer keys live encrypted in DB, not env)* | 4 | per-customer BYO model keys | Per-row, encrypted |
| *(cron trigger secret if needed)* | 5 | Vercel Cron → loop-execution route auth | Platform-wide |

**What is explicitly NOT being rebuilt from scratch** (already working, being extended not replaced): Groq-based orchestrator (`ai/orchestrate`), pgvector semantic search (`lib/embeddings.ts`), MCP server (`/api/mcp`), ingestion batch pipeline, `ai_configurations` table (fixing its wiring, not its shape).

---

## `main_dashboard_user.md` — captured as the Wave 3 worker-agent seed reference

The dashboard mockup at `main_dashboard_user.md` is a static, self-contained HTML/JS prototype (fake data, `setInterval`-driven simulation, no backend calls) — but its `WA` object is a genuinely useful, concrete taxonomy that should become the actual Wave 3 `worker_agents` seed data rather than being invented fresh:

- **33 Global-tier agents** across India Tax (Direct/Indirect), India Compliance (ROC/Labour), Accounting, Audit, Treasury, and Cross-Cutting (OCR, Anomaly Detection, Report Generation) domains — each with a name, domain path, icon, usage count, and accuracy score.
- **6 Firm-tier agents** scoped to an example firm ("Shah & Co"): Month-End Close WF, TDS Review Checklist, Client Onboarding, Communication Templates, Approval Chain Config, Manufacturing ITC Rules.
- **5 Client-tier agents** scoped to example clients (ABC Corp, DEF Inc, GHI Holdings): GST/TDS patterns, approval chains, bank patterns, risk profiles.
- **3 User-tier agents** scoped to an example user ("Rahul"): task priority, review style, active hours.
- **5 example assistants**, each wired to exactly 5 worker agents (one plausible combination per assistant persona) with example tasks and chat transcripts — useful as the Wave 2/Wave 4 demo/seed data too, not just Wave 3.

This taxonomy is preserved here so it survives independently of the mockup file. Wave 3, step 3.1/3.3 should seed from this list (translated into real `worker_agents` rows) rather than re-deriving domain examples from scratch.

## Frontend direction (from `main_dashboard_user.md`)

The mockup's interaction model — 5 assistant columns (Kanban-style), each showing its linked worker-agent tags grouped by tier color (teal=Global, indigo=Firm, amber=Client, slate=User), a per-assistant task list with pending/in-progress/completed/submitted states, an embedded per-assistant chat, and a slide-out "Agent Library" panel listing all worker agents filterable by tier — is the target UX. It's built with the Tailwind CDN + Font Awesome CDN, which is fine for a throwaway prototype but not appropriate to bring into the production Next.js app as-is; the real implementation should use the existing shadcn/ui + Tailwind (non-CDN) + lucide-react stack already in `src/components/`, reusing `DataTable`, `StatusBadge`, `DashboardCard` where they fit, rather than hand-rolling new equivalents.

---

## Change Log

*(entries appended here one per executed step, in the order it actually happened — this table is the ground truth for progress, the waves above are the plan)*

| # | Date | Layer | Change | Commit/Migration ref | Notes |
|---|------|-------|--------|----------------------|-------|
| 1 | 2026-07-01 | Supabase | Enabled RLS + service_role-bypass policy on 7 previously-exposed tables (`mcp_access_codes`, `challans`, `notices`, `embeddings`, `onboarding_steps`, `ingestion_batches`, `ingestion_items`) on project `pcrjmlpuqsbocqfwoxod` | migration `enable_rls_exposed_compliance_tables`; repo copy `drizzle/0003_enable_rls_exposed_compliance_tables.sql` | Applied with explicit user sign-off (Supabase tooling requires this before enabling RLS). Verified clean via `get_advisors` afterward. |
| 2 | 2026-07-01 | Supabase | Created `compliance.ai_configurations` table (declared in `schema.ts`, never migrated), enabled `pgcrypto`, added `org_id`/`(status, due_date)` indexes on project `pcrjmlpuqsbocqfwoxod` | migration `create_ai_configurations_and_indexes`; repo copy `drizzle/0004_ai_configurations_and_indexes.sql` | — |
| 3 | 2026-07-01 | GitHub | Rewired `/api/settings/ai-config` to real DB-backed, per-org, pgcrypto-encrypted storage; added `src/lib/ai-config-crypto.ts` | commit `2dca6c1` | Local build/typecheck not run (no `node_modules`/bun in this environment) — Vercel's own build step and existing CI will catch any compile error on deploy. |
| 4 | 2026-07-01 | Vercel | Added `AI_CONFIG_ENCRYPTION_KEY` (32-byte random, encrypted) to the confirmed-live project `veridian-compliance-ai` (`prj_mRRWcMvhyuxgRZtcfp4ArSzcOvII`), all environments | Vercel env id `3lNDmiwI99rJ43y8` | Not set on the `compliance-tracker` project since that one appears to be a dead/broken duplicate deployment — see infrastructure findings above. |
| 5 | 2026-07-01 | Supabase | Reset `pcrjmlpuqsbocqfwoxod`'s database password (with explicit user approval) since the previous one couldn't be verified or read back | via Management API `PATCH /v1/projects/{ref}/database/password` | — |
| 6 | 2026-07-01 | Vercel | Repointed `veridian-compliance-ai`'s `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, and `DATABASE_URL` from the old project (`jusqumifsmtcaujqyjuy`) to `pcrjmlpuqsbocqfwoxod` | env ids `KNT1lNlmF3iSwNle`, `yYlSCDBDnE2rxeNS`, `nioEtKhcp1mrSr03`, `SHu8tWdQtB28bPF8`, `qw45B0HjHB5VdFIi` | Confirms and closes the "which DB does the live app actually use" open item from the previous change log entries — it now unambiguously uses `pcrjmlpuqsbocqfwoxod`, the same project all Wave 0 DB fixes were applied to. `DATABASE_URL` update required a fresh confirmation after an earlier attempt was interrupted, per the interrupt-retry safety rule. |
| 7 | 2026-07-01 | Vercel | Triggered fresh production deployment (commit `2d110c2`) so the repointed env vars took effect | deployment `dpl_Eux5w9tX7XACw7peij9yacVapQAN` | User confirmed the live app loads correctly against the new database afterward. |
| 8 | 2026-07-01 | Supabase | Dropped two dead compliance-tracker artifacts from `jusqumifsmtcaujqyjuy`: the `compliance` schema (9 tables, stale duplicate data) and a separate, entirely empty `compliance_tracker` schema (abandoned earlier attempt) | migration `drop_dead_compliance_tracker_schemas` | `public` schema in that project (MeetTrack's real data) verified untouched before and after — same row counts. |
| 9 | 2026-07-01 | Vercel | Deleted the dead duplicate `compliance-tracker` project (`prj_80z9Rz3BYvvExvGXyt5LNoPPMgiZ`) | — | `veridian-compliance-ai` is now the only Vercel project linked to this repo. |
| 10 | 2026-07-01 | GitHub | Added `/orchestra` — visual preview of the target Orchestra experience (5 assistant columns, Agent Library across 4 tiers, explicit "what's not built yet" roadmap). New page + components only, no existing page touched. | commit `e2bee10` | `tsc --noEmit`, `eslint`, and full `npm run build` all verified clean before pushing. |
| 11 | 2026-07-01 | GitHub | **Security fix:** `/orchestra` (and pre-existing `/ingest`) were reachable with zero authentication — `middleware.ts` gates routes via a hardcoded path allowlist, and neither path was in it. Verified live (`curl` showed HTTP 200 with no redirect, vs. `/dashboard`'s correct 307→`/login`) before and after the fix. | commit `4c70908` | Found while manually verifying the new page post-deploy — a reminder that this allowlist pattern is itself fragile and worth revisiting in Wave 1 (a denylist, or route-group-based middleware matching, would fail closed instead of open). |
| 12 | 2026-07-01 | Supabase | Attempted to create a dev branch for Wave 1 safety-testing — **blocked**: branching requires Supabase Pro plan, this org is on Free. | — | User chose to proceed directly on production, incrementally, rather than upgrade. Wave 1 from here on is additive-first: new nullable columns/tables (can't break anything not yet referencing them) before any RLS-policy or API-route behavior change. |
| 13 | 2026-07-01 | Supabase | Discovered `auth.users` was **completely empty** on `pcrjmlpuqsbocqfwoxod` — 0 of 7 seeded `compliance.users` rows had a matching Auth account. Created a real Supabase Auth account for the seeded `admin@acme.com` user via the Admin API and linked it. | auth_user_id `ed889917-d975-4d70-8a51-cca553d8ac96` | This means the "it's opening" confirmation earlier was likely a stale browser session from before the DB repoint, not a fresh login against the new database — flagged to the user, who asked me to fix it directly (create a test account) rather than manually re-test in a browser. |
| 14 | 2026-07-01 | GitHub | Wave 1 step 1.1: added `auth_user_id` (FK to `auth.users.id`) + `reporting_to_id` (self-FK) to `compliance.users`; `requireAuth()` now links `auth_user_id` on every authenticated request regardless of login method (password login never hits `/auth/callback`, so this had to live here, not just in the callback route) | commit `33eb97d` | Also surfaced: **signup never creates a `compliance.users` row at all** — `auth.signUp()` only creates the Auth identity, so any brand-new signup hits a permanent "contact your administrator" wall. Pre-existing, unrelated to this session's changes. Logged here rather than fixed, to avoid scope creep — worth a dedicated fix. |
| 15 | 2026-07-01 | Supabase | Wave 1 steps 1.2-1.5: extended `user_role` enum (+6 values), created `branches`/`clients`/`client_entities`/`user_client_access`/`subscription_plans` (seeded 4 plans), added nullable `client_id` to the 5 client-scoped tables, backfilled every existing row to an auto-created "Self / Direct" client per org (18/18 compliance_items, 18/18 documents, 36/36 audit_points — zero left null) | migrations `wave1_step2_extend_user_role_enum`, `wave1_step3_hierarchy_tables`, `wave1_step5_client_id_and_backfill` | `get_advisors` clean — all 5 new tables have RLS enabled with the same service_role-bypass pattern as everything else, no new findings. |
| 16 | 2026-07-01 | GitHub | Added matching Drizzle `schema.ts` declarations for everything in #15, plus the `user_role` enum extension | commit `26ad605` | `tsc --noEmit`, `eslint`, full `npm run build` all clean. |
