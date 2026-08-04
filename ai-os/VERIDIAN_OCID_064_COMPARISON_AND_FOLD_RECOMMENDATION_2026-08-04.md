# OCID-064 -- Honest Comparison vs OCID-061/OCID-062, and a Fold-In Recommendation

**Not a new implementation initiative.** This dispatch's incoming prompt named parent chain
`UMR-20260802-173631-ca85` (OCID-021) -> `UMR-20260802-165606-4413` (OCID-020), and arrived under
the Mandatory Governance Directive `UMR-20260804-051521-7099`. As PM, the Owner explicitly refused
to register OCID-064 as a third parallel initiative alongside the two siblings already registered
this same day: OCID-061 (`UMR-20260804-044535-7214`, the universal deterministic input runtime,
branch `worker/task-20260804-054220-register-ocid-061--universal-determinist`, PR #878 **OPEN, not
merged**) and OCID-062 (the Mini VERIDIAN runtime architecture, branch
`docs/ocid062-server-authority-mini-veridian-architecture`, PR #876 **OPEN, not merged**). This
document's real scope, per that PM instruction: read both siblings' full discovery/design output,
read the new prompt's content, and produce an honest comparison -- what genuinely new information
the new prompt adds versus what is restatement of already-registered architecture -- so a fresh PM
decision can fold real value into an existing OCID rather than spinning up a competing deliverable.
**No code, no database object, no new registry, no new schema was created for this dispatch.**

**Explicitly forbidden this phase, per the PM's own instruction, and respected here:** no new
database table; no new parallel Universal Metadata Registry or Universal Task Registry, server-side
or "local browser-side"; the incoming prompt's own envelope schema names four separate registry-id
fields (brand, organization, task, and a fourth identity field), which the PM correctly reads as a
risk of standing up four parallel registries. Nothing below recommends building that. Any real local
browser task tracking, if and when a fresh PM decision authorizes it, must be a cache/mirror of the
one existing UMR/UTR concept -- never a second schema. This document takes no position beyond
restating that constraint; it is the PM's, not a finding of this pass.

---

## 1. The new prompt's four claimed elements, taken at face value

The incoming prompt (per the PM's own framing, since the raw prompt text itself was not re-quoted
verbatim into this document beyond what the PM's own instruction already excerpted) describes:

1. **Local browser-side LLM tool calling.**
2. **Context injection so the model cannot hallucinate identifiers.**
3. **A deterministic confidence calculation done in real code, not trusted from the model.**
4. **An envelope object carrying brand, organization, and task identity fields through browser, PWA,
   and server execution.**

Each is checked below against OCID-061's real discovery output and OCID-062's real design output,
both read in full for this comparison (`git cat-file -p <branch>:<path>` against each PR's own head
commit, not the truncated shell-display trailer this environment is known to produce on large `git
show`/`diff` output -- see this session's own methodology note in the Honest Gaps section).

---

## 2. Element-by-element verdict

### 2.1 Local browser-side LLM tool calling -- **RESTATEMENT, not new.**

OCID-062 §4.1 already catalogs this as real, already-built infrastructure: `src/lib/browser-execution/tool-calling.ts`
-- "real client-side MCP-shaped tool dispatch (`BrowserToolRegistry`, `dispatchMcpToolCall`), zero
network hop, fully client-side." The same section names the concrete model/runtime choice the new
prompt's "tool calling" framing implies picking: `webllm-engine.ts` (`Qwen2.5-0.5B-Instruct-q4f16_1-MLC`
via `@mlc-ai/web-llm`, gated on WebGPU), `transformers-engine.ts` (`Xenova/all-MiniLM-L6-v2` via
`@huggingface/transformers`), and `npu-engine.ts` (WebNN, gated on `navigator.ml`). OCID-062 §4.1 also
already discloses the one honest gap here: none of these tier engines are wired into `VeriComposer.tsx`'s
live send path today. The new prompt does not name a different tool-calling mechanism, a different
model choice (no Ollama or equivalent is named anywhere in the new prompt's own four elements as
excerpted), or a different wiring point than what OCID-062 §4.5 already proposes ("wiring existing,
tested engines into an existing, live send path -- not new engine-building").

### 2.2 Context injection against identifier hallucination -- **PARTIAL new framing, but the
underlying principle is already established; no new mechanism is named.**

The general principle -- AI must never invent an identifier, deadline, or number that software
already knows -- is already load-bearing, cited repeatedly and independently across this OCID chain:
OCID-031 §1 ("AI never executes software responsibilities"), OCID-062 §3.6 ("engines compute, AI
never invents a number," citing `grc-workflow-engine.ts`'s own header discipline), and OCID-062 §4.2's
real, live "non-authoritative telemetry only" rule at `src/app/api/prompt-compiler/execute/route.ts`
(the server never trusts the browser's own compiled result for anything authoritative). "Context
injection" as a named technique -- putting the real, server-known IDs directly into the model's
context window so it echoes rather than invents them -- is a reasonable, more concrete restatement of
this same principle, but the new prompt (as excerpted) does not specify a concrete injection
mechanism, a concrete point in the pipeline where it would happen, or a schema for what gets injected
beyond the envelope object covered in 2.4 below. There is no evidence this is a mechanism distinct
from what OCID-062 §5.2 step 3 already describes: the server's SECOND pass "recomputes the full,
authoritative result from `rawText` and real DB-backed context," which is, functionally, server-side
context injection against a client-side draft. **Verdict: same principle, no new mechanism added.**

### 2.3 Deterministic confidence calculation, not trusted from the model -- **RESTATEMENT, not new.**

This is, concretely, the same mechanism OCID-062 §3.5 already documents as real and live:
`llm-routing-gate.ts`'s `tryDeterministicRoute()`, and the server-computed `confidenceLabel` field
consumed by `HomeThreadSlot.tsx`'s `withSourceTypeLabel()` (closing
`GAP-VERI-CHAT-NO-VISIBLE-DETERMINISTIC-VS-AI-SIGNAL`, `ai-os/MASTER-TRACKER.yaml`, `status:
resolved`). That gap's own closing note is explicit that confidence/source labeling is computed
server-side in real code and only rendered, never computed, by the client -- exactly what the new
prompt's third element describes. The new prompt does not supply a different confidence formula, a
different set of inputs, or a different consumption point than what is already built and cited here.
**No new value found in this element** -- it is the clearest pure restatement of the four.

### 2.4 Envelope object carrying brand/organization/task identity -- **RESTATEMENT of an already-named
real gap, with a framing the PM correctly flagged as risky.**

OCID-061 §5 already found, and named as a confirmed real gap (not an undiscovered mechanism): there
is no canonical intent object or shared intent-resolution layer in this codebase today (`GAP-OCID-061-NO-CANONICAL-INTENT-OBJECT`).
Each of the four real intake surfaces OCID-061 mapped (Chain Selector/mode pill, free chat, voice
tickets, webhook/share-target/guest/partner surfaces) resolves independently to its own backend
shape today -- there is no single point where they converge into one object before downstream
processing. The new prompt's "envelope object carrying brand, organization, and task identity fields
through browser, PWA, and server execution" is describing exactly this same unbuilt canonical-object
gap, using different terminology ("envelope" vs. "canonical intent object"). It adds no new intake
surface, no new resolution mechanism, and no new field beyond identity/brand/org/task, all of which
already exist as real, separately-tracked identifiers in this codebase (`organizations.id`,
`AuthContext`'s org/user/role fields per OCID-062 §3.1, the existing brand-as-configuration model
OCID-048 already certified as "a real brand is a configuration of the one shared platform, not
separate software," and the task/UMR identity chain this entire OCID series is itself built on). The
PM's own flag is correct and independently confirmed here: naming four separate registry-id fields on
a from-scratch envelope reads as proposing four parallel registries sitting beside the one real
UMR/UTR concept and the one real `organizations`/`AuthContext` identity model -- that would duplicate,
not close, the gap OCID-061 already named.

---

## 3. Summary table

| Element | Already covered by | Verdict |
|---|---|---|
| Local browser LLM tool calling | OCID-062 §4.1 (`tool-calling.ts`, `webllm-engine.ts`, `transformers-engine.ts`, `npu-engine.ts`), §4.5 (proposed wiring) | Restatement -- no new mechanism or tooling choice |
| Context injection against ID hallucination | OCID-031 §1, OCID-062 §3.6/§4.2/§5.2 (non-authoritative telemetry, server recomputes from real context) | Same principle already established; no new mechanism named |
| Deterministic confidence calculation | OCID-062 §3.5 (`llm-routing-gate.ts`, `confidenceLabel`, `withSourceTypeLabel()`, `GAP-VERI-CHAT-NO-VISIBLE-DETERMINISTIC-VS-AI-SIGNAL` resolved) | Restatement -- clearest pure duplicate of the four |
| Brand/org/task identity envelope | OCID-061 §5 (`GAP-OCID-061-NO-CANONICAL-INTENT-OBJECT`), OCID-062 §3.1 (`AuthContext`), OCID-048 (brand-as-configuration) | Restatement of an already-named real gap; the "4 registries" framing is the one part the PM correctly flags as new *risk*, not new *value* |

**Net finding: no genuinely new tooling choice, algorithm, or mechanism was found in the new prompt
beyond what OCID-061 and OCID-062 already discovered or proposed.** All four elements map cleanly
onto existing sections of the two siblings. The one place the new prompt's own framing diverges from
theirs is the 4-field envelope's parallel-registry shape -- and that divergence is a regression to
avoid, not a gap to close with a new deliverable.

---

## 4. Recommendation: fold in, do not build OCID-064 separately

- **Fold 2.4 (identity envelope) into OCID-061's own gap, `GAP-OCID-061-NO-CANONICAL-INTENT-OBJECT`
  (`ai-os/MASTER-TRACKER.yaml`, and OCID-061's own §5 conclusion table).** When a fresh PM decision
  eventually authorizes closing that gap, the canonical intent object's schema should carry
  brand/organization/task identity as *fields on the one object*, resolved against the existing
  `organizations`/`AuthContext`/UMR-task identity already in this codebase -- not as four separate
  registry-id lookups against four separate stores. This is the same object OCID-061 §5's table
  already shows each of the four intake surfaces failing to converge into; the new prompt's envelope
  is a candidate schema sketch for that same object, not a reason to register a different one.
- **Fold 2.1 and 2.2 (browser tool calling + context injection) into OCID-062 §4.5's already-proposed
  scope** ("Tier-aware local response for narrow, low-stakes intents"). When `tool-calling.ts`'s
  `BrowserToolRegistry` is eventually wired into `VeriComposer.tsx`'s live send path (the real gap
  OCID-062 §4.1 already names), the concrete mechanism for "never invents an identifier" should be:
  inject the real, server-sourced canonical-intent-object fields (once 2.4's fold lands) into the
  tool-call context, then let the server's existing SECOND pass (§5.2 step 3, unchanged) remain the
  authoritative recomputation -- exactly the non-authoritative-telemetry pattern already proven live
  in `client-compile.ts` -> `/api/prompt-compiler/execute`.
- **2.3 (deterministic confidence) needs no fold-in action.** It is already built, already resolved
  as a gap (`GAP-VERI-CHAT-NO-VISIBLE-DETERMINISTIC-VS-AI-SIGNAL`), and the new prompt supplied no
  new formula, input, or consumption point to add to it.
- **Do not register OCID-064 as its own deliverable.** Nothing found here clears the bar of "genuinely
  new information" the PM's own instruction set as the condition for a separate deliverable.

---

## 5. Honest gaps and uncertainties, not glossed over

- **This document did not have the new prompt's literal raw text to quote verbatim** -- it worked
  from the PM's own excerpt/framing of that prompt (four named elements) rather than a full copy
  reproduced here. If the Owner's actual original prompt contains a concrete tooling choice (e.g. a
  named local-inference runtime like Ollama, or a specific confidence formula) that the PM's excerpt
  did not carry into this dispatch, that concrete detail would not be reflected in the verdicts above
  and should be re-checked against §2 before treating this comparison as final.
- **OCID-061 and OCID-062 are both open, unmerged PRs (#878, #876)** as of this writing -- their
  content could still change before merge. This document cites their current branch-head content,
  not a merged, settled artifact.
- **A real, separate governance concern was noticed but is out of scope for this comparison and is
  disclosed rather than silently fixed:** diffing OCID-061's branch (`pr878-ocid061`) against
  `origin/main` for `ai-os/MASTER-TRACKER.yaml` and `ai-os/OS.yaml` shows that branch's edits appear
  to replace, not append to, several unrelated existing entries (e.g. `GAP-VERI-TODO-STUCK-LOADING-NOT-READY`,
  `GAP-NO-SERVICE-WORKER-OFFLINE-BLANK-PAGE`, and several `OS.yaml` document-index rows), suggesting
  that branch may have been started from a stale point in `origin/main`'s history. This document does
  not attempt to resolve that -- it is a real risk for whoever reviews PR #878 for merge, not something
  this comparison-only dispatch is authorized to fix.
- **This session's own methodology note:** this environment's Bash tool is independently known (this
  session's own prior memory) to silently truncate large `git show`/`git diff` output and append a
  fabricated-looking "... more files changed" trailer. Both sibling documents were read via `git
  cat-file -p <rev>:<path>` into a file and then the `Read` tool, specifically to avoid this failure
  mode, and their reported line counts (139 lines for OCID-061, 443 lines for OCID-062) were verified
  against `git cat-file -s` byte counts before being treated as complete.

---

## 6. Readiness

This document hands off: (a) an honest, section-cited comparison of the new prompt's four claimed
elements against OCID-061 and OCID-062's real, current discovery/design output, (b) a finding that no
element clears the bar for a new, separate OCID-064 deliverable, and (c) a concrete fold-in
recommendation naming exactly which existing section of which existing OCID should absorb each real
element, once a fresh PM decision authorizes implementation. It implements nothing, creates no
database object, and registers no new registry -- consistent with the PM's explicit instruction for
this phase.

Canonical artifact created: this file
(`ai-os/VERIDIAN_OCID_064_COMPARISON_AND_FOLD_RECOMMENDATION_2026-08-04.md`).
Amends the existing canonical-artifact index (`ai-os/OS.yaml`); does not start a new UMR chain and
does not add a new gap to `ai-os/MASTER-TRACKER.yaml` (this comparison found no new gap -- only a
fold-in target for OCID-061's and OCID-062's existing ones).
