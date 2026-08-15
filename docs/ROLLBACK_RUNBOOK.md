# Rollback Runbook (High-Risk Deploys)

VERIDIAN Review Framework gap-closure, "AI Maintainability / Change Risk
Management" -- **[High] Rollback Readiness**: "Rollback relies on generic
git/CI mechanisms, not a dedicated capability." This is that dedicated
capability: a concrete, ordered procedure for rolling back a change that
touches both application code and the database, not just "revert the PR
and hope."

This runbook is scoped to **planned rollback of a specific deploy**
(you know which change caused the problem). For live incident response
where you're still diagnosing, start at
[`docs/SEV1_INCIDENT_RUNBOOK.md`](./SEV1_INCIDENT_RUNBOOK.md) instead --
its Section 4 already covers Vercel Instant Rollback and is not duplicated
here.

## Step 0 -- classify the rollback before touching anything

| The deploy... | Rollback path |
|---|---|
| Only touched application code (no migration ran) | **App-only rollback** -- Step 1 alone. |
| Ran a migration, but it was purely additive (new nullable column/table/index, nothing yet reads it) | **App rollback + leave the migration** -- Step 1; the extra column/table is inert and safe to leave until the next deploy cleans it up. |
| Ran a migration that's destructive, type-changing, data-transforming, or touches RLS/grants | **Full rollback** -- Step 1 AND Step 2, in that order. |

Getting this wrong in the unsafe direction (rolling back app code while a
destructive migration stays applied, or vice versa) is exactly the "generic
git/CI, not a dedicated capability" gap this runbook closes -- the table
above is the missing decision step.

## Step 1 -- application code rollback

1. **Fastest mitigation**: Vercel Instant Rollback to the previous
   production deployment (project `prj_mRRWcMvhyuxgRZtcfp4ArSzcOvII`) --
   see `SEV1_INCIDENT_RUNBOOK.md` Section 4, item 1. Buys time; does not by
   itself touch the database.
2. **Durable fix**: `git revert <merge-commit>` on a new branch, open a PR,
   let CI run (Lint/Type Check/Build/Unit Tests), merge. `AGENTS.md` Rule 6
   has no break-glass exception -- this still goes through the normal
   branch protection gate, same as a forward change.

## Step 2 -- database rollback

Only needed when Step 0's table says "Full rollback."

1. Find the migration(s) the deploy ran: `git show <merge-commit> --
   drizzle/` or check `drizzle/meta/_journal.json` for what was added.
2. Check for a paired down migration in `drizzle/down/<NNNN>_..._down.sql`
   (see `drizzle/down/README.md` for the convention -- every high-risk
   migration from that convention's start date forward should have one).
   - **If one exists**: review it (it documents its own data-loss
     implications in a header comment), then apply it directly via the
     Supabase MCP (`execute_sql`) or `psql` against `DATABASE_URL` --
     Drizzle's CLI has no built-in `migrate down`, this repo's migrations
     are applied via `drizzle-kit push`/raw SQL, not a tracked
     up/down ledger, so the down file is run the same way the forward one
     was.
   - **If none exists** (migration predates the convention, or was
     classified low-risk): hand-write the reverse SQL now, following the
     same pattern (`DROP COLUMN IF EXISTS` / `DROP TABLE IF EXISTS` for an
     add, restoring the prior type/constraint for an alter). State the data
     loss explicitly before running it, exactly as `drizzle/down/README.md`
     requires for new ones.
3. **Verify before declaring done**: re-run `get_advisors` (Supabase MCP)
   for new security/lint findings, and spot-check the affected table(s)'
   `FORCE ROW LEVEL SECURITY` status if the migration touched RLS --
   matching `SEV1_INCIDENT_RUNBOOK.md` Section 4 item 3's existing
   verification habit for this exact class of risk.
4. Confirm the reverted application code (Step 1) is compatible with the
   now-reverted schema -- this is the ordering hazard: rolling back the
   schema while newer code that expects the added column is still live
   (or vice versa) creates a second incident on top of the first. Roll back
   app code first, confirm it's serving, then roll back the schema.

## Step 3 -- post-rollback

Same as `SEV1_INCIDENT_RUNBOOK.md` Section 5: write a dated retrospective
in `docs/` covering what happened, why the rollback path above was (or
wasn't) sufficient, and whether a down migration should have existed but
didn't -- if so, add it to `drizzle/down/` retroactively as a real follow-up,
not silently.

## Honest gaps

- No automated rollback trigger -- every step above is manually executed.
  Automating Step 0's classification or Step 2's down-migration lookup is a
  reasonable follow-up, not attempted here.
- `drizzle/down/` is a convention enforced by PR review, not CI (see its
  README's "Not a CI gate" section) -- a reviewer can still merge a
  high-risk migration without its down counterpart. The same honest-limits
  framing this codebase already uses for `check-guardrail-presence.mjs` and
  `validate-audit-verdict.ts` applies here too.
