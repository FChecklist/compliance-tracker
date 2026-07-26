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
- [x] Full DDL cross-reference of all 261 migrations against live compliance+platform
      schema state (information_schema batch queries, not per-file replay). Also
      discovered migration 0245 relocated 22 tables from `compliance` to a new
      `platform` schema mid-history -- drizzle.config.ts's schemaFilter (['compliance']
      only) is now stale for those tables, documented as a separate finding.
      12 migrations were genuinely unapplied live: 0005, 0037, 0140, 0165, 0169,
      0199, 0217, 0218, 0249, 0251, 0253, 0255. All 12 applied live via Supabase MCP
      apply_migration, with 2 real complications hit and resolved along the way:
        - 0140/0199 targeted `compliance.dynamic_chains`, which had already moved to
          `platform.dynamic_chains` by migration 0245 -- applied against the correct
          current location instead of the literal migration file text.
        - 0251's `crm_activities` table already existed live but with a completely
          different, stale column shape (account_id/contact_id/occurred_at/type)
          that didn't match schema.ts's current declared shape or 0251's own design.
          0 rows, no FK dependents -- dropped and recreated with the correct shape.
      Re-ran the full cross-reference after applying: 0 genuine mismatches remain
      (one expected false-positive: 0020's personal_model_config/page_agent_enabled,
      deliberately created then dropped again by migration 0196 -- correct history,
      not drift).

## Remaining
- [ ] Rebuild `drizzle/meta/_journal.json` with entries for all 261 real migrations
      (required for db:migrate to even know they exist, and for future db:generate
      to not collide with existing 0001.sql filename)
- [ ] Populate `drizzle.__drizzle_migrations` with correct hash+timestamp rows for
      all 261 migrations (sha256 of raw file content, matching readMigrationFiles())
- [ ] Verify `bun run db:migrate` exits 0 cleanly against the live project
- [ ] Check projexa's own Supabase project (evpckeuxgvahguwsaeul) for the same gap
- [ ] Write ai-os/MIGRATION_DRIFT_AUDIT_2026-07-26.yaml with full findings
- [ ] Open PR, push
