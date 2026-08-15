# PROGRESS — task-20260718-065005-ai-engineering-quality--logic-separation

Title: AI Engineering Quality: Logic Separation & Determinism (VERIDIAN Review Framework gap-closure, 4 findings)

## Completed
- [x] Read `AGENTS.md`, `CLAUDE.md`, `ai-os/boss/ACTIVE-CLAIMS.yaml` (no overlapping claim found for this
      area; registered this task's own claim).
- [x] Branch was stale (last real commit was the merge-base with `main`, ~600 commits behind); merged
      `origin/main` in cleanly (fast-forward-equivalent, no conflicts) before starting.
- [x] Discovered `PROGRESS.md` at repo root is a **shared, per-run placeholder file** overwritten by
      whichever task last checked out this worktree — NOT this task's own progress log despite the
      protocol note in the resume prompt. Reverted an uncommitted local diff that had blown away a
      prior task's (cost-estimate) `PROGRESS.md` content. Using this file
      (`progress/task-20260718-065005-*.md`) as the real, isolated per-task log instead, per the
      resume protocol's own instruction and the pattern already used repo-wide (`progress/task-*.md`,
      100+ existing files).
- [x] Re-verified all 4 findings against the current codebase (fresh Explore-agent pass, file:line
      cited) rather than trusting the evaluation's original gap descriptions:

  **1. [Low] Deterministic Logic Coverage — gap CONFIRMED, real and still open.**
  Every LLM call funnels through `src/lib/llm-client.ts`. There's a strong *inline* convention of
  justifying "why LLM / why deterministic" at individual call sites (`src/lib/llm-routing-gate.ts`,
  `src/lib/policy-enforcement-engine.ts`, etc. — 50+ files use the word "deterministic" in exactly
  this reasoning pattern), but **no script, CI job, or checklist actually audits new LLM-call sites**
  for this. `scripts/check-guardrail-presence.mjs` (closest analog) never mentions `llm-client` or
  "deterministic-first" anywhere in its 32-entry manifest. `.github/workflows/*.yml` (12 files):
  zero hits for "deterministic-first"/"LLM audit". `src/lib/audit-cadence-scan.ts` is the one real
  periodic-audit mechanism in the repo, but it audits task/dispatch *failures*, not LLM-call-site
  provenance.
  → **Action taken**: added `scripts/audit-deterministic-first-coverage.mjs`, a standalone,
  non-CI-blocking report script (same class as `scripts/report-cognitive-brain-coverage.ts`) that
  scans every file importing `callLLM`/`callLLMJson`/`callLLMVision` from `@/lib/llm-client` and
  flags any call site with no nearby "why not deterministic" justification comment, for periodic
  manual/human-triggered review — matching the finding's own recommended approach ("periodically
  audit"), not proposing a new CI-blocking gate for a Low-severity finding.

  **2. [Medium] Configuration Over Hardcoding — gap CONFIRMED as described (mixed posture), but
  recommended approach is explicitly "leave as-is... document the trade-off pattern."**
  Repo-wide, 51 `src/` files reference "hardcod(e/ed)". Two consistent shapes exist: (a) "this used
  to be hardcoded, now config-driven" fix narratives, and (b) explicit, individually-justified
  "deliberately hardcoded, not configurable" calls (e.g. `src/lib/services/hr-attendance-service.ts`
  weekend-day default; contrast `src/lib/services/erp-payroll-service.ts`, which explicitly keeps
  PF/ESI/PT rates in `erp_statutory_rules` instead of hardcoding them). No doc anywhere
  (`AGENTS.md`/`CLAUDE.md`/`ai-os/CONSTITUTION.yaml`/`docs/*`) names this as a convention new code
  can point to — it's a real, well-reasoned, but unwritten emergent practice.
  → **Action taken**: no code change (per the finding's own recommendation — "leave as-is unless a
  real per-org tuning need emerges"). Added the documentation of the trade-off pattern the finding
  asked for: `docs/ai-engineering-quality-conventions.md`, § "Configuration vs. deliberate
  hardcoding", with the real examples above cited and the decision rule made explicit for future
  code.

  **3. [Low] Separation of Business Logic — "No gap of note" CONFIRMED, convention holds.**
  995 `route.ts` files under `src/app/api/`; 862/995 (87%) import from `@/lib/services/*`. Sampled
  both old (`src/app/api/tasks/route.ts`) and new-wave (`src/app/api/v1/projexa/payroll/runs/route.ts`,
  explicitly self-labeled "thin ALIASING route") routes — both are genuinely thin wrappers around a
  service-layer call. One pre-existing, self-documented exception found (`src/app/api/mcp/route.ts`,
  Edge-runtime-constrained, its own header explains why it can't import the Node-dependent service
  layer) — not a new violation, not something this Low/no-gap finding asked to be fixed.
  → **Action taken**: none (per the finding's own recommendation — "maintain the existing
  convention"). Documented the verification (this entry + the conventions doc's cross-reference) so
  the "no gap" conclusion is evidenced, not just asserted.

  **4. [Low] Separation of AI Logic — "No gap of note" CONFIRMED for the core CI-protected gate
  family, with one pre-existing, self-documented, non-CI-protected exception noted (not a new gap).**
  Checked every gate/guardrail/policy file (`policy-enforcement-engine.ts`, `guardrail-engine.ts`,
  `task-tightening.ts`, `risk-classification.ts`, `model-tier-eligibility.ts`,
  `floor-tier-escalation.ts`, `communication-guardrails.ts`, `knowledge-sufficiency-gate.ts`,
  `qa-precompletion-gate.ts`) for `llm-client` imports or direct provider `fetch()` calls — zero
  matches in all of them; `policy-enforcement-engine.ts` explicitly documents itself as
  "deliberately a DETERMINISTIC keyword/pattern gate, not an LLM-based classifier." One real,
  pre-existing exception: `src/lib/prompt-security/layer3-runtime-guardrails.ts` does call
  `callLLM("groq", "meta-llama/llama-guard-4-12b", ...)` as an intentional, opt-in, self-documented
  LLM-based safety-classifier layer of a 4-layer defense-in-depth design (not in
  `check-guardrail-presence.mjs`'s protected manifest, not a mandatory hop). This finding's own
  gap text is "No gap of note" and its recommendation is "continue the discipline for *new* gates" —
  this pre-existing, intentional exception isn't a new gate breaking that discipline, so no action
  the finding asked for is outstanding.
  → **Action taken**: none (per the finding's own recommendation). Noted the layer3 exception in
  the conventions doc so future gate authors have an accurate, non-absolutist picture of the "no
  LLM call in gates" discipline (it's the rule for the core policy/guardrail family, with one named,
  deliberate, opt-in exception) rather than a blanket claim that could be read as inaccurate.

- [x] Added `scripts/audit-deterministic-first-coverage.mjs` (real script, addresses finding #1).
- [x] Added `docs/ai-engineering-quality-conventions.md` (documents findings #1–#4, addresses
      finding #2's explicit ask + records #3/#4 verification).
- [x] Ran the new audit script locally against the current tree to confirm it executes cleanly and
      produces a sane report (see script's own output for the current baseline).
- [x] Registered/will retire this task's `ai-os/boss/ACTIVE-CLAIMS.yaml` entry (move `active:` →
      `recently_completed:` once the PR is opened).

## Remaining
- [ ] Commit + push the real code/docs change, open PR, verify CI green.
- [ ] Move this task's ACTIVE-CLAIMS entry to `recently_completed:`.
