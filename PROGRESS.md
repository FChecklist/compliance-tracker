# PROGRESS -- task-20260802-202322-pm-decision--pr-737-kept-as-its-own-real

SPEC (PM decision, checked before deciding): PR #737 represents a real, genuine bug and fix, found
through real triage, and should not be discarded, but it tested the wrong target and is out of
scope for the actual OCID-020 certification UMR. Keep PR #737 on record under its own separate
UMR, not under `UMR-20260802-165606-4413`. Mint that UMR if one doesn't already exist, citing the
real bug/fix found, merge on its own real merits once it has a real audit, independent of OCID-020.
Separately, the real OCID-020 certification must redo the real 22-spec suite against the real
correct target, `projexa-ai.com` (serves `veridian-compliance-ai`) -- citing `UMR-20260802-165606-4413`
for the redo and `UMR-20260802-134939-145d` for why that target is correct.

## Completed
- [x] Read governance chain (`ACTIVE-CLAIMS.yaml`, `AGENTS.md`, `CONSTITUTION.yaml` context) and
      collision-checked before starting -- no active claim or completed entry for this exact scope.
- [x] Verified real current state of PR #737 (`gh pr view 737`): open, `mergeStateStatus: BLOCKED`,
      all CI checks pass except `audit-check`. Its body **already states this exact PM decision**
      verbatim (citing `UMR-20260802-201526-48ed`, `UMR-20260802-201605-08b8`,
      `UMR-20260802-192538-d700`, `UMR-20260802-165606-4413`, `UMR-20260802-134939-145d`) -- minted
      by `task-20260802-190820` itself (PR body `updated_at: 2026-08-02T20:18:15Z`, before this
      task's own `2026-08-02T20:23:22Z` creation timestamp) but **never recorded in the canonical
      cross-session governance file** (`task-190820`'s own last commit, `9acc79b7`, only touched
      `PROGRESS.md` -- `IMPLEMENTATION_MATRIX_2026-08-02.md` and `ACTIVE-CLAIMS.yaml` were
      untouched by it).
- [x] Independently confirmed real content of PR #737: 85 passed / 20 failed / 2 skipped from the
      full 22-spec e2e suite run against `projexa-smoky.vercel.app`; 1 real bug (Wiki
      `organizationId`) fixed and shipped as `FChecklist/projexa#69`; 2 other real still-open bugs
      (procurement requisition `500`, KB read-path `500`); rest are stale selectors from a real UI
      refactor.
- [x] Independently confirmed why the target was wrong: `projexa-smoky.vercel.app` is a different
      real product from `projexa-ai.com` (which serves `veridian-compliance-ai` per the real,
      executed Owner domain decision `UMR-20260802-134939-145d` / `WAVE-10-REDO`,
      `ai-os/boss/COMPLETED.yaml`, PR #720) -- OCID-020's real certification target is the latter.
      Confirmed PR #736 (open) independently records this same underlying target resolution as its
      own PM decision, under `UMR-20260802-165606-4413` -- not a duplicate of this task, a sibling
      decision this amendment builds on without restating.
- [x] Independently confirmed PR #737's `audit-check` CI job currently fails: the posted
      `AUDIT: PASS` comment's "Evidence Recorded" field contains the literal word "etc.", which
      `scripts/validate-audit-verdict.ts` correctly rejects as vague/unresolved language -- a real,
      unresolved, mechanical merge blocker, named as a next step (not fixed here -- this task did
      not implement PR #737 and does not self-certify it).
- [x] Recorded the full PM decision as a matrix amendment in
      `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` ("PM decision — PR #737 kept on record under its
      own standalone UMR, independent of OCID-020").
- [x] Registered this task's claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` (retroactively, alongside the
      real work -- this being a small single-commit docs task). Validated the new YAML block parses
      standalone; confirmed the whole-file YAML parse failure that pyyaml reports is pre-existing
      (same failure, same relative line offset, present in the file at `HEAD` before this task's
      edit -- not introduced by it).

## Remaining
- [ ] Commit + push this branch, open a PR.
- [ ] Await CI + a real (non-self) `AUDIT:` verdict per Rule 7(c)/Operating Rule 10, then merge.
- [ ] Not this task's scope, named for a future continuation session: (a) post a corrected, specific
      `AUDIT:` verdict on PR #737 (remove "etc.", replace with the actual finding) so its
      `audit-check` can pass and it can merge on its own real merits; (b) the actual OCID-020
      22-spec redo against `projexa-ai.com`/`veridian-compliance-ai`, building on PR #727 and
      PR #735 (both open, already correctly targeted).
