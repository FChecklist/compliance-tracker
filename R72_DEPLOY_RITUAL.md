# R72 Deploy Ritual — compliance-tracker / veridian-compliance-ai

Written: R72 Phase 7 ("Reconciliation, Local-First Development, Vercel Production-Only").
This is the explicit, deliberate procedure that now stands in for the auto-deploy this
project used to have. As of R72 Phase 6 (claude_log id 196), `vercel.json`'s
`git.deploymentEnabled.main` is `false` — pushing to `main` no longer deploys anything by
itself. Every real deployment from here on is a conscious act of running this ritual.

**Standing precondition: the Vercel project (`veridian-compliance-ai`,
`prj_mRRWcMvhyuxgRZtcfp4ArSzcOvII`) is currently PAUSED.** Nothing in Steps 1–3 below can
reach real traffic until an owner-approved unpause decision is made and executed separately
(that gate is tracked in the R71/R72 Owner Register, not here). Steps 1–2 are safe and
useful to run regardless — they validate the code, they do not touch the paused state.

## Step 1 — Pre-deploy gate (mandatory, automated)

```bash
node scripts/pre-deploy-gate.mjs
```

Runs, in order: `bun install --frozen-lockfile`, `tsc --noEmit`, `eslint .` (0 errors
required, warning count only reported), the full `bun test` suite (diffed against
`known-test-failures-baseline.json` — a NEW failure not in that baseline is a hard stop;
the 69 already-known, already-proven-pre-existing failures are expected and do not block —
see claude_log ids 176 and 193 for how that baseline was established), and `bun run build`
(with `NODE_OPTIONS=--max-old-space-size=6144` set defensively for this machine's 8GB-RAM
constraint — see `R72_PARITY_GAP_REGISTER.md` item 5).

**Exit code 0 = proceed to Step 2. Any non-zero exit = STOP. Fix the reported failure and
re-run this gate from the top. Never skip a failing gate "just this once."**

## Step 2 — Confirm target and intent (manual, human-in-the-loop)

Before deploying, say out loud (or in chat, to whoever is present) exactly what is being
deployed and why:
- The commit SHA being deployed (`git rev-parse HEAD`) and its one-line message.
- Whether this is a Preview deploy (safe, always allowed) or a Production deploy (requires
  the project to be unpaused first — confirm current state with
  `vercel project inspect veridian-compliance-ai` or the `get_project` MCP tool; if
  `live: false`, a Production deploy target is pointless until the separate unpause
  decision is made).
- Confirm no one else is mid-deploy: `vercel ls veridian-compliance-ai --meta` for
  in-flight builds.

## Step 3 — Deploy (manual, explicit command)

Preview (always safe, does not require unpause):
```bash
vercel deploy
```

Production (only meaningful once the project is unpaused — see the Owner Register):
```bash
vercel deploy --prod
```

Record the resulting deployment URL and ID (printed by the CLI) — you will need the ID for
Step 5 if a rollback becomes necessary.

## Step 4 — Post-deploy checks (mandatory, within 15 minutes of deploy)

1. **Route smoke test** — `curl -o /dev/null -w "%{http_code}\n"` against at least 3 real
   routes on the new deployment URL (e.g. `/`, `/login`, `/api/health`). All must be 2xx/3xx,
   not 5xx.
2. **Runtime error check** — `get_runtime_errors` (Vercel MCP) or
   `get_runtime_logs` filtered to `level: ["error", "fatal"]`, `since: "15m"`, scoped to the
   new `deploymentId`. Zero new errors is the bar; any error must be triaged before calling
   the deploy "done."
3. **Migration state check** — if this deploy shipped any schema migration, confirm via the
   Supabase MCP (`list_migrations` or a direct `schema_migrations` query) that it applied
   cleanly on the real project — Vercel builds do not run migrations for you; migrations in
   this project's history have always been applied separately via the Supabase MCP's
   `apply_migration`, before or independent of the app deploy.
4. **claude_log entry** — write a `platform.claude_log` row recording the deployment (SHA,
   deployment ID, who/what ran the ritual, the 4 checks above with their actual results).
   This is this project's only durable deploy history; there is no other changelog.

## Step 5 — Rollback (if Step 4 finds a real problem)

Vercel keeps every previous deployment as an immutable, independently-addressable build.
Rolling back does **not** require a revert commit or a new build:

```bash
vercel rollback [deployment-url-or-id]
```

Omitting the argument rolls back to the most recent prior Production deployment
automatically. To roll back to a *specific* older deployment (not just the immediate
previous one), pass its URL or ID from `vercel ls veridian-compliance-ai`.

After rolling back:
1. Re-run Step 4's checks against the now-live (rolled-back) deployment to confirm it is
   actually healthy — do not assume a rollback target was fine just because it predates the
   bad deploy.
2. Write a `platform.claude_log` row documenting the rollback: what broke, how it was
   detected, what was rolled back to, and — separately, not blocking the rollback itself —
   file the real fix needed before attempting Step 1–3 again.
3. If the bad deploy included a schema migration, the migration itself is **not** rolled
   back by `vercel rollback` (that only reverts the application code/build). A migration
   requiring rollback needs its own explicit reverse migration, written and applied the same
   deliberate way the original was — never rely on the app-level rollback to undo a schema
   change.

## Why this exists

Before R72 Phase 6, pushing to `main` deployed automatically and silently. This repo has no
CI (confirmed repeatedly across R65–R72 — the only enforcement of correctness has ever been
a human or an AI session choosing to run these checks by hand), so an automatic deploy meant
zero gate between "commit lands" and "code is live." This ritual is the replacement gate:
manual, but real, every time.
