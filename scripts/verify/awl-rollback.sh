#!/usr/bin/env bash
# register: BR-488
# PROJEXA-BUILD-001 U-46 step 1 (audit A-20, spec AWL-D13): every Universal AI Work Link migration (drizzle/NNNN_build001_awl_*.sql) has
#   1. a PASS_ROLLED_BACK aborted-transaction rehearsal row in ai-os/projexa-build-001/ROLLBACK_REHEARSALS.md (written by the PM on the
#      live database; a row counts only while its forward_sha256 equals the forward file's sha256 today), and
#   2. a PGlite forward-then-down replay with an equal schema hash (h2 = h0, h1 != h0), which also runs the rehearsal DO block the PM
#      pastes into the live database and requires PASS_ROLLED_BACK from it (scripts/verify/rollback-tools.mjs replay).
#
# Exit 0 = both counts are zero. stdout last line: AWL_ROLLBACK missing_rehearsal=0 replay_mismatch=0
# Exit 1 = a migration has no valid rehearsal row, or its replay did not restore the schema. The same last line carries the real
#          numbers, and one MISSING or MISMATCH line per failing migration sits above it.
#          Until the PM has rehearsed the migrations on the live database, missing_rehearsal equals the number of link migrations:
#          that is correct, the script cannot write the evidence it checks for.
# Exit 2 = usage error, node missing, or the rehearsal log missing.
# The last stderr line is `PASS BR-488` or `FAIL BR-488: <reason>`.
#
# The starting point of each replay is the committed base snapshot of the migration plus the forward files of the link migrations
# before it (they are not live when this is written); the logic is in scripts/verify/awl-rollback.mjs. Runtime: about 4 seconds per
# migration on the 8 GB laptop, one PGlite at a time.
#
# Usage: bash scripts/verify/awl-rollback.sh
# Environment: ROLLBACK_REHEARSALS_FILE, DRIZZLE_DIR, ROLLBACK_FIXTURES_DIR (defaults under the repo root).
set -u

ID="BR-488"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

command -v node >/dev/null 2>&1 || { printf 'FAIL %s: node is not available on PATH\n' "$ID" >&2; exit 2; }
[ $# -eq 0 ] || { printf 'FAIL %s: this script takes no arguments\n' "$ID" >&2; exit 2; }

exec node "$(winpath "$ROOT/scripts/verify/awl-rollback.mjs")"
