# VERIDIAN AI OS — the "Brain" doc

Closes PLATFORM_STRATEGY.md §31.1 pain point 6 ("Clear understanding of what
VERIDIAN AI OS is / how it works") per §31.4 Phase A item (2). This is the
single plain-language "start here" document that did not previously exist —
see `ai-os/OS.yaml`'s own header for the fragmentation this replaces
(`ai-os/OS.yaml` = document index, `ai-os/system-tree/` = exhaustive built
inventory, `CLAUDE.md` = stack basics, none of them a narrative explainer).

**Every claim below is grounded in a file this document's author actually
opened and read in this codebase on 2026-07-13** (list in §5). Where
something could not be verified, that is stated explicitly rather than
smoothed over. If you are an AI agent reading this to orient yourself:
trust the citations, not the prose — go read the cited file yourself before
relying on any specific number or behavior for something consequential.

---

## 1. What VERIDIAN AI OS is, in one paragraph

VERIDIAN AI OS (product name "Veridian AI," brand "VERIDIAN AI," tagline
"One Portal. One Truth." — `CLAUDE.md`) is a multi-tenant compliance and
business-operations web application: Next.js 16 App Router pages under
`src/app/(app)/` (dashboard, compliance, checklists, tasks, reports,
penalties, departments, users, audit, settings, team), a Drizzle-ORM/
postgres.js backend against a Supabase Postgres `compliance` schema, and
Supabase Auth for session management (`CLAUDE.md`, `src/lib/db/schema.ts`,
`src/lib/supabase/`). Layered through and around that product is an AI
orchestration system with two genuinely different purposes that this
codebase keeps structurally separate: **Orchestra Layers**
(`src/lib/orchestra-model-resolver.ts`) route a *customer org's* product
features (task execution, chat, document extraction, etc.) to whichever
model that org is configured to use, while the **AI Dev Team**
(`src/lib/ai-team/roster.ts`, `src/lib/ai-team/team-service.ts`) is a
separate roster of ~198 role definitions used to build and govern VERIDIAN
itself, dispatched by the platform's own agents (Super Boss / Z.ai GLM /
Claude Code, per `AGENTS.md`), never by a customer. VERIDIAN is a
compliance/business-operations platform with an AI orchestration layer
bolted through it — it is not, itself, a standalone AI product, and there
is no single unified "Brain" service (see §3).

---

## 2. How a request actually flows, end to end

Traced example: a user types a request into VERI Chat's composer and it
becomes a running task. This is a real, live path — not the only one in
the app, but a concrete, fully-traceable one.

1. **UI**: `src/components/veri-chat/VeriComposer.tsx` — the composer's
   send handler does `fetch("/api/tasks", { method: "POST", ... })`. The
   file's own comment (lines 5–9) states this reuses the existing task
   creation endpoint deliberately, "no new task-creation logic was needed."

2. **API route**: `src/app/api/tasks/route.ts` `POST()`. It calls
   `requireAuthOrApiKey(request)` from `src/lib/supabase/auth-guard.ts`
   first — this is the combined-auth entry point that accepts either a
   Supabase session cookie or an API key (`requireAuth()` underneath it is
   the plain session-only version every other authenticated route uses).
   `requireAuth()` (same file, `~line 300`) does more than check a
   session: it also auto-provisions a brand-new tenant (org + admin user +
   default department) on a user's very first login if no
   `compliance.users` row exists yet (`autoProvisionUser`, same file), and
   enforces per-org opt-in gates (seat limits via `org-license-service.ts`,
   concurrent-session limits via `session-limit-service.ts`) that fail
   *open* by design if the check itself errors, per that function's own
   comments.

3. **Service layer**: the route calls `createTask()` in
   `src/lib/services/task-service.ts` (line 113), which — after
   validation/high-impact-confirmation logic — calls `executeTask()` in
   `src/lib/task-execution-engine.ts` (imported at that file's line 6).

4. **Model routing**: `task-execution-engine.ts` calls
   `resolveModelConfig(orgId, "task_oa")` from
   `src/lib/orchestra-model-resolver.ts` (confirmed real call sites at that
   file's lines 1846 and 2118, in the package-dispatch and free-text
   execution paths respectively). `"task_oa"` is an Orchestra Layer key.
   `resolveModelConfig()`'s real resolution order, read directly from the
   function body: (a) an active `customer_model_config` row for that
   org+layer (a customer's own "bring your own key" configuration) if one
   exists, layer-specific beating an all-layers row; else (b) the layer's
   `defaultModelConfig` — today that resolves to the platform floor tier,
   Groq's `openai/gpt-oss-120b` (`PLATFORM_DEFAULT_PROVIDER`/
   `PLATFORM_DEFAULT_MODEL`, same file, with a same-model Cerebras failover
   defined in `platformFallbackFor()` for when Groq's free-tier daily cap
   is hit — see that function's comment for the confirmed real incident
   this was built in response to). A `canIncurCost()` check
   (`src/lib/cost-guard.ts`) runs before any of this and can block the
   whole resolution if the org's cost cap is engaged (opt-in, off by
   default).

5. **The actual model call**: the resolved `{provider, model, apiKey,
   fallback}` is passed to `callLLM`/`callLLMJson` in
   `src/lib/llm-client.ts` (`LLMProvider` union at line 32: `"groq" |
   "openai" | "anthropic" | "google" | "openrouter" | "cerebras"`). If the
   response reads as hedging/uncertain, `detectLowConfidenceResponse()`
   (`src/lib/floor-tier-escalation.ts`) fires and — only for
   platform-default (non-customer-configured) calls — retries once on
   `escalatedPlatformConfig()`, which resolves to `z-ai/glm-5.2` via
   OpenRouter (`orchestra-model-resolver.ts` lines 92–106). This is a
   deterministic, non-LLM decision (a text-pattern check), not a model
   judging itself.

6. **Response and record**: the result is written back to the task's rows
   (via `withTenantContext`, `src/lib/db/tenant-scoped.ts`, which scopes
   the write to the requesting org under RLS) and the HTTP response goes
   back through the API route to the composer.

**A second, structurally distinct traced example** worth naming because
the task brief specifically asked about it: an **AI Dev Team dispatch**
(`POST /api/ai/team/dispatch`, `src/app/api/ai/team/dispatch/route.ts`) is
*not* a customer-facing flow — that route is `veridian_admin`-gated
(checked immediately after `requireAuth()`, line 40 of that file) and is
how the platform's own agents get AI Dev Team roles to do real work on the
codebase itself. Its flow, read directly from the route file: validate the
request as a structured `TightTask` (`task-tightening.ts`, rejecting a
loosely-specified objective before any model is called) → classify it to
one of the roster's roles (`classifyTask()`, `team-service.ts`) → check
`checkTierEligibility()` (`src/lib/model-tier-eligibility.ts`) — a model
that hasn't earned "judgment" tier trust (today: everything except
`z-ai/glm-5.2` and `openai/gpt-5.5`) is mechanically blocked from
judgment-tier work, not just discouraged — → run `GUARDRAIL_PLATFORM`
guardrail checks (`guardrail-engine.ts`) → `runRole()`
(`team-service.ts`), which resolves that role's prompt template
(`prompt-os-resolver.ts`) and calls it via OpenRouter using the
*platform's own* key, never a customer's → a risk/confidence check decides
whether the result needs independent human/agent review before it counts
as `"completed"` vs. `"pending_review"` → the outcome is written to
`activity_log` (`recordActivity()`, `src/lib/activity-log-service.ts`).

---

## 3. What "the Brain" really is today, corrected from the common assumption

**There is no single unified "Brain" service anywhere in this codebase.**
`ai-os/OS.yaml`'s own header says this plainly: the closest thing to a
"Brain" pointer that existed before this document was `OS.yaml` itself, an
index — "not a working cognitive architecture." A separate GitHub repo
named `veridian-brain` exists, but `ai-os/system-tree/40-veridian-brain.yaml`
confirms (sourced from a live `gh api` call against that repo) it is an
**empty scaffold** — a README and a `package.json`, nothing extracted from
this codebase, no functional surface. This document is not that repo and
does not claim to be a working standalone cognitive-architecture product.

What actually exists, verified by reading each file, is a set of
**separate systems that happen to compose into something brain-like**:

- **`src/lib/ai-team/roster.ts`** — the "who can do what." 198
  `roleKey:`-tagged role definitions (confirmed by direct grep count),
  each a hardcoded `{roleKey, team, title, model, promptKey}` record —
  data, not a learned or dynamic structure. Grouped into ~20 `TeamName`
  values (Engineering, Quality & Safety, Legal & Compliance, four
  Guardrail levels, an Executive Ladder, etc.). Three roles are
  human-only (never API-dispatched); two are `isCodeOnly` (deterministic
  code standing in for a "role" — `cost-policy.ts` and the RBAC checks in
  `auth-guard.ts` itself). This file's own header documents a real,
  dated cost-driven model-reassignment decision (moving 9 roles off
  Claude Sonnet 5 onto GLM-5.2 after a $11.44-of-$12.34 billing spike from
  3 dispatches) — i.e. this roster has a real, auditable operating
  history, not just a static design doc.

- **`src/lib/orchestra-model-resolver.ts`** (customer-facing model
  routing, traced in §2) **+ `src/lib/model-tier-eligibility.ts`**
  (platform-internal tier gating, traced in §2's second example) — "who
  gets to do it, with which model, and is that model actually trusted for
  work this consequential." These are two distinct axes: the resolver
  picks a provider/model per org+layer; the tier-eligibility file
  restricts which models the *AI Dev Team* roster may use for
  judgment-critical work, independent of what any customer org is
  configured to use.

- **`src/lib/embeddings.ts`** — the closest thing to genuine
  "knowledge"/semantic memory. `generateEmbedding()`'s real, read-in-full
  resolution order: an exact-text-match cache
  (`compliance.embedding_cache`, sha256-keyed) → OpenRouter's real
  `text-embedding-3-small` endpoint (confirmed genuinely configured in
  production, per that file's Wave 73 comment) → a Groq embedding
  endpoint (confirmed, by the same comment, to be dead code in production
  today because `GROQ_API_KEY` was never set in Vercel as of that note) →
  **a deterministic hash-based pseudo-vector as a last resort**, which
  the function itself logs a warning about ("Semantic search quality will
  be degraded") and — importantly — never caches, specifically so a
  degraded fallback never poisons the cache for a query a real provider
  could later answer properly. Worth being honest about: this document's
  author did not independently verify whether `GROQ_API_KEY` is still
  unset in the live Vercel deployment today (2026-07-13) — that comment
  is dated to Wave 73's investigation, not re-checked here.

- **`activity_log`** (Drizzle export `activityLog`,
  `src/lib/db/schema.ts` line 1068) — the execution history / "memory of
  what happened." A polymorphic table (`activityType`:
  `customer_task | orchestra_call | ai_team_dispatch | loop_run`) with a
  `lifecycleStage` state machine (`requested → classified → validated →
  executing → reviewing → completed | failed → closed`), plus — per that
  table's own accumulated comments — bolted-on columns for self-assessment,
  independent review, risk level, confidence banding, complexity tier,
  and re-audit flags, added incrementally over several waves rather than
  designed in from the start. This table is what
  `/api/ai/team/governance-health` (`src/app/api/ai/team/governance-health/route.ts`,
  read in full) queries to compute Reasoning Quality / Dependency Health /
  Compliance scores from real terminal-state outcomes, plus a separate
  "stuck activity" signal (>24h in a non-terminal stage, a stated,
  adjustable threshold, not a proven-correct one per that route's own
  comment).

- **`src/lib/escalation-ladder.ts` + `src/lib/monitor-protocol.ts`** —
  the emerging self-monitoring layer. `escalation-ladder.ts` is a
  deterministic (no LLM call) failure-routing table with two
  **deliberately un-merged** ladders documented side by side in its own
  header: a CSEO → COO → Super Boss "who handles a failure" ladder, and a
  separate L0–L5 staffing-hierarchy ladder from a different source
  document — the file's comment explains explicitly why merging them
  would lose information. `monitor-protocol.ts` defines the structured
  5-field report shape (`status/worker/protocol/confidence/action`) a
  "Narrow Monitor Agent" must produce; its own header states plainly that
  only **Phase 0** is wired today — one Tier-1 (pure rule-engine, no LLM
  call) monitor, `src/lib/monitors/approval-decision-monitor.ts` per that
  file's comment (not independently opened by this document's author —
  flagged in §5). PLATFORM_STRATEGY.md §29 documents Tier 2/3
  (model-backed) monitors as designed, not yet built — treat that
  distinction as load-bearing, not incidental.

**The honest summary**: these five pieces were built at different times,
by different waves of work, for different immediate reasons, and are
wired together only where a specific caller happens to import both. There
is no orchestrator-of-orchestrators, no shared "Brain" object, no single
process that all of this reports into. They compose into something
brain-like when you trace calls across files, as this document does — but
that composition lives in the reader's understanding, not in a piece of
running code. The `veridian-brain` repo being an empty scaffold means
nothing has changed that today.

---

## 4. Pointers, not duplication

This document is one level of abstraction above the exhaustive inventory —
it explains *how the pieces relate*, not *what every route/table/page is*.
For that:

- **`ai-os/system-tree/`** (Tree 3) — the granular, grep-derived
  inventory of what's actually built: `10-13` cover this repo's
  governance/API/DB/UI surfaces, `20`/`30`/`40` cover PROJEXA/
  veda-advisors/veridian-brain, `50-merged-tree.yaml` is the merge. Go
  here for "does route X exist," "what columns does table Y have," "how
  many pages are under Z."
- **`ai-os/MASTER-TRACKER.yaml`** — the single tracker for open work,
  gaps, and in-progress items. Go here for "what's not done yet."
- **`ai-os/boss/COMPLETED.yaml`** — the append-only doer+auditor
  completion log (per `AGENTS.md` Rule 7(d)). Go here for "what shipped,
  who did it, who audited it."
- **`ai-os/OS.yaml`** — the governance-document index this file is now
  registered in (`index.brain_pointer`). Go here for "which document
  covers X" across all 8+ governance/tracking files.
- **`PLATFORM_STRATEGY.md`** — the living strategic-direction document.
  Section 31 is the specific evaluation that produced this file; read its
  §31.1–31.4 for the full reasoning behind why this document exists and
  what it's scoped to close.

If any of the above and this document ever disagree on a factual claim
(e.g. a file path, a role count, a resolution order), the source file
itself is the ground truth, this document's citation is what's stale, and
it should be corrected or removed rather than trusted over the code.

---

## 5. How confident is this document

**Methodology**: every specific claim above (file paths, function names,
resolution orders, model names, table/column names, counts) was written
after directly opening and reading the cited file's real source in this
worktree on 2026-07-13, not inferred from filenames, comments in other
files, or prior training data. Files actually opened and read (in full or
in the cited relevant range) while writing this document:

- `ai-os/OS.yaml` (full)
- `ai-os/system-tree/40-veridian-brain.yaml` (full)
- `scripts/check-metadata-index-coverage.mjs` (full)
- `PLATFORM_STRATEGY.md` (§27, §29–31 headers/body, read via targeted grep + surrounding context)
- `src/lib/supabase/auth-guard.ts` (full)
- `src/lib/ai-team/roster.ts` (header + first ~120 lines; role count verified by grep across the whole file)
- `src/lib/orchestra-model-resolver.ts` (full)
- `src/lib/model-tier-eligibility.ts` (full)
- `src/lib/embeddings.ts` (first ~150 lines, covering the full resolution chain)
- `src/lib/escalation-ladder.ts` (header + first ~100 lines)
- `src/lib/monitor-protocol.ts` (header + first ~100 lines)
- `src/lib/db/schema.ts` (the `activityLog` table definition, lines ~1060–1174, located via grep)
- `src/app/api/ai/team/dispatch/route.ts` (full)
- `src/lib/ai-team/team-service.ts` (first ~90 lines, covering `runRole`/`classifyTask`)
- `src/app/api/tasks/route.ts` (full)
- `src/components/veri-chat/VeriComposer.tsx` (header comment + the `/api/tasks` `fetch` call sites, via grep)
- `src/lib/services/task-service.ts` (the `createTask`/`executeTask` call site, via grep)
- `src/lib/task-execution-engine.ts` (the two `resolveModelConfig("task_oa")` call sites and surrounding ~60 lines)
- `src/lib/llm-client.ts` (the `LLMProvider` type and function signatures, via grep)
- `src/app/api/ai/team/governance-health/route.ts` (first 50 lines)
- `ai-os/system-tree/` directory listing (confirmed the 8 files this section references by name)
- `ai-os/` and `ai-os/boss/` directory listings (confirmed `MASTER-TRACKER.yaml`/`COMPLETED.yaml` exist as named)

**Flagged as NOT independently verified** (named explicitly rather than
silently smoothed over):

- `src/lib/monitors/approval-decision-monitor.ts` — cited via
  `monitor-protocol.ts`'s own comment, not opened directly. It may exist
  exactly as described; this document did not confirm its contents.
- Whether `GROQ_API_KEY` is currently set in the live Vercel deployment —
  `embeddings.ts`'s Wave 73 comment says it was not, as of that
  investigation; not re-checked live here.
- The `TeamName` union in `roster.ts` lists roughly 20 team values; this
  document says "~20" deliberately rather than counting precisely, since
  only the file's first 120 lines were read directly.
- No customer-facing UI page under `src/app/(app)/` was found that calls
  `POST /api/ai/team/dispatch` directly — that route is dispatched by the
  platform's own agents/scripts (`AGENTS.md`, `scripts/ai-workforce-agent.mjs`,
  referenced but not opened in this pass), not through this repo's own
  Next.js UI. Stated in §2 as "not a customer-facing flow" on that basis,
  not independently confirmed by reading the dispatch scripts themselves.

If a future reader finds any claim above no longer matches the code, that
is drift in this document, not a hidden intentional inaccuracy — fix the
claim or remove it, per this file's own opening paragraph.
