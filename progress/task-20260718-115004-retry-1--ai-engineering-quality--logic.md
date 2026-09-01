# Progress -- task-20260718-115004-retry-1--ai-engineering-quality--logic

Gap-closure for 4 VERIDIAN Review Framework findings (AI Engineering
Quality / Logic Separation & Determinism):
- [Low] Deterministic Logic Coverage
- [Medium] Configuration Over Hardcoding
- [Low] Separation of Business Logic
- [Low] Separation of AI Logic

This is a retry of an earlier attempt at the same task (branch name has
`retry-1`) -- prior invocations left no real commits on this branch (only
an uncommitted `PROGRESS.md` stub, itself stale content from a different,
unrelated task sharing this worktree). Starting the real investigation
fresh in this invocation; nothing to resume from a prior partial diff.

## Investigation (before writing code)

- Read `ai-os/boss/ACTIVE-CLAIMS.yaml` -- no other session claims this
  area. Registered this task's own claim before starting real work, pushed
  it on its own commit first (per that file's own protocol / Rule 11).
  Branch was 1356 commits behind `origin/main` (stale from mid-July);
  merged `origin/main` in, resolving 2 real conflicts (`PROGRESS.md` --
  root-level file is shared/contested scratch space across concurrent
  tasks, resolved by keeping `origin/main`'s current placeholder rather
  than fighting over it, real progress tracked here instead per the
  resume protocol's own instruction; `ai-os/boss/ACTIVE-CLAIMS.yaml` --
  resolved by keeping both sides' independently-added entries).
- **[Low] Deterministic Logic Coverage**: confirmed still a real, open gap.
  `ai-os/CONSTITUTION.yaml`'s `software_first` (SF-01) and
  `ai-os/AI_ENGINEERING_POLICY.yaml`'s `engineering_priority_order` are
  real, existing *declarative* policy ("deterministic path first, AI
  fallback only"), but neither has an operational mechanism auditing new
  LLM-call sites against that policy -- confirmed via `git grep` for any
  existing `scripts/check-*.mjs` covering this (none does; the closest,
  `check-guardrail-presence.mjs`, covers a different thing --
  guardrail-call-site *presence*, not LLM-call-site *audit*). The finding's
  own recommended approach ("periodically audit new LLM-call sites") is a
  process gap, not a described bug -- closed it the way this codebase
  already closes this class of finding (see error-handling gap-closure
  precedent, `progress/task-20260718-065003-ai-engineering-quality--
  error-handling.md`): a `check-*.mjs` CI script + a coverage manifest,
  same enforcement class as `check-asset-registry-coverage.mjs`.
- Enumerated every real LLM-call site in `src/` (`git grep` for
  `callLLM(`/`callLLMJson(`/`callLLMVision(`, excluding `.test.ts`): 25
  files matched textually, individually read all 25 -- 20 make a genuine
  live call, 4 (`schema.ts`, `prompt-normalizer.ts`,
  `prompt-security/types.ts`, `response-vocabulary-gate.ts`) only mention
  one of the 3 functions in a comment, and 1 (`llm-client.ts`) is the
  wrapper's own definition. All 25 were classified with a real, specific
  note in the new manifest (see "What was built" below) -- zero left
  unaudited.
- **[Medium] Configuration Over Hardcoding**: confirmed still an accurate
  description (a real, deliberate mix), and confirmed the finding's own
  recommendation is explicitly "leave as-is... document the trade-off
  pattern" -- not a code change. Found the codebase already has strong,
  real precedent for *why* it configures in some places
  (`module-rules-resolver.ts`'s `resolveModuleRule()`, `erp_statutory_rules`
  for regulator-driven values, the Prompt Operating System) and hardcodes
  deliberately in others (`ai-team/roster.ts`'s 198-role fixed roster, TDS
  left manually-entered pending CA/legal sign-off, the ~37 GRC modules not
  yet wired into the module-rules resolver) -- but this reasoning was
  scattered narrative across `PLATFORM_STRATEGY.md`/`ERP_BENCHMARK_
  COMPARISON.md`, not written down as a single, findable pattern. Wrote
  that doc.
- **[Low] Separation of Business Logic** / **[Low] Separation of AI
  Logic**: re-verified both "no gap of note" conclusions against current
  code rather than trusting the evaluation as still accurate. Spot-checked
  5 gate/guardrail files (`guardrail-engine.ts`, `guardrail-registrations.ts`,
  `policy-enforcement-engine.ts`, `task-tightening.ts`, `loop-prevention.ts`,
  `high-impact-action-detector.ts`) for any real `callLLM`/OpenAI/Anthropic
  reference: zero real calls found (one comment in
  `policy-enforcement-engine.ts` instructing callers to check
  `enforcePolicy().allowed` *before* calling an LLM entrypoint -- the gate
  itself stays pure). Spot-checked 4 API routes across different modules
  (`tasks`, `crm/leads`, `erp/journal-entries`, `hr/attendance`): all
  47-63 lines, thin request/response glue delegating to a service module,
  consistent with the route-thin/service-thick convention the evaluation
  describes. Both findings confirmed still accurate as "no gap" --
  **no code change made for either**, per the task's own instruction not
  to make an unnecessary change when a finding is already resolved/
  accurate as-is.
- Did not touch `src/lib/services/permission-service.ts`'s
  `ERP_ACTION_ROLES` table or any file another active claim names.

## What was built

1. **`ai-os/registry/deterministic-first-audit-log.yaml`** -- new coverage
   manifest, same shape as `ai-os/registry/asset-registry-coverage.yaml`.
   Every one of the 25 real-or-textually-matching LLM-call-site files found
   during investigation gets a `sites` entry (a real audit note: what
   deterministic alternative was considered, why AI is still the right
   call) or an `exempted` entry (comment-only match / the wrapper's own
   definition file). This is a one-time, individually-read census pass,
   not a generic placeholder grandfather -- every note above was verified
   against the actual file content, not guessed.
2. **`scripts/check-deterministic-first-audit.mjs`** -- new CI check, same
   enforcement class/precedent as `check-route-error-handling.mjs`: only
   fails on a NEW or MODIFIED `src/**/*.ts(x)` file that references
   `callLLM(`/`callLLMJson(`/`callLLMVision(` and is not yet in the
   manifest, so it stops the "unaudited LLM-call site" count from growing
   without retroactively failing CI on the 25-file baseline. Core logic
   factored into a pure, unit-testable `findUnauditedSites()` export (same
   pattern as `check-reviewer-not-author.mjs`'s `evaluate()`), documented
   honest limitation matching this repo's other `check-*.mjs` headers:
   detection is text-level (a comment merely mentioning `callLLM(` also
   matches) -- it cannot mechanically verify a deterministic alternative
   was *actually* considered, only that someone wrote a real, reviewable
   answer down.
3. **`scripts/check-deterministic-first-audit.test.ts`** -- bun:test
   covering: a new real call site with no manifest entry is flagged (all 3
   entrypoints); an already-manifested file is allowed even with a real
   call; `llm-client.ts` itself is always skipped; a file with no LLM
   reference at all is allowed; a deleted file (no `contents` entry) is
   skipped, not flagged; the documented comment-mention limitation is
   real, not just described (`CALL_RE` genuinely matches a bare comment,
   and `findUnauditedSites` genuinely flags a comment-only file with no
   manifest entry).
4. **`docs/architecture/configuration-vs-hardcoding.md`** -- new doc
   answering the Medium finding's "document the trade-off pattern"
   recommendation: states the standing policy
   (`ai-os/AI_ENGINEERING_POLICY.yaml`'s prefer-configuration default),
   then the real, concrete conditions this codebase already uses for
   *when it configures anyway* (per-org/client/project variance,
   regulator-driven values, platform catalog data, prompt content) vs.
   *when it deliberately hardcodes* (small fixed-by-design sets, values
   needing a domain expert's sign-off before automating, no real per-org
   need yet, genuine infrastructure facts) -- each backed by a real,
   already-existing precedent in this codebase, not invented for this doc.

## Completed

- [x] Registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml`, pushed first
- [x] Merged stale `origin/main` (1356 commits), resolved both conflicts
- [x] Re-verified all 4 findings against current code (none assumed stale
      or assumed still-accurate without checking)
- [x] `ai-os/registry/deterministic-first-audit-log.yaml` -- coverage
      manifest, all 25 known LLM-call-site files individually classified
- [x] `scripts/check-deterministic-first-audit.mjs` -- CI check
      (new/changed files only), pure-function core
- [x] `scripts/check-deterministic-first-audit.test.ts` -- 9 unit tests,
      all passing
- [x] `docs/architecture/configuration-vs-hardcoding.md` -- trade-off
      pattern doc
- [x] Confirmed no code change needed for Separation of Business Logic /
      Separation of AI Logic (both re-verified accurate as "no gap")
- [x] Did not touch `permission-service.ts`

## Verification

- `node scripts/check-deterministic-first-audit.mjs --base origin/main`:
  `No new/changed source files -- nothing to check` (correct -- this PR's
  own new files live in `scripts/`/`ai-os/registry/`/`docs/`, not
  `src/**/*.ts`)
- Standalone verification pass (temporary script, removed before commit)
  confirmed **zero** unaudited LLM-call-site files across the entire
  current `src/` tree against the new manifest
- `bun test ./scripts/check-deterministic-first-audit.test.ts`: 9 pass, 0
  fail
- `python3 -c "import yaml; yaml.safe_load(...)"` on both new YAML/manifest
  files: valid
- (Full-suite `bun test`, `bunx tsc --noEmit`, `bunx eslint` run before
  opening the PR -- see final commit for exact counts.)

## Known limitation: not wired into `.github/workflows/ci.yml`

Same known constraint as the error-handling gap-closure precedent
(`progress/task-20260718-065003-ai-engineering-quality--error-handling.md`):
this session's `gh` token has no `workflow` scope, so a push touching
`.github/workflows/*.yml` is rejected by GitHub outright. Rather than block
this PR's real deliverable on that, `ci.yml` is deliberately left
untouched here. The job to add (same shape as the existing
`guardrail-presence`/`asset-registry-coverage` jobs) is:

```yaml
  deterministic-first-audit:
    name: Deterministic-First Audit Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: node scripts/check-deterministic-first-audit.mjs --base origin/main
```

The script itself is real, tested, and callable manually right now
(`node scripts/check-deterministic-first-audit.mjs --base origin/main`)
regardless of when the CI wiring lands -- same framing as the
error-handling precedent's identical limitation.

## Remaining

- [ ] Open PR, let CI run, merge per Rule 6
- [ ] Wire `deterministic-first-audit` into `.github/workflows/ci.yml` (see
      "Known limitation" above -- needs a `workflow`-scoped push)
- [ ] Once merged, move this task's `ai-os/boss/ACTIVE-CLAIMS.yaml` entry
      from `active:` to `recently_completed:` per that file's own Rule 3
