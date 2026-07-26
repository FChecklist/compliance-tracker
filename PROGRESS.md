# PROGRESS -- task-20260726-071400-migration-drift-audit-and-reconciliation

## Completed
- [x] Registered ACTIVE-CLAIMS.yaml entry for this task
- [x] Root-cause confirmed via drizzle-kit@0.31.0 / drizzle-orm@0.45.2 source inspection:
      `drizzle/meta/_journal.json` has had exactly ONE entry (migration 0000) since
      the file was first committed to this repo (git log confirms). drizzle-orm's
      `readMigrationFiles()` iterates `journal.entries` ONLY -- it never scans the
      drizzle/ folder directly. This means `bun run db:migrate` has never known
      migrations 0001-0263 exist; it only ever attempts migration 0000.sql, which
      explains today's observed "died partway through after 2 benign NOTICEs" (0000
      tried to recreate tables/enums that already exist live via a different path).
- [x] Enumerated real migration files: 261 real `.sql` files in `drizzle/`, numbered
      0000-0263 with numbers 166/167/168 never used (confirmed via git log: no file
      was ever added/deleted at those numbers -- parallel-agent numbering collisions
      that got renumbered elsewhere, not missing DDL).

## Remaining
- [ ] Cross-reference all 261 migration files' real DDL effects against live DB
      (pcrjmlpuqsbocqfwoxod, compliance schema) via information_schema batch queries
- [ ] Apply any genuinely-missing migrations' DDL live, verify each
- [ ] Rebuild `drizzle/meta/_journal.json` with entries for all 261 real migrations
      (required for db:migrate to even know they exist, and for future db:generate
      to not collide with existing 0001.sql filename)
- [ ] Populate `drizzle.__drizzle_migrations` with correct hash+timestamp rows for
      all 261 migrations (sha256 of raw file content, matching readMigrationFiles())
- [ ] Verify `bun run db:migrate` exits 0 cleanly against the live project
- [ ] Check verdian-ai/projexa's own Supabase project for the same gap (confirm
      scope before assuming it applies there)
- [ ] Write ai-os/MIGRATION_DRIFT_AUDIT_2026-07-26.yaml with full findings
- [ ] Open PR, push
