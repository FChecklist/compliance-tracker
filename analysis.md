# VERIDIAN AI Orchestra — Phase 1 Discovery Analysis

**Scope of this document:** Phase 1 only (Discovery), per the master prompt's own gate ("Do NOT proceed to Phase 2 until you have produced and shown me all three maps") and per explicit instruction: *"dont change anything without full analysis."*

No schema changes, no migrations, no code changes have been made. This document is the output of reading the actual repository at commit `df59c34` on `main` — not the `ai-os/boss/BOARD.yaml` self-reported status, not prior chat memory. Where those sources disagree with the code, the code wins and the discrepancy is flagged below.

---

## 0. Reality Check (read this first)

1. **This repo is much more real and further along than prior session notes suggested.** It is a working Next.js 16 + Bun + Drizzle ORM + Supabase app with 19 real tables, 25 real page routes, 27 real API routes, a working Groq-based AI orchestrator already branded "Veridian AI", a working MCP server exposing compliance tools to external AI clients, and pgvector embeddings already wired with a fallback. This is not a shell.
2. **The repo's own governance layer over-reports its health.** `ai-os/boss/BOARD.yaml` claims `ai_os_score: 9.8/10`. The repo's own CEO-style review (`review_of_vedian.md`, written by a prior Claude Code session) is more honest and lists unresolved critical/high issues. Some of those (auth guard on API routes, dead Prisma/next-auth removal) were fixed in later commits per BOARD.yaml. **One was not:** multi-tenancy enforcement (REC-11) — flagged below as the single biggest blocker to anything in the new master prompt.
3. **This exact product vision has already been half-articulated in this repo**, in `features_to_be_added_claude.md`: "AI is pluggable: customer uses their own OpenAI/Anthropic/Groq key (BYOK)... Data Out: customer's own AI (via API key)... MCP server interface." The VERIDIAN AI Orchestra master prompt is a much more elaborate, formalized version of an idea this repo was already reaching for. That's good — it means less is being thrown away than it looks — but it also means there's a risk of building a second, parallel "AI-native" framework (pgvector loops, orchestra layers, 15 self-improvement loops) on top of a first one (`ai-os/` YAML governance) that already exists and that `CLAUDE.md` explicitly forbids touching.
4. **Governance constraint already in the repo:** `CLAUDE.md` says *"DO NOT touch: `.claude/`, `CLAUDE.md`, `AGENTS.md`, `SENTINEL.md`, `ai-os/`"*. This analysis and any future orchestra work will respect that — new work should live alongside, not inside, those paths, or that rule needs to be explicitly revisited with you first.
5. **`ai-os/engines/ENGINES.yaml` currently grants Z.ai and Claude Code `FULL_ACCESS` (merge PRs, delete branches, run migrations, deploy to Vercel) across all three FChecklist repos** (compliance-tracker, meettrack-v2, veda-advisors), authorized "by VEDABOSS." Per your instruction I am only touching `FChecklist/compliance-tracker` in this session — noting the standing grant exists in case it's not what you intend long-term.

---

## 1. SCHEMA MAP (actual, from `src/lib/db/schema.ts` + `drizzle/*.sql` + `supabase/migrations/create_pgvector.sql`)

Postgres schema namespace: `compliance` (isolated from `public`). ORM: Drizzle. **No `.sql` file in this repo contains a `CREATE POLICY` or references RLS anywhere — confirmed by direct grep of every migration file. Row Level Security is not implemented at the database level today.** All tenant isolation is (partially) app-code-level `orgId` filtering.

### Enums (9)
`user_role` (admin/manager/member/viewer) · `compliance_status` (pending/in_progress/completed/overdue/not_applicable/draft) · `priority` (low/medium/high/critical) · `compliance_type` (GST/TDS/MCA/PF/ESIC/INCOME_TAX/ROC/LABOUR/ENVIRONMENTAL/OTHER) · `notification_type` (deadline_reminder/assignment/status_change/comment/system/mention) · `audit_action` (create/update/delete/status_change/assign/reassign/login/logout/export/invite) · `recurrence_type` (none/monthly/quarterly/half_yearly/annually) · `notice_status` (received/in_progress/replied/closed/appealed) · `ai_provider` (groq/openai/anthropic/google) · `webhook_event` (item.created/item.completed/item.overdue/notice.received/challan.recorded/item.status_changed)

### Tables (19)

| Table | Purpose | Key columns | FKs (app-level, no DB constraint enforced) | Notes |
|---|---|---|---|---|
| `organisations` | The tenant (a single firm/company) | id, name, slug, plan, entityType, trialStartsAt/EndsAt, isReadOnly | root | **No concept of "clients served by this firm"** — see Gap Analysis §A |
| `departments` | Org sub-teams | id, orgId, headId | → organisations, users | |
| `users` | App users | id, orgId, departmentId, role (4 values), passwordHash | → organisations, departments | Auth identity via Supabase Auth; role synced by email lookup |
| `compliance_items` | Core compliance record | id, orgId, departmentId, assignedToId, complianceType, status, priority, dueDate, period, financialYear, acknowledgementNumber, registrationNumber, recurrenceType/ParentId, amount | → departments, users, self (recurrence) | Central entity |
| `challans` | Tax payment records | id, complianceItemId, orgId, bsrCode, challanSerialNumber, amount | → compliance_items, users | |
| `notices` | Govt notices/SCN | id, orgId, departmentId, assignedToId, complianceItemId, demandAmount, replyDeadline, status | → departments, users, compliance_items | |
| `audit_points` | Sub-checklist per compliance item | id, complianceItemId, assignedToId, status, dueDate | → compliance_items, users | |
| `documents` | Uploaded files | id, complianceItemId, noticeId, fileUrl, extractedData (jsonb) | → compliance_items, notices, users | **Files are URLs only — no real Supabase Storage upload wired yet** |
| `comments` | Threaded comments | id, entityId, entityType, authorId, complianceItemId | → users, compliance_items | |
| `notifications` | In-app notifications | id, userId, type, isRead | → users | |
| `audit_logs` | Audit trail | id, action, entityType, entityId, userId, ipAddress | → users | Actor is sometimes hardcoded ("adminUser") per prior review — verify in current code before relying on it |
| `api_keys` | Customer's outbound API keys (Open API) | id, orgId, keyHash, keyPrefix, scopes | → organisations | For customers calling *this* platform's API |
| `webhooks` / `webhook_deliveries` | Outbound event delivery | id, orgId, url, secret, events; deliveries: statusCode, payload, attempt | → organisations | |
| `ai_configurations` | **BYOK AI config (per-org, DB-level)** | id, orgId, provider (groq/openai/anthropic/google), encryptedApiKey, useForExtraction/QA/Drafting | → organisations | **Table exists in schema.ts but the live API route (`/api/settings/ai-config`) does NOT use it — see Gap Analysis §B** |
| `embeddings` | Semantic search store | id, entityType, entityId, contentHash, content, orgId; `embedding vector(1536)` added via raw SQL migration, HNSW cosine index | → organisations (soft) | Real pgvector, real HNSW index, already exists |
| `mcp_access_codes` | Bearer tokens for the MCP server | id, orgId, token, name, isActive, lastUsedAt | → organisations | This is the working precursor to "user gets an API/access token to hand to any AI" |
| `onboarding_steps` | Per-user onboarding checklist | id, userId, step, completed | → users | |
| `ingestion_batches` / `ingestion_items` | Bulk import pipeline (xlsx/csv/pdf → staged rows → confirm) | batch: orgId, uploadedById, status, aiModel; items: batchId, extracted fields, confidence, reviewStatus | → organisations, users, ingestion_batches | Already AI-assisted (extraction), already has a human-review-then-confirm step |

### RLS Policies
**None exist.** `/api/mcp/route.ts` explicitly uses the Supabase **service-role** client, commented `"bypasses RLS for token lookup"` — meaning even if RLS were added to the DB today, this route already routes around it by design (which is fine *if* it re-derives and enforces `orgId` scoping itself in application code, which it currently does consistently in every query shown).

### Indexes
Only one explicit index found: `embeddings_cosine_idx` (HNSW, `vector_cosine_ops`, m=16, ef_construction=64) and `embeddings_entity_idx` (btree on entity_type, entity_id). No indexes on `orgId` columns anywhere else, no indexes on `dueDate`, `status` for the dashboard's hot queries.

---

## 2. FEATURE MAP (actual, from `src/app` route tree)

### Pages (`src/app/(app)/*`, all middleware-auth-protected)
Dashboard · Compliance (list/detail/new) · Checklists (list/detail) · Tasks (Kanban, drag-drop via @dnd-kit) · Reports (charts + data table) · Penalties (overdue + manual calculator) · Departments (list/detail) · Users · Audit log · Team · Notices (list/detail/new) · Ingest (bulk import UI) · Settings (profile/org/AI config/API keys/webhooks) · Help

Plus public: Landing (`/`), Login (password + magic link), Signup, Pricing.

### API Routes (`src/app/api/*`, 27 routes)
- **Compliance:** CRUD, `[id]/comments`, `import`, `overdue`, `recur`, `stats`
- **Notices:** CRUD, `stats`
- **Challans:** CRUD
- **Audit:** points CRUD, log query
- **Departments, Users:** CRUD/list
- **Documents:** `extract` (AI extraction)
- **Ingestion pipeline:** upload → `[batchId]` → `items/[itemId]` → `confirm`
- **AI:** `ai/orchestrate` (Groq-powered "Veridian AI" event orchestrator — document.uploaded / item.overdue / notice.received / deadline.approaching), `search/semantic` (pgvector search)
- **MCP:** `/api/mcp` (JSON-RPC 2.0 tool server — 7 tools, Bearer-token-to-org resolution), `/api/mcp/tokens` (issue/manage those tokens)
- **Settings:** `ai-config` (BYOK — currently in-memory stub, see gap below), `api-keys`, `webhooks`
- **Notifications, health, me**

### Already-working AI-native surface (important — don't rebuild what's already here)
- "Veridian AI" branded Groq orchestrator generating event-driven suggested actions with graceful non-AI fallback.
- Real pgvector embeddings + semantic search endpoint.
- A working MCP server that already implements "give your own AI a token, let it read/write your compliance data" — the core of the master prompt's "User AI Assistant gets an API/access token" concept already has a functioning prototype here, scoped to one org.
- A `document.extract` AI pipeline and a full ingestion-batch human-review workflow (AI proposes, human confirms) — this is a working example of the "guardrail before automation acts" pattern the master prompt wants generalized.
- `ai_configurations` DB table for BYOK already designed (though not yet wired to the live route).

---

## 3. GAP ANALYSIS — what exists vs. what VERIDIAN AI Orchestra (master prompt) asks for

Mapped against the master prompt's own section letters.

### §A — Organizational Hierarchy: **Largest structural gap**
- Master prompt wants: VERIDIAN (platform) → Customer Account (firm) → Branch → User, **plus** Customer → Clients → Client Entities, with an 8-role ladder (VERIDIAN Admin, Firm Admin, Branch Manager, Senior Professional, Professional, Team Member, Client Viewer, External Auditor) and depth-based visibility rules.
- Reality: `organisations` **is** the tenant, and it has no child concept of "the clients this firm services." The app today models a company tracking *its own* compliance, not a CA firm tracking *many clients'* compliance. `departments` is the only sub-grouping, and roles are a flat 4 (admin/manager/member/viewer) with no reporting-hierarchy or visibility-depth logic.
- **This is not a schema tweak — it's a new layer.** Every existing row needs to be reinterpreted as belonging to *one specific client* under a customer account, or the product needs an explicit decision that (for now) org == client == account (single-entity firms only) with the firm/client split added later. Worth a decision from you before Phase 2 schema design starts, since it changes almost every table's tenant key.

### §B — AI Assistant System (5 per user, persistent memory, embeddings)
- Reality: no per-user "assistant" concept at all. AI today is a single stateless orchestrator function (Groq) plus a BYOK config table (`ai_configurations`) that is **defined at org level, not user level**, and — critically — the live `/api/settings/ai-config/route.ts` doesn't even use that table: it's an **in-memory object, single hardcoded `orgId = "default"`, base64 "obfuscation" instead of encryption**, wiped on every server restart. This is a stub, not a feature, despite the DB table existing.
- Gap: need `ai_assistants` (5/user), `assistant_memories` (pgvector — the repo already has a working embeddings pattern to copy), `assistant_sessions`, `assistant_metrics_daily`. Also need to actually wire `ai_configurations` to a real route with real encryption (pgcrypto or Supabase Vault), and extend it to be settable per-assistant, not just per-org.

### §C — Worker Agent Library (4 tiers, versioned, immutable global tier)
- Reality: nothing like this exists. The closest analog is the MCP tool list (7 fixed tools, hardcoded in `route.ts`, not versioned, not tiered, not embedded/searchable). No `worker_agents` table, no learnings/versioning/usage-log tables.
- This is entirely new build, but the MCP tool-handler pattern (`handleTool(name, args, orgId)`) is a reasonable execution substrate to extend rather than replace.

### §D — Task System (task_execution_plan, task_agent_executions, task_chat_messages)
- Reality: `compliance_items` + `audit_points` + `comments` cover "a unit of compliance work," but there's no generic "task given to an AI assistant" concept, no execution-plan/step log, no per-assistant chat thread. `ingestion_batches`/`ingestion_items` is the one place with something structurally similar (batch → items → review → confirm), and is a good template to generalize from.

### §E — Orchestra Layer System (5 layers, per-layer model config, BYO model per layer)
- Reality: one layer exists — a single Groq call in `ai/orchestrate`. No layer registry, no per-layer model routing, no `customer_model_config` for BYO model. `ai_provider` enum already lists groq/openai/anthropic/google, which is a useful starting point for the provider abstraction the master prompt wants generalized across 5 layers.

### §F — 15 Self-Improvement Loops
- Reality: none exist as data/process. The repo's `ai-os/` YAML governance (BOARD.yaml, SENTINEL.yaml, ENGINES.yaml, LIFECYCLE.yaml) is a **file-based, human/agent-read manifest system**, not a running, measured, self-improving loop with observe/analyze/act/measure tracked in the database. It's documentation of intent, not telemetry of outcomes. Before adding 15 new loop-tracking tables, worth deciding whether `ai-os/` is meant to be the loop system's source of truth (in which case it needs to move from YAML to DB-backed telemetry) or whether the new loop tables are a separate, parallel thing.

### §G — Knowledge Flow & Separation (anonymized upward flow, cross-tenant leak audits)
- Reality: none. No anonymization pipeline, no `knowledge_flow_log`, no `data_separation_audit`. **This section assumes RLS-enforced isolation already exists as a foundation — it does not (see §0.2 and the Schema Map RLS note).** Building knowledge-flow-with-anonymization on top of a database with zero RLS and app-code-only tenant filtering is the wrong build order.

### §H — Preserved Business Data
- Every current business table (compliance_items, notices, challans, audit_points, documents, comments, notifications, audit_logs, webhooks, ingestion pipeline) has a clear, preservable mapping into the new architecture — nothing here needs to be thrown away. The main work is adding `customer_account_id`/`client_id` columns (per §A's resolution) and embedding columns where semantic search is wanted (documents, notices already have `extractedData`/description text that could be embedded using the existing `lib/embeddings.ts` pattern).

### Critical sequencing flag (this is the main thing worth deciding before Phase 2)
The master prompt's own rule #2/#3 are: *"NEVER put customer A's data in a query that could return customer B's data — enforce at the SCHEMA level with RLS"* and *"NEVER make vector search bypass RLS."* Today:
- There is **no RLS at all** in this database.
- The MCP route **intentionally** uses a service-role client that bypasses RLS by design, relying entirely on hand-written `org_id` filters in every query.
- The prior review flagged multi-tenancy enforcement as unresolved (REC-11) and it's not evidenced as fixed in BOARD.yaml's completed list.

Building a 4-tier agent hierarchy, 15 self-improvement loops, and BYO-model routing on top of this foundation, before fixing tenant isolation at the schema level, would mean the most elaborate, highest-blast-radius parts of the new system (agents reading/writing across tiers, knowledge flowing "up" between customers) get built on a database that cannot currently guarantee one customer's data stays out of another customer's queries. Recommend treating **RLS + tenant-key redesign (§A decision) as Phase 2 Wave 1**, ahead of the AI-assistant/worker-agent/loop tables, even though the master prompt lists them all together.

---

## What I did NOT do (by design, per your instruction)
- No schema changes, no migrations, no new tables, no RLS policies added.
- No changes to `ai-os/`, `CLAUDE.md`, `AGENTS.md`, `SENTINEL.md`, `.claude/` (respecting the repo's own stated rule).
- No changes to any other FChecklist repo.
- Did not touch Supabase or Vercel in any way.

## Next step
Per the master prompt's own gate, this is where Phase 1 stops for your review. `orchestra_changes.md` (companion file, also being added in this same commit) lays out the proposed Phase 2/3 execution order — nothing in it has been executed yet. Once you've reviewed the §A hierarchy decision and the RLS sequencing flag above, tell me which wave to start on and I'll begin, logging each change in `orchestra_changes.md` as it's done, GitHub first, then Supabase, then Vercel, exactly as instructed.
