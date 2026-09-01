# drizzle/ — migration files

Migration filenames are NOT strictly sequential and have large gaps (e.g.
`0365_...` jumps straight to `0400_...`, `0400_...` to `0500_...`, plus
smaller gaps elsewhere). **This is expected, not evidence of missing or
deleted history.** `scripts/check-migration-collision.mjs`'s own header
explains why: multiple agents/PRs author migrations concurrently, so
numbers get reserved ("burned") without a collision even when a
particular PR is abandoned or renumbered before merge. If you're auditing
this history, don't assume a gap means a migration went missing — check
`scripts/check-migration-collision.mjs` and `drizzle/meta/_journal.json`
before concluding anything is lost.

Related known issue (see `ai-os/registry/dead-code-baseline.yaml`-style
tracking is not yet set up for this specific problem): `drizzle/meta/_journal.json`'s
entries are not always in migration-number/chronological order, which has
twice caused `drizzle-kit generate` to produce a bogus diff against the
live database (see `drizzle/0350_add_org_fk_constraints.sql` and
`drizzle/0327_crr_p2_schema_drizzle_sync.sql`'s own migration headers).
Both of those migrations were hand-written instead of generated for
exactly this reason. Reconciling the journal against
`drizzle.__drizzle_migrations` (the live ground truth) is a known,
still-open follow-up — not attempted as part of adding this README (R66
code-quality inspection, 2026-09-01), since it needs real `drizzle-kit`
tooling to verify safely, not a hand-edit from an inspection pass.
