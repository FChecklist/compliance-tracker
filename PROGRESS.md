# PROGRESS -- task-20260726-071400-migration-drift-audit-and-reconciliation

## Completed
- [x] Registered ACTIVE-CLAIMS.yaml entry for this task
- [x] Root-cause confirmed via drizzle-kit@0.31.0 / drizzle-orm@0.45.2 source inspection:
      `drizzle/meta/_journal.json` frozen at migration 0000 since first commit;
      readMigrationFiles() iterates journal.entries only. Explains today's
      "died partway through after 2 NOTICEs" (0000 replayed against already-built schema).
- [x] Enumerated 261 real migration files (0000-0263, gaps at 166/167/168 explained
      as parallel-agent numbering collisions, not missing DDL, via git log).
- [x] Full DDL cross-reference of all 261 migrations against live compliance+platform
      schema (information_schema batch queries). Found migration 0245 relocated 22
      tables to a new `platform` schema mid-history (drizzle.config.ts's schemaFilter
      is now stale for those, documented as separate finding).
- [x] 12 genuinely-missing migrations found and applied live: 0005, 0037, 0140, 0165,
      0169, 0199, 0217, 0218, 0249, 0251, 0253, 0255. Complications hit and resolved:
      dynamic_chains schema retarget (2 files), stale-shaped crm_activities table
      dropped/recreated (0 rows, no FK deps), ivfflat maintenance_work_mem bump,
      unqualified enum type fix. Re-verified after: 0 genuine mismatches remain
      (1 expected false positive: 0020/0196 create-then-drop, correct history).
- [x] Rebuilt drizzle/meta/_journal.json with all 261 real migrations (dense idx,
      real git-commit-derived timestamps, strictly increasing).
- [x] Populated drizzle.__drizzle_migrations with 261 correct hash+created_at rows
      (sha256 of raw file content, matching readMigrationFiles()). Verified: count=261,
      max(created_at) matches journal's last entry -- future db:migrate will see
      everything as already-applied per drizzle-orm's actual migrate() logic.
- [x] Checked projexa's own Supabase project (evpckeuxgvahguwsaeul): `drizzle` schema
      doesn't exist there at all -- confirmed out of scope, not the same gap.
- [x] Wrote ai-os/MIGRATION_DRIFT_AUDIT_2026-07-26.yaml with full findings.

## Remaining
- [ ] Open PR
- [ ] Note in PR: bun/npm unavailable in this sandbox, so `bun run db:migrate` was
      not literally re-run as a final smoke test -- safety established via direct
      drizzle-orm source inspection instead (documented in the audit yaml). A
      session with a working bun env should still do a final live confirmation run.
