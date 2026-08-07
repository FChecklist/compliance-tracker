# PROGRESS -- task-20260807-071602-retry-ai-documentation-ai-readable-techn

Redispatch of task-20260718-064002 (VERIDIAN Review Framework gap-closure:
AI Documentation / AI-Readable Technical Documentation, 10 findings), per
UMR-20260801-170930-2080. Original attempt was blocked at first invocation
by the OpenRouter/Cerebras balance hard-stop (removed from preflight-guard.py
2026-08-01, commit 7ff5be8).

**Correction, this invocation (2/20):** this branch's own `task.yaml`
checkpoint narrative (completed/remaining steps, PR #898, OCID-052) was
stale/cross-contaminated from a *different* concurrent task -- it did not
describe this task's real work at all. `PROGRESS.md` at the start of this
invocation was also stale: unmodified from `origin/main`'s copy (last
touched by an unrelated PR #960, a different task entirely -- 0-line diff
against HEAD). The real work for *this* task was sitting uncommitted in the
worktree the whole time (11 files, +707/-10, done in invocation 1) and is
now verified below and being committed for the first time.

## Completed

- [x] **AI-Readable Business Rules Documentation** [High] -- built
      `ai-os/registry/business-rules-registry.yaml`: 6 domains
      (GST/Tax, Payroll, Fixed Assets, Procurement, HR/Attendance, CRM),
      12 rules, each cross-referenced to real `file:function:line`.
      Spot-verified 3 of 12 citations (`computeReverseChargeLiability`,
      `calculateGratuity`/`STATUTORY_CAP`, `straightLineDepreciation`)
      directly against the current source -- all accurate. Registered in
      `ai-os/OS.yaml`'s index.
- [x] **AI-Readable Configuration Documentation** [Medium] -- built
      `docs/CONFIGURATION.md`: full 33-var env index (`CLAUDE.md` only had
      4) plus notable in-code constants/flags. Added the previously-missing
      `APP_RUNTIME_DATABASE_URL` to `CLAUDE.md`'s own env list and linked
      to the new doc. Registered in `docs/master/INDEX.md`.
- [x] **AI-Readable Prompt Documentation** [Medium] -- built
      `docs/master/PROMPT_CATALOG.md`: all 26 real `resolvePromptTemplate()`
      keys by call site (verified via `git grep` -- 26 literal keys + 1
      dynamic/non-literal match, matches the doc's claim exactly), schema
      pointers, and an honest "what's NOT built yet" section for the
      separate Prompt Directory UI feature (not folded into this doc task).
      Registered in `docs/master/INDEX.md`.
- [x] **AI-Readable Workflow Documentation** [Medium] -- filled previously-
      empty `workflow: []` fields for 9 UI domains in
      `ai-os/system-tree/50-merged-tree.yaml` (PMS/product scope, sector-
      gated compliance pages, users/settings, CRM/Sales-HQ, VERI Chat
      tickets+meetings, PMS/Firm practice, AppShell, SimpleModulePage+Forge).
- [x] **AI-Readable API Documentation** [Medium] -- extended
      `src/lib/openapi/generate.ts` with `/projexa/leads` and
      `/projexa/opportunities` (both real, already-shipped routes, verified
      to exist on disk). Documented the remaining ~30-domain backlog with a
      prioritized order (HR, Risk, Procurement, Sales documents, PMS issues)
      in the file's own header rather than claiming full coverage.
- [x] **AI-Readable Architecture Documentation** [Low] + **AI-Readable
      Database Documentation** [Low] (same staleness-risk gap, one fix) --
      built `scripts/check-doc-scale-freshness.mjs`: parses
      `docs/master/MODULE_MAP.md`'s "Scale at time of writing" line and
      fails if live migrations/tables/services/routes/pages counts drift
      >20% from it. Ran it locally -- passes cleanly (284/468/212/995/188,
      all exactly matching the now-corrected doc line). Also corrected
      `ARCHITECTURE.md`'s stale VCEL engine count (25→32 files, verified via
      `git ls-files`) and `dispatchEngine()` case count (verified 190 case
      branches via direct grep).
      **NOT wired into `ci.yml` this pass** -- this session's `gh` token
      lacks the `workflow` OAuth scope required to push a branch that
      touches `.github/workflows/*.yml` (confirmed via `gh auth status`:
      scopes are `gist, read:org, repo`, no `workflow`). The wiring edit
      was written, verified to work, then reverted out of this branch
      rather than block the whole PR on it. **Remaining step for whoever
      has `workflow` scope**: add a `doc-scale-freshness` job to
      `.github/workflows/ci.yml` running `node
      scripts/check-doc-scale-freshness.mjs` (same shape as the
      `doc-cross-references`/`doc-quarantine-banner` jobs immediately
      above the `e2e` job) -- until then the script exists and passes but
      is not yet a real CI gate.
- [x] **AI-Readable Calculation Documentation** [Low] -- re-verified the
      finding's own "~17% implemented" claim: not found anywhere in repo
      history (only an unrelated "17%" idiom hit elsewhere) -- treated as
      stale/incorrect input rather than a real gap, per the task's own
      instruction not to assume a stale gap description is still accurate.
      Added a correction note to `docs/master/CAPABILITY_COVERAGE.md`
      re-stating the real, still-open gap (doc-refresh cadence, not engine
      count) and a re-verified `dispatchEngine()` case count (190) as a
      partial cross-check pending live-DB access for the doc's own
      category-by-category SQL query.
- [x] **AI-Readable Metadata Documentation** [Low] -- gap description said
      "no gap of note for the registry itself; maintain the existing
      CI-gated registry." Confirmed true, no action needed.
- [x] Verified generate.ts changes build clean (`bun build`) and the two
      new routes exist on disk (`src/app/api/v1/projexa/{leads,opportunities}/route.ts`).
      Full-repo `tsc --noEmit` OOMs in this sandbox regardless of this
      change (pre-existing environment limit, not caused by this diff) --
      not a reliable signal either way for this PR.

## Deferred (disclosed, not silently dropped)

- **AI-Readable Module Documentation** [Low] -- recommended approach was
  explicitly "Optional: generate a lightweight per-file doc-comment index
  as part of CI." Not built this pass: genuinely optional per the
  finding's own wording, and the other 9 findings (including two
  High/Medium ones) were prioritized first. Left as real, open, low-
  priority follow-up work, not claimed done.

## Remaining

- [ ] Wire `scripts/check-doc-scale-freshness.mjs` into `ci.yml` (blocked
      on `workflow` OAuth scope this session doesn't have -- see above).
- [ ] Optional: `AI-Readable Module Documentation`'s per-file doc-comment
      index, if prioritized later.
- [ ] Open PR, confirm CI green, hand off for independent audit per
      AGENTS.md Rule 7(c)/Rule 10 (this session both authored and is
      self-reporting verification here -- a real second reviewer should
      still audit before merge, per the governance norm this repo runs on).
