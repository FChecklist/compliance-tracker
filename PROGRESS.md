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
- [x] **Independently re-verified Playwright/Chromium genuinely works on
      this box** (correcting `GAP-PLAYWRIGHT-BROWSER-MISSING-SYSTEM-LIBS`,
      not silently leaving it stale): real `chromium.launch({headless:true,
      args:['--no-sandbox']})` + real `page.goto('https://projexa-ai.com/login')`
      + `page.title()` succeeded once `LD_LIBRARY_PATH=/home/rajat/.local/chrome-system-libs`
      was exported first. Correction note appended to that gap entry in
      `ai-os/MASTER-TRACKER.yaml` (left `status: open` since the underlying
      system-level lib install is still genuinely missing -- the env var is
      a real, working, per-invocation workaround, not a permanent fix).
- [x] **Real testing execution completed for OCID-047, all 4 roles with a
      real product provisioning path (admin/manager/member/viewer)**:
      - **Provisioning**: hit a real blocker first -- `POST /api/users`
        (the real invite path) returned 400 `"email rate limit exceeded"`
        for all 3 new roles (Supabase SMTP quota already exhausted, same
        class the original session's `sigB` hit). Worked around per this
        task's own instructions ("real Admin-API email-confirm bypass"):
        `supabaseAdmin.auth.admin.createUser({email,password,email_confirm:true})`
        (a real Admin API call that does NOT send email, unlike
        `inviteUserByEmail`) + a direct `compliance.users` INSERT mirroring
        the exact real row shape `consumeInviteLinkAndProvisionUser`
        produces, then verified via a REAL Playwright password-grant login
        through `/login` that `requireAuth()`'s real downstream
        authorization code is genuinely exercised for each role.
      - **Rights axis**: 4 real actions spanning every rank threshold among
        these 4 roles (`erp.risks.create`=member, `board.create`=manager,
        `clients.create`=branch_manager, `erp.fiscal_periods.reopen`=admin)
        -- every one of the 16 (role x action) real HTTP outcomes matched
        the documented model exactly (403 with the correct centrally-
        generated message, or a real 2xx success).
      - **Responsibility/scope axis, all 4 named in the OCID-047 amendment**:
        dashboard rollup (`individual`/`individual`/`team`/`org`, exact
        match), risk-register visibility (`BROAD_SCOPE_ROLES`, exact match,
        plus a real positive UX bonus -- the Risk Register list already
        shows *"(N risks outside your scope not shown)"*), classification
        ceiling (`ROLE_CLEARANCE`/`canAccess`, all 16 role x classification
        combinations matched exactly, `restricted` flag + real key
        withholding both correct) -- all 3 a clean pass. Client-list
        visibility was **not** a clean pass -- real gap found and
        registered (see below).
      - **Denial UX (Item 5)**: mixed, both directions registered honestly
        -- the Risk Register LIST's scope-denial message is real and good;
        but the CREATE-modal's 403 (role-rights denial) closes silently
        with zero visible error text over 3 real seconds of polling -- a
        real, separate gap.
      - Full real evidence (HTTP status codes, DB query results, request/
        response bodies, screenshots) written to `/tmp/ocid047/*` this
        session (ephemeral, not committed -- reproducible any time from the
        real fixtures still live in Org A: 3 new users, 1 client, 5 risks,
        8 board meetings, 1 fiscal year + periods).
      - Registered in `ai-os/MASTER-TRACKER.yaml`: one closed clean-pass
        summary entry (`OCID-047-ROLES-RIGHTS-REAL-TEST-EXECUTION-4-ROLES`)
        plus 2 real open gaps
        (`GAP-CLIENT-LIST-NO-SCOPE-ENFORCEMENT`,
        `GAP-RISK-CREATE-403-SILENT-DENIAL-UX`).
- [x] Moved this session's `ACTIVE-CLAIMS.yaml` entry from `active:` to
      `recently_completed:`.

## Remaining

- [ ] OCID-047's other 6 roles (`veridian_admin`, `branch_manager`,
      `senior_professional`, `team_member`, `client_viewer`,
      `external_auditor`) have no real product-level provisioning path
      today (DB-seed only) -- a separate, already-registered gap, not
      attempted this pass, per the amendment's own scoping.
- [ ] OCID-048 through OCID-052's remaining items (OCID-052 Items 2-3
      already done in an earlier session/PR #822) still have zero or
      partial real test execution -- next real OCID-020 increment for
      whoever picks this up next.
- [ ] The 2 real gaps found this pass
      (`GAP-CLIENT-LIST-NO-SCOPE-ENFORCEMENT`,
      `GAP-RISK-CREATE-403-SILENT-DENIAL-UX`) are registered but not fixed
      -- both are small (S / XS-S per their own `size` fields), real
      follow-up implementation work, out of scope for this testing-only
      pass.
