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

This is the concrete technical finding from the architecture review that directly determines whether §1's platform vision is achievable or just aspirational. Full detail below; this is the highest-priority build item in this entire document because *every other multi-surface goal (mobile app, ChatGPT connector, Claude connector, reseller white-label, custom client app) depends on it.*

**Current state (verified against the live repo, not assumed):**
- All 97 API routes are Next.js Route Handlers with business logic written *inline* — there is no service layer a non-web surface could call into directly. An earlier plan for shared `@compliancetrack/types`/`@compliancetrack/db` packages was never actually built; the app is a flat monolith.
- **95 of 97 routes only accept Supabase session cookies** (`requireAuth()`) — unusable by a mobile app, ChatGPT, or any non-browser client.
- **Two separate, half-built external-access mechanisms already exist and don't talk to each other:**
  - `apiKeys` table + Settings UI generates real `vk_...` scoped keys — but **nothing validates one of these keys on an incoming request.** Pure stub.
  - `mcp_access_codes` table + `/api/mcp` — a hand-coded, separate Bearer-token path using raw Supabase JS (bypassing Drizzle), exposing only the original 7 compliance tools. None of the ~35 modules built since are reachable via MCP/Claude connector today.
- No versioned public contract (`/api/v1/*`), no OpenAPI spec.

**What "designed from the beginning for this" requires — the fix, additive not a rewrite:**
1. Extract a service layer (`src/lib/services/*.ts`, one file per domain) — route handlers become thin wrappers: parse request → call service function → format response. This is the one change that lets web app, MCP, a future mobile app, and a future ChatGPT Action all share one real implementation instead of four.
2. Finish wiring `apiKeys` as the *one* external credential: add `validateApiKey()` alongside `requireAuth()`, retire the separate `mcp_access_codes` table, point MCP at the same key. One key, generated once, works everywhere.
3. Add `/api/v1/*` as the stable public contract (or version via header) so external surfaces get a contract independent of internal route churn.
4. Publish an OpenAPI spec generated from the same service layer/zod schemas (zod is already a dependency) — this is the literal artifact a ChatGPT custom GPT Action or a reseller's white-labeled app needs to self-integrate.
5. Extend MCP tool coverage through the new service layer so all ~40 GRC modules (and every future product branch) are reachable via Claude connector / customer's own AI, not just the original 7.

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

**Gap: none of this exists in the real product yet.** The GRC branch's actual UI (`src/app/(app)/`) predates this design process and does not have the Chat Page, the unified compose bar, the instruction-tracking feature, or the universal To Do/Analytics/Approval tab structure. Building these into the real app is a first-class item in the TODO list below — the template is the target, not yet the shipped product.

---

## 9. Comprehensive TODO List

### Phase A — Platform foundation (blocks everything else; do first)
- [ ] Extract `src/lib/services/*.ts` service layer out of the 97 inline route handlers (start with the highest-traffic domains: compliance, tasks, notices).
- [ ] Build `validateApiKey()` for the existing `apiKeys` table; wire it as an alternate auth path alongside `requireAuth()` on every route.
- [ ] Retire `mcp_access_codes`; repoint `/api/mcp` to validate against the unified `apiKeys` table.
- [ ] Add `/api/v1/*` versioned surface (or header-based versioning) as the stable external contract.
- [ ] Generate and publish an OpenAPI spec from the service layer's zod schemas.
- [ ] Extend MCP tool coverage to reach all ~40 GRC modules via the new service layer (not just the original 7).
- [ ] Fix the still-open Supavisor pooler bug (`ENOTFOUND tenant/user ... not found`) — confirmed live via end-to-end test; blocks all authenticated production usage until fixed. Two remediation paths already scoped: contact Supabase support re: `worker_not_found`, or stopgap-switch to the direct non-pooled connection string.

### Phase B — Platform-native capabilities (the "AI-OS" requirements from §6)
- [ ] **Wire up the 4 dormant orchestra layers** (`user_assistant_oa`, `customer_account_oa`, `global_intelligence_oa`, `meta_oa`) — today only `task_oa` has any real call site (§5). Sequencing matters: `user_assistant_oa` should come first since it's what would finally give the 5 per-user `aiAssistants` something to do; `meta_oa` (reasoning about the other layers) logically comes last, once there are other layers worth reasoning about.
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
- [ ] Build Chat Page for real (pinned AI thread, filter chips, project-thread pinned task cards) in the actual GRC app.
- [ ] Build the unified bottom nav strip (Chat/To Do/Analytics/Approval/Email/New) to replace the current `(app)` sidebar-only navigation.
- [ ] Build instruction tracking end-to-end: instruction-tagging on assign, activity-log comparison, AI mismatch-detection bubble, one-tap Nudge/It's-fine resolution.
- [ ] Rework Home Page around the universal To Do/Analytics/Approval tab structure, replacing any remaining rank-based screens.
- [ ] Responsive scaling so the same codebase gives a native-feeling mobile experience and a full desktop experience (per §6.8).

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

## Appendix: Prior mockup iterations (design history, for reference)
`veridian_landing_v2_role_adaptive.html` through `v13_top_nav.html` (and the original `veridian_ui_mockup.html`) were kept under separate filenames through the design process specifically so each round's reasoning could be compared against the last. They are not part of this repo; v14's content is preserved here as `examples/mobile-app-template/veridian-mobile-template.html`. Do not regenerate the earlier rounds' patterns (per-role separate pages, redundant per-task icons, dual permanent compose bars, top-of-screen nav duplicating persona-switching) — each was tried and superseded for a documented reason.
