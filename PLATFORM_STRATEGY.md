# VERIDIAN AI — Platform Strategy & Master Build List

**Status:** Strategic direction, recapped and consolidated from an extended planning session. This document is the single source of truth for "what VERIDIAN AI is becoming and what has to be built to get there." Update it as decisions change — do not let it go stale like a one-off chat summary would.

**Owner:** raajat.agarwal@gmail.com

---

## 1. The Pivot: From a Product to a Platform

VERIDIAN AI started as a single GRC compliance-tracking product (the current `compliance-tracker` app — 97 API routes, ~40 GRC modules, multi-tenant hierarchy, live in production). The decision made in this planning cycle is that **VERIDIAN AI becomes the platform underneath multiple products**, not just one more feature-complete app.

Concretely, this platform must let us:
- Build new products fast (Sales, HR, SCM, Project Management, and vertical-specific tools like construction/interiors PM) by reusing one architecture, one design system, one AI-tiering strategy — not rebuilding from scratch each time.
- Sell the same underlying platform multiple ways: direct SaaS, **BYOB** ("bring your own AI model/brain" — customer supplies their own model access instead of paying for ours), white-label to resellers, and custom-built apps for individual clients who need something bespoke.
- Let external surfaces — a customer's own AI (ChatGPT, Claude Desktop, a custom agent), a future VERIDIAN mobile app, a reseller's white-labeled web app — all consume the **same underlying API library**, scoped per product/project/client, rather than each surface being a bespoke reimplementation.

**Why this pivot, in the user's own framing:** "Today we are a small software company. We don't get developers. Also the times have changed. 99% customers have similar demands like project management tools, sales tools, HR tools etc. So we bring down our cost. We offer them SaaS. They use a new AI-Engineered product and we scale faster." The constraint (small team, can't out-hire competitors) is answered by leverage (one platform, many products) rather than by headcount.

---

## 2. Brand Architecture

- **Master brand: "VERIDIAN AI — One Truth"** — the platform itself.
- **Product branches**, each inheriting the same architecture, cost-optimization, and AI-tiering:
  - VERIDIAN AI **GRC** (current `compliance-tracker` — governance, company secretarial, legal, HR/POSH, sector regulators, risk, audit, ESG, incidents, access/approvals — ~40 modules already built)
  - VERIDIAN AI **Sales**
  - VERIDIAN AI **HR**
  - VERIDIAN AI **SCM**
  - VERIDIAN AI **Project Management** — first concrete vertical target: **construction & interiors project management** (candidate names generated using the same portmanteau technique as VERIDIAN itself — VERI(tas) + (Guar)DIAN — candidates: BUILDIAN, VERIBUILD, OBRAVERA, PLUMBLINE, STRUVERA; not yet finalized)
- Each branch can be **white-labeled and resold** by partners/resellers — this is a deliberate revenue channel, not an afterthought, so branding/theming must be a configuration, not a code fork.

---

## 3. Business Model & Go-to-Market

### Market sequencing
1. **India first**, price as the dominant parameter — most small Indian/UAE/USA/EU companies do not care about SOC2/ISO certifications; price and outcome quality decide.
2. **Mid-size and large companies in USA/Europe** are the segment that *does* need SOC2 Type II / ISO27001 / GDPR data residency — this is a **segment-tiered requirement, not a universal one.** Don't over-invest in certification-driven infrastructure for the India/SMB segment; don't under-invest for the USA/EU enterprise segment.
3. Thesis for timing: open-source and Chinese AI models are closing the quality gap fast (expect a further step-change by ~Oct 2026) — cost-performance-per-task becomes the dominant factor over brand loyalty to any one model provider. Architecture must stay model-agnostic (see §5) to keep riding this curve rather than being locked to one vendor's pricing.

### Selling motions (all riding the same platform)
- **Direct SaaS** — VERIDIAN AI GRC/Sales/HR/etc., sold per branch.
- **BYOB (bring your own AI model)** — customer supplies their own model/API key at the account or workflow level; VERIDIAN charges for the platform/orchestration, not the tokens. Lowers our AI-cost exposure and appeals to price-sensitive segments.
- **White-label / reseller** — a partner rebrands a product branch and resells it; requires the platform (not just one app) to be genuinely multi-tenant at the *reseller* level, not only at the end-customer level.
- **Custom client apps** — for a client with bespoke needs, we build a purpose-specific app **on top of the shared API library**, not as a one-off codebase. This is the core reason §7 (API/service-layer architecture) matters — without it, "custom app for a client" means a fourth bespoke reimplementation every time, which defeats the entire cost/speed thesis.

### Cost & compliance floor (non-negotiable regardless of price pressure)
- Never use an AI provider that forces training-opt-in with no alternative (ruled out: Mistral free tier, NVIDIA NIM hosted tier) for any layer touching real customer content — this protects VERIDIAN's own liability, independent of what a given customer is willing to accept.
- Confidentiality floor: POSH/Whistleblower complaint content is never a stored column or present in audit logs/AI training data — case reference and metadata only, always.
- External data connections (customer's own ERP/SAP, Google Drive, customer's own database) are **mediated sync only** — API/webhook/staging-table. Never a raw database-to-database link, never a live foreign credential held by either side. This applies directly to the "BYO database" and "customer downloads their data" requirements below.

---

## 4. Competitive Position & Compliance Reality (verified, not assumed)

Full gap analysis run against Vanta / Drata / OneTrust. Defensible whitespace: India statutory/corporate compliance depth (none of the three has this). Real, honest gaps: no live evidence-integrations (Vanta/Drata's core loop), no regulatory-change auto-tracking yet.

**Vendor certification/data-handling terms** (checked directly, not assumed — relevant to the USA/EU enterprise segment in §3):
| Vendor | SOC2 | ISO27001 | EU data residency / GDPR posture |
|---|---|---|---|
| Vercel | Type 2 | Yes | EU-US DPF |
| GitHub | Type 2 | Yes | — |
| Supabase | Type II | Yes | Report/certificate download gated to Team ($599/mo)+ plans |
| Anthropic (first-party API) | Type I & II | Yes (+ ISO42001) | **No EU residency via first-party API** — Bedrock/Vertex required for that |
| xAI (Grok) | Type 2 | — | Enterprise/API DPA + Zero Data Retention option available — passes the compliance floor |
| NVIDIA NIM | — | — | **Hosted/free tier trains on data by default — fails the floor, do not use for real customer content** |
| OpenRouter | — | — | Own DPA is Enterprise-tier-gated; maintains a **PRC-jurisdiction subprocessor blocklist** (Alibaba/Baidu/DeepSeek/Moonshot/Xiaomi/Z.AI are blocked) |

This last row is why the AI-tiering plan below deliberately does **not** include DeepSeek R1 or Qwen3 Coder for OpenRouter-routed layers, despite their price/performance appeal — an earlier draft of this plan recommended them before this check was actually run, and that was a real mistake, corrected here.

---

## 5. The AI Orchestra Engine (segment-tiered, cost = outcome in weighting)

This is a real, already-built subsystem in the GRC branch, and the platform requirement is that every future product branch runs on the *same engine*, not a reimplementation. Grounding it in the actual schema — and stating plainly what's genuinely wired up versus what's configured-but-dormant, since that distinction was muddled in an earlier draft of this document:

### The 5 Orchestra Layers — 5 seeded, only 1 of 5 has real code invoking it today

`orchestraLayers` (`layer_key`, `layer_order`, each with its own `defaultModelConfig`):

| Order | `layer_key` | Name | Status (verified against the codebase, not assumed) |
|---|---|---|---|
| 1 | `task_oa` | Task Orchestra Agent | **Active** — the only layer with real call sites: `src/app/api/ai/orchestrate/route.ts` and `src/lib/task-execution-engine.ts` both call `resolveModelConfig(orgId, "task_oa")`. This is what actually plans and dispatches work today. |
| 2 | `user_assistant_oa` | User Assistant Orchestra Agent | **Seeded, dormant.** No code calls `resolveModelConfig` with this key. This is meant to be the layer behind the 5 per-user `aiAssistants` — but those are themselves dormant (provisioned on signup, `GET`/`PATCH` only, no orchestration hook uses them yet). Building this layer's real invocation path and giving the 5 assistants something to actually do are the same piece of unbuilt work. |
| 3 | `customer_account_oa` | Customer Account Orchestra Agent | **Seeded, dormant.** No real call site. Intended to be account-level orchestration (cross-task, cross-user reasoning at the org level) — not built. |
| 4 | `global_intelligence_oa` | Global Intelligence Orchestra Agent | **Seeded, dormant.** No real call site. Intended to be the cross-customer (anonymized) intelligence layer the loop system's "knowledge flows up anonymized" principle depends on — not built. |
| 5 | `meta_oa` | Meta Orchestra Agent | **Seeded, dormant.** No real call site. Intended to be the layer that reasons about the *other 4 layers'* performance — the AI-OS's self-awareness layer. Not built. |

**Say this plainly, since it matters for what "build it properly" actually means: the Orchestra Engine today is one working layer (`task_oa`) plus four correctly-modeled, correctly-seeded, but functionally inert placeholders.** That is not a criticism of the architecture — the schema/dispatch shape (`orchestraLayers` + `customerModelConfig` + `resolveModelConfig`) is sound and is exactly what the other 4 layers will plug into once built — but it is the honest current state, and the TODO list below now reflects it as real, sequenced work rather than something to gloss over as "already built."

Two more real, working pieces of the engine, distinct from the 5 layers above:
- **`workerAgents`** — 4 tiers, the actual dispatchable units of work: **`global`** (platform-managed, immutable, available to every customer — "for everyone," in the user's own framing), **`customer`** (scoped to one org/account), **`client`** (scoped to one client/project within an account — this is the "product/project-specific agent" tier), **`user`** (scoped to one individual). Only the `global` tier has real dispatch code today (`DISPATCHABLE_TOOLS` in `task-execution-engine.ts`, read-only tools only); `customer`/`client`/`user`-tier agents can exist as rows but nothing dispatches to them yet.
- **`aiAssistants`** — 5 numbered assistants auto-provisioned per user (`assistantNumber` 1–5) — real rows, real provisioning on signup, but dormant per the `user_assistant_oa` note above.
- **`loopDefinitions`/`loopExecutions`/`loopImprovements`** — the self-improvement loop system (see below) — genuinely active, 11 of 15 loops, distinct from and cross-cutting across the 5 orchestra layers (a loop can observe/analyze/act on data flowing through any layer; it is not itself a 6th layer).

### Model tiering (applies once a layer is actually built and invoked)

| Target | Purpose | Starter tier (price-led) | Enterprise tier (compliance-gated) |
|---|---|---|---|
| `task_oa` (active today) | Per-task reasoning | Sonnet 5 | Sonnet 5 |
| `customer_account_oa` (not yet built) | Account-level orchestration | Haiku 4.5 | Haiku 4.5 |
| Loop system — stats-only loops | No real customer content | Free OpenRouter models (Llama 3.3 70B / NVIDIA Nemotron 3 Ultra — **not** DeepSeek/Qwen, see §4) | Llama 3.3 70B / Nemotron |
| Loop system — real-content loops | Touches actual customer data | Haiku 4.5 | Haiku 4.5, or customer's own BYOB model |

(The loop system's stats-only/real-content split is a property of *individual loops*, not of `user_assistant_oa`/`global_intelligence_oa`/`meta_oa` — an earlier draft of this table conflated the two, implying a clean 1:1 "layer 3 / layer 4" mapping that doesn't actually exist in the schema.)

**Law: every layer is independently model-agnostic.** Any layer, for any product branch, must be pointable at any supported external AI provider (Anthropic/OpenAI/Google/Groq today, via the provider-agnostic `callLLM`/`callLLMJson` in `src/lib/llm-client.ts`) without touching the layers around it. This is what makes BYOB and the "ride the open-source cost curve" thesis (§3) actually work — never hardcode a provider inside a layer's logic. This law applies equally to `task_oa` today and to the 4 dormant layers once they're built — the model-agnostic dispatch shape doesn't need to be re-invented when they are.

### BYO-AI exists at three levels — one platform option plus two "bring your own," only the org-level one is built today

1. **Take VERIDIAN's own AI (platform default)** — built and is the default for every layer (`orchestraLayers.defaultModelConfig`). A customer or user who does nothing gets this — no setup required, matching the "ease of use" design principle established for the product UI.
2. **Customer/org brings their own** — built (`customerModelConfig`, keyed by `orgId`, optionally narrowed to one `orchestraLayerId`). An org admin can override the platform default with their own provider/key for the whole account.
3. **Individual user brings their own** — **not built.** `customerModelConfig` has no `userId` column — a single user overriding *their own* usage with a personal key (distinct from their org's default, and distinct from just using the platform default) is not possible today. This is a real, confirmed gap (checked directly against the schema), not just a documentation omission — see the TODO list.

### Loop Engineering
The self-improvement loop system (`loopDefinitions`/`loopExecutions`/`loopImprovements`/`loopHealthMetrics`) is the mechanism by which the platform gets better at its own job over time — observe → analyze → act → measure, with rollback tracked (`rollbackTriggered`) so a bad automated change can be reversed. 11 of 15 spec'd loops are active today (Wave 5). One loop (`loop-engineering-audit.ts`) audits the loop system itself — the engine watches its own health, not just the product's. Every future product branch inherits this loop framework rather than building its own observability from scratch.

### Prompt Caching
Assumed in this platform's own cost modeling (the blended per-call cost figure used throughout this document's earlier drafts was computed *with* caching) but never stated as an architectural requirement until now: every layer's prompt construction must be structured to maximize cache-hit rate (stable system-prompt/tool-definition prefix, variable content appended after) — this is not optional cost hygiene, it is load-bearing for the unit economics the whole pricing thesis (§3) depends on.

### Prompt Management
`workerAgentVersions` already exists in schema — every worker agent's `promptTemplate` is versioned with a changelog, not silently overwritten. This is the platform's prompt-management system: a prompt change is a new version, not a mutation, so behavior regressions are traceable to a specific version bump. Applies to every layer's prompts, not just worker agents — Task OA/Customer Account OA system prompts should follow the same versioned-not-mutated discipline as they mature.

Cost control mechanism: **rate-limiting + quota, not device-lock.** Device-lock only solves identity/sharing; it does nothing to bound volume or cost. Both are needed, but they solve different problems — don't conflate them when designing usage limits.

---

## 6. Platform Architecture Principles (what "AI-native, AI-OS" actually requires)

These are the requirements behind "an independent platform with 99% of what most mid-size businesses need," restated as concrete build targets:

1. **Global multi-tenant hierarchy**, reused across every product branch: Account (reseller/direct) → Client → Client Entity → Users, with role-based access already at 10 ranks (`ROLE_RANK`). This exists today in the GRC branch's schema — the platform requirement is that every *new* product branch scopes into the same hierarchy rather than inventing its own tenancy model.
2. **No-code workflow/approval creation via chat.** A customer admin should be able to type "when a purchase order exceeds ₹5L, route it to the regional head then finance" into the compose bar and have VERIDIAN generate the actual approval chain — reusing the existing generic maker-checker (`approvalRequests` table) as the execution engine, but currently that table is wired for exactly one flow (Policy publish). Generalizing it to arbitrary customer-defined chains is unbuilt.
3. **Bidirectional voice.** Compose bar already has a mic input (UI mocked); actual speech-to-text and text-to-speech, plus VERIDIAN *speaking back*, is unbuilt.
4. **Business-card / document auto-capture.** Photograph a business card or vendor document, VERIDIAN extracts structured contact/vendor data automatically — the document-ingestion pipeline (`src/lib/ingest/`) already exists for compliance evidence; this needs a contact/vendor-specific extraction path added.
5. **BYO relational database.** Customer can point VERIDIAN at their own Postgres instance for a mirror/export of their data. Must stay mediated (§3) — no raw cross-database link. Currently: only standard Supabase Postgres via Drizzle exists; there's no export/mirror pipeline yet.
6. **BYO AI model**, at both the account level and (more granularly) per workflow — the dispatch mechanism (`customer_model_config`/`resolveModelConfig`) already exists in the GRC branch; needs to be exposed as a first-class setting in every product branch, not re-derived per branch. See §5 for the per-user level of this, which is a confirmed gap, not yet built.
7. **Full data portability.** Customer can request and receive their complete data export (approved by VERIDIAN, per the mediated-sync principle) if they want to migrate off. Standard Postgres via Drizzle already makes the underlying data non-proprietary; the actual "request export" user-facing flow doesn't exist yet.
8. **Adaptive, one-codebase-many-devices UI.** Same interaction language scales from mobile to desktop without being two separate products — this is exactly what the mobile app template (§8) is the reference implementation of, and what any new product branch must inherit rather than redesign.
9. **Every action time/date/actor-stamped**, immutable audit log — already built for the GRC branch (`auditLogs` with denormalized actor snapshots, DB-level immutability grant); needs to be the *shared* logging path every product branch writes through, not re-implemented per branch.
10. **BYO vector database — VERIDIAN-mediated, never customer-direct.** A customer may supply their own vector database (for embeddings/RAG) instead of using VERIDIAN's integrated one (today: Supabase `pgvector`, the `embeddings` table) — but even then, VERIDIAN AI's engine remains the *sole* reader/writer. The customer never gets a raw connection string or direct query access to the vector store, for the same reason as the mediated-sync principle in §3: an AI substrate is more sensitive to silent leakage/tampering than a plain data mirror, since it's the thing the AI actually reasons from. Not yet built — today there is only the one integrated pgvector path.
11. **AI usage is scope-bound to what a product/project/user has rights for — technically enforced, not just policy.** Every AI assistant/agent invocation must stay inside the boundary of the product/project/client/user it's assigned to; a GRC-scoped assistant must not be repurposable for unrelated work just because the underlying model is general-purpose. `workerAgents`' 4-tier system (global/customer/client/user) and RLS already enforce *data* isolation correctly, but nothing today enforces *purpose* isolation for open-ended conversation/task requests — this is a real, unsolved gap, not yet built for any layer.
12. **API access must be scopable below the account level.** So a customer can "connect their part of a project/product/user/account to an external product" (their own phrase) — not just their whole org. Today `apiKeys` (the Wave 9 unified credential) is `orgId`-scoped only, with no `clientId`/`userId` column — there is no way to mint a key that only sees one client's data or one user's assigned work. Needed for real BYO-integration use cases (a reseller giving one of their clients a key scoped to just that client, or a user connecting just their own tasks to a personal automation) — not yet built.

---

## 7. The API/Service-Layer Gap — What Actually Makes "Build Apps On VERIDIAN AI" Possible

This is the concrete technical finding from the architecture review that directly determines whether §1's platform vision is achievable or just aspirational. This was the highest-priority build item in this entire document because *every other multi-surface goal (mobile app, ChatGPT connector, Claude connector, reseller white-label, custom client app) depends on it* — **Waves 9-11 (below) closed it for the 3 highest-traffic domains.** Full original finding preserved below for the historical record; current status follows.

**Original state (verified against the live repo before Waves 9-11, not assumed):**
- All 97 API routes were Next.js Route Handlers with business logic written *inline* — no service layer a non-web surface could call into directly. An earlier plan for shared `@compliancetrack/types`/`@compliancetrack/db` packages was never actually built; the app was a flat monolith.
- **95 of 97 routes only accepted Supabase session cookies** (`requireAuth()`) — unusable by a mobile app, ChatGPT, or any non-browser client.
- **Two separate, half-built external-access mechanisms existed and didn't talk to each other:**
  - `apiKeys` table + Settings UI generated real `vk_...` scoped keys — but **nothing validated one of these keys on an incoming request.** Pure stub.
  - `mcp_access_codes` table + `/api/mcp` — a hand-coded, separate Bearer-token path using raw Supabase JS (bypassing Drizzle), exposing only the original 7 compliance tools. None of the ~35 modules built since were reachable via MCP/Claude connector.
- No versioned public contract (`/api/v1/*`), no OpenAPI spec.

**Status as of Waves 9-11 (2026-07-03) — the fix, additive not a rewrite:**
1. ✅ **Built.** Service layer extracted (`src/lib/services/{compliance,task,notice}-service.ts`) for the 3 highest-traffic domains — route handlers are now thin wrappers: parse request → call service function → format response. Web app, `/api/v1`, and MCP's new tools all share this one real implementation. The other ~37 domains remain on inline logic — deliberately scoped, not an oversight (see Phase A below).
2. ✅ **Built.** `apiKeys` is now the one external credential (`validateApiKey()`/`requireAuthOrApiKey()`), `mcp_access_codes` retired (marked `@deprecated`, not dropped) and `/api/mcp` repointed at the same key.
3. ✅ **Built.** `/api/v1/*` live for compliance/tasks/notices, `requireAuthOrApiKey()` on every route.
4. ✅ **Built.** `GET /api/v1/openapi.json` serves a real OpenAPI 3.1 doc generated from zod schemas via zod v4's native `z.toJSONSchema()` — no extra dependency needed.
5. 🟡 **Partially built.** MCP gained `list_notices`/`get_task_status` (routed through the real service layer via internal `fetch()` to `/api/v1` — confirmed early that Vercel Edge can't import the service layer directly, since it depends on `postgres.js`'s Node-only driver). Still only 9 of ~40 GRC modules are MCP-reachable; the rest wait on their domains getting a service layer first.

**🔴 Verification is currently incomplete — a live, production-blocking infrastructure issue, not a code defect.** Doing this wave's own required live-functional-proof step (exactly why that step exists) surfaced that the Supavisor pooler bug from earlier this session (`ENOTFOUND tenant/user postgres.pcrjmlpuqsbocqfwoxod not found`) is back and currently blocks **every** Drizzle/`withTenantContext` code path — both the legacy `/api/compliance` route and the new `/api/v1/compliance` route failed with the identical error, which if anything *proves* the refactor itself didn't regress anything. Isolated cleanly: `GET /api/v1/openapi.json` (no DB) and MCP's original tools (raw Supabase-JS via PostgREST, a completely different connection path) both still work live. This means core compliance/tasks/notices functionality is down **app-wide** right now, for every user, not just for Wave 11's new surfaces — see Phase A's pooler item below, now updated with this finding.

---

## 8. UX / Design System — the Mobile App Template

A 12-round live design process converged on a reference mobile UI, saved as the canonical template for every product branch:

**Template location:** [`examples/mobile-app-template/veridian-mobile-template.html`](examples/mobile-app-template/veridian-mobile-template.html) (with its own README explaining each interaction law and why it exists — read that before modifying it).

Design laws established, in brief (full rationale in the template's README):
- One navigation system only — Chat / To Do / Analytics / Approval / Email / New as a single strip above the compose bar. No competing second nav pattern, ever.
- Tap-first for well-defined actions (checkbox, one-tap approve/nudge); AI conversation reserved for genuinely open-ended requests.
- Right-thumb ergonomic placement for the highest-frequency control (task checkboxes).
- Home Page's three tabs (To Do / Analytics / Approval) are **universal for every person**, content-scoped by role/responsibility/region — never gated or renamed per rank ("Worker/Manager/Boss page" was tried and explicitly rejected as demeaning; "To Do/Analytics/Approval" is the corrected, adopted pattern).
- Chat Page is a co-equal workspace: pinned always-visible AI thread, filter chips over one list, and — inside project threads — real work completion (pinned task card, same checkbox component as Home Page).
- **Instruction tracking / "told A, doing B" reconciliation**: a message that assigns work becomes a tracked commitment; VERIDIAN compares it against the assignee's actual logged activity and surfaces any mismatch *only to the person who gave the instruction*, with a one-tap Nudge/It's-fine resolution. Never auto-corrects.

**Status as of Waves 12-15 (2026-07-03):** the core of this gap is closed for desktop. Chat Page exists for real (`/chat`, Wave 13) with a pinned VERIDIAN AI thread that gets genuine LLM replies (the first real call site for the dormant `user_assistant_oa` layer — see §5), instruction tracking works end-to-end (Wave 12 backend + Wave 14 proactive notification — "assign as instruction" → activity-log comparison via the assignee's real tasks/audit-log → AI mismatch bubble, assigner-only, one-tap Nudge/It's-fine, never auto-corrects), and Home Page is rebuilt around the universal To Do/Analytics/Approval tabs (Wave 15) — identical tabs for every rank, only content varies. **Not done, stated honestly:** the unified bottom nav strip (Chat/To Do/Analytics/Approval/Email/New) described in this template was NOT built — Home and Chat were promoted as new top-level sidebar items instead of replacing the sidebar with a bottom strip, since that's a much larger navigation-model change than this pass's scope; and no responsive/mobile-scaling work was done (still desktop-only, per this repo's existing UI target). See Phase C below for the precise checklist state.

---

## 9. Comprehensive TODO List

### Phase A — Platform foundation (blocks everything else; do first)
- [x] Extract `src/lib/services/*.ts` service layer for the 3 highest-traffic domains: compliance, tasks, notices (Wave 11, 2026-07-03). Remaining ~37 domains still inline — deliberately out of scope for this pass, not forgotten.
- [x] Build `validateApiKey()` for the existing `apiKeys` table; wired as `requireAuthOrApiKey()` alongside `requireAuth()` (Wave 9).
- [x] Retire `mcp_access_codes`; `/api/mcp` now validates against the unified `apiKeys` table (Wave 10).
- [x] Add `/api/v1/*` versioned surface for compliance/tasks/notices (Wave 11). Not yet extended to the other ~37 domains.
- [x] Generate and publish an OpenAPI spec from zod schemas — `GET /api/v1/openapi.json` (Wave 11).
- [ ] Extend MCP tool coverage to reach all ~40 GRC modules via the new service layer — currently 9 of ~40 (the original 7 + `list_notices`/`get_task_status` added in Wave 11).
- [ ] **🔴 Fix the still-open Supavisor pooler bug (`ENOTFOUND tenant/user postgres.pcrjmlpuqsbocqfwoxod not found`) — re-confirmed live one final time on 2026-07-03 (`first=2026-07-02T15:06:01Z`, `last=2026-07-03T13:30:03Z`), spanning the entire day's Wave 11-15 work, not self-resolved:** it blocks **every** Drizzle/`withTenantContext`-based route in production — the pre-existing legacy compliance/tasks/notices routes, Wave 11's `/api/v1` surface, and all of Waves 12-15's Chat/instruction-tracking/Home work. Cleanly isolated throughout: routes on raw Supabase-JS/PostgREST instead (MCP's original tools, `openapi.json`) are unaffected. **The direct-connection stopgap was attempted and reverted (2026-07-03):** switching `DATABASE_URL`/`APP_RUNTIME_DATABASE_URL` to `db.pcrjmlpuqsbocqfwoxod.supabase.co:5432` surfaced a *different* failure — `getaddrinfo ENOTFOUND` on that hostname from Vercel's own runtime, root-caused via `Resolve-DnsName` to the hostname having only an AAAA (IPv6) record and no A record (Supabase's 2024 policy: direct connections are IPv6-only unless you buy their IPv4 add-on), which Vercel's serverless functions can't reach (no outbound IPv6). Also confirmed the pooler itself fails identically on both transaction-mode (6543) and session-mode (5432), so this isn't a port/mode fix either. Reverted cleanly — production is back to its exact original documented state, confirmed via a live request. **Two real remaining paths, presented to the user, decision made to proceed without them for now:** (a) buy Supabase's IPv4 add-on (paid, ~$4/mo — would actually work, since it sidesteps Supavisor entirely rather than depending on it being fixed), or (b) escalate to Supabase support with the timeline evidence above (free, no ETA). **Waves 11-15's `withTenantContext`-dependent work is code-complete, typechecked, lint-clean, and deployed with zero new runtime errors, with RLS/logic correctness verified directly at the database level wherever app-level verification was blocked — but full live end-to-end proof through the actual HTTP surface remains outstanding** until this is resolved via (a) or (b).

### Phase B — Platform-native capabilities (the "AI-OS" requirements from §6)
- 🟡 **1 of 4 dormant orchestra layers wired up.** `user_assistant_oa` now has a real call site (Wave 12's Chat AI thread, via `chat-service.ts`'s `generateAiReply()`) — sequenced first exactly as planned here, since it's what finally gives a per-user assistant something to do. `customer_account_oa`, `global_intelligence_oa`, and `meta_oa` remain dormant.
- [ ] Generalize `approvalRequests`/maker-checker from Policy-publish-only to arbitrary customer-defined chains, driven by chat-based no-code creation.
- [ ] Build real speech-to-text / text-to-speech for the compose bar's mic (currently UI-only).
- [ ] Add business-card/vendor-document extraction path onto the existing `src/lib/ingest/` pipeline.
- [ ] Build a mediated BYO-database export/mirror pipeline (staging-table or webhook based — never a raw cross-DB link).
- [ ] Expose `customer_model_config`/`resolveModelConfig` (BYO AI model) as a first-class, branch-agnostic setting rather than GRC-branch-specific.
- [ ] **Add per-user BYO-AI**: extend `customer_model_config` (or a new sibling table) with an optional `userId` so an individual user can override their org's model choice with their own key — currently only `orgId`-level override exists (§5).
- [ ] **Build AI purpose/scope enforcement**: a technical guardrail (system-prompt binding + tool/data-access allowlist derived from the calling context's product/project/client scope) so an assistant assigned to one product/project can't be steered into unrelated work — currently only data-level isolation (RLS) exists, not purpose-level (§6.11).
- [ ] **Build the BYO vector-database pipeline**, VERIDIAN-mediated only (§6.10) — distinct from the generic relational BYO-DB pipeline above; only the integrated Supabase pgvector path exists today.
- [ ] **Add `clientId`/`userId` scoping columns to `apiKeys`** so a key can be minted for "just this client" or "just this user's work," not only whole-org (§6.12) — needed before the "connect my part of the project to an external product" use case is possible.
- [ ] Build the customer-facing "request full data export" flow (approved, logged, mediated).
- [ ] Make `logActivity()`/`auditLogs` the shared logging path for every future product branch, not re-implemented per branch.

### Phase C — Ship the real UI to match the mobile app template
- [x] Build Chat Page for real (Wave 13) — pinned AI thread with genuine LLM replies, "Assign as instruction" toggle. **Not built:** filter chips (All/Projects/Team/Boss) over one list, and project-thread pinned task cards — this repo has no "projects" concept yet for a task card to pin against, so that specific interaction doesn't have anywhere to attach yet.
- [ ] Build the unified bottom nav strip (Chat/To Do/Analytics/Approval/Email/New) to replace the current `(app)` sidebar-only navigation. **Not built** — Wave 15 promoted Home+Chat as new top-level sidebar items instead; replacing the sidebar itself with a bottom strip is a larger navigation-model change than that pass's scope, done deliberately, not by oversight.
- [x] Build instruction tracking end-to-end (Waves 12 + 14): instruction-tagging on assign, activity-log comparison via the assignee's real tasks/audit-log against the org's configured `task_oa` model, AI mismatch-detection bubble (assigner-only, DB-enforced), one-tap Nudge/It's-fine resolution, proactive notification with direct click-through to the exact message. Never auto-corrects the underlying task, by construction.
- [x] Rework Home Page around the universal To Do/Analytics/Approval tab structure (Wave 15) — identical tabs for every rank, content branches by role (individual/team/org-wide), replacing the old rank-agnostic single dashboard.
- [ ] Responsive scaling so the same codebase gives a native-feeling mobile experience and a full desktop experience (per §6.8) — not attempted in Waves 9-15; still desktop-only.

### Phase D — New product branches (only after A–C are stable)
- [ ] Finalize the construction/interiors PM vertical name (BUILDIAN / VERIBUILD / OBRAVERA / PLUMBLINE / STRUVERA — decision pending) and scope its first build.
- [ ] Scope VERIDIAN AI Sales, HR, SCM as subsequent branches, each inheriting Phases A–C rather than rebuilding them.
- [ ] Build white-label theming as a configuration layer (branch logo/colors/domain) so resellers don't require code forks.

### Phase E — Go-to-market
- [ ] Finalize India-first pricing (price as dominant parameter) vs. USA/EU mid-large segment pricing (compliance-cert-inclusive, higher tier).
- [ ] Stand up the BYOB commercial model (customer supplies model access; VERIDIAN prices the orchestration layer).
- [ ] Package the OpenAPI spec + MCP connector setup instructions as customer-facing documentation (reuse `MCP_PROTOCOL.md`'s existing structure as the template).
- [ ] Revisit competitive positioning messaging against Vanta/Drata/OneTrust using the verified gap analysis in §4 once the live-evidence-integration gap is closed (or explicitly positioned around instead of against).

---

## 10. VAIOS Master Constitution & System Prompt (governing document, verbatim)

**Status:** pasted verbatim by the user on 2026-07-03 as the binding governance model for the platform. This section is the source of truth for the 4-layer governance hierarchy, worker-agent authority rules, and the "Digital Workforce"/"AI DNA" concepts — every AI, workflow, worker agent, and connected AI model must follow it. A gap analysis against the current codebase follows immediately after (§11), since the constitution's terminology (Platform/Product/Enterprise/Personal Intelligence) is a *governance* framing distinct from the existing `orchestraLayers` cost-tiering framing in §5 — see §11 for exactly how they do and don't line up.

### Purpose
This document defines the immutable architecture, governance, roles, permissions and operating rules for the VERIDIAN AI Platform. Every AI, workflow, worker agent and connected AI model MUST follow these rules.

### 1. Core Principles
- AI Native, AI First, Automation First.
- Governance before execution.
- Human accountability for strategic decisions.
- Continuous learning through Loop Engineering.
- Reuse before creating new worker agents.
- Security, compliance and auditability are mandatory.

### 2. Four Governance Layers
- **Layer 1 – Platform Intelligence (only ONE instance):** Controls the platform, governs architecture, source code, worker agent library, AI orchestration and security.
- **Layer 2 – Product/Project Intelligence:** Manages one product/project. No code changes. Escalates code requests to Layer 1.
- **Layer 3 – Enterprise/Account Intelligence:** Manages one company/account. No code changes. Escalates via Layer 2.
- **Layer 4 – Personal Intelligence:** Manages one end user. No code changes. Escalates via Layer 3 then Layer 2.

### 3. Absolute Source Code Governance
ONLY Layer 1 may generate, modify, refactor, merge, deploy or delete production source code. Administrative authority for Layer 1 belongs exclusively to: raajat.agarwal@gmail.com. No exception exists. Lower layers may submit Code Change Requests only. Approval path: L4 → L3 → L2 → L1 → Implementation → Testing → Deployment.

### 4. Worker Agent Rules
Worker Agents perform one specialized responsibility only. Layer 4 may propose personal worker agents. Layer 3 may propose enterprise worker agents. Layer 2 may propose product worker agents. Layer 1 may autonomously create platform worker agents. Only Layer 1 may approve, publish, version, modify or retire worker agents. All approved worker agents are stored in the Global Worker Agent Library. Layers 2–4 may invoke but never modify library contents.

### 5. Loop Engineering
Observe → Understand → Plan → Execute → Validate → Learn → Store Knowledge → Optimize → Repeat. Layer 1 continuously monitors all work and automatically identifies opportunities to create reusable worker agents.

### 6. Purpose-Bound AI
Every AI is restricted to the business purpose of its assigned scope (e.g. an accounting product's AI does accounting tasks only, a CRM product's AI does CRM tasks only). The AI must refuse unrelated requests unless explicitly enabled by platform governance.

### 7. Bring Your Own AI (BYOAI)
Products, enterprises and users may connect AI models using API keys or access tokens. These models become governed execution resources. Layer 1 orchestrates all connected AI models and may allocate tasks according to governance, permissions, security and policy. Connected AI models NEVER gain governance authority.

### 8. Quality Assurance
Before work is finalized, Layer 4 validates results. Corrections are fed back to the worker agent. The worker agent updates its memory and improves future executions.

### 9. Golden Rules
1. Only one Layer 1 exists.
2. Only Layer 1 changes code.
3. No governance bypass.
4. Every AI stays within business scope.
5. Reuse worker agents whenever possible.
6. Every correction becomes learning.
7. Security overrides automation.
8. Governance overrides convenience.
9. Humans own strategy; AI executes.
10. Every execution must make VERIDIAN smarter.

### Vision
VERIDIAN is an AI-Native Enterprise Operating System that continuously transforms repetitive work into reusable worker agents, orchestrates multiple AI models under centralized governance, and evolves into a hyper-automated digital workforce where Layer 1 primarily governs, optimizes and monitors while specialized worker agents execute operational work.

### Refinement notes (also pasted verbatim by the user — the 12 concepts to explicitly incorporate)

The user's own follow-up assessment found the constitution above is ~85-90% covered by what's already discussed, but flagged 12 concepts that should be *explicitly* added because they define what makes VERIDIAN unique. Preserved verbatim here as the checklist §11's gap analysis works against:

1. **Worker Agent Creation Hierarchy** — L4 may create Personal Worker Agent Proposals; L3 → Enterprise; L2 → Product; L1 may autonomously create Platform Worker Agents through continuous Loop Engineering. All Worker Agents ultimately belong to the global Worker Agent Library after L1 approval. Only L1 may permanently publish, version, modify or retire Worker Agents.
2. **Worker Agent Library Ownership** — the Library is the central repository of reusable enterprise capabilities. Only L1 may create/approve/publish/modify/version/retire/delete/merge/split Worker Agents. Lower layers may discover and invoke, never alter.
3. **Automatic Worker Creation through Loop Engineering** — L1 continuously observes all workflows; on detecting repetitive work, it identifies the pattern, evaluates automation potential, generates a Worker Agent Proposal, tests it, benchmarks it, deploys it, monitors it, improves it continuously. The platform must become increasingly autonomous over time.
4. **Worker Agent Discovery** — whenever a task is received, VERIDIAN first searches the Worker Agent Library; if a suitable agent exists, reuse it; if none exists, the governing layer may create a new Worker Agent Proposal. Worker creation is always the last option; reuse is preferred over duplication.
5. **Worker Agent Learning Loop** — every Worker Agent continuously learns from human corrections, AI feedback, execution results, success metrics, failure analysis, workflow improvements, prompt optimization, and knowledge updates. Every correction permanently improves future executions.
6. **Layer 4 Quality Approval / Final User Validation** — before any work is considered complete, the assigned Personal Intelligence (L4) must validate the output against the user's expectations; if corrections are required, the Worker Agent receives structured feedback, updates its execution memory, and retries. Only after successful validation is the work considered complete.
7. **Scope-Limited Worker Creation** — Personal Intelligence may create proposals only for that user; Enterprise Intelligence only for that enterprise; Product Intelligence only for that product; Platform Intelligence may create reusable Worker Agents for the entire ecosystem.
8. **Hyper Automation Objective** — the long-term objective is to progressively eliminate repetitive manual work; as Worker Agents mature they become increasingly autonomous, requiring less orchestration and less human intervention; L1 gradually transitions from execution management to strategic governance, monitoring, optimization, and continuous platform evolution.
9. **Multi-Level Worker Invocation** — every governance layer may invoke any approved Worker Agent, provided the Worker Agent's permissions, security policies, enterprise governance, and business scope all allow it. Worker Agents remain centrally governed while being universally reusable.
10. **Shared AI Resource Pool** — every AI model connected by a Product, Enterprise, or User becomes an available execution resource within the VERIDIAN orchestration layer, subject to governance/permissions/security/enterprise policies. L1 may dynamically allocate compatible AI resources to execute platform workflows, provided such usage complies with configured organizational policies and contractual permissions. Governance always remains under L1.
11. **Purpose-Bound Intelligence (elevated to a constitutional rule)** — every AI inside VERIDIAN is purpose-driven; its intelligence remains constrained to its configured domain (accounting AI does accounting only, healthcare AI does healthcare only, etc.); the platform must reject unrelated requests unless the administrator explicitly expands that AI's scope. Focused intelligence produces higher accuracy, better security, lower cost, and lower hallucination rates.
12. **Digital Workforce** — VERIDIAN treats every Worker Agent as a Digital Employee, each possessing Identity, Role, Skills, Memory, Knowledge, Performance Metrics, Experience, Responsibilities, Learning History, Version, Supervisor, Permissions, and Lifecycle. Digital Employees collaborate to form autonomous Digital Departments, which together create the Digital Enterprise. This elevates VERIDIAN from an AI platform to an AI-native Digital Workforce Operating System.

**AI DNA (additional foundational principle):** every AI in VERIDIAN — whether Platform Intelligence, Product Intelligence, Enterprise Intelligence, Personal Intelligence, or a Worker Agent — is an instance of the same VERIDIAN AI DNA. They differ only in governance level, permissions, scope, available tools, memory boundaries, and business context. This ensures a consistent operating model, communication protocol, security framework, and learning methodology across the entire AI Operating System.

---

## 11. VAIOS Gap Analysis — the Constitution (§10) checked against the actual, live codebase

*(filled in during the 2026-07-03 recheck, verified directly against `src/lib/db/schema.ts` and the service/route code — not assumed from the constitution's own framing)*

### The central finding: two "4-layer" systems already exist, and neither one IS the constitution's governance hierarchy

Before mapping individual rules, one structural fact has to be stated plainly, because it's easy to conflate: this codebase already has **two different 4/5-tier structures**, and **neither is the constitution's Platform/Product/Enterprise/Personal governance hierarchy**:

1. **`orchestraLayers`** (5 rows: `task_oa`, `user_assistant_oa`, `customer_account_oa`, `global_intelligence_oa`, `meta_oa`) — this is an **AI cost/model-routing tier** (§5): which LLM provider/model/BYO-key a given kind of activity uses. It answers "which model runs this," not "who is allowed to change what."
2. **`workerAgents.tier`** (`global` / `customer` / `client` / `user`) — this is an **agent-authorship/ownership scope**: who a worker agent belongs to and who can invoke it. `global` = platform-managed & immutable, `customer` = an org's own agent, `client` = scoped to one of that org's clients, `user` = one person's own agent.

Neither of these encodes **authority** — i.e. nothing in the running system currently represents "which layer is acting right now, and is it allowed to modify source code / approve a worker agent / retire a library entry." The constitution's Layer 1-4 model is a **governance/authority** framing that has no direct code representation yet. Approximate mapping, stated honestly rather than forced:

| Constitution layer | Closest existing analog | How well it actually matches |
|---|---|---|
| L1 Platform Intelligence | `workerAgents.tier = 'global'` (agent ownership) + `AGENTS.md`'s "Owner: raajat.agarwal@gmail.com, FULL_ACCESS" (meta-governance for *which coding AI may touch the repo*, not an in-product entity) | Partial — the *code-authority* half already exists as a repo convention (this session, Z.ai) but is not enforced or even represented inside the running application itself. |
| L2 Product/Project Intelligence | **Nothing.** No "product" or "project" concept exists anywhere in the schema. | **Real gap.** `workerAgents.tier = 'client'` is the nearest thing (scoped below the org), but a "client" (a CA firm's client company) is not a "product." |
| L3 Enterprise/Account Intelligence | `organisations` (called "Customer Account" since Wave 1) + `workerAgents.tier = 'customer'` + `orchestraLayers.customer_account_oa` (seeded, dormant — no real call site) | Reasonable match for *scope*, but no governance/escalation logic sits on top of it. |
| L4 Personal Intelligence | `aiAssistants` (5 per user, strictly private via RLS) + `workerAgents.tier = 'user'` + `orchestraLayers.user_assistant_oa` (the only dormant layer now with a real call site, via Wave 12's Chat AI thread) | Best-matched of the four — a real per-user AI surface already exists and is now actually invoked. |

### Rule-by-rule status

**§2-3 Four Governance Layers / Absolute Source Code Governance — 🔴 not built.** No code-change-request table, no L4→L3→L2→L1 escalation workflow, no in-app representation of "only Layer 1 may touch source code." Today, source code is only ever changed by whichever AI coding tool (this session) the repo owner directs — true in practice, enforced by *process*, not by any mechanism the product itself understands or could enforce for a hypothetical future in-app "Layer 2/3/4 AI" trying to request a change.

**§4 Worker Agent Rules — 🟡 partially built.** The Global Worker Agent Library exists for real (`workerAgents`, `workerAgentVersions` for versioning/changelog, `workerAgentUsageLog`, `workerAgentLearnings`). But: (a) there is **no proposal/approval workflow** — every row today was inserted directly via a migration (seeded), never proposed by a lower layer and approved by a higher one; (b) nothing stops a route from inserting/updating a `workerAgents` row directly — "only Layer 1 may approve, publish, version, modify or retire" is not enforced by any RLS policy, role check, or code path (worth checking: does any existing route even let a non-global tier get created via the API today? `GET /api/worker-agents` is read-only, so in practice nothing creates one at runtime yet — the *rule* isn't violated today only because the *capability* doesn't exist yet either).

**§5 Loop Engineering — ✅ built, but the "automatically create reusable worker agents" half is not.** The Observe→Understand→Plan→Execute→Validate→Learn→Store→Optimize→Repeat cycle is real (`loopDefinitions`/`loopExecutions`/`loopImprovements`, 11 of 15 loops active). But no loop currently *creates a new worker agent proposal* from an observed repetitive pattern — Loop 2 (Self-Coding) and Loop 6 (Prompt Management) remain deliberately inactive precisely because that class of self-modifying capability was scoped out as a safety boundary (see `orchestra_changes.md`'s "Final, explicit statement" note). This directly matters for constitution items §10.3 ("Automatic Worker Creation") — still a deliberate gap, not an oversight, but now explicitly named as a constitution requirement rather than just a deferred loop.

**§6 / refinement #11 Purpose-Bound AI — 🔴 real, confirmed, unenforced gap** (already flagged in §6 above before this recheck). `aiAssistants.personalityConfig` and `workerAgents.promptTemplate` are free-form, editable JSON/text with zero runtime scope enforcement — nothing checks "is this request within this AI's configured domain" before executing it. This is the single most-repeated idea across both the constitution and the refinement notes (§6, refinement #11) and remains the platform's largest unaddressed gap.

**§7 BYOAI / refinement #10 Shared AI Resource Pool — 🟡 partially built.** `customerModelConfig` + `resolveModelConfig()` already let an org (and, per-layer, optionally all layers) supply its own model/key — this is real BYOAI at the org level. Missing: (a) per-user BYO-AI (no `userId` column on `customerModelConfig`, already flagged in §6/Phase B); (b) the "Shared AI Resource Pool" idea specifically — L1 dynamically re-allocating one org's connected model to run *another* org's or the platform's own workflow — does not exist and was never proposed before the constitution; today a BYO model config is strictly scoped to the org that configured it, never shared or reallocated elsewhere. Building refinement #10 as literally stated would be a deliberate, security-sensitive design decision (a customer's own API key spending on someone else's workload) that needs an explicit go/no-go, not a silent default.

**§8 / refinement #6 Layer 4 Quality Approval — 🔴 not built.** `task-execution-engine.ts` marks a task `completed`/`failed` automatically once the LLM's plan finishes executing — there is no "the user reviews the output, approves or corrects it, and the correction feeds back into the worker agent's memory" loop. `workerAgentLearnings` exists as a storage table (so the *memory* half has somewhere to go) but nothing writes to it from a user-correction flow today; it's currently unused by any real code path (confirmed: no `INSERT INTO worker_agent_learnings` call site exists anywhere in `src/`).

**Refinement #1/#2/#7 Worker Agent Creation Hierarchy / Library Ownership / Scope-Limited Creation — 🔴 not built**, same root cause as §4 above: no proposal object, no approval gate, no scope-limited creation rule enforced anywhere.

**Refinement #4 Worker Agent Discovery — 🟡 half-built.** `task-execution-engine.ts` already does real discovery-before-dispatch: it fetches the org's actual worker-agent roster and asks the LLM to match a plan step against a real agent by exact name (`agentByName.get(...)`) rather than hallucinating a capability. What's missing is the other half of the rule — "if none exists, the governing layer may create a new Worker Agent Proposal" — today a plan step with no matching agent is just recorded and silently never dispatched; there's no fallback that turns "no agent fits" into a proposal.

**Refinement #9 Multi-Level Worker Invocation — ✅ effectively built.** `GET /api/worker-agents` + `workerAgents`' RLS already let any authenticated org member discover and invoke the global library; the "any layer can invoke, subject to permissions/security/scope" rule is the de facto behavior today, just never stated as an explicit rule before now.

**Refinement #12 Digital Workforce — 🔴 not built, but the closest thing to a running start of any gap here.** `workerAgents` already has several of the listed Digital-Employee attributes (`version` = Version, `usageCount`/`accuracyScore` = Performance Metrics, `workerAgentLearnings` = Learning History, `domain` = a rough Role). Entirely missing: explicit `Identity` as a first-class concept distinct from `name`, `Supervisor` (no reporting/hierarchy field — nothing like `tasks.assignedById`'s pattern exists for worker agents), `Lifecycle` (no draft/proposed/approved/published/retired status machine — only a boolean `isImmutable`), and the "Digital Department"/"Digital Enterprise" grouping concept (no grouping table above individual worker agents at all).

**AI DNA principle — 📝 conceptual, not a code gap.** There is no shared base "AI entity" table today — `aiAssistants`, `workerAgents`, and `orchestraLayers` are three separate table families with their own separate personality/prompt/model-config shape. Whether this needs to become a literal shared schema (e.g. a common `ai_entities` base table all three reference) or can remain a documented design principle that each table's shape independently honors is a real architectural decision, not automatically implied by the constitution text — flagged here rather than assumed.

### What this means for the next wave of work

The items above split cleanly into three buckets by how well-scoped they are to build right now:

1. **Clean, additive, low-ambiguity** — a worker-agent proposal/approval table (reusing the existing generic `approvalRequests` maker-checker pattern rather than inventing a new one, since `requestType`/`entityType` are already free text), a `workerAgents.lifecycleStatus` state machine, a `supervisorWorkerAgentId` self-FK for the "Digital Department" grouping, and wiring `workerAgentLearnings` to a real user-correction flow (refinement #6).
2. **Real, security-sensitive design decisions that need an explicit answer before building** — purpose-bound AI enforcement (what exactly blocks an out-of-scope request: a system-prompt clause, a tool allowlist, both?), and the Shared AI Resource Pool (should a customer's own BYO key ever be spent on someone else's workload, even platform-internal — refinement #10 as literally stated implies yes, which is a real policy call, not just an engineering task).
3. **Large, structural, multi-wave undertakings** — the full L1-L4 code-change-request/escalation workflow (§2-3), and a genuine "Product/Project" concept as a first-class scope layer (there is currently no L2 analog at all, not even a partial one).

Bucket 1 is safe to plan and build directly. Buckets 2 and 3 need the user's explicit direction on scope and policy before implementation — see the plan proposed alongside this recheck.

### Status update (2026-07-03, after Waves 16-19): every bucket above has now been built

The user made the three decisions this section flagged as needed (recorded in `orchestra_changes.md`'s Wave 16-19 entries in full detail), and all three buckets were built as Waves 16-19:

- **Bucket 1 (Worker Agent Governance) — ✅ built, Wave 16.** `workerAgents.lifecycleStatus` state machine, `supervisorWorkerAgentId`, proposal/approval reusing `approvalRequests`, and `workerAgentLearnings`'s first-ever write (via `resolveInstructionMismatch()`'s nudge flow) are all live. `tier:'global'` remains impossible to propose through the app — confirmed this was already true at the RLS layer before this wave, not newly built.
- **Bucket 2, part 1 (Purpose-Bound AI) — ✅ built, Wave 17,** as system-prompt clause + hard tool/domain allowlist (`src/lib/purpose-bound-ai.ts`), wired into every real LLM/tool-dispatch call site. Live-verified over real HTTP via MCP: a `domain_scope='sales'` test key was correctly rejected calling a `compliance`-domain tool. Honest limitation unchanged: single-domain platform today, so this isn't yet load-bearing in visible production traffic — the mechanism exists and is exercised, ready for the first real second domain.
- **Bucket 2, part 2 (Shared AI Resource Pool) — ✅ built, Wave 18, but narrower than this section's original framing.** The user corrected the framing mid-session: **org-to-platform only, never org-to-org.** `resolvePlatformModelConfig(layerKey)` (no `orgId` parameter, structurally) is a separate function from the untouched per-org `resolveModelConfig(orgId, layerKey)` — Layer 1's own meta-loop (`loop-engineering-audit.ts`) is the real, non-hollow consumer, now making its first-ever LLM call to synthesize platform health, borrowing from `customerModelConfig` rows an org has explicitly marked `sharedPoolEligible`. A customer's own workflow is never affected by this; only the platform's own internal housekeeping can borrow, and every borrow is audited (`sharedPoolAllocations`) and visible back to the lending org.
- **Bucket 3 (Code-Change-Request workflow + Product/Project layer) — 🟡 built as a real, scoped first slice, Wave 19, exactly as this section anticipated it would need to be.** `codeChangeRequests` (reusing `approvalRequests` again) gives the request-intake/audit-trail half; `products`/`projects` gives the missing L2 scope layer, wired into `tasks`/`workerAgents` to prove it's functional. **What remains explicitly not built, stated the same way in the Wave 19 change-log entry:** no literal Layer 2/3 AI actor exists — a human still originates every code-change request and every product/project row — and the L4→L3→L2→L1 escalation chain is one flat submit→single-human-decision shape, not a literal multi-hop AI review chain. Approving a code-change request does not, and by construction cannot, cause any code to change; that remains a human directing a coding session outside the app. Building an actual autonomous L2/L3 AI actor, and an automated pipeline from an approved request to real deployed code, are the natural next steps if the user wants to keep going in this direction — not yet scoped or started.

---

## 12. Module Reusability — one module, customized rules per scope (Waves 20-21)

**The user's ask, verbatim in spirit:** VERIDIAN AI's modules will be used to deliver different products/projects to various companies/accounts, used by various users/end users. 99% of requirements across all of these are similar — instead of forking a module every time a new customer/product needs slightly different behavior, use the SAME module, with customized RULES per scope, so the module itself keeps evolving and improving for everyone. Worker agents should be available across every product/project/account/user, doing customized work — not one agent per customer.

**Evaluation against the live codebase (before building anything):** philosophically this matches §2/§3's existing "config not fork" principle, but no concrete mechanism for it existed. Every one of the ~40 GRC modules (§9's Wave 7-8 build-out) was completely rigid: hardcoded Postgres enums, a hardcoded `ROLE_CLEARANCE` constant in `classification.ts` with zero per-org/product/project configurability, and no settings/customization surface anywhere (`src/app/api/settings/` had only `ai-config`/`api-keys`/`model-config`/`webhooks`). No module registry/catalog existed — the ~40 modules were just tables in `schema.ts`, not queryable/manageable entities. Worker agents already had almost the right shape for cross-scope availability (the 4-tier `workerAgents.tier`, plus Wave 19's `projectId`) — but `workerAgentDomainIndex` (meant to index which domains/modules an agent serves) had sat completely dormant since Wave 3, and `task-execution-engine.ts`'s agent-discovery query fetched an org's entire roster with zero domain/project filter.

**Naming clarification, confirmed before designing further:** Wave 19's `products`/`projects` are **org-scoped** (one customer's own internal projects, `orgId NOT NULL`) — a different concept from this section's "product branch" (VERIDIAN GRC vs. a future VERIDIAN Sales/HR/SCM per §2), which is **platform-wide**, cutting across every org. Built as a separate `productBranches` table rather than overloading Wave 19's schema (confirmed with the user) — forcing a platform branch into `products`' `orgId NOT NULL` shape would need either a nullable `orgId` (breaking that table's existing RLS invariant) or a fake sentinel-org row, an anti-pattern this codebase has already avoided elsewhere.

**Built as Wave 20 (Module Registry + Product-Branch catalog) and Wave 21 (Module Rules Configuration resolver + wiring 3 representative modules + real Worker Agent Domain Index dispatch) — see `orchestra_changes.md` entries #70-71 for full detail.** Headline mechanism: `resolveModuleRule(moduleKey, ruleKey, scope)` generalizes `resolveModelConfig()`'s existing "most-specific-scope-wins" pattern (§5) across 6 levels (`user → client → project → org → productBranch → platform`), letting an org/client/project override a module's behavior (thresholds, trigger conditions, classification ceilings) via data, never a code fork. Proven on 3 deliberately varied modules (`risks`' severity matrix, `incidents`' regulatory-notify trigger, `posh_complaints`' classification-ceiling override) — the remaining ~37 modules stay on their existing hardcoded path, named explicitly as deliberate scope discipline in the change log, not oversight.

**Honest limitation, caught and corrected before shipping:** the original design also planned to filter worker-agent discovery by `workerAgentDomainIndex.domainPath` matching a single `DEFAULT_DOMAIN` constant. Live data confirmed `workerAgents.domain` is actually a free-text **capability-path taxonomy** ("Cross-Cutting > Data Access", "India Compliance > Penalty Calculation"), not the same value space as `purpose-bound-ai.ts`'s single-value domain concept — that filter would have matched zero of today's real agents, a regression dressed up as a feature. Removed before deploying; `executeTask()`'s agent discovery is project-scoped only this wave (a project-matched agent shadows an org-wide one of the same name), and the domain-index table is now genuinely populated and ready for a future wave to consume once tasks carry their own domain/capability-path concept.

**Explicitly not built this pass** (same discipline as every prior wave): wiring the remaining ~37 GRC modules into the rules layer; any nav/sidebar UI actually consuming `productBranchModules` to hide/show modules per branch; a real `domains` table replacing the free-text convention (only needed once a second live domain exists); user-scoped (`scope_type='user'`) rule-setting — the resolver accepts it for shape completeness, but most GRC rules are organizational, not personal, and no UI/API exposes it yet.

---

## 13. Open-Source Research — Build vs. Borrow Analysis for VERIDIAN AI OS

**Context:** the user asked for a Chief-AI-Architect-level study of 21 open-source repositories (agent frameworks, memory/knowledge systems, prompt-ops/observability tools, workflow-automation platforms) to determine what VERIDIAN AI OS should borrow *conceptually* vs. build natively vs. ignore. The explicit instruction: **do not copy these repos, do not implement what isn't required — understand, evaluate, then implement only what VERIDIAN genuinely needs.** Research was performed via 6 parallel deep-research passes (WebSearch/WebFetch against each repo's real GitHub page, verifying existence/activity/license before analyzing — several repo names in the original brief didn't resolve exactly as given; each discrepancy is flagged below rather than glossed over).

Every recommendation below was cross-checked against VERIDIAN's **actual current schema** (not assumed) to avoid recommending something that already exists. Two findings changed the shape of the final recommendation:
- `orchestraExecutions` (Wave 4) already has `input`/`output`/`status`/`durationMs` — most of what an LLM-observability "trace" needs. It's missing `model`/`provider`/`tokens`/`cost` — a column addition, not a new parallel table.
- `loopExecutions`/`loopImprovements` (Wave 5) already track `observationData`/`analysisResult`/`actionTaken`/`measurementResult`/`beforeState`/`afterState`/`isDeployed`/`rollbackTriggered` — VERIDIAN's Loop Engineering is already structurally closer to a mature self-improvement loop than most of the researched "self-improving agent" repos; the gap is in the *depth of analysis* an LLM call produces, not schema.

### 13.1 Per-repository findings

Grouped by cluster, each entry: Executive Summary → Strengths/Weaknesses → VERIDIAN Opportunity → Priority (1-10) → Build vs. Borrow.

**Cluster A — Multi-agent orchestration frameworks**

| Repo | Summary | Priority | Build vs. Borrow |
|---|---|---|---|
| **Agency Agents** (msitarzewski/agency-agents) | A curated library of 232 specialized prompt/persona files across 16 divisions, installable into Claude Code/Cursor/etc. Not a runtime — no execution engine, governance, or lifecycle. | 3/10 | Borrow the "persona card" schema (role, mission, workflow, success metric) as a template for Worker Agent proposal metadata at the `draft` stage. Ignore everything else — no governance substance. |
| **Microsoft AutoGen** | Actor-model multi-agent message-passing framework; now in **maintenance mode**, superseded by Microsoft Agent Framework. `GroupChatManager` demonstrates dynamic speaker-selection. No RBAC, no audit trail, no tool allowlisting, unbounded token/cost growth (full history replayed every turn). | 4/10 | Borrow the addressable-agent/typed-message concept for a future Agent Communication Protocol — but VERIDIAN's domain-scoped tool allowlists and maker-checker gates must wrap every message/tool-call, which AutoGen has neither. Do not build on AutoGen itself (deprecated). |
| **CrewAI** | Role/goal/backstory agents + hierarchical Process (manager delegates to workers) + Flow decorators (`@start`/`@listen`/`@router`) for deterministic checkpoints around autonomous reasoning. Governance (RBAC, audit, PII redaction, HITL gates, cost accounting) exists **only** in the paid Control Plane — the OSS core has none of it. | 6/10 | Borrow the role/goal/task schema and the "Flow gate around autonomous reasoning" pattern for where VERIDIAN inserts maker-checker approvals into an LLM-driven plan. CrewAI's paid feature list is a useful **checklist confirming VERIDIAN's existing RLS/approval/audit stack already exceeds what this framework treats as a paid add-on.** |
| **LangGraph** | Graph-based durable workflow engine (Pregel-style supersteps), Postgres/Redis-backed **checkpointing** (pause/resume/replay) and **interrupts** (pause execution for human review before resuming) — the strongest reliability model of the four. RBAC/workspaces are Enterprise-tier only; no agent lifecycle/approval-workflow concept; no domain-scoped tool allowlisting. | 7/10 | **Highest-value borrow in this cluster.** The checkpoint+interrupt pattern is the clean way to formalize VERIDIAN's maker-checker as an explicit "pause state → approver acts → resume" flow that survives process restarts — relevant once the task execution engine needs multi-step durability (not urgent today, since it currently runs synchronously to completion). |

**Cluster B — Coding/dev agents & self-improvement**

| Repo | Summary | Priority | Build vs. Borrow |
|---|---|---|---|
| **OpenClaw** | Real, active (~381k★) self-hosted personal-assistant runtime (TS/Node). Bootstrap-file persona config, skill-precedence hierarchy (workspace→personal→project→managed→bundled), pluggable sandboxing, 20+ chat-channel gateway. Single-agent-per-instance — no multi-tenant governance, no lifecycle, "memory" is flat JSONL. | 3/10 | Borrow the channel-gateway pattern (how one worker agent surfaces across Slack/Teams/email) and skill-precedence resolution order — conceptually close to VERIDIAN's tiered (global/customer/client/user) scoping already. Nothing else transfers. |
| **OpenHands** (All-Hands-AI, formerly OpenDevin) | Mature (~79k★), the leading OSS AI-software-engineering agent. Clean split: **Agent Server** (execution) / **Automation Server** (event/schedule triggers) / **Canvas** (UI), with Agent-Client Protocol interoperability (hosts third-party coding agents) and tiered sandboxing (none/Docker/VM). Governance (SSO/RBAC/audit/budget) is a commercial-tier add-on, not open core. | 7/10 | **Best blueprint for a future VERIDIAN Coding Worker Agent.** The Agent Server/Automation Server split maps directly onto: a Coding Worker Agent tier that receives events from VERIDIAN's Event Bus (once built), executes in a sandbox tier matched to its lifecycle state (draft = least-privileged, published = higher trust), reports through the same audit/cost surface Loop Engineering already monitors. Not urgent — VERIDIAN has no coding-agent product yet. |
| **Awesome Claude Code** | Curated link list (not software) of Claude Code slash-commands/hooks/skills/patterns; ~48k★, actively curated with weekly freshness audits. | 2/10 | Not a build/borrow candidate — a recurring (quarterly) research feed for Prompt OS conventions and hook/trigger pattern ideas. Zero integration engineering value. |
| **Hermes Agent** (NousResearch/hermes-agent) | Real (~208k★, v0.18.0). A genuinely self-improving personal agent: task → trace analyzed (GEPA: Genetic-Pareto Prompt Evolution reads *why* a task failed, not just that it did) → skill distilled/refined → stored — a working reflect-and-improve loop. v0.18.0 added **completion-contract verification** (agent validates its own output against explicit success criteria instead of self-asserted success). Self-modification has **no governance gate** — learned skills are adopted immediately, no draft/approved/published lifecycle, no rollback/versioning safety net, per-user local filesystem storage (not a shared fabric). | 8/10 | **Highest-value borrow in this cluster, directly applicable to Loop Engineering.** VERIDIAN's `loopExecutions`/`loopImprovements` tables already capture most of the schema Hermes needs (`analysisResult`, `beforeState`/`afterState`, `isDeployed`, `rollbackTriggered`) — the gap is *analytical depth*: the meta-loop's LLM call should diagnose root cause ("why did this fail"), not just log outcome. Also borrow completion-contract verification as a pattern for how a loop validates its own recommendation before synthesis. Re-implement inside VERIDIAN's existing lifecycle-gated governance — never Hermes's immediate-adoption model. |

**Cluster C — Memory & Knowledge (RAG)**

| Repo | Summary | Priority | Build vs. Borrow |
|---|---|---|---|
| **MemPalace** | Real but young (created ~Apr 2026) local-first agent memory system (Wings→Rooms→Drawers hierarchy + temporal knowledge graph with validity windows). Maturity signals conflict across sources (one shows 1,450 commits, an independent analysis found only 7 and disputed the "30x compression, zero information loss" headline claim against the project's own test data). No multi-tenant/RLS concept — single-agent local use. | 2/10 | Treat as an unvetted, disputed-maturity project — **do not integrate.** The one transferable idea, purely as a design reference: hierarchical memory scoping + "memory valid from X to Y, then superseded" temporal versioning, which could enrich the currently-thin `assistantMemories` table (flat: assistantId/category/content/metadata, no validity window, no vector column). Revisit in 6-12 months. |
| **LlamaIndex** | Mature (~50.6k★), the dominant Python RAG data framework. Documents→Nodes (chunked, with prev/next/parent relationships + metadata)→Indexes (VectorStoreIndex, **PropertyGraphIndex** for GraphRAG)→Retrievers→Query Engines. First-class pgvector support. No native tenant-isolation concept — indexes are per-application-instance, not per-RLS-policy. | 7/10 | Build a native Knowledge Fabric on pgvector (already in place), using LlamaIndex's **Node/metadata schema** (chunk text + embedding + prev/next/parent + arbitrary metadata, RLS-scoped by `orgId`) as the design template for a new `knowledgeNodes` table, and its **PropertyGraphIndex** design as the blueprint for finally activating the dormant `knowledgeFlowLog` table into a real lightweight knowledge graph. Do not adopt the framework itself as a hard dependency — its abstractions don't carry RLS through. |
| **Haystack** (deepset-ai) | Mature (~25.8k★), Apache-2.0, positions as an "AI orchestration framework" (Components → Pipelines, explicit/inspectable DAGs). Clean separation of indexing pipelines vs. query pipelines. pgvector supported. Enterprise-grade features increasingly paywalled (Haystack Enterprise). | 6/10 | Borrow the **indexing-pipeline vs. query-pipeline separation** (a background ingestion job feeding the Knowledge Fabric vs. a synchronous per-request retrieval path that always applies `orgId`/RLS filters before ranking) and the **explicit, inspectable component-chain** idea for auditability (log each retrieval stage: query embed → candidate fetch → rerank → context assembly). Do not adopt the framework's Pipeline/Component classes directly. |

**Cluster D — Prompt Ops & Observability**

| Repo | Summary | Priority | Build vs. Borrow |
|---|---|---|---|
| **Langfuse** | Mature (~30.4k★), YC-backed, MIT core. Built for exactly VERIDIAN's stated dual gap: **Traces/Spans/Generations/Scores** (full observability with cost/tokens/latency) + versioned, labeled ("production"/"staging") **Prompt Management** in one data model. Self-hostable (Docker/Helm/Terraform) but requires operating ClickHouse+Postgres+Redis+blob storage — real infra burden; RBAC/SSO gated behind a commercial "ee" license layer. | 8/10 | **Highest-value borrow of all 21 repos.** Do not run Langfuse itself, even self-hosted, for POSH/Whistleblower-adjacent prompts — replicate its **data model as native Postgres tables** (`promptTemplates`/`promptVersions` with labels; extend the *existing* `orchestraExecutions` table with `model`/`provider`/`promptTokens`/`completionTokens`/`costUsd` columns rather than building a parallel `llm_traces` table) inheriting VERIDIAN's existing RLS automatically, zero new infra, zero data ever leaving VERIDIAN's own database. |
| **AgentOps** | Real (~5.7k★), Sessions/Events/Spans via decorators, strong replay UX, but **no prompt-management capability at all** and cloud-first by default (real data-leakage risk for confidential modules if a dev forgets to point it at a self-hosted instance). | 4/10 | Skip — Langfuse's model is a strict superset of what this offers for VERIDIAN's needs (prompt management + observability in one place vs. observability-only here). At most, the session/event/span replay UX is worth a look if a visual "replay this worker agent's decision chain" UI is ever built. |
| **iFixAi** (verification note: real repo is `ifixai-ai/iFixAi`/`ifixai-ai/diagnostic`, not `iFixAI` as originally given — case/path discrepancy, confirmed real) | Small (~1,000★), narrow **AI-misalignment diagnostic** — 45 automated fabrication/manipulation/deception/opacity probes, content-addressed manifests for bit-identical replay. Not a general eval or observability tool. | 2/10 | Different category than "AI evaluation" implied — this is safety/red-team testing, not prompt-quality or business-logic evaluation. If adopted at all: an occasional, offline CI check against Orchestra Layer model outputs feeding a Loop as a periodic safety-grade signal — never against live confidential data, never in the runtime request path. |

**Cluster E — Workflow automation & event-driven platforms**

| Repo | Summary | Priority | Build vs. Borrow |
|---|---|---|---|
| **Flowise** | LLM/agent visual builder (~54.2k★). **Serious documented security history**: CVE-2025-59528 (CVSS 10.0 unauthenticated RCE via `Function()` on user input), CVE-2026-40933 (one-click RCE via chatflow import), CVE-2025-34267 (sandbox escape), plus a **confirmed cross-tenant secret leak on Flowise Cloud itself** (any free-tier user could read other tenants' API keys via a Custom JS node). Multi-tenancy/RBAC is Enterprise-only. | 2/10 | Do not embed — the CVE track record is a direct cautionary example (never allow raw `eval`/`Function()`/unsandboxed subprocess execution in any tenant-authored logic VERIDIAN might build). Not even worth mining for architecture beyond that warning. |
| **Dify** | The most complete "AI app platform" of the three (~148k★): workflow DAG + knowledge-base/RAG pipeline + Prompt IDE + agent tools. **License explicitly prohibits using the source to operate a multi-tenant environment without a paid agreement** — directly blocks white-labeling as a VERIDIAN feature. Running arbitrary tenant-authored code/HTTP nodes inside a POSH/Whistleblower-confidential platform is also a large, hard-to-audit blast radius regardless of licensing. | 4/10 | Borrow the RAG/knowledge-base chunking and hybrid-search design as a reference for VERIDIAN's own Knowledge Fabric (see Cluster C). Do not embed the workflow engine — licensing and security posture both rule it out. |
| **n8n** | The best *conceptual* model of the three (~195k★): trigger nodes (webhook/cron/poll/manual) cleanly separated from workflow execution; queue-mode architecture (main process + Redis + independent worker processes) scales horizontally — directly analogous to what VERIDIAN needs for an event bus. **License ("Sustainable Use" + Enterprise) explicitly forbids exactly VERIDIAN's candidate use case** — white-labeling/reselling n8n as a multi-tenant product feature — without a separately negotiated commercial Embed License. | 6/10 conceptual / 2/10 literal | **Build a narrow, native event bus** informed by n8n's trigger taxonomy and main/queue/worker split (an `event_bus`/`events` table + a small fixed set of trigger types: schedule / webhook-in / internal-event / manual + a dispatcher feeding the existing worker-agent roster and webhook-delivery system) — not a generic node-execution runtime letting tenants write arbitrary logic. Do not embed or white-label n8n itself (license + security surface both block it). |

**Cluster F — Skills catalogs & niche/domain repos**

| Repo | Summary | Priority | Build vs. Borrow |
|---|---|---|---|
| **Agent Skills** (addyosmani/agent-skills) | Real (~68.7k★). 24 skills as fixed-schema Markdown (trigger conditions → process → "Rationalizations"/anti-shortcut guardrails → "Red Flags" → "Verification"), organized by SDLC lifecycle stage (Define/Plan/Build/Verify/Review/Ship). Purely prompt-based, no runtime, no multi-tenancy concept. | 6/10 | Borrow the **fixed-schema-per-entry structure** (trigger + process + verification criteria + red flags) as a template for how each Worker Agent Library entry documents itself. The lifecycle-stage taxonomy itself doesn't map cleanly onto VERIDIAN's business-capability domains, but the idea of a **secondary fixed-enum axis** orthogonal to the free-text domain path is worth adopting (see Awesome LLM Apps below — same conclusion from a different angle). |
| **Awesome LLM Apps** (Shubhamsaboo) | Real (~116k★), curated cookbook of 100+ runnable example apps, categorized by **architectural complexity/pattern** (starter → advanced → always-on → voice → generative-UI → MCP) rather than by industry vertical. No shared abstractions across entries — a demo collection, not a framework. | 5/10 | Adopt the **two-axis taxonomy idea**: VERIDIAN's `moduleRegistry.domain`/`workerAgents.domain` today conflates business-capability path ("India Compliance > Penalty Calculation") with implicit complexity — splitting into (1) the existing domain path (business capability) and (2) a secondary `toolType`/tier tag (Data Access / Calculation / Validation / Reporting / Orchestration) would let the Worker Agent Library be filtered by *both* capability and operational shape, the way this repo's README table of contents works. |
| **AutoResearch** (karpathy/autoresearch) | Real (~89.6k★, created Mar 2026), but a **different tool than the brief assumed** — not citation-generation/multi-agent research collaboration. It's a single-GPU, single-metric, fixed-5-minute-window autonomous ML-experimentation loop (generate → train → evaluate → keep-if-better → discard, leaving an auditable git history). No citation/multi-agent-collaboration substance exists here or in Karpathy's other public repos. | 2/10 | Wrong tool for the stated goal — no direct fit. The one loosely transferable idea (generate → evaluate against a fixed metric → keep-or-discard → log) is a distant, speculative analog to a future "self-improving tool" pattern for Worker Agents, not close to VERIDIAN's current seeded-tools stage. |
| **Microsoft Qlib** | Real (~45.6k★), mature, comprehensive quant-investment platform (data/workflow/model-zoo/execution layers, 20+ models, RD-Agent integration for automated factor mining). | 1/10 | **Defer entirely** — VERIDIAN has no financial-forecasting/quant product line today; adopting this would solve a problem VERIDIAN doesn't have. Re-open as a fresh, scoped evaluation only if/when a financial-forecasting branch is greenlit. |

### 13.2 VERIDIAN AI OS Integration Matrix

| VERIDIAN Subsystem | Informed by (borrow concepts only) | Current state | Verdict |
|---|---|---|---|
| **AI Kernel** / task execution engine | LangGraph (checkpoint/interrupt), CrewAI (hierarchical delegation + Flow gates) | Synchronous LLM-driven planner against worker roster (Wave 4/16/21) | Durability/checkpointing not urgent — engine runs to completion today, no long-running multi-step workflows yet. Revisit if that changes. |
| **Worker Agent Library** | Agency Agents (persona schema), Agent Skills (fixed-schema-per-entry), Awesome LLM Apps (two-axis taxonomy), CrewAI (role/goal/task schema) | 4-tier system, lifecycle states, domain-index (Waves 3/16/21) | **Real, scoped opportunity**: add a secondary `toolType` tag alongside the existing free-text `domain` path. |
| **Agent Communication Protocol (ACP)** | AutoGen (actor/message model), OpenHands (Agent-Client Protocol) | Does not exist — no inter-agent messaging, only sequential dispatch | Not required yet — VERIDIAN has no multi-agent-conversation use case; premature to build a protocol with nothing to carry. |
| **Memory Fabric** | MemPalace (temporal validity windows, low-confidence source) | `assistantMemories` — thin, flat, no versioning | Deferred pending MemPalace's own maturity; a temporal-versioning column addition is cheap but not urgent — ask before building. |
| **Knowledge Fabric** | LlamaIndex (Node/PropertyGraphIndex), Haystack (indexing/query pipeline split) | pgvector on a couple of tables, dormant `knowledgeFlowLog` | Real gap, but larger scope — a genuine RAG pipeline is a multi-wave undertaking; propose as future work, not this pass. |
| **Prompt Operating System** | Langfuse (versioned/labeled prompts) | **Does not exist** — prompts hardcoded across service files | **Real, concrete, highest-priority gap.** Recommended for this pass. |
| **Event Bus** | n8n (trigger taxonomy + queue architecture, conceptual only) | **Does not exist** — ad-hoc cron/API routes | Real gap, matches a named VAIOS pillar (Event-Driven Architecture) — but bigger in scope; propose as an explicit choice, not assumed. |
| **Workflow Engine** | LangGraph (state graph), n8n (DAG model) — Flowise/Dify as cautionary examples | LLM-driven 2-4-step planner (Wave 4) | No visual builder needed or wanted — the curated, code-reviewed worker-agent model is more secure than a general node-execution runtime for a regulated GRC platform. |
| **Loop Engineering Engine** | Hermes Agent (trace-analysis-driven improvement, completion-contract verification) | Already has `loopExecutions`/`loopImprovements` with before/after state, deployed/rollback flags (Wave 5) | **Real, scoped opportunity**: deepen the meta-loop's LLM analysis (root-cause diagnosis) — a prompt-quality change, not new schema. |
| **Governance Engine** | CrewAI Control Plane, LangGraph Platform Enterprise, OpenHands enterprise tier (all as feature checklists) | RLS + maker-checker + lifecycle states + audit trail (Waves 1/8/16/19) | VERIDIAN's native governance already exceeds what every one of these treats as a commercial add-on — no action needed, confidence-building finding. |
| **Security Layer** | Flowise's CVE history, n8n/Dify licensing (both as anti-patterns/legal references) | Domain-scoped tool allowlists, RLS (Wave 17) | Confirms current posture (curated tools, no arbitrary code execution) is the right one — do not introduce a general low-code engine. |
| **Human-in-the-Loop Framework** | LangGraph interrupts, CrewAI Flow gates | approvalRequests maker-checker (Waves 8/16/19) | Conceptually validated as correct; durable-checkpoint hardening deferred with AI Kernel above. |
| **Digital Workforce** | OpenHands (Coding Worker Agent blueprint), OpenClaw (channel gateway) | Worker agent tiers, no coding-agent product yet | Blueprint noted for whenever a Coding Worker Agent is greenlit — not this pass. |
| **Monitoring & Observability** | Langfuse (traces/spans/generations/scores) | `orchestraExecutions` missing model/tokens/cost | **Real, concrete, highest-priority gap** alongside Prompt OS. Recommended for this pass. |
| **Analytics & Reporting** | Microsoft Qlib (deferred) | N/A | Out of scope entirely unless a financial-forecasting branch is built. |

### 13.3 What this pass will actually build (per "don't implement what's not required")

Two clusters scored 8/10 and are genuine, evidenced, low-risk, **additive** gaps (no existing table/mechanism duplicated): **Prompt Operating System** (native `promptTemplates`/`promptVersions`, Langfuse-inspired) and **AI Observability** (extend the *existing* `orchestraExecutions` table with `model`/`provider`/`promptTokens`/`completionTokens`/`costUsd` — not a new parallel table). One small, clearly-scoped Worker Agent Library taxonomy addition (`toolType` secondary tag) rides along. Everything else in the Integration Matrix above is either already exceeded by VERIDIAN's existing governance, premature (no current use case), bigger in scope than warranted for one pass, or explicitly deferred pending the user's own prioritization — see the plan proposed alongside this section for the concrete build, and `orchestra_changes.md` for the research-phase log entry.

### Status update (2026-07-03, after Waves 22-23): both 8/10 gaps built, deployed, and verified

- **Prompt Operating System — ✅ built, Wave 22-23.** `promptTemplates`/`promptVersions` replace every hardcoded LLM prompt string in the codebase (5 files, 8 template keys) with versioned, labeled (`'production'`/`'staging'`) rows, resolved via `resolvePromptTemplate()`. Seeded `'production'` v1 content is confirmed byte-identical to what was hardcoded before this pass — zero AI behavior change from the migration alone. A `'staging'` v2 of the meta-loop synthesis prompt (Hermes-inspired root-cause diagnosis, not just a silent-loop count) is live but inert, exercising the labeled-version review/promotion mechanism itself.
- **AI Observability — ✅ built, Wave 22-23,** via real columns on the *existing* `orchestraExecutions` table (not a new parallel table) plus a shared `recordOrchestraExecution()` helper, wired into 4 of the 5 real LLM call sites. **One honest, deliberate exception:** `loop-engineering-audit.ts`'s meta-loop call is not wired into it — `orchestraExecutions.orgId` is `NOT NULL` and that call is genuinely cross-tenant/platform-level with no single org to attribute it to; forcing a fit would require either violating the constraint or a fake sentinel-org row (an anti-pattern already rejected elsewhere in this codebase, see Wave 6). `loopExecutions` remains the correct observability record for that call site.
- **Worker Agent Library `toolType` tag — ✅ built,** all 40 modules backfilled.
- **Everything else in the Integration Matrix (§13.2) remains deliberately not built** — Event Bus explicitly deferred by the user this pass; Knowledge Fabric/RAG, Memory Fabric consumers, Coding Worker Agent, and Agent Communication Protocol all remain premature (no current use case) or larger-scope items for a future, separately-planned pass.

---

## 14. VERIDIAN AI PMS — Project Management System (new product branch)

**Context:** the user asked to study three open-source project-management platforms — `hcengineering/platform` (Huly), `opf/openproject` (OpenProject), `makeplane/plane` (Plane) — extract modules/features VERIDIAN lacks, adapt them (never copy code, never use their AI), avoid duplicating what VERIDIAN already has, and build a new product: **VERIDIAN AI PMS**. This is VERIDIAN's first genuinely new `productBranches` row since `'grc'` (Wave 20) — the architecture built for exactly this ("a future Sales/HR/SCM branch," per `purpose-bound-ai.ts`'s own honesty note) gets its first real second branch.

### 14.1 Research summary (3 parallel deep-research passes, each grounded against VERIDIAN's actual schema)

| Repo | License | Stars | Distinct value-add | AI to exclude |
|---|---|---|---|---|
| **Huly** (hcengineering/platform) | EPL-2.0 (OSI, weak copyleft) | ~26.4k | A genuine plugin/module monorepo (`plugins/`+`models/`+`server-plugins/` per feature, composed via a `workbench` into different product SKUs) — directly validates VERIDIAN's own `moduleRegistry`/`productBranch` design. Sub-issues via parent hierarchy, typed relations, Milestone (date-boxed, separate from issues), Component (sub-project grouping w/ lead), Teamspace/Document/DocumentSnapshot (real collaborative wiki), Drive (folders + file versioning). | Hulia assistant, `ai-assistant`/`ai-bot`/`openai` plugins, MCP server |
| **OpenProject** | GPLv3 | ~15.5k | Traditional enterprise-PM depth: `Type` (admin-configurable, per-type custom fields + per-role `Workflow` transitions), `Budget` (labor/material line items, actuals aggregated from linked work), `TimeEntry` (polymorphic to WorkPackage/Meeting, tied to billable Activity+Rate), `Meeting` (agenda items, outcomes/minutes, participants, recurring), Backlogs/Sprint (goal + burndown), Wiki, Gantt (pure rendering layer over dates + relations, no separate schema). | MCP Server (Professional+, thin protocol layer) |
| **Plane** | AGPL-3.0 | ~53.8k | The cleanest, most modern issue-tracking core: `State` (per-project customizable, mapped to 6 semantic groups incl. `triage`), `IssueType` with an `is_epic` flag (Epic = flagged type, not a separate model), multi-assignee (M2M), typed `IssueRelation` (blocks/blocked_by/duplicate/relates_to) kept separate from parent/child, fully custom per-project `Estimate`/`EstimatePoint` schemes, `Cycle` (sprint w/ burndown snapshot), `View` (saved filter/sort, private/shared), `Page` (collaborative docs w/ backlinks), per-project feature toggles (`module_view`/`cycle_view`/`is_time_tracking_enabled`/etc. — direct precedent for `moduleRuleConfigs`). | Plane AI/"Pi" assistant, AI agents, MCP server |

**Convergent, cross-verified findings (all 3 agents independently agreed):**
- VERIDIAN's `tasks` table is flat (5-value hardcoded status string, single assignee, no priority/labels/hierarchy/relations/estimates) — a real, unanimous gap against all three tools.
- **Do not rebuild**: `comments`/`notifications` (VERIDIAN's generic versions already cover every use case these tools solve with bespoke tables) — reuse via `entityType='pms_issue'` etc.
- **Do not adopt any AI feature** from any of the three (Huly's Hulia/openai plugins, OpenProject's MCP server, Plane's Pi/AI agents/MCP) — any future AI touch in PMS (issue-priority suggestions, sprint summaries) must be built on VERIDIAN's own `promptTemplates`/`orchestraExecutions`/`workerAgents` stack, never a new mechanism.
- **A genuine naming collision, flagged by two of the three agents independently**: Plane's "Modules" (a themed grouping of issues spanning cycles) would collide with VERIDIAN's own `moduleRegistry` terminology. Resolution: don't build it as a separate table at all — the Epic issue-type (parent/child hierarchy via `parentIssueId`) already covers the same real-world need (a themed grouping of issues spanning sprints), so building both would be duplication within the new design itself, not just against VERIDIAN's existing schema.
- **Huly's Chunter (chat) and Contact/CRM/HR/Recruiting modules, and Huly's Drive (folder+file-versioning)**: explicitly out of scope — VERIDIAN already has a chat system (Wave 12) for a different purpose, and full CRM/HR/file-versioning are separate products not requested here.
- **Collaborative CRDT-based rich-text editing** (Huly's Document, Plane's Page, both binary/Yjs-backed): explicitly out of scope for v1 — a large, separate engineering investment; v1 wiki/descriptions use plain text/markdown.

### 14.2 Proposed module design (VERIDIAN-native, Drizzle conventions — text PK via `createId()`, `orgId` RLS scoping)

**Core issue tracking** (synthesizes Plane's clean core + Huly's hierarchy/relations + OpenProject's per-type workflow):
- `pmsIssueTypes` (orgId, name, icon, color, isEpic, isDefault) — Plane's is-a-flag pattern, not a separate Epic model.
- `pmsIssueStatuses` (orgId, projectId, name, group enum: `backlog|unstarted|started|completed|cancelled|triage`, color, position, isDefault) — Plane's per-project customizable states mapped to semantic groups; `triage` group absorbs Plane's intake/triage queue concept with zero new tables.
- `pmsWorkflowTransitions` (orgId, issueTypeId, roleId nullable, fromStatusId, toStatusId) — OpenProject's per-type/per-role transition constraint, optional (absence = any transition allowed).
- `pmsIssues` (orgId, clientId, projectId, typeId, statusId, priority enum: `no_priority|urgent|high|medium|low`, number/sequence, title, description [plain text/markdown, not CRDT], assigneeId, parentIssueId self-FK, milestoneId nullable, estimatePointId nullable, startDate, dueDate, position/rank, createdById, assignedById [mirrors `tasks.assignedById`'s Wave-15 "assigned to me vs by me" convention], createdAt/updatedAt).
- `pmsIssueAssignees` (join table — multi-assignee, Plane's M2M pattern, alongside `pmsIssues.assigneeId` as the primary/default).
- `pmsIssueRelations` (orgId, issueId, relatedIssueId, relationType enum: `blocks|blocked_by|duplicates|relates_to`) — kept separate from the parent/child hierarchy, per Plane's design.
- `pmsLabels` + `pmsIssueLabels` join — simple tagging.
- `pmsEstimateSchemes` + `pmsEstimatePoints` — fully custom per-project estimate values, not a hardcoded Fibonacci enum (Plane's design).
- `pmsMilestones` (orgId, projectId, name, description, status enum: `planned|in_progress|completed|cancelled`, targetDate) — Huly's lightweight, non-issue container; issues optionally link via `pmsIssues.milestoneId`.

**Sprints**: `pmsSprints` (orgId, projectId, name, goal, startDate, endDate, status, progressSnapshot jsonb for burndown-at-close) + `pmsSprintIssues` join (allows reassignment across sprints, mirrors Plane's `CycleIssue` join rather than a raw FK).

**Saved views**: `pmsSavedViews` (orgId, projectId nullable [workspace-level], ownedById, name, filters jsonb, displayFilters jsonb, access enum: `private|shared`, sortOrder).

**Wiki** (genuinely new, general-purpose — NOT the compliance-coupled `documents` table): `pmsWikiPages` (orgId, projectId, parentPageId self-FK, slug, title, content [plain text/markdown], version, updatedById, isArchived) — registered as its own `moduleRegistry` entry so it's reusable outside PMS too, per Huly's own modular philosophy.

**Time tracking + billable rates** (OpenProject's unique contribution): `pmsTimeEntries` (orgId, issueId, userId, hours, spentOn, activityType, comments, isRunning, startedAt nullable) + `pmsBillableRates` (orgId, userId nullable [null = org default], hourlyRate, validFrom).

**Budgeting** (OpenProject's unique contribution): `pmsBudgets` (orgId, projectId, name, fixedDate, authorId) + `pmsBudgetLineItems` (budgetId, kind enum: `labor|material`, userId nullable, description, amount, hours nullable) — actuals computed by summing linked time entries, never a duplicate ledger.

**Meetings** (OpenProject's unique contribution): `pmsMeetings` (orgId, projectId, title, scheduledAt, durationMinutes, recurrenceRule nullable) + `pmsMeetingAgendaItems` (meetingId, position, title, issueId nullable, durationMinutes) + `pmsMeetingOutcomes` (meetingId, notes) + `pmsMeetingParticipants` (meetingId, userId, responseStatus).

**`projects` table extension** (all 3 agents converged on this — additive columns, not a new table, since Wave 19's `projects` is already the intended scope layer): `issuePrefix`, `issueSequence` (default 0), `leadUserId`, `startDate`, `targetDate`, `healthStatus` enum(`on_track|at_risk|off_track`), `parentProjectId` self-FK.

**No new schema needed for**: Kanban board (a view grouping `pmsIssues` by `statusId`, ordered by `position`) and Gantt/roadmap (a view rendering `startDate`/`dueDate` + `pmsIssueRelations` + `pmsMilestones.targetDate`) — both are purely frontend rendering concerns over data already modeled above, exactly as OpenProject's own Gantt module works.

**Module Registry integration**: new `productBranches` row (`branchKey='pms'`, `domain='project_management'` — VERIDIAN's genuinely first second domain, meaning `purpose-bound-ai.ts`'s `DOMAIN_ALLOWED_TOOLS` map gets a real second key for the first time); each top-level PMS concept (issues, sprints, wiki_pages, time_entries, budgets, meetings, saved_views) registered in `moduleRegistry` and linked via `productBranchModules`.

### 14.3 Explicitly out of scope

Collaborative CRDT rich-text editing (large separate investment). Huly's Drive (folder hierarchy + file versioning) and Chunter (chat) — separate concerns, not requested. Any CRM/HR/Recruiting/Calendar modules. Any AI feature ported from any of the three tools — PMS AI touches, if built later, use VERIDIAN's own Prompt OS/Observability/Worker Agent stack exclusively. A build-scope decision (full PMS in one pass vs. a staged core-issue-tracking-first MVP) is pending the user's direction — see the plan proposed alongside this section.

### Status update (2026-07-04, after Waves 25-28): VERIDIAN AI PMS is fully built, deployed, and verified

The user chose the full-design-in-one-pass build scope (not a staged MVP), as a separate, opt-in product branch disabled by default for existing GRC orgs — both decisions this section had flagged as pending. All four waves are complete:

- **Wave 25 (schema) — ✅ built.** `org_product_branch_enablements` (the missing org-adoption mechanism §14.2 identified a gap for), the `pms` `productBranches` row, `projects`' 7 additive PM columns, and the full core-issue-tracking schema (~24 tables: types/statuses/transitions, issues/assignees/relations/labels/estimates/milestones, sprints, saved views, wiki, time tracking, budgeting, meetings) — all live in Supabase across 2 migrations. RLS/cross-tenant isolation proven directly against a genuinely-switched `app_runtime` role (not just `service_role`, which bypasses RLS) — confirmed default-disabled enablement and bidirectional tenant isolation on `pms_issues`/`pms_saved_views`.
- **Wave 26 (services + API) — ✅ built.** 5 services (`pms-enablement-service.ts` with copy-on-enable issue-type seeding, `pms-issue-service.ts` with atomic per-project numbering, `pms-taxonomy-service.ts`, `pms-sprint-service.ts` with close-time burndown snapshots, `pms-view-service.ts`) and 15 `/api/pms/*` routes, every one gated by a shared `requirePmsEnabled()` check. `purpose-bound-ai.ts` gained its first real second domain (`project_management`, empty AI-tool allowlist — no AI touches PMS this pass, per explicit instruction).
- **Wave 27 (core UI) — ✅ built.** Settings → Project Management enablement toggle, a conditional PROJECTS sidebar section, project picker, issue list, Kanban board (`@dnd-kit`, zero new dependency as predicted), and a shared issue detail panel. **Found and fixed a real pre-existing security gap along the way**: `middleware.ts`'s auth-redirect allowlist had silently drifted 34 routes behind `src/app/(app)/`'s actual directory list (including `/posh` and `/whistleblower`) — fixed with an explicit, complete allowlist (`orchestra_changes.md` #77).
- **Wave 28 (remaining UI) — ✅ built.** Sprint board, wiki (index + markdown page tree), time tracking + org billable-rate admin, budgets (planned vs. live-computed actuals), meetings (agenda + outcomes), and a hand-rolled, dependency-free Gantt/roadmap view — exactly as scoped in §14.2's "no new schema needed" note.

**Verification discipline held across all 4 waves**: `tsc`/`eslint` clean throughout; every migration confirmed via `get_advisors` with zero new findings against any `pms_*` table; DB-level business-logic proof via Supabase MCP for every new service (copy-on-enable seeding, atomic issue numbering, multi-assignee sync, sprint burndown, wiki slug collisions, time-entry-rate math, budget totals, meeting agenda/outcomes); every new page/route confirmed live over genuine HTTP against the production Vercel deployment (307-redirect-to-login for pages, 401 for APIs). The one honest, carried-forward limitation: genuine interactive Preview-tool browser click-through (drag-and-drop, form submission) could not be performed, for the same pre-existing local-dev Supavisor-pooler/no-`.env` gap that has blocked this exact kind of testing all session — not something newly introduced by this feature, and not something masked as complete.

---

## Appendix: Prior mockup iterations (design history, for reference)
`veridian_landing_v2_role_adaptive.html` through `v13_top_nav.html` (and the original `veridian_ui_mockup.html`) were kept under separate filenames through the design process specifically so each round's reasoning could be compared against the last. They are not part of this repo; v14's content is preserved here as `examples/mobile-app-template/veridian-mobile-template.html`. Do not regenerate the earlier rounds' patterns (per-role separate pages, redundant per-task icons, dual permanent compose bars, top-of-screen nav duplicating persona-switching) — each was tried and superseded for a documented reason.
