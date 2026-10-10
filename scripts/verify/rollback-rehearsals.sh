#!/usr/bin/env bash
# register: BR-206
# PROJEXA-BUILD-001 phase 2 (U-17, PMD-10): every migration listed in ai-os/projexa-build-001/PHASE2_MIGRATIONS.txt has an
# aborted-transaction rollback rehearsal logged PASS_ROLLED_BACK in ai-os/projexa-build-001/ROLLBACK_REHEARSALS.md.
#
# Exit 0 = every listed migration passes, or the list is empty. stdout last line: REHEARSAL_MISSING=0
# Exit 1 = at least one listed migration fails. stdout last line: REHEARSAL_MISSING=<n>, with one MISSING line per failing
#          migration above it naming the reason.
# Exit 2 = usage error, node missing, or the list or log file missing or malformed.
# The last stderr line is `PASS BR-206` or `FAIL BR-206: <reason>`.
#
# A listed migration <name> passes when all of these hold:
#   - drizzle/<name>.sql (forward) and drizzle/down/<name>.down.sql (down) exist;
#   - the LAST row for <name> in the table under the '## Log' heading of ROLLBACK_REHEARSALS.md has exactly the shape
#       | <name> | PASS_ROLLED_BACK | h0=<md5> h1=<md5> h2=<md5> | forward_sha256=<sha256> | <YYYY-MM-DDTHH:MM:SSZ> | <who> |
#   - h2 equals h0 (the down file restored the schema hash) and h1 differs from h0 (the forward file changed something);
#   - forward_sha256 equals the sha256 of the bytes of drizzle/<name>.sql today, so editing a rehearsed migration
#     invalidates its rehearsal until a new row is appended (drizzle/*.sql is LF-only per .gitattributes, so the value is
#     the same on Windows and in CI).
# What this script cannot do: recompute h0/h1/h2. They come from the live DO block (procedure in ROLLBACK_REHEARSALS.md);
# the script checks that the logged values are consistent and belong to the current forward file.
# With an empty list it passes and says that zero migrations are listed; the requirement that the list is non-empty
# belongs to a separate register row.
#
# Usage: bash scripts/verify/rollback-rehearsals.sh
# Environment: PHASE2_MIGRATIONS_FILE, ROLLBACK_REHEARSALS_FILE, DRIZZLE_DIR (defaults under the repo root; see
# scripts/verify/rollback-tools.mjs).
set -u

ID="BR-206"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

command -v node >/dev/null 2>&1 || { printf 'FAIL %s: node is not available on PATH\n' "$ID" >&2; exit 2; }
[ $# -eq 0 ] || { printf 'FAIL %s: this script takes no arguments\n' "$ID" >&2; exit 2; }

exec node "$(winpath "$ROOT/scripts/verify/rollback-tools.mjs")" rehearsals
