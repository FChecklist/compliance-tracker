# PROGRESS -- task-20260816-142705-find-and-eliminate-whatever-keeps-reassi

UMR: UMR-20260816-142651-d552

## Completed
- [x] Registered claim in ai-os/boss/ACTIVE-CLAIMS.yaml
- [x] Checked pre-existing indexes per Rule 12 (capability_registry, wiring_registry,
      CLAUDE_MEMORY_INDEX.md) -- no existing capability/entity matched; genuinely new
      investigation.
- [x] Inspected compliance-tracker's vercel.json (current + full git history via
      `git log -p --all -- vercel.json`): no `alias` field, no `domains` field, ever.
      Ruled out.
- [x] Searched every repo on the box (compliance-tracker, projexa, veda-advisors,
      claude-control, veridian-scripts, veridian-ai-os, ai-os) for any script/workflow
      that calls a Vercel domain-management endpoint or CLI verb (`domains add`,
      `/domains`, `vercel domains`): zero real hits anywhere in tracked code.
- [x] Inspected `.vercel/project.json` in compliance-tracker and projexa: each
      correctly points at its own project (prj_mRRWcMvhyuxgRZtcfp4ArSzcOvII /
      prj_JA9mwUdOfW3SKSxjG4jdPo0R2iVM) -- not cross-wired.
- [x] Inspected the one Vercel-touching GH Actions workflow that runs unattended
      (`sync-vercel-env.sh`, systemd unit `veridian-cron-sync-vercel-env`, "closed
      set" unit #2): only calls `vercel env pull`, never touches domains.
      `.github/workflows/sync-vercel-env.yml` is `workflow_dispatch`-only and also
      never touches domains.
- [x] Pulled real Vercel deployment history (v6/deployments) for both projects --
      no deploy timestamp exists that could auto-trigger a domain move (Vercel's own
      git-integration deploys never call the domains API); ruled out "a normal
      production deploy re-asserts the domain."
- [x] Read `ai-os/boss/COMPLETED.yaml`'s full history of this exact domain: WAVE-199
      (2026-07-21, Wave 10 brand-merge, Owner-authorized, moved domain -> compliance-
      tracker), an "undocumented" reversal around 2026-07-27 (-> projexa), WAVE-10-REDO
      (2026-08-02, citing UMR-20260802-134939-145d "Owner decision: revert to Wave 10
      state", moved back -> compliance-tracker), then real re-verification on 2026-08-07
      (commit a274c203e) found it back on projexa again (another undocumented flip
      between 08-02 and 08-07), then today's 2026-08-16 incident (back on compliance-
      tracker, corrected back to projexa by the desktop PM tier).
- [x] Root cause determined (see PR description / COMPLETED.yaml entry): every single
      one of these events was a manual, unattended-by-code live Vercel API/CLI action
      (`vercel domains add ... --force` / raw DELETE+POST), executed by a different
      agent session acting on a different (and in at least one case explicitly
      conflicting) "Owner decision" citation, with **no single persisted canonical
      record** anywhere in the repo stating which project currently, authoritatively
      owns the domain, and **no automated check** that would surface a drift between
      sessions. This is a governance/observability gap, not a code bug -- confirmed by
      exhaustive negative search above, not asserted by default.
- [x] Implemented fix: `ai-os/DOMAIN_OWNERSHIP.yaml` (single canonical record + full
      cited flip history + the rule that any future reassignment must update this file
      with a verbatim-quoted Owner citation FIRST) + `.github/workflows/
      domain-drift-check.yml` (read-only scheduled GH Action, every 15 min, GET-only
      against the Vercel domains API, diffs live projectId against the canonical
      record, fails the run + is visible in the Actions tab within 15 minutes of any
      future drift -- this is the realistic, provable form of "structural prevention"
      available given the proven absence of any code-level cause: nothing in this repo
      can technically block a manual dashboard/API action, but drift can now be
      detected in minutes instead of days/weeks).
- [x] Updated CLAUDE.md/AGENTS.md to point at the canonical record.
- [x] Logged this session's real work + evidence in `ai-os/boss/COMPLETED.yaml`.
- [x] Opened PR.

## Remaining
- [ ] Record completion via agent_work_briefing.py record-completion.
- [ ] Move ACTIVE-CLAIMS entry to recently_completed once PR is up.
