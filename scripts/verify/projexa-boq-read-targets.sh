#!/usr/bin/env bash
# register: BR-419
#
# PROJEXA-BUILD-001 U-33, register row BR-419 (PMD-01): the BOQ client reads go through the Edge gateway. On projexa main, the two BOQ
# screen components (src/components/ScopeObjectClient.tsx and src/components/BoqDualViewGrid.tsx) must issue 0 GET requests to /api/scope
# (on 2026-09-25 they issued 4: ScopeObjectClient line 116, 143 and 146, BoqDualViewGrid line 195), and the gateway URL must be a code
# constant (src/lib/boq-gateway-client.ts, BOQ_READ_GATEWAY_URL), with no Vercel environment change.
#
# The three files are read from projexa main through the GitHub API (gh), the way scripts/verify/projexa-proof-present.sh reads a spec, and
# the GETs are counted by scripts/verify/lib/count-api-scope-gets.mjs (calls to fetch or fetchJson whose first argument is a literal that
# starts with /api/scope and whose options hold no method or method GET; comments and text inside strings are ignored).
#
# WHAT THIS DOES NOT PROVE. The GET reads did not disappear: they moved into src/lib/boq-read-source.ts, which the two components call, and
# that file still sends them when the switch BUILD001_BOQ_READ_VIA_GATEWAY is off (the default) and for the money grid, whose project-side
# cost columns the gateway never returns. This row proves where the components' requests are written, not what the running app sends; the
# running app is BR-422 (0 Vercel function invocations, needs an owner-released deploy).
#
# Usage: bash scripts/verify/projexa-boq-read-targets.sh [--from-dir <projexa checkout>]
#   --from-dir d   read the three files from a local checkout instead of GitHub (used by the self-test and to check a branch before merge)
# Environment: PROJEXA_REPO (default FChecklist/projexa), PROJEXA_REF (default main).
#
# Exit 0 when api_scope_get=0 and gateway_const=1. Stdout is exactly one line, the last line of the run:
#   api_scope_get=<n> gateway_const=<m>
#   n  the GET requests to /api/scope in the two components (-1 when a component file does not exist on that ref)
#   m  1 when src/lib/boq-gateway-client.ts holds exactly one line `export const BOQ_READ_GATEWAY_URL = "<the projexa-read URL>"`, else 0
# Exit 1 = a target is not met. Exit 2 = usage error, no gh or node, a file could not be read after retries, or the counter saw no
# fetch call at all in the two components (a count of 0 from a parser that read nothing would be a false pass).
# The last stderr line is `PASS BR-419` or `FAIL BR-419: <reason>`.
set -u

ID="BR-419"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COUNTER="$HERE/lib/count-api-scope-gets.mjs"
GATEWAY_URL="https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-read"
FILES_COMPONENT=("src/components/ScopeObjectClient.tsx" "src/components/BoqDualViewGrid.tsx")
FILE_CONST="src/lib/boq-gateway-client.ts"

finish_ok()    { printf '%s\n' "$1"; printf 'PASS %s\n' "$ID" >&2; exit 0; }
finish_fail()  { printf '%s\n' "$2"; printf 'FAIL %s: %s\n' "$ID" "$1" >&2; exit 1; }
finish_usage() { printf 'FAIL %s: %s\n' "$ID" "$1" >&2; exit 2; }

FROM_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --from-dir) [ $# -ge 2 ] || finish_usage "--from-dir needs a folder"; FROM_DIR="$2"; shift 2 ;;
    *) finish_usage "unknown argument: $1" ;;
  esac
done

command -v node >/dev/null 2>&1 || finish_usage "node is not on PATH"
[ -f "$COUNTER" ] || finish_usage "the counter is missing: $COUNTER"

REPO="${PROJEXA_REPO:-FChecklist/projexa}"
REF="${PROJEXA_REF:-main}"
TMP="$(mktemp -d)" || finish_usage "no temp directory"
trap 'rm -rf "$TMP"' EXIT

# fetch_file <path in the projexa repo> <local file>. Returns 0 read, 1 the file does not exist, 2 could not be read.
fetch_file() {
  local rel="$1" out="$2"
  if [ -n "$FROM_DIR" ]; then
    [ -f "$FROM_DIR/$rel" ] || return 1
    cp "$FROM_DIR/$rel" "$out"
    return 0
  fi
  command -v gh >/dev/null 2>&1 || return 2
  # This laptop's link to api.github.com times out now and then: three tries, five seconds apart. A 404 is an answer, so it stops at once.
  local tries=0
  until gh api "repos/$REPO/contents/$rel?ref=$REF" -H "Accept: application/vnd.github.raw" >"$out" 2>"$out.err"; do
    if grep -q -E "HTTP 404|Not Found" "$out.err" 2>/dev/null; then return 1; fi
    tries=$((tries+1))
    if [ "$tries" -ge 3 ]; then
      printf 'could not read %s from %s@%s after %s tries: %s\n' "$rel" "$REPO" "$REF" "$tries" "$(head -c 200 "$out.err" | tr '\n' ' ')" >&2
      return 2
    fi
    sleep 5
  done
  return 0
}

if [ -z "$FROM_DIR" ] && ! command -v gh >/dev/null 2>&1; then finish_usage "gh is not on PATH"; fi

LOCAL=()
missing=""
for rel in "${FILES_COMPONENT[@]}"; do
  out="$TMP/$(printf '%s' "$rel" | tr '/' '_')"
  fetch_file "$rel" "$out"; rc=$?
  if [ "$rc" -eq 2 ]; then finish_usage "could not read $rel"; fi
  if [ "$rc" -eq 1 ]; then missing="$missing $rel"; continue; fi
  LOCAL+=("$out")
done
if [ -n "$missing" ]; then
  finish_fail "component file(s) not found on the ref:$missing" "api_scope_get=-1 gateway_const=0"
fi

CONST_FILE="$TMP/const.ts"
fetch_file "$FILE_CONST" "$CONST_FILE"; rc=$?
if [ "$rc" -eq 2 ]; then finish_usage "could not read $FILE_CONST"; fi
const_count=0
if [ "$rc" -eq 0 ]; then
  # The statement must start the line (a copy of it inside a comment does not count) and end there, with an optional semicolon.
  const_pattern="^export const BOQ_READ_GATEWAY_URL = \"${GATEWAY_URL//./\\.}\";?[[:space:]]*\$"
  const_count="$(grep -c -E "$const_pattern" "$CONST_FILE" 2>/dev/null || true)"
  const_count="${const_count:-0}"
fi
gateway_const=0
[ "$const_count" -eq 1 ] && gateway_const=1

COUNT_OUT="$(node "$COUNTER" "${LOCAL[@]}")" || finish_usage "the counter failed"
TOTAL_LINE="$(printf '%s\n' "$COUNT_OUT" | grep '^TOTAL ')"
gets="$(printf '%s' "$TOTAL_LINE" | sed -n 's/.* gets=\([0-9]*\).*/\1/p')"
calls="$(printf '%s' "$TOTAL_LINE" | sed -n 's/.* calls=\([0-9]*\).*/\1/p')"
dynamic="$(printf '%s' "$TOTAL_LINE" | sed -n 's/.* dynamic=\([0-9]*\).*/\1/p')"
[ -n "$gets" ] && [ -n "$calls" ] || finish_usage "the counter printed no total"
if [ "$calls" -lt 1 ]; then
  finish_usage "the counter saw no fetch call in the two components, so a count of 0 would prove nothing"
fi
printf 'calls_seen=%s dynamic_method=%s\n' "$calls" "${dynamic:-0}" >&2

LAST="api_scope_get=$gets gateway_const=$gateway_const"
if [ "$gets" -ne 0 ]; then finish_fail "$gets GET request(s) to /api/scope remain in the two components" "$LAST"; fi
if [ "$gateway_const" -ne 1 ]; then finish_fail "$FILE_CONST does not define BOQ_READ_GATEWAY_URL exactly once with the projexa-read URL (found $const_count line(s))" "$LAST"; fi
finish_ok "$LAST"
