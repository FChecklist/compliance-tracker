# Rollback rehearsals: PROJEXA-BUILD-001 phase 2 (U-17)

Evidence log for register row BR-206 (and BR-301, which restates it as the phase 3 entry gate). PMD-10: no paid Supabase
branch is created; a migration's rollback is proven on the live database inside a transaction that always aborts, plus a
PGlite replay on a snapshot (BR-207). This file extends the existing convention of `docs/ROLLBACK_RUNBOOK.md`
(`drizzle/down/<name>.down.sql`, BEGIN/COMMIT-wrapped, data-loss conditions in its header, never auto-applied).

Which migrations need a row: every name in `ai-os/projexa-build-001/PHASE2_MIGRATIONS.txt`.
The check: `bash scripts/verify/rollback-rehearsals.sh` (last stdout line `REHEARSAL_MISSING=0`, exit 0).

## Procedure (the PM, once per migration, before `apply_migration`)

Prerequisites: `drizzle/<name>.sql` and `drizzle/down/<name>.down.sql` are committed on the PR branch, the name is in
`PHASE2_MIGRATIONS.txt`, the base snapshot `scripts/verify/fixtures/<name>.base.sql` is committed, and
`bash scripts/verify/rollback-replay.sh` passes. The replay runs the same DO block as step (b) on the snapshot, so a
block that cannot parse or does not restore fails there first, with no live database involved.

Writing the base snapshot (read-only, role app_runtime is enough because it reads pg_catalog only):

```bash
VERIFY_DATABASE_URL=<connection string, never printed> \
  node scripts/verify/gen-base-snapshot.mjs --tables <schema.table>[,<schema.table>...] \
  [--function compliance.current_org_id] --out scripts/verify/fixtures/<name>.base.sql
```

Name every table the forward or down file touches, plus the target of any foreign key the migration touches. Run the
same command again to regenerate a snapshot after the live table changed.

**(a) Baseline hash.** Run the full text of `scripts/verify/schema-hash.sql` through the Supabase MCP `execute_sql` on
project `pcrjmlpuqsbocqfwoxod` (it runs as role `postgres`). Note `n_objects` and `schema_hash`. This is the value the
database must show again after step (b). It changes whenever any session changes the schema, so take it right before (b).

**(b) Aborted-transaction rehearsal.** Generate the block and read it before pasting it:

```bash
node scripts/verify/rollback-tools.mjs do-block <name> > "$TMPDIR/<name>.rehearsal.sql"
```

stdout is the block; stderr prints `forward_sha256=<sha256>` and the log row to fill in. The generator strips the
leading `BEGIN;` and trailing `COMMIT;` of both files and refuses (exit 2) a file with any other transaction-control
statement (COMMIT, ROLLBACK, SAVEPOINT, ...) or with `CONCURRENTLY`. Paste the block into `execute_sql`. It does, in one
transaction:

1. `set local lock_timeout = '3s'`;
2. `h0` = the schema hash (the `schema_hash` column of `schema-hash.sql`);
3. the forward file's body through `EXECUTE`;
4. `h1` = the schema hash;
5. the down file's body through `EXECUTE`;
6. `h2` = the schema hash;
7. `RAISE EXCEPTION`, always: `FAIL forward changed nothing ...` when h1 = h0, `FAIL down did not restore ...` when
   h2 differs from h0, otherwise `PASS_ROLLED_BACK h0=<md5> h1=<md5> h2=<md5>`.

Pass: the error text starts with `PASS_ROLLED_BACK`. Any other error (a FAIL line, `canceling statement due to lock
timeout`, a SQL error in either file) is a failed rehearsal: nothing persisted, fix the files and repeat. Then run step
(a) again: the hash must equal the value from (a). If it differs, find out which session changed the schema in between
before going on.

**(c) Log row.** Append one row to the table under `## Log`, exactly this shape (single spaces, UTC time to the
second, `<who>` = the person or session that ran (b)):

```text
| <name> | PASS_ROLLED_BACK | h0=<md5> h1=<md5> h2=<md5> | forward_sha256=<sha256> | <YYYY-MM-DDTHH:MM:SSZ> | <who> |
```

h0, h1 and h2 are copied from the error text of (b); forward_sha256 is the value the generator printed (the sha256 of the
bytes of `drizzle/<name>.sql`). The check reads the LAST row for each name, so a re-rehearsal after an edit appends a
new row; earlier rows stay as history. Editing the forward file after its rehearsal changes its sha256 and the check fails
until a new row is appended. Keep the `execute_sql` error text in the PR description as the primary evidence.

Only after (a) to (c): `apply_migration` with the forward file, and record h0 of (a) in the PR description. After any
later rollback (down file applied for real), `schema-hash.sql` must return that h0 again, unless other schema changes
landed in between.

## Limits (read before relying on a PASS)

- **Locks.** DDL in the block takes ACCESS EXCLUSIVE locks on the touched tables for as long as the block runs (it holds
  them until the exception aborts the transaction). Reads and writes on those tables queue behind it for that moment.
  The full hash took 2.6 seconds live on 2026-09-25 (25,399 objects), and two hashes run after the forward DDL, so expect
  the locks to be held for about 5 to 6 seconds plus the time of the DDL itself. `lock_timeout = '3s'` caps how long the
  block waits for a lock held by someone else; it does not shorten the time the block holds its own locks. Run it at low
  traffic. `do-block <name> --schemas compliance,platform` hashes only the named schemas (shorter hold, narrower hash); a
  scoped block's values are comparable only with a scoped (a) over the same schemas
  (`node scripts/verify/rollback-tools.mjs hash-sql --schemas compliance,platform` prints that query). A statement timeout on the MCP
  connection, if one applies, ends the block like any other error: nothing persists and the rehearsal counts as failed.
- **Schema, not data.** The rehearsal proves the down file restores the schema hash. It says nothing about data: a down
  file that drops a column loses whatever was written to it after the real apply. The data-loss conditions belong in the
  down file's header (runbook section 3).
- **Hash coverage.** `schema-hash.sql` covers columns, constraints, indexes, policies, functions (definition md5 and
  SECURITY DEFINER), RLS flags, table grants and routine grants in compliance, platform, dpdp and public. It does not cover
  triggers, sequences, enum values, extensions, comments, column collations or the auth, storage and cron schemas. A down
  file that forgets one of those still shows PASS_ROLLED_BACK; read the diff of forward against down for them.
- **Role.** Take every hash with the same role. The information_schema sections depend on the role (see the header of
  `schema-hash.sql`); the block takes h0, h1 and h2 as `postgres`, so they are comparable with each other and with (a)
  when (a) also runs through `execute_sql`.
- **Concurrent changes.** Another session's schema commit between h0 and h2 makes h2 differ: a false FAIL, never a
  false PASS.
- **What CI can check.** `rollback-rehearsals.sh` checks this log's rows against the current files. It cannot recompute
  h0/h1/h2; they are evidence recorded by the PM, backed by the PGlite replay (BR-207) that CI can run.

## Log

| migration | result | hashes | forward | time_utc | who |
|---|---|---|---|---|---|
| 0613_build001_link_project_scope | PASS_ROLLED_BACK | h0=0632897937bfdb90a878bbacbae4c1c7 h1=540464ae9a36c8ac1d1d06e30b64cda1 h2=0632897937bfdb90a878bbacbae4c1c7 | forward_sha256=7fea27e785f5871698c181b6e16fa2429313427572dbc0eee10746c6d7aeb105 | 2026-09-25T10:24:00Z | PM (Claude Code, PROJEXA PROJECT MANAGER) |

Notes on the 0613 row. The block was generated with --schemas compliance,platform, so the three hashes are for those two schemas only (22,532 objects at the time). Step (a) taken through the Supabase SQL tool before the block and again after it gave the same value, 0632897937bfdb90a878bbacbae4c1c7, with the new columns absent, so the aborted transaction persisted nothing. The forward file was then applied through pply_migration (name build001_link_project_scope) at about 10:29Z, and the drizzle ledger row (created_at 1790072000000) was written. After the apply: platform.user_ai_links has 19 columns and 2 rows, both still product veridian and active; compliance.api_keys has 15 columns and 36 rows, all key_kind org_service; token is nullable; the two per-product unique indexes exist and user_ai_links_one_active_per_user is gone.
