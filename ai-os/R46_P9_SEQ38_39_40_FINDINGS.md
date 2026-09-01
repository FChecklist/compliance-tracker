# R-46 P9 seq38/seq39/seq40 — Real-State Audit (2026-08-25)

**Queue rows:** `platform.r43_queue` seq 38, 39, 40. This is an investigation
+ tracker-accuracy pass, not a feature build — see "What this PR does and
does not do" at the bottom. All file paths, DB row counts, and code excerpts
below were read/queried live on 2026-08-25; none are inferred from memory or
from prior write-ups.

---

## seq38 — Chat response guardrails (brevity, options, hyperlinks, role scope)

**R-43 spec (verbatim from `platform.r43_queue` seq38, ref `PART-D-chat`,
depends_on seq30):** six rules, each enforced in code at
`compliance-tracker/src/lib/ai/chat-rules.ts` + the assistant route:
1. BREVITY — replies ≤10 words unless a list/figure genuinely needs more;
   over-length + no list/figure ⇒ regenerate once, then truncate with a
   "more" link.
2. TWO OPTIONS — any system question offers exactly two tappable options +
   a free-text third; never an open question with no options.
3. HYPERLINKS — any named entity renders as a link to its object screen.
4. PRELOADED DISPLAYS — prefer returning the real screen/report/card over
   prose.
5. ROLE SCOPE — a task is only offered if the asking user's role permits
   it, checked *before* listing the action.
6. NO NON-ERP — song/poem/essay/image requests get a fixed scope refusal
   (shares the drift detector from seq30).

**Target file `compliance-tracker/src/lib/ai/chat-rules.ts` does not exist.**
Verified: `find src -iname "chat-rules*"` → no results. No single module
implements these six rules as a unit anywhere in either repo.

**Verdict: PARTIAL — 0 of 6 rules implemented as specified; 2 adjacent,
differently-scoped primitives exist and were confirmed real by file:line.**

| # | Rule | Real code found | Matches spec? |
|---|------|-----------------|----------------|
| 1 | Brevity ≤10 words | `chat.ai_thread_system` prompt template (DB: `compliance.prompt_versions`, active row) says *"Keep replies concise and practical -- most replies should be a few words, not paragraphs"* — **prompt text only, unenforced**. `src/lib/ai-reply-gate.ts` `passesReplyGate()` only rejects empty replies or >8000 chars (`MAX_REPLY_CHARS`) — no word count, no regenerate-then-truncate, no "more" link. | No |
| 2 | Two options + free text | No code found (`grep -rn "two.options\|tappable"` — zero hits in `src/lib`). | No |
| 3 | Hyperlinks to entity screens | No code found. `veri-chat` components render `content` as plain/markdown text; no entity→URL resolver runs on AI reply text before render. | No |
| 4 | Preloaded displays over prose | No code found. `generateAiReply()` (`src/lib/services/chat-service.ts`) always returns a text `message` row; no branch returns a structured component reference. (`ai-reply-gate.ts`'s own header even names this exact gap as future work: "structured JSON output + a typed renderer instead of a text bubble... explicitly OUT OF SCOPE.") | No |
| 5 | Role scope before offering an action | `buildUserContextBlock()` (`src/lib/purpose-bound-ai.ts:103`) only injects `role` as a *tone* hint — `"[Context: speaking with X, role: Y -- ... keep tone appropriate for their role]"` — it never gates which actions/data the model is allowed to mention. `fetchContextEntitySummary()` (`chat-service.ts:562`) fetches `policy`/`pms_issue`/`project`/`veri_meeting` rows via `withTenantContext` (org-level RLS only) with **no per-role ACL check** on top. `DOMAIN_ALLOWED_TOOLS` (`purpose-bound-ai.ts:19`) gates tool-calling by **domain** (compliance/construction/…), not by the requesting user's **role** within that domain — a different axis than the spec asks for. | No |
| 6 | Non-ERP refusal | `DOMAIN_ALLOWED_TOOLS` + `isToolAllowedForDomain()` block off-domain *tool calls*, but nothing stops the chat LLM from answering a "write me a poem" prompt with prose (no tool call is needed to do that) — no refusal detector runs on the free-text reply. seq30's audit (`ai-os/R46_P9_SEQ30_L1_GUARDRAILS_GAP_ANALYSIS.md`, this same 2026-08-25 pass) independently confirms the "drift detector" this rule is meant to share does not exist as real code either. | No |

**Dependency note:** this queue row's own `depends_on` is seq30
(`L1 guardrails — anti-hallucination/drift/loop/collision`), confirmed
`status=PENDING` in `platform.r43_queue` as of this pass, with its own
parallel 2026-08-25 audit landing on PARTIAL (2/6 wired). seq38 cannot be
honestly marked DONE while its own stated dependency is unresolved.

---

## seq39 — Cache and token strategy (browser cache, token/prompt cache, token reduction)

**R-43 spec (verbatim from `platform.r43_queue` seq39, ref `G.6.1`,
depends_on seq38):** three layers at `compliance-tracker/src/lib/ai/cache.ts`
+ `projexa/src/lib/browser-cache.ts`:
1. Browser cache keyed by `org_id+user_id`, sessionStorage/IndexedDB only
   (never localStorage), cleared on logout/org-switch, TTL 5min
   lists/15min reports, invalidated on write.
2. Token/prompt cache of the static L1 prompt prefix, keyed by
   `sha256(candidate_set + schema_version)`.
3. Token reduction: L0 zero-token hits, 5-15 candidate functions per call
   (never 400), no derived fields in-prompt, one L1 call per request (not
   per segment), short JSON schema.

**Both target files are absent.** Verified: `find compliance-tracker/src
-iname cache.ts` and `find projexa/src -iname browser-cache*` → no results
in either repo.

**Verdict: PARTIAL — real, wired, production-logged infrastructure exists
for the *token/prompt-cache* layer and for *token-reduction*, but it is
verified by live data to deliver zero benefit on the platform's actual
default model. The *browser cache* layer (org+user-scoped, TTL'd,
write-invalidated) does not exist in either repo.**

### 1. Browser cache — NOT BUILT as specified
`src/lib/browser-intent-cache.ts` (232 lines, real, IndexedDB, wired into
`IntentCommandPalette.tsx`/`VeriComposer.tsx`) is the only browser-side
cache in either repo, and it is a **different feature**: it recalls a
user's own past chat-composer submissions for one-click resubmission (recency/
frequency-ranked), keyed by `(composerMode, selectedPath)` — not an
org+user-scoped read cache for lists/reports with TTL and write-invalidation.
It has no logout/org-switch clear hook, no 5/15-minute TTL, no
write-triggered invalidation, and (by its own header comment) deliberately
does not implement encryption-at-rest, judged unnecessary since it never
leaves the browser. `projexa/src/lib/browser-cache.ts` does not exist at
all — `grep -rli cache projexa/src` found no client-side data-cache module.

### 2. Token/prompt cache — REAL, wired, but 0% effective on the live default model
Real code, "Prompt & Cache Management Framework, Phase 1" (2026-07-14):
- `src/lib/prompt-cache/{compiler,fingerprint,metrics,utilization}.ts` —
  `compileStaticPrefix()` computes a real fingerprint of the resolved system
  prompt (the static prefix), used as the metrics grouping key.
- `src/lib/llm-client.ts` — `enablePromptCache` option; `callAnthropic()`
  (line ~377) and `callOpenAICompatible()` (line ~320) both send Anthropic's
  real `cache_control: { type: "ephemeral" }` content-block shape when
  `cacheEligible` (Anthropic-family model ID + prompt ≥ `ANTHROPIC_MIN_CACHEABLE_CHARS`
  = 3500 chars, doubled for Haiku). DeepSeek gets automatic caching for free
  per OpenRouter's own documented behaviour (no code needed). GLM/Zhipu is
  explicitly **not** guessed at — the code's own comment says OpenRouter's
  docs don't document its caching support, so no `cache_control` is sent
  rather than risk a malformed request on an unverified assumption.
- `chat-service.ts:775/787` passes `enablePromptCache: true` on every VERI
  Chat call.
- `recordPromptCacheMetric()` writes every call's cache-attempted/read/creation
  token counts to `compliance.prompt_cache_metrics`, **and** forwards the
  same usage to `logTokenUsage()` (`compliance.token_usage_ledger`) so
  Finance's real spend report also reflects cache savings.

**Live production data (Supabase, queried this pass):**
```sql
select count(*), count(*) filter (where cache_attempted)
from compliance.prompt_cache_metrics;
-- 14 rows total, 0 with cache_attempted = true

select provider, model, count(*) from compliance.prompt_cache_metrics
group by provider, model;
-- provider=groq, model=openai/gpt-oss-120b, count=14  (100% of rows)
```
Every real call logged so far used the platform's default floor-tier model,
`openai/gpt-oss-120b` via Groq (AGENTS.md Rule 8's 90-day-quality floor
model). `isAnthropicModelId()` in `llm-client.ts` only matches
`anthropic/*`/`claude-*` model IDs, so `cacheEligible` is `false` for every
one of these 14 real calls — the caching code path has never actually fired
in production. **The infrastructure is real and correctly wired; it just
covers a model family (Anthropic direct/via-OpenRouter, plus DeepSeek) that
the platform's real default traffic does not use.** This is a precise,
checkable gap, not a documentation gap: extending it to Groq would require
the same "verify before guessing" discipline this file already applies to
GLM — Groq's prompt-caching support was not verified in this pass either,
so it is reported as open rather than guessed at.

### 3. Token reduction — partially real, not measured against a candidate-set discipline
- `src/lib/prompt-normalizer.ts` `normalizeForLlm()` strips greetings/hedges/
  filler before the message reaches the LLM — real, wired at 2 call sites
  (`chat-service.ts`, `app/api/help/ask/route.ts`, `prompt-compiler/prompt-construction.ts`).
- `chat-service.ts` caps replies at `maxTokens: 800` — a real ceiling, but a
  ceiling is not the same as the R-43 "5-15 candidate functions, never 400"
  discipline; VERI Chat's system prompt (`chat.ai_thread_system`, read live
  from `compliance.prompt_versions`) has no candidate-function list at all —
  that concept applies to the L0→L1 segmentation pipeline (seq30's territory,
  `src/lib/segmentation/pipeline.ts`), a different code path than VERI Chat's
  `generateAiReply()`.
- No "tokens per resolved utterance, before/after" measurement exists
  anywhere — the R-43 test oracle for this item ("report avg tokens per
  resolved utterance; must fall after the prefix cache lands") is not
  instrumented. `token_usage_ledger` (14 rows, matching prompt_cache_metrics
  1:1) records raw usage per call but nothing computes or reports a
  before/after average.

---

## seq40 — Master checklist against what actually exists

**R-43 spec (verbatim, ref `A.9`, depends_on seq44):** the row's own `gap`
field is explicit that a full point-by-point review of R1–R42 has **no
stored artefact for R1–R30** and instructs: *"Itemise and verify... For
each: requirement -> implementation file path -> validation -> verification
-> boolean... Items with no retrievable source are listed as NOT RETRIEVABLE
— an honest gap, never a fabricated tick."* Its own `depends_on` is seq44
("Review R1-R45 and list what is STILL OPEN"), confirmed `status=PENDING`
in `platform.r43_queue` as of this pass — the full R1-R42 sweep this row
asks for is downstream of a not-yet-done prerequisite, and was not
attempted here for that reason (attempting it now, ahead of seq44, would
mean re-deriving R1-R37's history from scratch with no authoritative
starting point — exactly the "fabricated audit" risk this row's own gap
text warns against).

**What this pass could and did verify: the live row counts of every source
this row names**, as a real, dated snapshot future work can build on:

| Source (per seq40's own `how`) | Row count (queried live, 2026-08-25) | Note |
|---|---|---|
| `platform.claude_log` | 17 rows | 1 row has `status='handout'` |
| `platform.cc_spec` | **191** rows | seq40's own text says "122 points" — **69-row drift** between what the queue row assumes and the live table; whatever review consumes this next should treat 191 as current, not 122 |
| `platform.sumeet_requirements` | 69 rows | matches seq40's own stated count exactly |
| `platform.sumeet_uat` | **105** rows | seq40's own text says "38" — **67-row drift** |
| `platform.screen_spec` | 8 rows | |
| `platform.r43_queue` (this queue itself) | 65 rows total: 55 PENDING, 6 DONE, 4 PARTIAL | |
| Master v5 Google Doc `128TWKEcqCEAGWuevcEPrCnVrMfRnBFi4b0BaJkLOz8Y` | NOT RETRIEVABLE from this session (no Google Docs access wired into this agent's toolset) | flagged honestly, not silently skipped |

**Verdict: PARTIAL.** Real progress: (a) confirmed the seq44 dependency is
unmet, so the full R1-R42 sweep is correctly deferred rather than faked;
(b) took a real, queryable snapshot of every named source's row count,
surfacing two live drifts (cc_spec 191≠122, sumeet_uat 105≠38) that the
eventual full review needs to reconcile; (c) this document itself, plus the
seq38/seq39 findings above, is a real requirement→file→boolean slice of
exactly the format seq40 asks for, covering the "chat guardrails" and
"cache/token strategy" areas — usable as-is by whoever picks up seq44/seq40
next, not a placeholder.

Real gap remaining: the R1-R37/R1-R42 point-by-point sweep itself (~460
combined source rows across `cc_spec`/`sumeet_requirements`/`sumeet_uat`/
`screen_spec`/`claude_log`) is unattempted — correctly scoped as its own
pass behind seq44, not fabricated here.

---

## What this PR does and does not do

**Does:** add this one findings document. Read-only investigation
everywhere else (file reads, `grep`/`find`, and `execute_sql` reads against
Supabase project `pcrjmlpuqsbocqfwoxod`). Updates `platform.r43_queue`
evidence/status for seq38/39/40 via a separate MCP call, not via this PR.

**Does not:** create `chat-rules.ts`, `cache.ts`, or `browser-cache.ts`;
does not touch any runtime chat/cache/LLM code path; does not run the
R1-R42 sweep (correctly blocked on seq44).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
