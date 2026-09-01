# Rollback Runbook

**Scope:** VERIDIAN AI OS internal operations (this repository + its Vercel
project + Supabase database). Same operating model as
`docs/SEV1_INCIDENT_RUNBOOK.md` -- one human Owner, no on-call rotation, no
paging service. Read that doc first for "who does what during an incident";
this one is specifically about undoing a bad change once you've decided to.

**Closes the "Rollback Readiness" finding from the VERIDIAN Review
Framework's AI Maintainability / Change Risk Management evaluation:**
*"Rollback relies on generic git/CI mechanisms, not a dedicated capability."*
Written honestly: this repo's real rollback capability genuinely is mostly
git + Vercel + Drizzle, same as most small teams -- there is no dedicated
rollback service. What was actually missing, and what this doc + the
tooling below now provide, is a **documented decision tree and real
down-migration examples**, not a brand-new mechanism.

---

## 1. The two things that can need rolling back

| Layer | What "rollback" means | Mechanism |
|---|---|---|
| **Application code** (Next.js app, API routes, services) | Serve the previous version again | Vercel instant rollback to a prior deployment, or `git revert` + new PR + deploy |
| **Database schema** (Drizzle migrations in `drizzle/`) | Undo a schema change | Depends entirely on whether the migration was additive -- see §2 |

These are independent. A code-only rollback (Vercel) never touches the
database. A schema rollback is a separate, deliberate action -- never done
automatically, never done as part of a Vercel rollback.

## 2. Is a migration even reversible? Check before you assume

Most of this repo's 230+ migrations (as of this wave) are
`ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` -- purely
additive. **Rolling those back needs zero database action**: old code
simply doesn't reference the new column/table, so reverting the
**application code** via Vercel/git is a complete rollback. Writing a
mechanical `DROP COLUMN` down-migration for every additive change would
actively make things worse (it would delete data the new code already
wrote), so this repo deliberately does not do that.

A migration only needs a real, hand-written down-migration when it does
something a code revert cannot undo: `DROP TABLE`, `DROP COLUMN`, `RENAME`,
`ALTER COLUMN ... TYPE`, or `SET NOT NULL`. Run this before deciding whether
you need one:

```bash
node scripts/check-migration-reversibility.mjs
```

It scans every file in `drizzle/` for those non-additive patterns and
reports which ones already have a down-migration in `drizzle/down/` and
which don't. As of this wave: 5 of 230 migrations are non-additive; 2 of
those 5 (the two most recent -- `0217_payment_entries_approval_workflow.sql`,
`0220_hr_attendance.sql`) have real down-migrations in `drizzle/down/` as
worked examples. The other 3 are older, already-applied production history
(`0005`, `0117`, `0196`) where a retroactive down-migration is a genuine
judgment call, not an automatic requirement -- see the script's own header
comment for why this is advisory, not a CI gate.

**This is not a hard gate on new migrations.** It's advisory tooling: run
it when you're about to write a non-additive migration, or before a
high-risk deploy, so the decision ("does this need a down-migration, and
if so, is data loss acceptable") is made deliberately instead of by
default.

## 3. Convention: writing a down-migration

When a new migration is non-additive, add a paired file:
`drizzle/down/<same-basename>.down.sql`. See
`drizzle/down/0217_payment_entries_approval_workflow.down.sql` and
`drizzle/down/0220_hr_attendance.down.sql` for the real pattern:

- Wrap in `BEGIN; ... COMMIT;`.
- State plainly, in a header comment, any condition under which the down
  migration will fail or lose data (e.g. "this fails if any row now holds
  a value the old enum doesn't have" or "this deletes real data -- back up
  first"). Do not write a down-migration that silently discards data with
  no warning.
- It is never auto-applied by any script or CI job. A human/agent runs it
  deliberately (`psql`/Supabase SQL editor/MCP `execute_sql`), the same way
  forward migrations are applied per this repo's existing `db:migrate`/
  `db:push` conventions.

## 4. Rollback decision tree for a high-risk deploy

1. **Is the problem in application code only (no migration involved, or
   only an additive one already applied)?**
   → Vercel dashboard → Deployments → previous good deployment → "Promote
   to Production" (or `vercel rollback` via the CLI, see
   `docs/infra/` for Vercel access). This is instant and does not touch the
   database. Prefer this first -- it's the fastest, least destructive lever
   this repo actually has (same posture as `SEV1_INCIDENT_RUNBOOK.md` §4).
2. **Was a non-additive migration part of the bad change, and it's already
   applied to production?**
   → Run `node scripts/check-migration-reversibility.mjs` to confirm
   whether a down-migration exists.
   → If yes: read its header comment for the failure/data-loss conditions,
     verify they don't apply (or accept them explicitly), then apply it.
   → If no: this is a real judgment call, same as `SEV1_INCIDENT_RUNBOOK.md`'s
     "Honest gaps" section -- there is no dedicated rollback service to
     fall back on. Write one following §3 above, or accept a forward-fix
     (a new migration that corrects the problem) instead of a rollback if
     writing a safe down-migration isn't possible without data loss.
3. **Roll back the code first, the schema second (if at all).** A schema
   rollback while new code is still deployed (expecting the new columns/
   tables) will break the *new* code, not fix anything. Always restore the
   application to a state consistent with whatever schema state you land
   on.
4. **Record what happened.** Same discipline as every other governance
   surface in this repo: note the rollback (what was rolled back, why, any
   data-loss accepted) in the incident's own PR/commit or in
   `ai-os/boss/COMPLETED.yaml` per `AGENTS.md` Rule 7(d) if it closed a
   tracked task.

## 5. Honest gaps

Matching `SEV1_INCIDENT_RUNBOOK.md`'s own honesty standard: this repo has
no automated rollback trigger (a rollback is always a deliberate human/agent
decision, never automatic on error-rate or health-check failure), no
point-in-time DB restore drill has been exercised (Supabase offers PITR on
paid tiers, but VERIDIAN AI OS has not documented or tested using it here),
and the 3 remaining down-migration-less non-additive old migrations (`0005`,
`0117`, `0196`) rely entirely on "it's already been in production a long
time and a rollback of that era's schema is not a realistic operation" as
their safety argument, not a written, tested down-migration.
