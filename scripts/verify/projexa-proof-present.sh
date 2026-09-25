#!/usr/bin/env bash
# BR-308 (PROJEXA-BUILD-001, phase 3, PMD-31): the proof of a few register requirements is a test or a Playwright spec that lives in
# the FChecklist/projexa repository, not in this one (R-15 and R-31: the BOQ view spec; R-92: two component tests). A verify_command
# on platform.sumeet_requirements runs from this repository's root, so for those rows it calls this script: it reads the named file
# from projexa main through the GitHub API and counts the lines that contain a fixed string. PRESENCE ONLY, exactly like R-B1's git grep: it proves
# the named spec or test still exists on projexa main and still names the requirement; it does not run it (Playwright runs only in
# CI). Deleting or renaming the spec or test makes the row's command fail.
#
# Usage: bash scripts/verify/projexa-proof-present.sh <path in the projexa repo> <fixed string> [--min <n>] [--from-file <local file>]
#   --min n            at least n lines must contain the fixed string (default 1)
#   --from-file <file> read the local file instead of GitHub (used by the self-test of this script)
# Environment: PROJEXA_REPO (default FChecklist/projexa), PROJEXA_REF (default main).
#
# Exit 0 = at least n lines contain the string; stdout is exactly one line:
#   PROJEXA_PROOF_PRESENT path=<path> count=<k>
# Exit 1 = the file is there but the string occurs fewer than n times (or the file does not exist on that ref: the API answers 404).
# Exit 2 = usage error, or gh is missing or could not answer.
# The last stderr line is `PASS BR-308` or `FAIL BR-308: <reason>`.
set -u

ID="BR-308"
finish_ok()    { printf '%s\n' "$1"; printf 'PASS %s\n' "$ID" >&2; exit 0; }
finish_fail()  { printf 'FAIL %s: %s\n' "$ID" "$1" >&2; exit 1; }
finish_usage() { printf 'FAIL %s: %s\n' "$ID" "$1" >&2; exit 2; }

[ $# -ge 2 ] || finish_usage "usage: projexa-proof-present.sh <path in the projexa repo> <fixed string> [--min <n>] [--from-file <file>]"
FILE_PATH="$1"; NEEDLE="$2"; shift 2
MIN=1
FROM=""
while [ $# -gt 0 ]; do
  case "$1" in
    --min)       [ $# -ge 2 ] || finish_usage "--min needs a number"; MIN="$2"; shift 2 ;;
    --from-file) [ $# -ge 2 ] || finish_usage "--from-file needs a file"; FROM="$2"; shift 2 ;;
    *) finish_usage "unknown argument: $1" ;;
  esac
done
case "$MIN" in ''|*[!0-9]*) finish_usage "--min must be a whole number" ;; esac
[ -n "$NEEDLE" ] || finish_usage "the fixed string must not be empty"
case "$FILE_PATH" in /*|*..*|"") finish_usage "the path must be relative and hold no .." ;; esac

REPO="${PROJEXA_REPO:-FChecklist/projexa}"
REF="${PROJEXA_REF:-main}"
TMP="$(mktemp)"
trap 'rm -f "$TMP" "$TMP.err"' EXIT

if [ -n "$FROM" ]; then
  [ -f "$FROM" ] || finish_usage "file not found: $FROM"
  cp "$FROM" "$TMP"
else
  command -v gh >/dev/null 2>&1 || finish_usage "gh is not on PATH"
  if ! gh api "repos/$REPO/contents/$FILE_PATH?ref=$REF" -H "Accept: application/vnd.github.raw" >"$TMP" 2>"$TMP.err"; then
    if grep -q -E "HTTP 404|Not Found" "$TMP.err" 2>/dev/null; then
      finish_fail "$FILE_PATH does not exist on $REPO@$REF"
    fi
    finish_usage "gh could not read $FILE_PATH from $REPO@$REF: $(head -c 200 "$TMP.err" | tr '\n' ' ')"
  fi
fi

COUNT="$(grep -c -F -- "$NEEDLE" "$TMP" 2>/dev/null || true)"
COUNT="${COUNT:-0}"
if [ "$COUNT" -lt "$MIN" ]; then
  finish_fail "only $COUNT line(s) of $FILE_PATH contain the string, expected at least $MIN"
fi
finish_ok "PROJEXA_PROOF_PRESENT path=$FILE_PATH count=$COUNT"
