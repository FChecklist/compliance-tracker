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

## Remaining
- [ ] STEP TWO — EMPTY class is empty (0 PRs) this run: nothing to close there.
- [ ] STEP TWO — review DOCS-ONLY (115) PRs, close only those whose doc
      content is already superseded on main (cite what supersedes it per PR)
- [ ] Commit + push disposal actions (closures)
- [ ] STEP THREE — write final report: class counts, closed count + reasons,
      exact CODE-class PR list for sibling dispatch
- [ ] record-completion via agent_work_briefing.py
