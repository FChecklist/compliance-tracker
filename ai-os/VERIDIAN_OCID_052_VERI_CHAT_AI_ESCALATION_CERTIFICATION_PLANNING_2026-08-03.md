# VERIDIAN OCID-052 — VERI Chat AI Escalation and Deterministic Software Execution Certification (dedicated planning, 2026-08-03)

**UMR:** `UMR-20260803-115620-29c6` (unchanged — this deepens, not re-registers, the existing OCID-052 UMR)
**Parent:** `UMR-20260802-165606-4413` (OCID-020, Business Certification phase)
**Prior artifact:** `ai-os/VERIDIAN_OCID_047_052_BUSINESS_CERTIFICATION_PLANNING_2026-08-03.md`'s own OCID-052
section (merged via PR #811). That section correctly ruled out `gateway.py`/`OWNER_ENGINE` (this
orchestration session's own server-ops tooling) as the target, but then named `mother-router.ts` as
"the real system this OCID's test plan should target" **without having read it yet** — its own task
breakdown item 1 said "read `mother-router.ts` directly to confirm its real deterministic-vs-AI decision
logic... before writing any test case against an assumed behavior." This document performs that read
(and the reads it leads to), and reports a **real correction**: `mother-router.ts` is not the mechanism.

This document deepens the existing, merged OCID-052 section in place rather than duplicating it — same
convention as OCID-051's dedicated doc. Planning only, per every governing directive's own explicit
instruction: **no testing, no implementation, no certification performed in this pass.**

**Zero-duplication check performed first, per directive**: `python3 /opt/veridian/scripts/resource_governor.py
--query-umr --search "OCID-052"` and `--search "UMR-20260803-115620-29c6"` both returned `{"count": 0,
"matches": []}` — no task_spec already queued/dispatched against this OCID/UMR in the dispatch DB (this
check queries the task-dispatch table, not document content — the existing merged doc is the real prior
artifact, found via `ai-os/OS.yaml` and confirmed via `git log`, not via this query).

---

## Correction: `mother-router.ts` is not the deterministic-first / AI-escalation gate

Read directly (`src/lib/ai-router/mother-router.ts`, 666 lines): its own header states its real job —
"a real, unifying **AI model/provider registry** + versioned routing policy" across three *scopes*
(`software_team`, `end_user_org`, `sales_marketing`). It decides **which AI model/provider** a request
should use once something has already decided AI should run at all. It contains no
deterministic-vs-AI decision logic — grep for `deterministic`/`escalat` inside it turns up nothing
relevant (only unrelated comment matches). Citing it as OCID-052's target would have built a certification
test plan against the wrong file, the same class of error the prior section already correctly avoided
for `gateway.py`.

## Real mechanism found (grounded in file:line, not assumed)

VERI Chat's real 1:1 AI thread reply path is `generateAiReply()` in `src/lib/services/chat-service.ts`
(~line 613 on). Its real, in-order gate sequence before any LLM call:

1. **Policy gate** (`enforcePolicy()`, chat-service.ts:623) — a denied request never reaches model
   resolution at all; returns a refusal message instead.
2. **Deterministic routing gate** (`tryDeterministicRoute()`, `src/lib/llm-routing-gate.ts:82-90`,
   invoked at chat-service.ts:638) — Wave 150's real "central 'Need LLM?' routing gate"
   (`Phase4_Implementation_Plan.md` P0 item 3). Classifies the message via `classifyIntent()`
   (`src/lib/intent-engine.ts:18-31`, deterministic word-boundary regex, 5 intents:
   `create_task`/`check_status`/`create_contact`/`generate_report`/`unknown`). Exactly **2 of the 5**
   intents have a registered deterministic handler (`llm-routing-gate.ts:41-72`): `check_status` (direct
   DB lookup of the user's latest task, zero LLM call) and `generate_report` (direct DB count over a
   7-day window, zero LLM call). `create_task`/`create_contact`/`unknown` return `{handled: false}` by
   design — the file's own comment states why: those two still "need real argument extraction from free
   text before they could safely bypass the LLM — correctly left for the LLM path for now rather than
   guessing." A matched handler returns a reply that is inserted with **zero LLM call and zero model
   resolution** (chat-service.ts:639-645).
3. **Dialogue-script gate** (`runDialogueScriptTurn()`, `src/lib/services/dialogue-script-executor.ts:259`,
   invoked at chat-service.ts:653) — resolves whether an active/startable `dialogue_script` capability
   package exists for this conversation (via Dynamic Chain selection or fuzzy prompt-overlap fallback);
   if so, drives the turn deterministically via a scripted step instead of a free-text LLM call. Returns
   `null` (complete no-op) on no match/no reliable package/an already-escalated script.
4. **Only if all three gates above pass through unmatched** does the function reach `resolveModelConfig()`
   (chat-service.ts:667) and eventually `callLLM()` (chat-service.ts:15,~872) — the real AI-escalation
   point. A separate, narrower escalation *within* this path (`checkPreCallEscalation()`/
   `detectLowConfidenceResponse()`, `floor-tier-escalation.ts`) governs floor-tier-model → stronger-model
   escalation, not deterministic-software → AI escalation; this is a distinct axis, not to be conflated
   with items 1-3 above (a mistake worth naming since both use the word "escalation").

This confirms, by direct code read, that a real deterministic-software-first / AI-escalation-second
layer already exists end to end for VERI Chat's 1:1 AI thread, wired through **exactly one real chokepoint**
(`generateAiReply()`), not a router file that turned out to govern something else.

## Real, honest gap found: the distinguishing UI signal is incidental, not designed

Read directly (`src/components/chat/ThreadView.tsx:226-283`, the real VERI Chat message-bubble component):
every reply inserted with `senderId: null` — whether from the deterministic route (chat-service.ts:644),
the dialogue-script route (chat-service.ts:664), a policy refusal (chat-service.ts:632), **or** a genuine
LLM reply (chat-service.ts:872) — renders identically: the same teal bubble, the same `Bot` icon, the same
"VERI" label (`ThreadView.tsx:246-249`). There is **no explicit "deterministic" vs "AI" label anywhere in
this component.**

The one real, already-existing signal that happens to correlate with the distinction: `confidenceLabel`
(`src/lib/db/schema.ts:3845-3852`) is set **only** on the genuine LLM-generated path
(`deriveConfidenceLabel()`, chat-service.ts:869 and :996 — both inside the `callLLM` branch) and is
`null` for every deterministic-route, dialogue-script, and refusal reply (those insert calls at
chat-service.ts:644/664/632 never set it). `ThreadView.tsx:234` renders a small confidence badge
("High/Medium/Low confidence") only `if (isAi && message.confidenceLabel)`. So today: **badge present ⇒
a real LLM call happened; badge absent ⇒ deterministic/scripted/refused.** This is real and observable,
but it was designed as an AI-confidence heuristic (per its own code comments, "REVIEW-FRAMEWORK-WAVE4 AI
Confidence Score"), not as a deterministic-vs-AI indicator — an end user has no labeled, intentional way
to tell the two apart today. This is the real, honest finding OCID-052's own test plan (item 4 below) must
confirm or refute directly, not assume solved by the badge's incidental behavior.

## Real task breakdown (deepened, supersedes the "read mother-router.ts" placeholder from the merged section)

1. ~~Read `mother-router.ts`~~ — **done above**; corrected to the real target
   (`llm-routing-gate.ts` + `chat-service.ts` + `dialogue-script-executor.ts`).
2. **Real test case 1 (deterministic-only path)**: send a real VERI Chat 1:1-AI-thread message matching
   a `check_status` or `generate_report` trigger phrase (`intent-engine.ts:20-27`, e.g. "what's the
   status" or "generate a report"). Confirm via real evidence — not narrated — that (a) the reply is
   correct against the real DB state, (b) `resolveModelConfig()`/`callLLM()` was never invoked (e.g. via a
   log/telemetry check or a temporary call-count assertion), and (c) the persisted message row has
   `confidenceLabel: null`.
3. **Real test case 2 (AI-escalation path)**: send a real message matching `create_task`, `create_contact`,
   or genuinely free-text/`unknown` intent (deterministic gate returns `{handled:false}` by design, and no
   dialogue-script package is active). Confirm real evidence that `callLLM()` fires, a genuine model reply
   is returned, and the persisted row has a non-null `confidenceLabel`.
4. **Real UI check**: with both messages from steps 2-3 rendered in the same real thread, confirm directly
   (screenshot or DOM read) whether an end user can actually tell them apart. Per the discovery above, the
   only real signal today is confidence-badge presence/absence — confirm this live rather than assuming;
   if it holds, register as a real but *unintentional* distinguishing mechanism and flag the gap (no
   explicit "Deterministic ✓" vs "AI-generated" label) as this OCID's own certification-blocking finding,
   not something to silently paper over.
5. **Real dialogue-script path (optional 4th case, if a scripted capability package exists for the test
   org)**: repeat step 2's evidence standard for a `runDialogueScriptTurn()` match, since it is a third,
   distinct deterministic-adjacent path (Lower-AI-driven, not zero-AI, not full free-text LLM) that this
   OCID's definition of done should account for explicitly rather than collapsing into either bucket.

## Real test execution results (2026-08-03, PM decision UMR-20260803-142956-d931)

Items 2 and 3 above were actually executed live against `projexa-ai.com`, not narrated. No browser was
available on this server for the run (see `GAP-PLAYWRIGHT-BROWSER-MISSING-SYSTEM-LIBS` below), so both
tests were driven directly against the real Supabase Auth REST API + this app's own authenticated API
routes: real signup (`POST /auth/v1/signup`) → real Admin-API email-confirm bypass → real password-grant
login (`POST /auth/v1/token?grant_type=password`) → a hand-constructed `@supabase/ssr` v0.12.3 session
cookie (`base64-` + base64url JSON, matching `node_modules/@supabase/ssr/dist/module/cookies.js`'s own
encoding exactly) → real `GET /api/conversations` (which triggers `requireAuth()`'s real, server-side
`autoProvisionUser()` — confirmed live via VERI's real welcome message: "Your workspace is set up and all
your modules are switched on") → real `POST /api/conversations/[id]/messages`. Two fresh, real, isolated
test orgs were used (one per item), zero pre-existing/shared test data.

**Item 2 (deterministic-only path) — PASS.** Sent `"what's the status"` to a fresh org with zero tasks.
Real response: `{"aiReply":{"senderId":null,"content":"No tasks yet"}}`, HTTP 201, ~1.4s round-trip. Live
DB row (`compliance.messages`, queried directly) confirmed: `content = "No tasks yet"` (exact match to
`suggestResponseForTaskStatus`'s empty-state output, ruling out the policy-refusal/no-model-configured
null-producing paths named in this doc's own Step 2), `confidence_label IS NULL`. All three Step 2 success
criteria (correct reply, no `callLLM()`, null `confidenceLabel`) independently confirmed.

**Item 3 (AI-escalation path) — PASS on routing, with a new real finding.** Sent a genuinely free-text,
non-triggering message (`"Can you help me understand how depreciation works for our fixed assets?"`) to a
second fresh org. Real response HTTP 201, ~6.6s round-trip (consistent with a real LLM call, not a DB
lookup). Live DB row confirmed `confidence_label = "high"` (populated — proof `callLLM()` genuinely fired,
per this doc's own Step 3 criterion). Routing behavior itself is correct and confirmed.

However, the actual reply content was: `"Boss, I'm sorry—I can't help with that."` — a refusal to a
completely benign, in-scope business question. Root-caused (not assumed): the real system prompt
(`drizzle/0172_priority11_gap_d13_assumption_scoped.sql`'s `chat.ai_thread_system`, assembled at
`chat-service.ts:680-694`) contains a real, direct self-contradiction. Its own persona paragraph states
VERIDIAN covers "finance & accounting... operations & inventory... compliance & legal", but the appended
`{{PURPOSE_CLAUSE}}` (`src/lib/purpose-bound-ai.ts:76-82`) separately instructs: *"You are strictly scoped
to the 'compliance' business domain. Refuse any request outside this domain's purpose..."* A model reading
"depreciation of fixed assets" as accounting/finance rather than strictly "compliance" has explicit
license, from the app's own system prompt, to decline -- registered as `GAP-VERI-CHAT-PURPOSE-CLAUSE-SCOPE-CONTRADICTION`
below. A second, related finding: `deriveConfidenceLabel()` (`src/lib/floor-tier-escalation.ts:116-120`)
defaults to `"high"` whenever `detectLowConfidenceResponse()` (same file, lines 49-55) doesn't match a
narrow "I'm not sure"/"I don't know"-style phrase list -- that list has zero refusal-language coverage, so
a genuine refusal gets mislabeled as a high-confidence reply. This directly matters for this OCID's own
Item 4 (UI-distinguishability): `confidenceLabel` is not just an unintentional distinguishing signal (per
the gap already named above), it is also not a reliable *quality* signal -- registered as
`GAP-VERI-CHAT-CONFIDENCE-LABEL-NO-REFUSAL-DETECTION` below.

**Item 4 (UI-distinguishability) and Item 5 (dialogue-script path) — not executed this pass**, deferred to
a future cycle; the routing-correctness items (2-3) were prioritized as the highest-signal, lowest-setup
starting point per the Explore-agent survey across all six OCID-047-052 docs.

## New real gaps registered this pass (`ai-os/MASTER-TRACKER.yaml`)

- `GAP-VERI-CHAT-PURPOSE-CLAUSE-SCOPE-CONTRADICTION` -- system prompt's persona and its `PURPOSE_CLAUSE`
  disagree on VERI Chat's real scope, causing live, reproducible refusals on benign, in-scope questions.
- `GAP-VERI-CHAT-CONFIDENCE-LABEL-NO-REFUSAL-DETECTION` -- `detectLowConfidenceResponse()` has no
  refusal-language coverage, so genuine refusals are mislabeled `"high"` confidence.
- `GAP-PLAYWRIGHT-BROWSER-MISSING-SYSTEM-LIBS` -- both installed Playwright Chromium builds
  (`chromium-1228`/`chromium_headless_shell-1228`) fail to launch on this server: `ldd` confirms real
  missing shared libraries (`libnspr4.so`, `libnss3.so`, `libatk-1.0.so.0`, and 10+ others). No
  passwordless `sudo` available to install them. Blocks any future Playwright-based E2E work on this
  server until resolved by someone with `sudo` access (`apt-get install -y` the missing libs, or
  `npx playwright install --with-deps` re-run with elevated privileges).

## Definition of done (unchanged from the merged section, restated precisely against the real mechanism)

Real test cases confirming `tryDeterministicRoute()`/`runDialogueScriptTurn()` genuinely resolve a routine
`check_status`/`generate_report` request with zero LLM call; one real `create_task`/`create_contact`/
free-text request genuinely escalating through to `callLLM()` end to end; and a real, live confirmation of
whether `ThreadView.tsx`'s confidence-badge behavior is (or is not) sufficient for an end user to tell a
deterministic reply apart from an AI-escalated one — reported honestly either way, not assumed.

## Reuse discipline

No new chat engine, no new routing architecture, no new schema — every mechanism named above
(`llm-routing-gate.ts`, `intent-engine.ts`, `dialogue-script-executor.ts`, `chat-service.ts`,
`ThreadView.tsx`, `messages.confidenceLabel`) already exists and is already wired into the real VERI Chat
1:1 AI thread send path. This document adds no code.
