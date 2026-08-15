# PROGRESS -- task-20260718-131005-retry-0--api-governance--rate-limiting

Task: VERIDIAN Review Framework gap-closure, API Governance (Rate Limiting,
Versioning, Webhooks) / API Developer Experience -- 2 findings:
- [Critical] API changelog maintained for external consumers
- [High] Sandbox/test environment available for API integrators

## Completed
- [x] Read AGENTS.md/CLAUDE.md, checked `ai-os/boss/ACTIVE-CLAIMS.yaml`
      live -- no other active entry touched this area; registered this
      task's own claim (commit d77c7d1a0, pushed).
- [x] Merged origin/main into this branch (was 1094 commits behind;
      merge-base only, zero prior task work committed here).
- [x] Re-verified finding #1 against live code instead of trusting the gap
      description: `docs/API_CHANGELOG.md` **already exists** (PR #383,
      merged) -- the gap description is stale in the "does a changelog
      exist" sense. But it had genuinely drifted out of date: 9 real
      commits/PRs on 2026-07-30 (#658 CRM auto-distribution,
      #637 FI-AP-005 Payment Proposal List, #651 FI-AP-006 Vendor Payment
      Behavior, #645 FI-AR-006 Customer Payment Behavior/DSO,
      #644 SD-007 Sales Order Document-Flow, #648 FI-AA-006 Asset-to-GL
      Reconciliation, #642 FI-AP-007 Subcontractor Retention Summary,
      #646 FI-AP-008 Subcontractor Payment Application Status, #636
      FI-AR-004 Dunning List) added 13 new `/api/v1/projexa/**` route.ts
      files with zero corresponding changelog entry -- confirmed via
      `git log --diff-filter=A -- 'src/app/api/v1/**/route.ts'` since the
      changelog's last dated entry (2026-07-28). Real, confirmed drift.
- [x] Added the missing `## 2026-07-30` entry to `docs/API_CHANGELOG.md`
      covering all 13 new routes, citing real commit hashes/PR numbers,
      matching the file's existing style/convention.
- [x] Re-verified finding #2 (sandbox) via a read-only investigation
      sub-agent rather than assuming the gap or its recommended approach
      ("reuse the existing Demo Company org") was accurate as written:
      - No committed "Demo Company" org exists anywhere in this repo (no
        seed, no migration). The name is a UI label for VERIDIAN's own
        live production demo org (`src/components/RealProductDemo.tsx`)
        whose real org id is **not tracked in this repo** -- can't safely
        point external integrators at an org we can't identify.
      - `projexa_demo_org` (the other "demo"-named org in the codebase) is
        a documented multi-tenancy **isolation gap**
        (`PROJEXA-NO-TENANT-ISOLATION-01`, every PROJEXA customer sharing
        one backend identity) -- explicitly the wrong thing to hand
        external API integrators as a sandbox.
      - `src/db/seed.ts`'s `Acme Corp` org (`bun run db:seed`) is the only
        reproducible, safe, sample-data-seeded org actually in this
        codebase -- confirmed real, designated as the interim sandbox.
      - Confirmed no test/live API key distinction exists anywhere
        (`apiKeys` schema has no `environment`/`isSandbox` column;
        `organisations` schema has no sandbox/prod flag) -- the finding is
        genuinely open, not stale.
      - Confirmed a safe additive hook point exists for a future dedicated
        flag (nullable column on `apiKeys` or `organisations`, same
        pattern as `domainScope`/`rateLimitPerMinute`) without touching
        `permission-service.ts`'s `ERP_ACTION_ROLES` -- documented as the
        follow-up, not built now (per the finding's own "before building a
        dedicated flag" framing -- this task closes the *interim* gap
        only).
- [x] Added `docs/API_SANDBOX.md`: designates the Acme Corp seed org as the
      interim sandbox, gives integrators the exact steps (seed locally,
      generate a key via Settings > API Keys, sample credentials), states
      plainly what's NOT yet true (no isolated per-integrator sandbox, no
      test/live key distinction, shared rate limits) instead of implying
      it's solved, and names the dedicated-flag follow-up.
- [x] Linked `docs/API_SANDBOX.md` from `src/lib/openapi/generate.ts`'s
      OpenAPI `info.description` (one-line addition, no functional/schema
      change) and from `docs/API_CHANGELOG.md`'s own header.
- [x] Did not touch `src/lib/services/permission-service.ts` or
      `ERP_ACTION_ROLES` -- not needed for either finding.
- [x] `bunx tsc --noEmit` clean; `bun run lint` clean (no new
      errors/warnings in changed files).

- [x] Pushed, opened PR #1267, posted structured AUDIT: PASS verdict
      comment (Rule 10, 8-field format per `src/lib/audit-protocol.ts`,
      disclosed the same-identity non-independence limitation honestly),
      pushed an empty re-trigger commit (known issue_comment-vs-head-SHA
      audit-check bug). All CI checks green except Vercel (external
      build-rate-limit, not this PR's doing).
- [x] Discovered after opening the PR: two other OPEN, unmerged sibling
      PRs (#1266 task-...-131006, #1222 task-...-073003) also touch
      `docs/API_CHANGELOG.md`'s header (both adding rate-limiting
      documentation, a different pair of findings than this task's two)
      -- #1266 independently made the identical
      `src/lib/api-key-auth.ts` -> `src/lib/supabase/api-key-auth.ts`
      path-fix this PR also makes. Expected to produce a small, trivial
      merge conflict on that shared file whichever of the 3 PRs merges
      last -- not a duplicate-work situation (each PR's substantive
      content, the changelog entry / sandbox doc here vs. rate-limit
      docs there, is genuinely distinct), just concurrent-PR file
      contention. Left for the supervising session to resolve at merge
      time; not fixed here since it is not this PR's own conflict to
      pre-resolve against a moving target.

## Remaining
- [ ] None from this task's own scope -- both findings closed. Leaving
      PR #1267 open for the supervising session's merge per standing
      convention (Rule 6/10), and for it to arbitrate the 3-way
      `docs/API_CHANGELOG.md` merge order noted above.
