#!/usr/bin/env bash
# register: BR-280
# PROJEXA-BUILD-001 phase 2 (U-44, U-45): one entry point for the Universal AI Work Link conformance harness in
# scripts/verify/ai-link/ (ai_link_conformance.py, ai_link_mock_server.py, ai_link_selftest.py; Python standard library only).
#
# Modes:
#   selftest   (BR-280)  runs ai_link_selftest.py: it starts the mock server on a free localhost port, runs the harness
#                        against it with every optional check on (24 checks must pass), then restarts the mock once per
#                        deliberately broken rule (18 rules) and requires the harness to fail on exactly the named check.
#                        Nothing but localhost is contacted. Takes about 30 seconds.
#                        Exit 0 only when the selftest exits 0 AND its last stdout line is exactly
#                          SELFTEST: clean 24/24 pass; 18/18 breaks detected
#   readonly --link <url>
#                        the 19 base checks (H01 to H16, H21, H22, H24) against one real link. Only GET requests, dry runs
#                        and function reads are made, and the harness proves they leave both business counters unchanged.
#                        Safe on production data. Accepts --link and nothing else, so no write and no optional check can
#                        be started by accident.
#   full --link <url> --link-b <url> --member-link <url> --revoked-link <url> --demoted-link <url> --write
#                        all 24 checks. --write runs ONE real level-1 write and replays it (H20), so this mode changes data:
#                        use it only on a test project. All six options are required, so that "full" always means 24 checks.
#   readonly (no arguments, BR-490)
#                        the 23 read-only checks (H01 to H19 and H21 to H24: every check but the H20 write) against one link and the four
#                        test links, all from the environment: AWL_LINK, AWL_LINK_B (a link of another project), AWL_LINK_M (a member-role
#                        link), AWL_LINK_REVOKED, AWL_LINK_DEMOTED. All five are required: a missing one is exit 2 (a run with fewer links
#                        is fewer than 23 checks and must not look like a pass). Exit 0 only when the harness exits 0 AND its last stdout
#                        line is exactly `RESULT: 23 passed, 0 failed`. A pxa_ token in the output is masked.
#   run <options>        pass-through to ai_link_conformance.py with the options exactly as its own header documents them
#                        (--link is required; --link-b, --member-link, --revoked-link, --demoted-link, --write are optional).
#
# Exit 0 = every check passed. Exit 1 = a check failed (the harness prints the failing check ids; readonly, full and run end
# with the harness's own line `RESULT: <p> passed, <f> failed`). Exit 2 = usage error or a missing prerequisite (no python).
# The last stderr line is `PASS BR-280` or `FAIL BR-280: <reason>`.
#
# Usage: bash scripts/verify/awl-harness.sh selftest
#        AWL_LINK=... AWL_LINK_B=... AWL_LINK_M=... AWL_LINK_REVOKED=... AWL_LINK_DEMOTED=... bash scripts/verify/awl-harness.sh readonly
#        bash scripts/verify/awl-harness.sh readonly --link "<pasted link>"
#        bash scripts/verify/awl-harness.sh full --link A --link-b B --member-link M --revoked-link R --demoted-link D --write
#        bash scripts/verify/awl-harness.sh run --link "<pasted link>" [--write ...]
set -u

ID="BR-280"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HDIR="$ROOT/scripts/verify/ai-link"
WANT_LAST="SELFTEST: clean 24/24 pass; 18/18 breaks detected"

finish_ok()    { printf 'PASS %s\n' "$ID" >&2; exit 0; }
finish_fail()  { printf 'FAIL %s: %s\n' "$ID" "$1" >&2; exit 1; }
finish_usage() { printf 'FAIL %s: %s\n' "$ID" "$1" >&2; exit 2; }

PY=""
for c in python python3; do
  if "$c" -c 'import sys' >/dev/null 2>&1; then PY="$c"; break; fi
done
[ -n "$PY" ] || finish_usage "python (python or python3) is not available on PATH"
winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
export PYTHONDONTWRITEBYTECODE=1

SELFTEST_PY="$HDIR/ai_link_selftest.py"
HARNESS_PY="$HDIR/ai_link_conformance.py"
[ -f "$SELFTEST_PY" ] || finish_usage "missing $SELFTEST_PY"
[ -f "$HARNESS_PY" ] || finish_usage "missing $HARNESS_PY"

usage() {
  finish_usage "usage: awl-harness.sh selftest | readonly --link <url> | full --link A --link-b B --member-link M --revoked-link R --demoted-link D --write | run <harness options>"
}

[ $# -ge 1 ] || usage
MODE="$1"
shift

# run_harness <harness options...>: runs ai_link_conformance.py, prints its output with LF line endings, and returns its exit code.
run_harness() {
  "$PY" "$(winpath "$HARNESS_PY")" "$@" | tr -d '\r' | sed -E 's/pxa_[0-9a-fA-F]{64}/pxa_[masked]/g'
  return "${PIPESTATUS[0]}"
}

# harness_verdict <exit code>: exit code 0 and 1 come from the harness itself, anything else is a crash or a usage error.
harness_verdict() {
  case "$1" in
    0) finish_ok ;;
    1) finish_fail "the harness reported at least one failed check (see the FAIL lines above)" ;;
    *) finish_usage "the harness stopped with exit $1 (bad options or a crash; see above)" ;;
  esac
}

case "$MODE" in
  selftest)
    [ $# -eq 0 ] || finish_usage "selftest takes no arguments"
    TMP="$(mktemp -d)"
    trap 'rm -rf "$TMP"' EXIT
    "$PY" "$(winpath "$SELFTEST_PY")" >"$TMP/out" 2>"$TMP/err"
    RC=$?
    tr -d '\r' <"$TMP/out"
    LAST="$(tr -d '\r' <"$TMP/out" | tail -n 1)"
    if [ -s "$TMP/err" ]; then head -c 2000 "$TMP/err" >&2; fi
    if [ "$RC" -ne 0 ]; then finish_fail "the selftest exited $RC (last line: '$LAST')"; fi
    if [ "$LAST" != "$WANT_LAST" ]; then finish_fail "the last line is '$LAST', expected '$WANT_LAST'"; fi
    finish_ok
    ;;
  readonly)
    if [ $# -eq 0 ]; then
      missing=""
      for v in AWL_LINK AWL_LINK_B AWL_LINK_M AWL_LINK_REVOKED AWL_LINK_DEMOTED; do
        if [ -z "${!v:-}" ]; then missing="$missing $v"; fi
      done
      [ -z "$missing" ] || finish_usage "missing environment variable(s):$missing (23 checks need all five links; see scripts/verify/awl-README.md)"
      OUT="$(run_harness --link "$AWL_LINK" --link-b "$AWL_LINK_B" --member-link "$AWL_LINK_M" --revoked-link "$AWL_LINK_REVOKED" --demoted-link "$AWL_LINK_DEMOTED")"
      RC=$?
      printf '%s\n' "$OUT"
      LAST="$(printf '%s\n' "$OUT" | tail -n 1)"
      case "$RC" in
        0) ;;
        1) finish_fail "the harness reported at least one failed check (see the FAIL lines above)" ;;
        *) finish_usage "the harness stopped with exit $RC (bad options or a crash; see above)" ;;
      esac
      [ "$LAST" = "RESULT: 23 passed, 0 failed" ] || finish_fail "the last line is '$LAST', expected 'RESULT: 23 passed, 0 failed'"
      finish_ok
    fi
    [ $# -eq 2 ] && [ "$1" = "--link" ] && [ -n "$2" ] || finish_usage "readonly mode takes exactly: --link <url> (no write and no optional check is allowed here)"
    run_harness --link "$2"
    harness_verdict $?
    ;;
  full)
    HAVE=" "
    for a in "$@"; do
      case "$a" in
        --link|--link-b|--member-link|--revoked-link|--demoted-link|--write) HAVE="$HAVE$a " ;;
        --*) finish_usage "full mode does not accept $a" ;;
      esac
    done
    for need in --link --link-b --member-link --revoked-link --demoted-link --write; do
      case "$HAVE" in *" $need "*) ;; *) finish_usage "full mode needs $need (all 24 checks run only with all six options)" ;; esac
    done
    run_harness "$@"
    harness_verdict $?
    ;;
  run)
    [ $# -ge 2 ] || finish_usage "run needs at least --link <url>"
    run_harness "$@"
    harness_verdict $?
    ;;
  *)
    finish_usage "unknown mode '$MODE' (use selftest, readonly, full or run)"
    ;;
esac
