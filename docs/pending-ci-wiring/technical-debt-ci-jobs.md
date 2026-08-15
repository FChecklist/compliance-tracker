# Pending CI wiring: AI Engineering Quality / Technical Debt gap-closure

**Status: blocked on `gh` token scope, not on code.** All 3 new CI jobs
below are fully built, tested locally, and pass (see PROGRESS.md for the
verification run) -- they just cannot be pushed as part of
`.github/workflows/ci.yml` from this session.

**Why:** this session's `gh` token (account FChecklist) has scopes `gist,
read:org, repo` but not `workflow`. GitHub refuses any `git push` whose
branch touches `.github/workflows/*.yml`, even on a feature branch, with
"refusing to allow an OAuth App to create or update workflow ... without
`workflow` scope" -- a GitHub-side anti-social-engineering guardrail, not
this repo's own branch protection (AGENTS.md Rule 6 is a separate,
additional layer). See prior-session precedent, same blocker, same fix
pattern: PR that added `check-migration-collision.mjs`-adjacent CI wiring.

**What to do:** whoever has `workflow` scope (the Owner, or a future
session token grant) adds the 3 job blocks below to
`.github/workflows/ci.yml`, inserted right before the existing `e2e:` job
(after `doc-cross-references:`), then pushes/commits directly (this is a
tiny, mechanical, already-reviewed diff -- no need to redo the design work
in this doc). The scripts, configs (`knip.json`, `.jscpd.json`), and
`package.json` script aliases (`check:dead-code`, `check:duplicate-code`,
`debt:score`) they invoke are already merged; only the workflow-file wiring
itself is pending.

```yaml
  dead-code-detection:
    name: Dead Code Detection
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      # AI Engineering Quality / Technical Debt gap-closure (2026-08-15):
      # knip (config: knip.json) does the real import-graph analysis; this
      # only fails the build if a NEW file this PR adds is unreachable from
      # every real entry point -- the pre-existing ~18-file backlog knip
      # finds across the whole repo is left for a separate, deliberate
      # cleanup pass, not retroactively gated here. See
      # scripts/check-dead-code.mjs's own header for the honest limitation
      # this does and doesn't guarantee.
      - run: bun run check:dead-code
  duplicate-code-detection:
    name: Duplicate Code Detection
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      # AI Engineering Quality / Technical Debt gap-closure (2026-08-15):
      # jscpd (config: .jscpd.json) measures repo-wide duplication;
      # threshold (4%) was set with headroom over the measured baseline
      # (1.97%). See scripts/check-duplicate-code.mjs's own header for the
      # honest limitation this does and doesn't guarantee.
      - run: bun run check:duplicate-code
  technical-debt-score:
    name: Technical Debt Score (informational)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      # AI Engineering Quality / Technical Debt gap-closure (2026-08-15):
      # composite score derived from ai-os/MASTER-TRACKER.yaml open items +
      # check-guardrail-presence.mjs's empty-guardrail % + stale-doc-
      # manifest.yaml's count. Informational only -- always exits 0, see
      # scripts/technical-debt-score.mjs's own header for why this doesn't
      # gate the build.
      - run: bun run debt:score
```

Once applied, delete this file (its only purpose is to carry the diff past
the token-scope blocker).
