#!/usr/bin/env bash
# register: BR-509 (BUILD-001), AW-902 (BUILD-002 WP-15): Live 5.2 on the real, deployed extraction Edge function and the real, live
# database. Submits a small, deterministic fixture workbook (never the owner's real ZOOMIES file) twice through the real
# createProjectFromDocument path (scripts/verify/live/p5-extraction-idempotent.ts) and checks that the SECOND submit made no new
# project: the file's sha256 already has one on the ledger, whatever number of times it is submitted.
#
# Needs, already set on this machine and never printed or taken as an argument: NEXT_PUBLIC_SUPABASE_URL,
# PROJEXA_DOCUMENT_EXTRACT_SECRET, and the live database connection (DATABASE_URL / APP_RUNTIME_DATABASE_URL). A real model call is
# made only on the first-ever run (a later run finds the sha256 already on the ledger and makes none): about USD 0.002 against the
# $1 cap (PROJEXA_EXTRACT_BUDGET_CAP_USD), the same model AW-902 wired.
#
# Exit 0 = exactly one project exists for the fixture's sha256 and both submits agree on it; stdout's last line is
#   projects_for_fixture_sha256=1
# Exit 1 = the check failed (the script's own reason on stderr). Exit 2 = bun is not available.
# The last stderr line is `PASS BR-509` or `FAIL BR-509: <reason>`.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2
command -v bun >/dev/null 2>&1 || { printf 'FAIL BR-509: bun is not available on PATH\n' >&2; exit 2; }

OUT="$(bun run scripts/verify/live/p5-extraction-idempotent.ts 2>&1)"
CODE=$?
printf '%s\n' "$OUT"
if [ "$CODE" -ne 0 ]; then
  printf 'FAIL BR-509: %s\n' "$(printf '%s' "$OUT" | tail -1)" >&2
  exit 1
fi
printf 'PASS BR-509\n' >&2
exit 0
