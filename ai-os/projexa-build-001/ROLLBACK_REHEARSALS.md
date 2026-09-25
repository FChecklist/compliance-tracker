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

Notes on the 0613 row. The block was generated with `--schemas compliance,platform`, so the three hashes are for those two schemas only (22,532 objects at the time). Step (a) taken through the Supabase SQL tool before the block and again after it gave the same value, 0632897937bfdb90a878bbacbae4c1c7, with the new columns absent, so the aborted transaction persisted nothing. The forward file was then applied through `apply_migration` (name build001_link_project_scope) at about 10:29Z, and the drizzle ledger row (created_at 1790072000000) was written. After the apply: platform.user_ai_links has 19 columns and 2 rows, both still product veridian and active; compliance.api_keys has 15 columns and 36 rows, all key_kind org_service; token is nullable; the two per-product unique indexes exist and user_ai_links_one_active_per_user is gone.
| 0615_build001_projexa_timer | PASS_ROLLED_BACK | h0=0682db710b2a714afdf8eea8ff0b7aa5 h1=cd6ced07f0347f44c4b1500d30d1fdb4 h2=0682db710b2a714afdf8eea8ff0b7aa5 | forward_sha256=f801b42a58617ca440d73ad16489927202d0e3af4a70b9e9d66950f624ed0671 | 2026-09-25T10:58:00Z | PM (Claude Code, PROJEXA PROJECT MANAGER) |

Notes on the 0615 row. The block was generated with `--schemas compliance,public`, so the hashes cover those two schemas (19,698 objects). Step (a) taken through the Supabase SQL tool just before the block gave 0682db710b2a714afdf8eea8ff0b7aa5 with no `projexa_timer_*` function present, the same value as the block's own h0. Step (a) was NOT repeated after the block; the apply followed directly, and the live checks after the apply (3 functions, all service_role only, 1 active projexa- cron job) are in the PR description. The forward file was applied through `apply_migration` (name build001_projexa_timer); the drizzle ledger row (created_at 1790072500000) was written. `scripts/verify/lib/rollback-lib.mjs` `touchedSchemas` now also counts the schema of a schema-qualified CREATE FUNCTION, because this migration creates functions in the existing schema public and creates no schema.
| 0614_build001_link_resolve_by_hash | PASS_ROLLED_BACK | h0=540464ae9a36c8ac1d1d06e30b64cda1 h1=e83fef306b067f94d86cf96ad2bff4f3 h2=540464ae9a36c8ac1d1d06e30b64cda1 | forward_sha256=5cebdf82923b58aba1428b5f97fa7507744b6e571e873eb9c0b8552d4b8a9cba | 2026-09-25T11:08:00Z | PM (Claude Code, PROJEXA PROJECT MANAGER) |

Notes on the 0614 row. The block was generated with `--schemas compliance,platform` (22,553 objects). Step (a) through the Supabase SQL tool gave h0 = 540464ae9a36c8ac1d1d06e30b64cda1 before the block, which is exactly the h1 of the 0613 row: the applied 0613 equals the rehearsed forward state. Step (a) was not repeated after the block; the apply followed directly. After the apply: platform.rpc_resolve_ai_link_scoped exists with proacl {postgres=X/postgres,app_runtime=X/postgres}, identical to platform.rpc_resolve_ai_link_token; guard G-3 is 0; the 2 VERIDIAN links are still active; a call with an unknown token returns 0 rows. The drizzle ledger row (created_at 1790073000000) was written.
| 0616_build001_requirement_evidence | PASS_ROLLED_BACK | h0=768a0b9882e9601516de9834a4560285 h1=24694543b05281ef144a94cc53772aa9 h2=768a0b9882e9601516de9834a4560285 | forward_sha256=418338c1abfacc3bacb41a0959aab1379762665b518afb227fb5ccfbe5593703 | 2026-09-25T12:15:00Z | PM (Claude Code, PROJEXA PROJECT MANAGER) |

Notes on the 0616 row. The block was generated with `--schemas platform` (3,901 objects). Step (a) through the Supabase SQL tool gave h0 = 768a0b9882e9601516de9834a4560285 immediately before the block. The block returned the error text beginning PASS_ROLLED_BACK (forward changed the hash, down restored it exactly, then the transaction was aborted, so nothing persisted). After the real apply (`apply_migration`, name build001_requirement_evidence) the two columns exist on platform.sumeet_requirements (verify_command text nullable, evidence_ref text nullable) and the drizzle ledger row (created_at 1790074000000) was written. The data file 0617 is not rehearsed with a schema hash on purpose: it changes rows, not the schema. Its proof is the PGlite test; on the live table it was applied against 80 rows, none of them EXC-ITEM, none with a verify_command or evidence_ref, and afterwards the table holds 111 rows (31 EXC-ITEM, 69 rows with a verify_command and 72 with an evidence_ref among the original 80), and the md5 of the 31 EXC-ITEM rows and of the updated cells equals the md5 of the same file applied in PGlite (fb4ba8aef7a2672fce87a68dff6adafa and 24fa85b9ce8bc8aa85bf85de8e2ad031). The drizzle ledger row for 0617 (created_at 1790074500000) was written.
| 0618_build001_projexa_gateway | PASS_ROLLED_BACK | h0=a89bf6f8978dc1140d88995a5b88162f h1=ceeed0085995ffcba5075234baa8acac h2=a89bf6f8978dc1140d88995a5b88162f | forward_sha256=2ce0bf2bbc654713383f8e1f4c7ce26f28c3dd405fb5fad487ece96f85510594 | 2026-09-25T12:25:00Z | PM (Claude Code, PROJEXA PROJECT MANAGER) |

Notes on the 0618 row. The block was generated with `--schemas platform,public` (4,955 objects before, 4,980 after). Step (a) through the Supabase SQL tool gave h0 = a89bf6f8978dc1140d88995a5b88162f immediately before the block. The block was pasted with the comment lines of the forward and down files left out (statements identical), and returned the error text beginning PASS_ROLLED_BACK, so nothing persisted. After the real apply (`apply_migration`, name build001_projexa_gateway) the same hash query gave h1 = ceeed0085995ffcba5075234baa8acac, exactly the rehearsed forward state, with 4,980 objects. Guard G-5 (anon or authenticated may execute a `projexa_` function in schema public) reads 0, no function is executable by PUBLIC, `public.projexa_read_enabled()` returns false, the settings table holds one row with both switches false, and an unknown sub answers reason not_linked. The drizzle ledger row (created_at 1790075000000) was written. The Edge Function projexa-read was then deployed with verify_jwt false (version 1).
