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
| 0619_build001_audit_surface | PASS_ROLLED_BACK | h0=62598911df3788e119a5a2672621eece h1=1db9fdac4df67e2fd46e49fd6393b77c h2=62598911df3788e119a5a2672621eece | forward_sha256=c5e190a4322dc25801ff99248645f1c99e5424d2c18d3e22c8d8ad9b04961fd7 | 2026-09-25T15:09:00Z | PM (Claude Code, PROJEXA PROJECT MANAGER) |

Notes on the 0619 row. The block was generated with `--schemas compliance` (18,655 objects before, 18,657 after) and pasted with the comment lines of the forward and down files left out (statements identical). Step (a) through the Supabase SQL tool gave h0 = 62598911df3788e119a5a2672621eece immediately before the block, which returned the error text beginning PASS_ROLLED_BACK, so nothing persisted. After the real apply (`apply_migration`, name build001_audit_surface) the same hash query gave h1 = 1db9fdac4df67e2fd46e49fd6393b77c, exactly the rehearsed forward state. On compliance.audit_logs (9,076 rows) the column surface exists once, every row reads NULL there, and the check audit_logs_surface_check allows NULL or the four surface keys. The drizzle ledger row (created_at 1790075500000) was written. Sequencing rule kept: the migration was applied before the code that declares the column is merged.
| 0620_build001_inbound_email_attachments | PASS_ROLLED_BACK | h0=1db9fdac4df67e2fd46e49fd6393b77c h1=200fd8a6697d6988436a6be5a196f678 h2=1db9fdac4df67e2fd46e49fd6393b77c | forward_sha256=e89d100da36e2444826b47edcdfe5923329cc73b3176eeb72b9e8fe025e54e0b | 2026-09-25T15:17:00Z | PM (Claude Code, PROJEXA PROJECT MANAGER) |

Notes on the 0620 row. The block was generated with `--schemas compliance` (18,657 objects before, 18,689 after) and pasted with the comment lines of the forward and down files left out (statements identical). Step (a) through the Supabase SQL tool gave h0 = 1db9fdac4df67e2fd46e49fd6393b77c, which is exactly the h1 of the 0619 row: the applied 0619 equals the rehearsed forward state. The block returned the error text beginning PASS_ROLLED_BACK, so nothing persisted. After the real apply (`apply_migration`, name build001_inbound_email_attachments) the same hash query gave h1 = 200fd8a6697d6988436a6be5a196f678, exactly the rehearsed forward state. The table compliance.inbound_email_attachments exists with 0 rows, row-level security enabled and forced, and 2 policies (a SELECT policy for app_runtime on the tenant, and the service_role bypass). The drizzle ledger row (created_at 1790076000000) was written.
| 0632_build001_cron_fm_ppm_occurrences | PASS_ROLLED_BACK | h0=7ea8d7ed23028146d513c82f495fcaed h1=3e0d9efe875686613ddc385c90188a4a h2=7ea8d7ed23028146d513c82f495fcaed | forward_sha256=72ba333d0f61c8bc0c2a349abd111029b710257e85f28559e74314c7ee07388c | 2026-09-26T04:20Z | PM (Claude Code, PROJEXA PROJECT MANAGER) |
| 0633_build001_cron_metric_alerts | PASS_ROLLED_BACK | h0=3e0d9efe875686613ddc385c90188a4a h1=cb08bef3768924ab88c5378144e6c120 h2=3e0d9efe875686613ddc385c90188a4a | forward_sha256=909f9c4b32194ec5cba525260b27a1c55f437dfaa34ba0cf1a692952c476ec8e | 2026-09-26T04:20Z | PM (Claude Code, PROJEXA PROJECT MANAGER) |
| 0634_build001_cron_the_firm_recur | PASS_ROLLED_BACK | h0=cb08bef3768924ab88c5378144e6c120 h1=30ffe96b68da4d5a36bf9b06fabbadb6 h2=cb08bef3768924ab88c5378144e6c120 | forward_sha256=da62adf21dee82a6d08cf4433e1eda57dda82830cd50b59a0a98b7deab227e68 | 2026-09-26T04:20Z | PM (Claude Code, PROJEXA PROJECT MANAGER) |
| 0635_build001_cron_audit_cadence | PASS_ROLLED_BACK | h0=30ffe96b68da4d5a36bf9b06fabbadb6 h1=a6ef587bcbfd862ea623fc553eff79cf h2=30ffe96b68da4d5a36bf9b06fabbadb6 | forward_sha256=e2928542bae50b1fd7c310da490a601344ccf907ea932ca84a7130f8ea8dd772 | 2026-09-26T04:20Z | PM (Claude Code, PROJEXA PROJECT MANAGER) |
| 0636_build001_cron_task_nudge_digest | PASS_ROLLED_BACK | h0=a6ef587bcbfd862ea623fc553eff79cf h1=20cef30976ff23c4479a859c10461ad9 h2=a6ef587bcbfd862ea623fc553eff79cf | forward_sha256=3cb996d00370757b2e98a9becf5b72ee0bb13df008002ac40e4be40e416771b5 | 2026-09-26T04:20Z | PM (Claude Code, PROJEXA PROJECT MANAGER) |
| 0637_build001_cron_report_schedules | PASS_ROLLED_BACK | h0=20cef30976ff23c4479a859c10461ad9 h1=a1c22b6003dfc405facfc6493d69ce44 h2=20cef30976ff23c4479a859c10461ad9 | forward_sha256=57294ae6dd3b599a85eeb83fcf44eb83ba0ad91f7265d4963e5fe0c0b246fa04 | 2026-09-26T04:20Z | PM (Claude Code, PROJEXA PROJECT MANAGER) |
| 0638_build001_cron_orchestra_log_purge | PASS_ROLLED_BACK | h0=a1c22b6003dfc405facfc6493d69ce44 h1=6dc5492257d24250bef7bb10e7d84d4e h2=a1c22b6003dfc405facfc6493d69ce44 | forward_sha256=075bfd25fa42e5de82d0e9992b76aa719628014774b95ace1ac197feb932fac9 | 2026-09-26T04:20Z | PM (Claude Code, PROJEXA PROJECT MANAGER) |
| 0639_build001_cron_ai_reduction_snapshot | PASS_ROLLED_BACK | h0=6dc5492257d24250bef7bb10e7d84d4e h1=23e65ebde3be2607ef309d2deb43bc85 h2=6dc5492257d24250bef7bb10e7d84d4e | forward_sha256=b55c3ae0337fd7152c7905635743d5cf3b17cabd5d3e0fe3fac13ed225ccd5a6 | 2026-09-26T04:20Z | PM (Claude Code, PROJEXA PROJECT MANAGER) |
| 0640_build001_cron_pipeline_stuck_deals | PASS_ROLLED_BACK | h0=23e65ebde3be2607ef309d2deb43bc85 h1=c9b3b34e86456d79b5fd90cf9a044b8c h2=23e65ebde3be2607ef309d2deb43bc85 | forward_sha256=694ed3a429b96b807902c3700e91503e62b571a65a6124cbb9acbffe6c916c40 | 2026-09-26T04:20Z | PM (Claude Code, PROJEXA PROJECT MANAGER) |
| 0641_build001_cron_crm_lead_followups | PASS_ROLLED_BACK | h0=c9b3b34e86456d79b5fd90cf9a044b8c h1=139067872285b782af8ddae8b785b00c h2=c9b3b34e86456d79b5fd90cf9a044b8c | forward_sha256=9273fb223e64ca8249efafeb378f7121b50703e6550fe02e74b6af17a70a682b | 2026-09-26T04:20Z | PM (Claude Code, PROJEXA PROJECT MANAGER) |

Notes on the 0632 to 0641 rows. Applied live on 2026-09-26T04:20Z through the Supabase Management API as the postgres role, one migration at a time: baseline hash query (`--schemas compliance,public`, 19,750 objects before 0632), the always-aborted rehearsal block (each returned PASS_ROLLED_BACK with h2 equal to h0 and h0 equal to the live baseline, so the chain is continuous: each h0 is the h1 of the row above), the real apply (migrations endpoint, name = the migration file name), the same hash query again (equal to the rehearsed h1 every time), then the drizzle ledger row (ids 455 to 464, created_at = the journal `when` of each file). Note: the hash query must run as the postgres role; the read-only role sees fewer information_schema rows and gives a different hash (57ab3b43... instead of 7ea8d7ed... for the same schema). All ten pg_cron jobs named cost001-* exist and are active (checked in cron.job). 0638 is irreversible after 90 days of purged rows (see its file header).
| 0642_build001_pipeline_schedules | PASS_ROLLED_BACK | h0=139067872285b782af8ddae8b785b00c h1=820c39fe19c477ffaa7e3bc4e2d51d09 h2=139067872285b782af8ddae8b785b00c | forward_sha256=677698f2a17151bdcdac62ec549231314eb0008b335c80cc71c7782e35bc5bdb | 2026-09-26T04:29Z | PM (Claude Code, PROJEXA PROJECT MANAGER) |

Notes on the 0642 row. Applied live on 2026-09-26T04:29Z through the Supabase Management API as the postgres role with `--schemas compliance,public`: baseline hash equal to the h1 of the 0641 row (chain continuous), always-aborted rehearsal PASS_ROLLED_BACK (h2 equal h0), real apply, hash equal to the rehearsed h1, drizzle ledger row id 465 (created_at 1790087000000). The cron job projexa-scheduler-bridge exists with schedule */5 * * * * and active = false (checked in cron.job); it is switched on only at go-live.
| 0621_build001_awl_config_tables | PASS_ROLLED_BACK | h0=b71246219e67de2bfe4213b68a587b07 h1=7e7169552b0b121cc1c8ab14d2a2293b h2=b71246219e67de2bfe4213b68a587b07 | forward_sha256=01fc10e3c96b432849e310c279f4c29a2b8bbfa8751d94c3ea8e93f6f7d94ca7 | 2026-09-26T04:36Z | PM (Claude Code, PROJEXA PROJECT MANAGER) |
| 0622_build001_awl_intent | PASS_ROLLED_BACK | h0=7e7169552b0b121cc1c8ab14d2a2293b h1=f98bac7f394bfcbfd16912db992652d9 h2=7e7169552b0b121cc1c8ab14d2a2293b | forward_sha256=b2650490fa31ebd6314ffc6c9d76de2c27d66118c9916058d5cacd68ccb9655d | 2026-09-26T04:36Z | PM (Claude Code, PROJEXA PROJECT MANAGER) |
| 0623_build001_awl_call_log | PASS_ROLLED_BACK | h0=8e2c3d5e5606b49512b528cc07abfc10 h1=19a76b77845e14f55b0235888e1d9ae0 h2=8e2c3d5e5606b49512b528cc07abfc10 | forward_sha256=0b67afce7520237defc3df72410101e7f5eb7fb4423ee8b733921258368df828 | 2026-09-26T04:36Z | PM (Claude Code, PROJEXA PROJECT MANAGER) |
| 0624_build001_awl_link_functions | PASS_ROLLED_BACK | h0=e2c2407c88f2a3ff8c80c66af73e8502 h1=7265d09f054ac75ea0fbd4ce376036c3 h2=e2c2407c88f2a3ff8c80c66af73e8502 | forward_sha256=30c8ec673987c27fd3f7b975853eaacaf05723ad00a4a8a739e419c6e845af59 | 2026-09-26T04:36Z | PM (Claude Code, PROJEXA PROJECT MANAGER) |
| 0625_build001_awl_read_functions | PASS_ROLLED_BACK | h0=7265d09f054ac75ea0fbd4ce376036c3 h1=285e0e7bae44603a8534b24a43e9a8e2 h2=7265d09f054ac75ea0fbd4ce376036c3 | forward_sha256=b38b0575a87926acf3e77fd4f95a52b45d68d3fb1cf446c2de3b0e7ab796f6e3 | 2026-09-26T04:36Z | PM (Claude Code, PROJEXA PROJECT MANAGER) |
| 0626_build001_awl_intent_functions | PASS_ROLLED_BACK | h0=285e0e7bae44603a8534b24a43e9a8e2 h1=721896d631265d62d7651f868a2295f5 h2=285e0e7bae44603a8534b24a43e9a8e2 | forward_sha256=855d65451c9bab26b078a19cabd67d57ce767789459c150262c1e9d160340246 | 2026-09-26T04:36Z | PM (Claude Code, PROJEXA PROJECT MANAGER) |
| 0627_build001_awl_retention | PASS_ROLLED_BACK | h0=721896d631265d62d7651f868a2295f5 h1=a8d0dc7cca928de684fb34514d8d7fc3 h2=721896d631265d62d7651f868a2295f5 | forward_sha256=9c87f6d89f46dd8dd4262e7c74b33733631c5937d024c9aeb17b13a31dc87a0a | 2026-09-26T04:36Z | PM (Claude Code, PROJEXA PROJECT MANAGER) |
| 0628_build001_awl_seed | PASS_ROLLED_BACK | h0=a8d0dc7cca928de684fb34514d8d7fc3 h1=c7280ad0687cd2e8ec825149c4ef6bc0 h2=a8d0dc7cca928de684fb34514d8d7fc3 | forward_sha256=984e0b284f1372d95eb413f29b2c4dd4e2e07b63e339566da56893d44f988614 | 2026-09-26T04:36Z | PM (Claude Code, PROJEXA PROJECT MANAGER) |

Notes on the 0621 to 0628 rows (Universal AI Work Link database, U-46a). Applied live on 2026-09-26T04:36Z through the Supabase Management API as the postgres role, one migration at a time, in three scope groups because the objects live in different schemas: 0621 and 0622 with `--schemas platform`, 0623 with `--schemas platform,public`, 0624 to 0628 with `--schemas public`. For each: the baseline hash equalled the rehearsal's h0, the always-aborted rehearsal returned PASS_ROLLED_BACK with h2 equal to h0, the real apply went through the migrations endpoint (name = the file name), the same hash query afterwards equalled the rehearsed h1, and the drizzle ledger row was written (ids 466 to 473, created_at = the journal `when` of each file, 1790090000000 to 1790093500000, moved above the pg_cron and scheduler-bridge migrations so merge order keeps the journal increasing). The chain is continuous inside a scope group (each h0 is the h1 above); the first row of each group starts a new scope. The hash query must run as the postgres role. 0627 schedules the daily job ai-work-link-call-retention (04:10) which purges nothing until call rows age past retention.
