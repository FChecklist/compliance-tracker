# PROGRESS -- task-20260718-120004-retry-2--ai-engineering-quality--logic

VERIDIAN Review Framework gap-closure: AI Engineering Quality / Logic
Separation & Determinism. 4 findings from the framework evaluation; per the
task's own instruction, re-verified each against the current codebase
(codebase has moved since the evaluation was written) before writing any
code.

## Completed

- [x] **[Low] Deterministic Logic Coverage** -- Gap: "Deterministic-first
  discipline is not universally applied." CONFIRMED still a real, if small,
  gap: the discipline itself IS genuinely followed today (every real
  `callLLM()`/`callLLMJson()`/`callLLMVision()` call site carries an inline
  rationale comment; `src/lib/llm-routing-gate.ts`'s header is the clearest
  example -- a deterministic handler is tried first, `callLLM()` is the
  fallback), but nothing made that durable: a brand-new call site could be
  added anywhere with zero rationale and nothing would notice.
  `scripts/check-guardrail-presence.mjs` doesn't cover this (it checks
  named markers stay present, not that new ones don't silently appear
  elsewhere).
  Fix: added `scripts/check-deterministic-llm-audit.mjs`, a new check that
  enumerates every real LLM-call-site file against an explicit
  `KNOWN_LLM_CALL_SITES` manifest (27 files, confirmed by direct code read)
  and fails the moment a call expression appears in a file not already in
  that manifest -- making "periodically audit new LLM-call sites" (the
  finding's own recommended approach) a real, automatic mechanism instead
  of a habit. The new script's own presence is protected by a new entry in
  `scripts/check-guardrail-presence.mjs`'s manifest (same "protect the
  protector" pattern already used for `check-metadata-index-coverage.mjs`).
  Both `node scripts/check-deterministic-llm-audit.mjs` and
  `node scripts/check-guardrail-presence.mjs` run clean locally (29 known
  call sites, 0 unaudited; 89/89 markers present).

  **Real-world validation, not hypothetical:** while rebasing this branch
  onto a much-advanced `main`, this script immediately caught 3 genuine new
  call sites that had landed since the manifest was first written
  (`src/lib/prompt-security/{defense-in-depth,layer1-input-sanitization,
  layer3-runtime-guardrails}.ts` -- a prompt-injection defense layer,
  itself deterministic-first in spirit: a cheap classifier gate in front of
  the real task call, same shape as `llm-routing-gate.ts`) and flagged one
  manifest entry as stale (`src/app/api/help/ask/route.ts` no longer calls
  `callLLM()` directly -- it was refactored to route through the new
  prompt-security layer instead). Both reconciled in this PR. This is
  exactly the "periodically audit new LLM-call sites" mechanism the
  finding asked for, demonstrated working on real drift, not just passing
  against a frozen snapshot.

  **Known limitation, disclosed rather than hidden:** the script is NOT yet
  wired into `.github/workflows/ci.yml` as a new CI job. This session's
  `gh` push token lacks the `workflow` OAuth scope, so `git push` on this
  branch is rejected outright the moment `.github/workflows/ci.yml` is
  touched ("refusing to allow an OAuth App to create or update workflow
  `.github/workflows/ci.yml` without `workflow` scope") -- a token
  permission limit, not a code or design issue. Per this repo's own
  established workaround for this exact situation, the workflow edit was
  reverted out of this branch so the rest of the fix (the script itself,
  useful and runnable on demand even unwired) can still ship. A follow-up
  PR from a workflow-scoped push needs to add this job to `ci.yml`
  (mirroring the existing `guardrail-presence`/`metadata-index-coverage`
  jobs immediately above it):

  ```yaml
    deterministic-llm-audit:
      name: Deterministic LLM-Call-Site Audit
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v7
        - run: node scripts/check-deterministic-llm-audit.mjs
  ```

  ...and then add
  `{ file: ".github/workflows/ci.yml", mustContain: ["check-deterministic-llm-audit.mjs"] }`
  to `scripts/check-guardrail-presence.mjs`'s manifest to close the loop
  (a comment at that manifest's relevant entry already points back here).

- [x] **[Medium] Configuration Over Hardcoding** -- Gap: "Mixed
  configuration posture -- some deliberate hardcoding." Recommended
  approach: "Leave as-is unless a real per-org tuning need emerges;
  document the trade-off pattern for consistency." ALREADY RESOLVED / no
  code change needed. Verified this is not "genuinely undocumented": every
  hardcoding decision site checked carries its own inline rationale comment
  (e.g. `src/lib/model-tier-eligibility.ts`'s `JUDGMENT_ELIGIBLE`/
  `INTEGRATIVE_ELIGIBLE` sets explain why they're hardcoded; contrast
  `src/app/api/whistleblower/route.ts`'s SLA resolution via
  `resolveModuleRule()`, whose own docstring explains why that value is
  config-driven instead). 40+ files carry a "hardcod..." rationale comment
  across `src/`. The documentation is real, just distributed at the
  decision site rather than centralized in one doc -- which is exactly
  consistent with "leave as-is." No change made, per the recommended
  approach and per this task's own instruction not to make an unnecessary
  change when a finding is already resolved.

- [x] **[Low] Separation of Business Logic** -- Gap: "No gap of note."
  NO GAP CONFIRMED. Spot-checked recent routes (`src/app/api/veri-meetings/
  [id]/generate-intelligence/route.ts`, `src/app/api/whistleblower/
  route.ts`, `src/app/api/incidents/route.ts`) -- all stay thin
  (`requireAuth()` + delegate into `src/lib/services/*`). 234 files now
  exist under `src/lib/services/` (a much larger service layer than an
  older, now-outdated architecture-doc note claiming only ~15 of ~40
  domains had one). The largest routes are long by design because they
  compose named deterministic gates/guardrails inline (required visible
  per `check-guardrail-presence.mjs`'s own manifest), not because business
  logic leaked into them. Route-thin/service-thick convention holds. No
  change needed.

- [x] **[Low] Separation of AI Logic** -- Gap: "No gap of note." NO GAP
  CONFIRMED. Checked every gate file (`src/lib/ai-reply-gate.ts`,
  `src/lib/llm-routing-gate.ts`, `src/lib/qa-precompletion-gate.ts`,
  `src/lib/response-vocabulary-gate.ts`, `src/components/SectorGate.tsx`):
  none make a direct LLM call (no `callLLM`/`fetch`/provider-SDK
  invocation in any of the five) -- they're pure/deterministic, some
  referencing `callLLM()` only in a comment describing what the *caller*
  does downstream. The "no LLM call in gates" discipline holds for every
  existing gate. No change needed; the new deterministic-audit check added
  above (finding 1) doubles as an early-warning if a *future* gate file
  were to add a real call site, since gate files aren't in
  `KNOWN_LLM_CALL_SITES` and adding one there would itself be a visible,
  reviewable diff.

## Remaining

- [ ] Wire `scripts/check-deterministic-llm-audit.mjs` into
  `.github/workflows/ci.yml` (exact snippet above, under finding 1) --
  blocked on this session's `gh` token lacking `workflow` OAuth scope, not
  on any code/design gap. Needs a workflow-scoped push (owner or a
  differently-scoped agent) to land the one-line CI job + the matching
  `check-guardrail-presence.mjs` manifest entry noted above.
- [x] All 4 findings otherwise fully addressed: 1 real code fix (the new
  audit script itself, runnable today even before CI wiring), 3 confirmed
  no-gap/already-resolved with no code change made (per the task's own
  instruction to avoid unnecessary changes when a finding no longer
  matches current reality).
