# AUDIT_wave146_zai_items.md

**Auditor:** Claude Code Sonnet Desktop | **Date:** 2026-07-09
**Scope:** the 3 Phase 2 items z.ai GLM-5.2 owned and implemented (Joint_Implementation_Plan.md, division agreed 2026-07-09): filler-word/phrase-normalization preprocessor, confidence badge + "VERI is thinking" indicator, and the conversations state-column writer decision. Per the agreed cross-audit workflow: whichever agent did not implement a task audits it — I implemented Wave 146's other 3 items (confirmation gate, PII redaction, CLEE capture→apply), z.ai audits those separately; this document is my audit of z.ai's 3.

---

## 1. Filler-word/phrase-normalization preprocessor (`src/lib/prompt-normalizer.ts`)

**Verdict: PASS.**

- Correctly reused the exact denylist (never-strip words) I specified verbatim from VERIDIAN.docx Study 1 Level 6.
- Found and documented a real, defensible tradeoff I hadn't anticipated: the denylist takes precedence over 2 listed filler phrases ("may you" contains "may", "if possible" contains "if"), so those specific phrases are never stripped even though they're nominally on the filler list. This is the *correct* conservative choice — better to under-strip than risk altering permission/condition semantics — and it's called out explicitly in a comment rather than silently happening.
- Address-word stripping (assistant/VERI/dude/chatgpt/chat/AI/buddy/friend) is scoped to whole-segment matches only (split on sentence delimiters, exact-match check) — correctly avoids the false positive I specifically warned about in the task brief ("AI" inside "AI cognitive research" must not be touched). Verified by reading the segment-split logic: it only strips a segment whose *entire* trimmed content is an address word.
- Empty-result safety fallback present and correct: if stripping would leave nothing but punctuation/whitespace, the original text is returned unmodified — never sends an empty prompt to the LLM.
- Integration into `chat-service.ts` is correctly scoped: `enforcePolicy()` still sees the original `userMessage` (policy/injection checks must see real text, not a normalized copy that could theoretically be crafted to evade a keyword check) — only the `callLLM` argument is normalized. This matches the task brief exactly.
- No bugs found. No security concern (deterministic, no LLM call, no injection surface — it only ever *removes* text, never interprets or executes it).

## 2. Confidence badge + "VERI is thinking" indicator (`fde/page.tsx`, `ThreadView.tsx`)

**Verdict: PASS.**

- `reuseLevel` added to the `FdeRequest` type and rendered via a second `Badge`, reusing the existing `Badge` component and the file's existing color-token conventions (`ct-teal`/`ct-saffron`/`ct-cloud`) rather than inventing new styling. Confirmed the backend already returned this field (I verified this myself before writing the task brief) — no backend changes needed or made, matching the brief's scope.
- Label mapping (`exact_match` → "High Confidence", `llm_assisted_match` → "Needs Confirmation", `new_proposal` → "New Capability") matches VERIDIAN.docx Study 32.16's vocabulary as instructed.
- Thinking indicator correctly hooks into the pre-existing `sending` state in `ThreadView.tsx` rather than inventing new state — gated on `sending && conversation.isAiThread`, so it never shows for non-AI conversations. `useEffect` correctly resets `thinkingPhase` to 0 and tears down the interval when `showThinking` goes false, and cleans up on unmount (standard `return () => clearInterval(id)`). No memory-leak risk.
- Reused the pre-existing `Bot` icon import rather than adding a new one — checked `git show main:...ThreadView.tsx` myself to confirm `Bot` was already imported before this change, not silently added.
- No bugs found. No security concern (pure presentational change, no new data flow, no new routes).

## 3. Conversation state-column writer decision (`docs/wave146-state-columns-decision.md`)

**Verdict: PASS — and a genuinely strong piece of work.**

I re-verified the two key factual claims the document makes, independently:

- **"`dispatchInstruction` does not pass a `conversationId`/`aiThreadId` in its POST body to `/api/tasks`."** Confirmed by reading `VeriComposer.tsx`'s `dispatchInstruction` myself (I wrote the confirmation-gate feature in this exact function this same session) — the `body` object is `{ title, description, projectId, workerAgentId?, agentInputs?, engineKey?, engineInputs? }`. No conversation reference anywhere. The document's conclusion that no real task↔conversation linkage exists in current code is correct.
- **"`ensureAiThread` seeds a welcome message immediately on creation, so there is no observable 'created but not active' window."** Confirmed by reading the same function — the welcome-message insert happens unconditionally right after the conversation/participant rows are created, in the same code path, with no gap.

Both of the document's load-bearing factual claims check out against the real code, not just plausible-sounding reasoning. The choice of Outcome B (document, don't fabricate) was the correct call: forcing a write of `current_state`/`workflow_id` with no real code path reading or acting on those values would have created exactly the kind of "signal into the void" this whole study has repeatedly flagged as a systemic risk pattern (dead/misleading state — the same category of issue as the false "completed" claims found in `ai-os/boss/BOARD.yaml` earlier this session). The Phase 3 prerequisites list (state taxonomy, transition rules, a real consumer, the task↔conversation linkage, a `previous_state` contract) is concrete and actionable, not vague.

No changes requested. This document should be treated as real input to Phase 3 scoping, not just an audit trail entry.

---

## Overall verdict: APPROVE, all 3 items

No bugs, no security concerns, no scope violations found in any of the 3. Two items are genuinely careful engineering (filler preprocessor's denylist-precedence handling, confidence badge's correct reuse of existing patterns); the third is a well-reasoned, independently-verified "no" that's more valuable than a hollow "yes" would have been.
