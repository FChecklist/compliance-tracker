> **ARCHIVED / STALE — do not treat as current.** See docs/master/INDEX.md or ai-os/MASTER-TRACKER.yaml for current status.

# Task.docx Evaluation

**Author:** Claude Code Sonnet Desktop | **Date:** 2026-07-09
**Source:** `Task.docx` (Boss, delivered after Phase 4 completed, with explicit instruction: "evaluate... implement what is good... don't duplicate if already built... you are free to take your own decision. Reject, accept, edit.")

**Methodology:** every distinct requirement in the document is checked against real, current code (not assumed) before a verdict is given. Verdicts: **ALREADY BUILT** (cite the file, don't touch), **EXTEND** (real code exists, a genuine gap remains), **NEW — BUILD** (real gap, scoped v1 worth building), **NEW — REJECT** (would make the system rigid/brittle/unscoped, explained why), **DEFERRED** (real idea, too large for this pass, explained why).

---

## The document's core framing, restated plainly

The "Dynamic Mode Pills and Dynamic Chain Options Selector" is the existing capability-tree + composer-mode system (`VeriComposer.tsx`, `capability-tree-service.ts`). Every leaf of that tree already carries real metadata (`key`, `codeReference`, `engineKey`, `inputFields`, `deterministic`) — this **is** the "unique anchor per selection" the document keeps referring to; it exists today, it's just not being described in those terms elsewhere. The document's real ask is: use that existing anchor as the attachment point for guardrails/validation/automation/reporting, keep the AI path as a fallback for what software can't yet do, and keep chat replies short so token cost and hallucination risk both drop. That's a coherent, good direction — most of the individual pieces already exist; a few genuinely don't.

---

## Item-by-item verdicts

### 1. "Dynamic Mode Pills and Dynamic Chain Options Selector gives the main intent and direction" — **ALREADY BUILT**
`VeriComposer.tsx` (mode pills, `FIXED_MODES` + capability-tree-derived modes) + `capability-tree-service.ts` (the tree itself). `CapabilityNode` (`veri-chat-context.tsx:26-54`) already carries `key`, `codeReference`, `engineKey`, `inputFields`, `deterministic` — a real, unique identifier per selection. No action.

### 2. "Requirement Anchor for every task, unique per selection" — **ALREADY BUILT**
Same as #1 — `CapabilityNode.key` (plus `codeReference`/`engineKey` where applicable) already is this anchor. `deterministic` is auto-computed (`capability-tree-service.ts:70-77`, `markDeterministic`) from whether a leaf has a `codeReference` or `engineKey`, specifically so it "can never drift out of sync" (existing code comment) — a better design than a hand-maintained flag would be. No action.

### 3. "Guardrail for every task... predefined message explaining what's violated and what to do... learning loop on failure" — **EXTEND**
The guardrail *mechanism* already exists and is real: `high-impact-action-detector.ts` (deterministic, keyword-based, no LLM) + `policy-enforcement-engine.ts` (hard pre-call gate). What's genuinely missing, confirmed by reading the actual dialog text (`VeriComposer.tsx:518-522`): every category (Delete, Payment, Access-Change, etc.) shows the **same generic templated sentence** — `"This looks like a {category} action ("{phrase}"). VERIDIAN never runs actions like this without your explicit go-ahead. Continue?"` — with no category-specific *why* or *what to do next*. **Building**: per-category polite explanation + suggested action (Wave 154, see below), reusing the existing `HIGH_IMPACT_CATEGORY_LABELS` structure — not a new guardrail system, a messaging fix to the real one that exists.

### 4/5/6/7/8. "Input/Process/Output/Assumption/Logic validation for every task" — **NEW — BUILD (narrow), REJECT (as literally specified)**
Read literally — a hand-authored validation contract across 5 dimensions for *every* leaf of the capability tree — this would be a large, brittle, unscoped effort, and it directly contradicts the document's own stated constraint ("it should not make system rigid"). Rejecting the literal ask, accepting the real underlying need:
- **Assumption validation** ("before AI makes any assumption, validate with the user") is the one dimension worth a real, cheap fix: confirmed via direct read (`prompt-os-resolver.ts` + the seeded `chat.ai_thread_system` prompt, `drizzle/0019...sql:85-87`) that the current system prompt says only *"Keep replies concise and practical"* — no clause anywhere instructing the model to ask rather than assume. **Building**: a one-line addition to the system prompt template instructing exactly this, paired with the new Response Engine's `Need Clarity`/`Require Input` labels (Wave 154/155) so the model has a concrete, short way to ask instead of a paragraph of hedging.
- **Input validation for structured/deterministic paths already exists** and is stricter than free text could ever be: `inputFields` + client-side required-field checks in `VeriComposer.tsx` (`engineInputsFilled`) already block dispatch until required fields are filled — this *is* input validation, per-leaf, already real. No duplicate needed.
- **Process/Output/Logic validation as a generic per-leaf framework**: genuinely out of scope for this pass. A real, opt-in **Guardrail Engine v1** (Wave 157, see below) generalizes the *pattern* `high-impact-action-detector.ts` already proves works (deterministic, keyed by leaf, human-readable message, feeds `loopImprovements`) — but ships with zero mandatory rules for the whole tree, only real ones added where there's an actual known risk (starting with high-impact actions, which already exist). This satisfies "not rigid" (nothing is gated by default) without being "too open" (what is gated is real, not just documented).

### 9. "Task Automation — regular AI-needing tasks should become software-automated" — **ALREADY BUILT**
This is exactly Wave 152's Innovation Engine (`innovation-engine-service.ts`, merged this session, PR #92): `detectRecurringTaskPatterns()` finds task titles recurring 3+ times and proposes (human-gated, via the existing CLEE `proposeLoopImprovement()`) converting them into automation. Built the same day this document was being evaluated, independently, from the same underlying need. No duplicate action.

### 10. "Task List — ping AI about all tasks together without token usage" — **ALREADY BUILT**
`veri-todo-service.ts`'s `listVeriTodos()` is exactly this: one deterministic SQL query/union across tasks + instructions + PMS issues, zero LLM calls, returns full status for everything at once. Already wired into Home's To Do tab. No duplicate action.

### 11. "Hallucination prevention... without token usage" — **ALREADY BUILT**
Phase 3's `ai-reply-gate.ts` (`passesReplyGate()`) is exactly this: a deterministic, zero-LLM-call check that blocks a reply claiming a completed action it never actually performed, before it reaches the user. No duplicate action.

### 12. "Software should work without AI, multi-tasking via Mode Pills/Chain Selector" — **ALREADY BUILT**
This is the existing deterministic-dispatch path (`codeReference`/`engineKey` leaves bypass the LLM entirely, confirmed by `deterministic` flag's own definition). No action.

### 13. "Calculators for every task" — **ALREADY BUILT**
The VCEL 247-engine computation registry (`src/lib/engines/`, seeded 2026-07-08, 41 implemented) is exactly this, already linked to capability-tree leaves via `engineKey`. No duplicate action.

### 14. "Process for every task" — **ALREADY BUILT**
`task-execution-engine.ts` + worker-agent registry + automation rules. No duplicate action.

### 15. "Reports — predefined, URL-addressable, email/PDF/Excel/Word export" — **EXTEND**
Reports genuinely exist in 4 separate forms (compliance dashboard, custom/saved reports, ERP financial reports, construction/PROJEXA reports) — confirmed by direct file read, not assumed. But confirmed by direct grep that **none of them export anything but CSV** (the compliance dashboard) or nothing at all (the other three). `xlsx` and `resend` (email) are already installed dependencies, unused for this. **Building**: real PDF + Excel export for the highest-traffic report surface (Wave 156, see below) using the already-installed libraries — no new dependencies. Word export explicitly **not** built: PDF + Excel cover the real business need (a formatted document and a data file); a third format duplicating PDF's formatting purpose is scope without value. Email delivery documented as a real, valuable follow-up (the `resend` dependency is already there) but not this pass — exporting first, emailing a follow-up wave.

### 16. "Tasks already given by user — click, modify, communicate, track without AI" — **ALREADY BUILT**
Existing task detail views (`VeriChatPanel.tsx`'s `TaskThread`, `/api/tasks/:id`) already support this — click to open, chat continues via `task-service.ts`, status tracked deterministically. No action.

### 17. "Response Engine — short, precise, predefined replies (Yes/No/OK/Pending/Completed/Need Clarity/Require Input/Wrong Data/Incomplete Instructions), max ~4 words + specific detail, long answers only for research/analysis" — **NEW — BUILD**
Confirmed by repo-wide grep: **zero matches** for any response-vocabulary concept anywhere. `StatusPill` (`SimpleModulePage.tsx:171-179`) colors arbitrary strings by regex, it does not constrain what strings exist. This is a genuine, real gap, and it's the single highest-leverage item in the whole document for the stated goals (token minimization, "even a lower model can do the job with higher confidence," loop engineering) — **building it (Wave 154)**.

---

## What gets built this pass

- **Wave 154 — Response Engine.** New: predefined short-response vocabulary (matching the document's own list exactly) + a deterministic `suggestResponse()` + short-format enforcement, wired into a real consumer (Wave 150's routing gate) so it's proven, not just infrastructure sitting unused.
- **Wave 155 — Guardrail message quality + assumption-clarification prompt fix.** Extends the *existing* high-impact gate with per-category "why + what to do" messages (still deterministic, still no LLM); adds one line to the chat system prompt instructing the model to ask rather than assume, using the new Response Engine's `Need Clarity`/`Require Input` labels.
- **Wave 156 — Report export (PDF + Excel).** Real export for the compliance reports dashboard using already-installed `xlsx`; PDF via a lightweight approach (see wave for the exact library decision). Word and email explicitly deferred with reasoning above.
- **Wave 157 — Guardrail Engine v1 (opt-in framework).** Generalizes the high-impact-action-detector pattern into a small, reusable, per-leaf-keyed registry — zero mandatory entries for the full tree (avoids rigidity), real enforcement for what's registered (avoids looseness), failures feed the existing `loopImprovements` CLEE pipeline (Wave 146, no new infra).

Each ships as a narrow, real, tested v1 with an explicit statement of what's not attempted — same discipline as every prior phase this session. Each is cross-audited (whichever of Claude/z.ai didn't build it audits it) before merge, same as every wave since Phase 1.
