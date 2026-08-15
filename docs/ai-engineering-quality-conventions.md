# AI Engineering Quality Conventions: Determinism, Configuration, and Logic Separation

Written 2026-08-15 to close 4 related findings from the VERIDIAN Review Framework evaluation
("AI Engineering Quality" area). Each section states the finding, what was actually found in the
live codebase (file:line evidence, re-verified against current `main` rather than trusted from the
original evaluation), and what — if anything — changed as a result. This doc is the "document the
trade-off pattern for consistency" deliverable the evaluation itself asked for on finding #2, and
the citable record for the "no gap of note" verifications on findings #3/#4.

## 1. Deterministic-first discipline: convention + how to audit it

**The convention** (already real practice, now made checkable): before adding a new LLM call, check
whether the same outcome can be reached deterministically — a lookup table, a regex/keyword match, a
DB query, a rule engine — and prefer that. This is not a new rule; it is already how the core of this
codebase is built. `src/lib/llm-routing-gate.ts` and `src/lib/policy-enforcement-engine.ts` are both
explicit, self-documented examples: the latter's own header states it is "deliberately a
DETERMINISTIC keyword/pattern gate, not an LLM-based classifier" specifically because a deterministic
gate "never depends on the model actually honoring the prompt," costs nothing, adds no latency, and
cannot itself be prompt-injected. `src/lib/services/capability-audit-service.ts` and
`scripts/report-cognitive-brain-coverage.ts` follow the same pattern for their respective domains.

**What was missing**: nothing actually *audited* new LLM-call sites for this — the discipline lived
entirely as scattered per-file justification comments, with no mechanism surfacing a new call site
that skipped the reasoning. `scripts/check-guardrail-presence.mjs` (the closest existing analog, a
32-entry manifest of protected guardrail markers) never referenced `llm-client.ts` or this question
at all.

**What was added**: `scripts/audit-deterministic-first-coverage.mjs` — run it by hand periodically
(or whenever reviewing a PR that adds a new `callLLM`/`callLLMJson`/`callLLMVision` import):

```
node scripts/audit-deterministic-first-coverage.mjs
```

It scans every file that imports an LLM-call function from `src/lib/llm-client.ts` and flags files
with no nearby "why this needs an LLM, not a deterministic check" comment, for human review. It is a
keyword heuristic, not a semantic reviewer — see the script's own header for what it does and does
not guarantee. It is deliberately **not** wired into CI as a blocking gate: this finding is Low
severity and its own recommended approach is "periodically audit," not "block every PR." A `--strict`
flag exists (exits 1 on any flagged site) if a future decision is made to promote this from advisory
to blocking CI — that's an explicit trade-off for whoever owns it to make, not decided here.

Running it against the tree as of this writing flags 12 of 29 LLM-call-importing files for review
(mostly `services/*-intelligence-service.ts`-style modules whose entire purpose is unstructured-input
extraction, where an LLM call is very plausibly the right call — the point of the script is to
surface these for a human glance, not to imply they're wrong).

## 2. Configuration over hardcoding: the trade-off pattern

**The finding**: mixed posture — some values are per-org configuration, some are deliberately
hardcoded — with the evaluation's own recommendation being to leave this as-is unless a real per-org
tuning need emerges, and to document the trade-off pattern for consistency. This section is that
documentation.

**The pattern, as it already exists in practice** (not a new rule — this codifies what good examples
already do):

- **Hardcode** a value when: it is a genuine constant (not something any real org has ever needed to
  vary), AND the decision is written down inline at the point of use, naming *why* it's hardcoded and
  what a future config knob would look like if the need ever arose. Example:
  `src/lib/services/hr-attendance-service.ts` defaults the weekend to Saturday/Sunday with the
  comment: *"Deliberately hardcoded, not a new per-org 'work week' configuration concept... A
  configurable work week is a real, honest future gap if a 6-day-week org ever needs this, not
  invented here."* — this is the right shape: explicit, honest about the limitation, and doesn't
  invent unused config surface speculatively.
- **Make it configuration** when a value genuinely varies per org/tenant/jurisdiction and that
  variance is already known to matter. Example: `src/lib/services/erp-payroll-service.ts` keeps
  PF/ESI/PT statutory rates in the `erp_statutory_rules` table rather than hardcoding them, because
  those rates are legally mandated to differ and change over time — a textbook case where hardcoding
  would be a real bug waiting to happen, not just a style preference.

**The rule of thumb going forward**: don't add configuration speculatively for a tuning need that
doesn't exist yet (that's its own kind of complexity cost — an unused config surface nobody asked
for), and don't hardcode a value silently when a real org-to-org difference is already known. When in
doubt, hardcode with an inline comment naming the trade-off (per the `hr-attendance-service.ts`
example above) rather than leaving the decision unstated — that comment is what lets a future change
be a one-line diff instead of an archaeology exercise.

No code changed for this finding — per its own recommended approach, this section is the entire
closure.

## 3. Separation of business logic — verified, no gap

**The finding**: "No gap of note." Recommended approach: maintain the existing route-thin/
service-thick convention. Re-verified rather than assumed: as of 2026-08-15, 862 of 995 (~87%)
`route.ts` files under `src/app/api/` import from `@/lib/services/*`. Sampled both an older route
(`src/app/api/tasks/route.ts` — auth guard + service call + status-code mapping, nothing else) and a
newer one (`src/app/api/v1/projexa/payroll/runs/route.ts`, explicitly self-labeled in its own header
as a "thin ALIASING route" over `erp-payroll-service.ts`) — both hold the convention. One pre-existing,
self-documented exception: `src/app/api/mcp/route.ts` (Edge runtime, can't import the Node-dependent
service layer — its own header explains this constraint honestly) reimplements some queries directly
against Supabase. This is a known, already-explained trade-off, not a new or silent violation, and
this Low/no-gap finding didn't ask for it to be fixed — no action taken.

## 4. Separation of AI logic — verified, no gap in the core gate family

**The finding**: "No gap of note." Recommended approach: maintain the existing separation; continue
the "no LLM call in gates" discipline for new gates. Re-verified: `policy-enforcement-engine.ts`,
`guardrail-engine.ts`, `task-tightening.ts`, `risk-classification.ts`, `model-tier-eligibility.ts`,
`floor-tier-escalation.ts`, `communication-guardrails.ts`, `knowledge-sufficiency-gate.ts`, and
`qa-precompletion-gate.ts` all have zero `llm-client` imports or direct provider calls — the core,
`scripts/check-guardrail-presence.mjs`-protected gate family is genuinely deterministic.

One real, pre-existing, and already-intentional exception worth naming accurately rather than
glossing over: `src/lib/prompt-security/layer3-runtime-guardrails.ts` does call
`callLLM("groq", "meta-llama/llama-guard-4-12b", ...)` as Layer 3 of a 4-layer defense-in-depth
prompt-security design (`src/lib/prompt-security/defense-in-depth.ts`). It's opt-in (callers can pass
`null` to skip straight to the deterministic Layer 1/4 checks) and not part of
`check-guardrail-presence.mjs`'s protected manifest. This is a deliberate LLM-as-safety-classifier
layer, not a new gate that skipped the discipline — but "no LLM call in gates," read as an absolute
blanket statement, would be inaccurate without naming it. The discipline holds for the core
policy/guardrail family that gates every dispatch; this one named, opt-in exception is the honest
picture for anyone adding a *new* gate to model their design against.
