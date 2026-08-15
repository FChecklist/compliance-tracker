# Down migrations

VERIDIAN Review Framework gap-closure, "AI Maintainability / Change Risk
Management" -- **[High] Rollback Readiness**: "Rollback relies on generic
git/CI mechanisms, not a dedicated capability." Recommended approach: "Add
down-migration scripts for Drizzle changes and document a rollback runbook
for high-risk deploys."

## Scope, stated honestly

`../` (the parent `drizzle/` directory) has 230 forward migration files
going back to this project's start. Retroactively writing a correct,
tested down-migration for all 230 -- many of which are additive, some of
which are destructive or data-carrying in ways a mechanical reverse can't
safely undo -- is not attempted here; doing that blind, without re-verifying
each one against the schema's current state, would risk shipping *wrong*
down migrations, which is worse than having none. That would misrepresent
what a drive-by pass through 230 files can responsibly certify.

What this closes instead: the **convention**, applied going forward, plus
one real worked example so the pattern is concrete rather than only
described in prose.

## The convention (for every new high-risk migration from here on)

A migration counts as "high-risk" if it does any of:
- Drops a column, table, or constraint
- Changes a column's type or nullability in a way existing rows might not satisfy
- Backfills or transforms data (not just adds a column with a default)
- Touches RLS policies or grants

For a high-risk migration `NNNN_description.sql`, add a paired
`drizzle/down/NNNN_description_down.sql` in the same PR that:
1. Reverses the forward migration's schema change as exactly as SQL allows
   (e.g. `ADD COLUMN` -> `DROP COLUMN IF EXISTS`, matching the `IF EXISTS`/
   `IF NOT EXISTS` idempotency convention the forward migrations already
   use).
2. States, in a comment at the top, what data loss (if any) running it
   causes -- e.g. dropping a column loses that column's data permanently;
   say so, don't leave it implicit.
3. Is exercised via Supabase MCP (or an equivalent apply-then-verify pass)
   before merging, the same verification discipline this codebase's own
   wave write-ups already use for forward migrations (see
   `orchestra_changes.md` entries) -- an untested down migration is a false
   sense of safety, not a real one.

Low-risk, purely-additive migrations (new nullable column with a default,
new index, new table nothing yet depends on) do not need a paired down
migration -- for those, `DROP COLUMN`/`DROP TABLE IF EXISTS` in the rollback
runbook's manual steps (see `../../docs/ROLLBACK_RUNBOOK.md`) is sufficient
and a dedicated file would be process overhead with no real safety gain.

## Worked example

`0224_erp_exchange_rates_source_down.sql` pairs with the existing
`../0224_erp_exchange_rates_source.sql` (adds `erp_exchange_rates.source`,
additive/backward-compatible) -- included as the concrete template new
high-risk migrations should follow, even though this particular one was
low-risk enough not to have strictly needed one under the rule above.

## Not a CI gate

Presence of a down migration is **not** enforced by CI in this pass -- doing
so today would either (a) immediately fail the build against 230
pre-existing forward migrations with no down counterpart, or (b) require an
allowlist that's indistinguishable from just trusting PR review. Adding a
real enforcement gate (e.g. extending
`scripts/check-migration-collision.mjs` to also require a `down/` pair for
migrations touching DROP/ALTER TYPE/data-transform statements) is a
reasonable follow-up but is new-guardrail territory (AGENTS.md Rule 9) and
is intentionally left for a dedicated follow-up task rather than bundled
into this one.
