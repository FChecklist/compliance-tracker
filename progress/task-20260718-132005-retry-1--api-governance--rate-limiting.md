# task-20260718-132005-retry-1--api-governance--rate-limiting

VERIDIAN Review Framework gap-closure: API Governance (Rate Limiting,
Versioning, Webhooks) / API Developer Experience. 2 findings from
`prompt.txt`.

## Note on invocation 16's RESUME checkpoint

The `LAST_CHECKPOINT` narrative handed to this invocation (CACHE-05
utilization report, PR #1017, `bunx eslint` on cache files, etc.) belongs to
a **different** task entirely --
`task-20260718-083006-cache---synchronization--cache-utilizati` -- whose own
`progress/task-20260718-083006-cache---synchronization--cache-utilizati.md`
matches it verbatim. That task's PR #1017 is already merged into `main`
(visible in `git log`, commit `45435c9c4`). This is the same
task.yaml/checkpoint cross-contamination pattern seen before in this repo
(see this session's own memory note on the subject) -- ignored the stale
narrative and re-derived real state from `git status`/`git diff` +
`prompt.txt` instead. Moved that entry from `ai-os/boss/ACTIVE-CLAIMS.yaml`'s
`active:` to `recently_completed:` as part of this invocation's cleanup,
since it was genuinely done but still sitting under `active:`.

## Findings

1. **[Critical] No API changelog for external `/api/v1/**` consumers.**
   Real: confirmed no changelog existed. Fix: `docs/API_CHANGELOG.md`,
   compiled from the real git history of `src/app/api/v1/**/route.ts`
   (dated entries back to the `/api/v1` surface's introduction,
   2026-07-03), cross-linked from `docs/API_SANDBOX.md` and (see below)
   the OpenAPI route.
2. **[High] No sandbox/test environment for API integrators.** The
   finding's own recommended fix ("reuse the existing Demo Company org")
   turned out to reference a UI-only marketing string
   (`src/components/RealProductDemo.tsx`) with no backing org -- not
   reusable as stated. Substituted the real functional equivalent already
   in the codebase: `projexa_demo_org` / `projexa_demo_key`
   (`src/lib/supabase/api-key-auth.ts`), already environment-gated behind
   `DEMO_API_KEY_IDS` since a 2026-07-17 security fix. Added a
   `DEMO_KEY_RATE_LIMIT_PER_MINUTE` (30/min) safety ceiling specifically
   for `KNOWN_DEMO_KEY_IDS` keys, independent of and always at least as
   strict as the key's own DB-configured `rateLimitPerMinute` -- so the
   moment a demo key is allowlisted for external sandbox use it's
   automatically capped, not unlimited. Documented in new
   `docs/API_SANDBOX.md`, including the honest "what this is not" section
   (no self-serve per-integrator isolation -- that's flagged as follow-on
   scope in MASTER-TRACKER.yaml if real demand shows up, not built
   speculatively).

## Completed

- [x] Read `AGENTS.md`/`CLAUDE.md` governance docs (per invocation
      protocol) -- already satisfied from prior invocation context.
- [x] Verified the actual current state of `src/app/api/v1/**` (via
      `docs/API_CHANGELOG.md`'s own git-history citations) rather than
      trusting the finding's gap description at face value.
- [x] `docs/API_CHANGELOG.md` -- new, real per-route history compiled
      from git log, cross-linked from the OpenAPI route and
      `docs/API_SANDBOX.md`.
- [x] `docs/API_SANDBOX.md` -- new, documents the interim sandbox
      (`projexa_demo_org`/`projexa_demo_key`), corrects the finding's own
      "Demo Company" naming mismatch, states the honest limitations.
- [x] `src/lib/supabase/api-key-auth.ts` -- additive
      `effectiveRateLimitFor()` + `DEMO_KEY_RATE_LIMIT_PER_MINUTE` (30/min)
      ceiling for `KNOWN_DEMO_KEY_IDS` keys only; no change to any
      non-demo key's behavior or to scopes.
- [x] `src/lib/supabase/api-key-auth.test.ts` -- 9 new tests (4 pre-existing
      demo-gate tests + 5 new sandbox-rate-limit-ceiling tests). All pass
      (`bun test`: 9 pass / 0 fail).
- [x] `bunx eslint` clean on all 4 changed/new files (the two `.md` files
      get an expected "no matching configuration" warning, not an error --
      markdown isn't linted by this project's eslint config).
- [x] Did not touch `src/lib/services/permission-service.ts` or
      `ERP_ACTION_ROLES` (per `prompt.txt`'s explicit instruction).
- [x] Registered this task's claim in `ai-os/boss/ACTIVE-CLAIMS.yaml`
      (`active:`), and moved the stale-but-actually-completed
      cache-utilization entry to `recently_completed:` while there.
- [ ] Commit the real diff, push branch, open PR (per AGENTS.md Rule 6 --
      no direct push to `main`).
- [ ] Watch CI, respond to any failures.
- [ ] Post/obtain the required `AUDIT: PASS`/`AUDIT: FAIL` verdict comment
      if this branch's dispatch role requires one (Rule 10) -- N/A here,
      this is an interactive/worker session, not an `ai-team/<role>/*`
      dispatch branch, but confirm before assuming.

## Remaining

- [ ] Commit + push + open PR.
- [ ] Confirm CI green (Lint/Type Check/Build/Unit Tests).
- [ ] Merge once green (subject to the standing self-approval
      reviewer-identity deadlock noted in many other tasks' progress
      files in this same repo -- if it recurs here too, note it rather
      than working around it silently).
