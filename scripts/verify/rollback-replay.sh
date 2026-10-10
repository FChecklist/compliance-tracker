#!/usr/bin/env bash
# register: BR-207
# PROJEXA-BUILD-001 phase 2 (U-17, PMD-10): PGlite replay of each migration listed in
# ai-os/projexa-build-001/PHASE2_MIGRATIONS.txt, forward then down, restores the schema hash. No Supabase branch, no
# network, no database write anywhere: everything runs in an in-memory PGlite (Postgres compiled to WASM) that is thrown
# away after each migration.
#
# Exit 0 = every listed migration restored, or the list is empty. stdout last line: SCHEMA_HASH_MISMATCH=0
# Exit 1 = at least one listed migration did not prove a restore. stdout last line: SCHEMA_HASH_MISMATCH=<n>, with one
#          MISMATCH line per failing migration above it (the count includes a missing file and a statement that failed).
# Exit 2 = usage error, node missing, or the list or hash query file missing or malformed.
# The last stderr line is `PASS BR-207` or `FAIL BR-207: <reason>`.
#
# Per listed migration <name>:
#   1. fresh PGlite; the Supabase baseline of scripts/replay-migrations-from-empty.mjs (roles anon, authenticated,
#      service_role, authenticator, app_runtime; auth and extensions schemas); then the committed base snapshot
#      scripts/verify/fixtures/<name>.base.sql (ONLY the tables that migration touches; write it with
#      scripts/verify/gen-base-snapshot.mjs, read-only against the live catalog);
#   2. h0 = scripts/verify/schema-hash.sql scoped to the schemas the snapshot and the forward file create;
#      apply drizzle/<name>.sql, h1; apply drizzle/down/<name>.down.sql, h2; pass needs h2 = h0 and h1 != h0;
#   3. run the rehearsal DO block the PM pastes into the live database (scripts/verify/rollback-tools.mjs do-block),
#      scoped the same way: it must raise PASS_ROLLED_BACK with the replay's h0/h1/h2 and leave the hash at h0.
# Differences between this hash and the live one are listed in the header of scripts/verify/rollback-tools.mjs (scope,
# engine version and superuser role, pgvector columns as real[]); hashes are compared only within one run.
# Runtime: about 2.5 to 3.5 seconds per migration on the 2026-09-25 laptop (8 GB RAM), one PGlite at a time.
#
# Usage: bash scripts/verify/rollback-replay.sh
# Environment: PHASE2_MIGRATIONS_FILE, DRIZZLE_DIR, ROLLBACK_FIXTURES_DIR, SCHEMA_HASH_FILE (defaults under the repo
# root; see scripts/verify/rollback-tools.mjs). Needs the repo's @electric-sql/pglite dependency (bun install).
set -u

ID="BR-207"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

command -v node >/dev/null 2>&1 || { printf 'FAIL %s: node is not available on PATH\n' "$ID" >&2; exit 2; }
[ $# -eq 0 ] || { printf 'FAIL %s: this script takes no arguments\n' "$ID" >&2; exit 2; }

exec node "$(winpath "$ROOT/scripts/verify/rollback-tools.mjs")" replay
