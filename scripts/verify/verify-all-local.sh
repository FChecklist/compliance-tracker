#!/usr/bin/env bash
# register: BR-313
#
# WO 3.3 gate (PROJEXA-BUILD-001, unit U-23): run `bun run verify:all` (scripts/verify/verify-all.mjs) against live Supabase and print
# its result. It runs every requirement row's check one at a time, so a full run takes 10 to 20 minutes; run it once.
#
# The LAST line of stdout is one of:
#   VERIFY-ALL-GATE: PASS                 printed only when verify:all exited 0 and its summary line shows n >= 111 checks and fail=0
#   VERIFY-ALL-GATE: FAIL <reason>        anything else
# Exit 0 = PASS. Exit 1 = FAIL (a check failed, fewer than 111 checks ran, no summary line, or VERIFY_ALL_ONLY is set: a partial run
# can never pass). Exit 2 = cannot run (no bun, no SUPABASE_ACCESS_TOKEN, the register could not be read: no token, no network).
#
# Runs from Git Bash (bun is at /c/Users/Dell/AppData/Roaming/npm, added to PATH when it is missing). Needs SUPABASE_ACCESS_TOKEN in
# the environment or in C:\ct\ct\.env.local; the token is never printed.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIN_CHECKS=111
cd "$ROOT" || { echo "VERIFY-ALL-GATE: FAIL cannot run: repository root not found"; exit 2; }

gate() {   # gate <exit code> <text after "VERIFY-ALL-GATE: ">
  echo "VERIFY-ALL-GATE: $2"
  exit "$1"
}

if ! command -v bun >/dev/null 2>&1; then
  [ -d /c/Users/Dell/AppData/Roaming/npm ] && PATH="/c/Users/Dell/AppData/Roaming/npm:$PATH"
fi
command -v bun >/dev/null 2>&1 || gate 2 "FAIL cannot run: bun is not on PATH"

OUT="$(mktemp)" || gate 2 "FAIL cannot run: no temporary file"
trap 'rm -f "$OUT"' EXIT

bun run verify:all > "$OUT" 2>&1
RC=$?
cat "$OUT"

case "$RC" in
  3) gate 2 "FAIL cannot run: no SUPABASE_ACCESS_TOKEN (verify:all exit 3)" ;;
  4) gate 2 "FAIL cannot run: the register could not be read (verify:all exit 4)" ;;
esac

SUMMARY="$(grep -E '^verify:all n=[0-9]+ pass=[0-9]+ fail=[0-9]+ open=[0-9]+ nocommand_pass=[0-9]+( only=[0-9]+)?$' "$OUT" | tail -n 1)"
[ -n "$SUMMARY" ] || gate 1 "FAIL no verify:all summary line (verify:all exit $RC)"

N="$(printf '%s\n' "$SUMMARY" | sed -n 's/.* n=\([0-9][0-9]*\) .*/\1/p')"
FAILED="$(printf '%s\n' "$SUMMARY" | sed -n 's/.* fail=\([0-9][0-9]*\) .*/\1/p')"

case "$SUMMARY" in
  *" only="*) gate 1 "FAIL partial run (VERIFY_ALL_ONLY is set): $SUMMARY" ;;
esac
[ "$RC" = "0" ] || gate 1 "FAIL verify:all exit $RC: $SUMMARY"
[ "$FAILED" = "0" ] || gate 1 "FAIL fail=$FAILED"
[ "$N" -ge "$MIN_CHECKS" ] || gate 1 "FAIL n=$N is below $MIN_CHECKS checks"
gate 0 "PASS"
