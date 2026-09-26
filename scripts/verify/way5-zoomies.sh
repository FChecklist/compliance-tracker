#!/usr/bin/env bash
# AW-605 (PROJEXA-BUILD-002 WP-13, way 5): a file dropped in a watched mailbox or Drive folder produces a proposal with no human trigger.
#
# Runs the committed way-5 tests, which put the ZOOMIES workbook into a fake folder and scan it on real SQL (PGlite): one parked job
# (needs_answers, 27 questions), one proposal, a cursor, no project and no BOQ; the same file again, with the cursor lost, and in a
# second source is still one job, one proposal and one model call; a crash between the job row and the cursor is recovered by the next
# scan; a claim whose process died is waited for and then taken over. Then checks that the trigger is the external scheduler path and
# not a Vercel cron: vercel.json must not name the scan job or the scheduler bridge.
#
# Exit 0 = every test passes and the trigger check holds. stdout is one line:
#   WAY5_OK files=6 pass=<n> fail=0 vercel_cron_mentions=0
# Exit 1 = a check failed (reasons on stderr). Exit 2 = a missing prerequisite. The last stderr line is `PASS AW-605` or
# `FAIL AW-605: <reason>`.
#
# Usage: bash scripts/verify/way5-zoomies.sh
# Environment: BUN (default: bun).
set -u

ID="AW-605"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUN="${BUN:-bun}"
cd "$ROOT" || exit 2

fail() { printf 'FAIL %s: %s\n' "$ID" "$1" >&2; exit 1; }

command -v "$BUN" >/dev/null 2>&1 || { printf 'FAIL %s: bun is not on PATH\n' "$ID" >&2; exit 2; }

FILES=(
  src/lib/services/folder-watch-service.test.ts
  src/lib/services/folder-watch-store.test.ts
  src/lib/services/folder-watch-connectors.test.ts
  src/lib/pipeline/scan-connected-folder-job.test.ts
  src/app/api/internal/scheduler-bridge/run/route.test.ts
  src/app/api/v1/projexa/scheduler-proposals/route.test.ts
)
for f in "${FILES[@]}"; do [ -f "$f" ] || fail "missing test file $f"; done

OUT="$("$BUN" test --isolate "${FILES[@]}" 2>&1)"
CODE=$?
PASS="$(printf '%s\n' "$OUT" | grep -E '^ *[0-9]+ pass$' | tail -1 | tr -dc '0-9')"
FAILS="$(printf '%s\n' "$OUT" | grep -E '^ *[0-9]+ fail$' | tail -1 | tr -dc '0-9')"
[ "$CODE" -eq 0 ] || fail "bun test exited $CODE (pass=${PASS:-?} fail=${FAILS:-?})"
[ "${FAILS:-1}" = "0" ] || fail "tests failed: ${FAILS:-?}"
[ "${PASS:-0}" -ge 50 ] || fail "only ${PASS:-0} tests passed (expected at least 50): a test file was skipped"

MENTIONS="$(grep -c -E 'scan_connected_folder|scheduler-bridge' vercel.json || true)"
[ "$MENTIONS" = "0" ] || fail "vercel.json names the scan job or the scheduler bridge ($MENTIONS lines): the trigger must not be a Vercel cron"

printf 'WAY5_OK files=%s pass=%s fail=0 vercel_cron_mentions=%s\n' "${#FILES[@]}" "$PASS" "$MENTIONS"
printf 'PASS %s\n' "$ID" >&2
exit 0
