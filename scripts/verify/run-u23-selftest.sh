#!/usr/bin/env bash
# register: BR-313, BR-314, BR-401, BR-501
#
# Self-test for the PROJEXA-BUILD-001 unit U-23 runners: sql-assert.mjs in mgmt mode (VERIFY_SQL_MODE=mgmt), verify-all.mjs
# (`bun run verify:all`), verify-all-local.sh, verify-all-deployed.sh and phase-gate.sh. The cases live in bun test files under
# src/lib/verify/ (bunfig.toml sets the test root to src/, so CI runs them too):
#   sql-assert.mgmt.test.ts    the mgmt read path against a fake Management API on a loopback port: Bearer header, a write statement
#                              never reaches the network, the token is never printed, HTTP 400 is exit 4, exit codes 0 to 4
#   verify-all-lib.test.ts     the pure rules: FAIL / OPEN / PASS classification, evidence_ref forms, expected_output rule, CSV reader,
#                              redaction, running a command with a timeout
#   verify-all.run.test.ts     verify-all.mjs, verify-all-local.sh, verify-all-deployed.sh and phase-gate.sh run end to end against a
#                              fake API and fake registers, with real bash commands
#   sql-assert.exit-codes.test.ts, sql-safety.test.ts   the existing runner tests (the default database path must be unchanged)
# Everything is offline: no database, no Supabase token, no Vercel. Nothing is written outside a temp folder.
#
# Exit 0 and the last line `PASS run-u23-selftest` when every case passes; exit 1 and `FAIL run-u23-selftest` otherwise; exit 2 when bun
# is missing. Run it from Git Bash (bun is at /c/Users/Dell/AppData/Roaming/npm, added to PATH when it is missing).
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || { echo "FAIL run-u23-selftest: repository root not found"; exit 2; }
if ! command -v bun >/dev/null 2>&1; then
  [ -d /c/Users/Dell/AppData/Roaming/npm ] && PATH="/c/Users/Dell/AppData/Roaming/npm:$PATH"
fi
command -v bun >/dev/null 2>&1 || { echo "FAIL run-u23-selftest: bun is not on PATH"; exit 2; }

if bun test --isolate \
  src/lib/verify/sql-assert.mgmt.test.ts \
  src/lib/verify/verify-all-lib.test.ts \
  src/lib/verify/verify-all.run.test.ts \
  src/lib/verify/sql-assert.exit-codes.test.ts \
  src/lib/verify/sql-safety.test.ts; then
  echo "PASS run-u23-selftest"
  exit 0
fi
echo "FAIL run-u23-selftest"
exit 1
