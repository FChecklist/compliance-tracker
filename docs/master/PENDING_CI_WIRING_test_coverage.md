# Pending CI wiring: New Test Coverage Check + Test Coverage Gap Report Check

**Status: prepared, NOT yet applied to `.github/workflows/ci.yml`.**

Why this is a separate doc instead of a direct edit: this session's `gh`
token has scopes `gist, read:org, repo` but not `workflow`, and GitHub
rejects any `git push` whose branch touches `.github/workflows/*.yml`
without that scope ("refusing to allow an OAuth App to create or update
workflow `.github/workflows/ci.yml` without `workflow` scope"). That
rejection applies to the *entire push*, not just the workflow file, so it
was reverted out of this PR's commits rather than block the two real
scripts (`scripts/report-test-coverage-gap.mjs`,
`scripts/check-new-test-coverage.mjs`) and the coverage report they
produce (`docs/master/TEST_COVERAGE_GAP.md`) from landing.

Someone with `workflow` scope (the repo owner, or a session/token that has
it) needs to add the following two jobs to `.github/workflows/ci.yml`,
immediately before the `e2e:` job:

```yaml
  new-test-coverage:
    name: New Test Coverage Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          # Needs real history to compute a merge-base against origin/main --
          # the default fetch-depth: 1 checkout only has this PR's own
          # commit(s), which is not enough for `git merge-base` to find a
          # common ancestor. See the script's own header for why the diff
          # (not just static file state, unlike this file's other coverage
          # checks) is the mechanism here.
          fetch-depth: 0
      # VERIDIAN Review Framework gap-closure ("AI Can Safely Modify
      # Module": "CI gate does not include comprehensive behavioral test
      # coverage") -- fails the build if this PR touches a
      # src/lib/services/*.ts file that had zero test coverage before this
      # PR, and the PR adds no test anywhere. See the script's own header
      # for the honest limitation this does and doesn't guarantee.
      - run: node scripts/check-new-test-coverage.mjs
  test-coverage-gap-report:
    name: Test Coverage Gap Report Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      # VERIDIAN Review Framework gap-closure ("AI Can Generate Tests for
      # Module": "No systematic test-generation tooling") -- fails the build
      # if docs/master/TEST_COVERAGE_GAP.md is stale relative to the current
      # src/lib/services tree, so the report stays trustworthy instead of
      # silently rotting the moment a new service file is added.
      - run: node scripts/report-test-coverage-gap.mjs --check
```

Both scripts already exist on `main` (this PR) and were verified manually
(success + a deliberately introduced violation, reverted) before writing
this doc — the only missing piece is the two `ci.yml` job entries above.

Once applied, this doc can be deleted (or marked applied) — it is a
holding pen for the diff, not a permanent artifact.
