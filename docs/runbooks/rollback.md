# Rollback Runbook

**VERIDIAN Review Framework gap-closure, Cloud Deployment / Deployment
Automation (2026-08-07).** Gap: "Rollback capability is theoretical
(platform feature), never rehearsed." This runbook is the rehearsal:
`docs/SEV1_INCIDENT_RUNBOOK.md`'s §4 step 1 named "Vercel Instant
Rollback" as the fastest incident-response lever, but until this doc, it
had never actually been exercised against the real project — only
described. Every command below was run for real (read-only) against the
live `veridian-compliance-ai` project on 2026-08-07 while writing this doc;
outputs are summarized inline, not invented.

**Scope:** this repo's one Vercel project, `veridian-compliance-ai`
(`prj_mRRWcMvhyuxgRZtcfp4ArSzcOvII`) — same project
`docs/SEV1_INCIDENT_RUNBOOK.md` and `.github/workflows/sync-vercel-env.yml`
already reference (note: some older docs/comments still say the project's
pre-rename name, `compliance-tracker-ai` — same project ID throughout,
confirmed live via the Vercel API 2026-08-07).

## Why CLI-based, not dashboard-based

The review's recommended approach is explicit: "CLI-based drill first
(faster, scriptable)." A dashboard click is not scriptable, not
repeatable in CI, and leaves no artifact. Everything below uses the
`vercel` CLI or Vercel's REST API directly (same pattern
`sync-vercel-env.yml` already uses with `curl`), with one prerequisite:
`VERCEL_ACCESS_TOKEN` (already a GitHub Secret — see that workflow).

## Step 1 — Drill (read-only, safe to run any time)

```sh
node scripts/rollback-drill.mjs
```

This is the scriptable half of the drill: it calls Vercel's real
`GET /v6/deployments` API, lists the project's recent **production**
deployments, and prints (a) the currently-live production deployment and
(b) the best rollback candidate — the most recent `READY`,
`isRollbackCandidate: true` deployment before it (Vercel's own API marks
eligible rollback targets with that field; the drill trusts it rather than
guessing "second newest"). It makes **zero** deployment or traffic changes.

Live output, captured 2026-08-07 (`vercel ls veridian-compliance-ai --prod`
/ the equivalent API call — real project state at time of writing):

```
Current live production deployment:
  veridian-compliance-jjrjbuj8k-meet-track-s-projects.vercel.app
  id=dpl_F7LZ9gW4kgx4Y5JckZNP1tYNFYPe state=READY created=<recent>

Rollback candidate (most recent READY production deployment before the current one):
  veridian-compliance-dhxpc4rrj-meet-track-s-projects.vercel.app
  id=dpl_4CZd2hsYyB29T4DEkhDVkFJbdKDV state=READY created=<~2 days earlier>
```

Confirmed at the same time via `vercel rollback status
veridian-compliance-ai --token=$VERCEL_ACCESS_TOKEN`: **"No deployment
rollback in progress"** — i.e. the CLI's rollback-status check itself
(step 3 below) is real and working, not theoretical.

## Step 2 — Execute (only with explicit owner confirmation)

The drill above never flips production traffic. Actually rolling back is a
live production change and, per `AGENTS.md` Rule 7(e), requires the
repository owner's explicit confirmation even when every agent involved
agrees it's ready — the same posture as a Vercel/Supabase deploy. It is
easily reversible (roll forward again, or re-run this same step against
today's `current` deployment), but it is real user-facing traffic, so it
is never executed unattended by this drill or its script.

Once confirmed:

```sh
vercel rollback <candidate-url-from-step-1> --token=$VERCEL_ACCESS_TOKEN --yes
```

This is Vercel's real "Instant Rollback" — it re-promotes the named
deployment to production **without a new build or a new commit**, which is
exactly why `docs/SEV1_INCIDENT_RUNBOOK.md` §4 lists it as the fastest
mitigation lever, ahead of a code fix.

## Step 3 — Verify

1. `vercel rollback status veridian-compliance-ai --token=$VERCEL_ACCESS_TOKEN`
   — confirms the rollback completed (no longer "in progress").
2. Check `deployment_events` (the table
   `src/app/api/webhooks/vercel-deployment/route.ts` writes to on every
   real Vercel webhook delivery) for a new `deployment.succeeded` row with
   `target = 'production'` matching the rolled-back deployment's id — this
   is the same data `GET /api/deployment-slo` (see
   `src/lib/services/deployment-slo-service.ts`) reads to track production
   reliability, so a rollback shows up in that SLO too, not just here.
3. `GET /api/health` — confirms the app is serving.

## Step 4 — Roll forward again

Once the underlying issue is fixed and merged through the normal PR/CI gate
(`AGENTS.md` Rule 6 — no break-glass exception, per
`docs/SEV1_INCIDENT_RUNBOOK.md` §4 point 4), either:

- push to `main` as usual (a fresh deployment supersedes the rolled-back
  one), or
- `vercel rollback <the-deployment-you-rolled-back-from> --token=$VERCEL_ACCESS_TOKEN --yes`
  if you specifically want to restore that exact prior build without a new
  commit.

## Honest limitations

- The drill script (`scripts/rollback-drill.mjs`) only rehearses the
  **read-only identification** half live. The actual traffic-flipping
  `vercel rollback` command has not been executed against production as
  part of writing this doc — doing so is a real, if brief, production
  traffic change, and per Rule 7(e) that's the owner's call, not something
  an autonomous gap-closure task should trigger on its own initiative.
- Rollback only restores the **application build** — it does not undo a
  database migration. If an incident is caused by a schema change, rolling
  back the Vercel deployment alone can leave old application code running
  against a newer schema. There is no automated migration-rollback tooling
  in this repo today (Drizzle migrations are forward-only, per
  `drizzle/` conventions) — this is a real, disclosed gap, not implied
  coverage.

## Related

- `docs/SEV1_INCIDENT_RUNBOOK.md` §4 — incident response levers, cross-links
  here for step 1.
- `docs/infra/DEPLOYMENT_ENVIRONMENTS.md` — staging/preview strategy.
- `src/lib/services/deployment-slo-service.ts` / `GET /api/deployment-slo`
  — production reliability SLO built off the same deployment-event data.
