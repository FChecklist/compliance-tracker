#!/usr/bin/env bash
# register: BR-401, BR-501
#
# Phase gate (PROJEXA-BUILD-001, unit U-23): re-run the [EXIT] rows of one phase of the boolean register.
#   bash scripts/verify/phase-gate.sh <N>
# BR-401 runs it for phase 3 (the entry to phase 4), BR-501 for phase 4. The work is done by scripts/verify/phase-gate.mjs, which reads
# ai-os/projexa-build-001/BOOLEAN_REGISTER.csv (override: REGISTER_FILE), takes the rows whose phase is N, whose title starts with
# [EXIT] and whose status is not blocked_owner, runs each row's verify_command from the repository root with VERIFY_SQL_MODE=mgmt, and
# stops at the first failure.
#
# stdout: `GATE <id> PASS|FAIL <seconds>s` per row run, and the last line `phase=<N> failed=<k>` (k is 0 or 1).
# Exit 0 = failed=0. Exit 1 = a row failed. Exit 2 = cannot run (bad argument, no node, unreadable register, no row of that phase).
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
command -v node >/dev/null 2>&1 || { echo "cannot run: node is not on PATH" >&2; exit 2; }
exec node "$ROOT/scripts/verify/phase-gate.mjs" "$@"
