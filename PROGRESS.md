# PROGRESS -- task-20260803-150816-pm-decision--defer-the-ci-guardrail-work

Cites `UMR-20260803-142309-da1f` (CI guardrail defer decision) and
`UMR-20260802-165606-4413` (OCID-020, parent). PM directive this task:
(1) do not sit blocked on the missing `workflow` OAuth scope, (2) register
it as an honest follow-up gap keeping the real, tested guardrail script as
work product, (3) stop working that item and move to the next real
OCID-020 priority -- determining and beginning real testing execution
across OCID-047 through OCID-052.

## Completed

- [x] **Step 1/2 already done by a prior/concurrent session, independently
      verified rather than redone**: `git log` shows this exact PM decision
      was already fully executed and merged --
      `390b3542` / PR #820 ("docs: real governance-YAML parse guardrail
      script (CI wiring blocked on OAuth scope)"). It:
      - Added `scripts/check-governance-yaml-parse.mjs`, tested locally
        against a real fail case (reintroducing the PR #818 bug class) and
        a real pass case -- kept as real work product, not discarded.
      - Registered `GAP-CI-WORKFLOW-FILE-PUSH-BLOCKED-MISSING-OAUTH-SCOPE`
        in `ai-os/MASTER-TRACKER.yaml` (line ~1521), citing
        `UMR-20260803-142309-da1f` verbatim, with the real `gh auth status`
        evidence (scopes `gist, read:org, repo`, no `workflow`) and the
        real, aborted `gh auth refresh -h github.com -s workflow` device-code
        attempt (per `UMR-20260803-142956-d931`: do not attempt this
        credential escalation -- PM is separately asking the Owner).
      - Did NOT wire the job into `.github/workflows/ci.yml` (push rejected
        by GitHub, confirmed real).
      Re-verified this is genuinely on `main` and on this branch (`git log`
      shows the merge commit at HEAD's own ancestry) -- not re-doing this
      work.
- [x] **Honest duplicate-effort note (not this task's to resolve)**: PR #821
      ("ci: add YAML safe-load guardrail for governance YAML files",
      `worker/task-20260803-142324-pm-decision--add-real-yaml...`) is a
      still-OPEN, unmerged, independently-written parallel attempt at the
      same class of guardrail (`scripts/check-yaml-safe-load.mjs`, different
      script, same OAuth-scope blocker independently rediscovered). Left
      as-is -- reconciling/closing it is outside this task's SPEC, which only
      asked to defer *this* item, not adjudicate a sibling session's PR.
      Noting it here so it isn't silently lost.
- [x] **Determined the real next OCID-020 priority** per the SPEC: read
      `ai-os/VERIDIAN_OCID_047_052_BUSINESS_CERTIFICATION_PLANNING_2026-08-03.md`
      and `ai-os/VERIDIAN_OCID_052_...md` in full, and confirmed via
      `git log`/`gh pr view 822` real testing execution has already begun
      for **OCID-052 only** (Item 2 deterministic-path PASS, Item 3
      AI-escalation-path PASS-on-routing-with-real-gaps-found, PR #822,
      merged). **OCID-047 through OCID-051 have zero real test execution
      so far** -- planning-only artifacts exist, no live test run against
      any of their real definitions of done.
- [x] Registered this session's claim in `ai-os/boss/ACTIVE-CLAIMS.yaml`
      per AGENTS.md Rule 11, before starting real execution.

## Remaining

- [ ] Begin real testing execution for OCID-047 (Roles/Rights/Responsibilities):
      start with the 4 roles that have a real, existing product
      provisioning path today (`admin`, `manager`, `member`, `viewer` --
      per the OCID-047 amendment's own table, the other 6 hierarchy roles
      have no real product-level provisioning path, DB-seed only, a
      separate real gap already registered in that doc, not this task's
      to solve). Real evidence standard: reuse the existing
      `/tmp/ocid020-continue/mega4-batched.mjs`-pattern browser harness and
      `OCID-020 Continue Org A`, real signup/login, confirm real
      allow/deny outcomes against `ERP_ACTION_ROLES`/`PROMPT_ACTION_ROLES`
      and the responsibility/scope axis (dashboard rollup, client-list
      visibility, risk-register visibility, classification ceiling) named
      in the 2026-08-03 amendment.
- [ ] Register real, honest findings (or a clean pass) per role tested.
- [ ] Update `ai-os/MASTER-TRACKER.yaml` / move this session's
      `ACTIVE-CLAIMS.yaml` entry to `recently_completed` once done or handed
      off.
