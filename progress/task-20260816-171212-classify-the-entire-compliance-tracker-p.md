# Progress — classify-the-entire-compliance-tracker-p

Owner directive 2026-08-16: deterministic bulk classification of all 422 open
PRs on FChecklist/compliance-tracker by changed-file signature (DOCS-ONLY /
CODE / DEPENDENCY / EMPTY), write machine-readable output, dispose ONLY of
EMPTY + superseded-DOCS-ONLY classes, report CODE-class list for sibling
dispatch.

## Completed
- [x] Read AGENTS.md / CLAUDE.md governance docs
- [x] Read ai-os/boss/ACTIVE-CLAIMS.yaml, confirmed no conflicting active claim
- [x] Registered claim in ACTIVE-CLAIMS.yaml, committed + pushed
- [x] STEP ONE — fetched real paginated list of all 422 open PRs (number, title,
      author, createdAt, headRefName, full changed-file list with per-file
      additions/deletions) via `gh api graphql` (see
      `scripts/pr-classification/fetch_prs.py` + `pr-query.graphql`).
      Confirmed live counts match Owner's SPEC exactly: totalCount=422,
      author breakdown FChecklist=414 / dependabot=8.
- [x] STEP ONE — classified every PR by deterministic file-signature script
      (`scripts/pr-classification/classify.py`), precedence EMPTY >
      DEPENDENCY > DOCS-ONLY > CODE. Real result: EMPTY=0, DEPENDENCY=8,
      DOCS-ONLY=115, CODE=299 (sums to 422). Full per-PR classification with
      cited reason and file list committed to
      `ai-os/registry/pr-classification-20260816.json`.
      NOTE: ai-os/*.yaml governance/tracking files (ACTIVE-CLAIMS.yaml,
      COMPLETED.yaml, CONSTITUTION.yaml, MASTER-TRACKER.yaml, registry/*)
      are deliberately classed as CODE not DOCS-ONLY — grep-confirmed they
      are actually parsed/consumed by real app routes/services and CI
      scripts, so a change to them can alter governed behavior. See the
      classify.py module docstring for the full rationale.

- [x] STEP TWO — EMPTY class confirmed empty (0 PRs) this run: nothing to close there.
- [x] STEP TWO — reviewed all 115 DOCS-ONLY PRs. 68 named a UMR id in their
      title; for each, grepped the full origin/main tree for that UMR id,
      then individually content-diffed (`gh pr diff`) every candidate whose
      UMR appeared on main against the actual matching main file(s) before
      deciding — NOT a blind ID-match (caught and rejected one real
      WAVE-181 sequential-id collision this way: same numeric id, two
      completely unrelated pieces of work). Closed 13 PRs confirmed
      duplicate/superseded with a cited main-branch file/commit in each
      closing comment (`gh pr close --comment`, verified closed via
      `gh pr view --json state`). Left 8 UMR-bearing PRs open after finding
      each contained real, unique, unshipped content (owner-proposals, live
      corrections, previously-undocumented bugs) NOT reproduced on main —
      closing them would have destroyed real work. Left the remaining 4
      UMR-bearing + all 47 no-UMR DOCS-ONLY PRs open: the 47 were checked for
      a uniquely-named file already existing on main (zero matches, so not
      superseded); the 4 ran out of review budget for individual content
      verification and were left open per the conservative default (never
      close without a verified citation). Full disposition + per-PR
      citation recorded in `ai-os/registry/pr-classification-20260816.json`
      (`disposition`/`disposition_reason` fields + top-level
      `disposalSummary`) and `ai-os/registry/pr-classification-20260816-disposal-decisions.json`.
- [x] Commit + push disposal actions (closures) — this commit.
- [x] STEP THREE — final report written to the user (class counts, closed
      count + reasons, exact CODE-class PR list already in the committed
      JSON for the sibling dispatch).

## Remaining
- [ ] record-completion via agent_work_briefing.py
