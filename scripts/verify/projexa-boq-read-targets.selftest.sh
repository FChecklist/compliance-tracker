#!/usr/bin/env bash
# register: BR-419
#
# Self-test for scripts/verify/projexa-boq-read-targets.sh (PROJEXA-BUILD-001 U-33). A count of 0 GETs only means something if the script is
# known to count a GET when one is there. This builds throwaway copies of the three projexa files in a temp directory, plants each shape of
# request, and checks the exit code and the last stdout line.
#
# Cases: clean components with only PATCH, POST and DELETE calls; each GET shape planted alone (fetchJson with a generic, fetchJson with a
# template holding a nested template, fetch with only a cache option, fetch with method GET in each quote style); the same text inside a
# comment and inside a string (must not count); a PATCH and a POST to /api/scope (must not count); a dynamic method (not counted, reported);
# a GET to another path (must not count); a GET in each file and in both (2); the gateway constant missing, wrong, and twice; a component
# file missing; two components with no fetch call at all (must exit 2, not pass); an unknown argument.
#
# No network and no real file of projexa is used. Exit 0 prints, as the last line:  SELFTEST PASS: <n> cases
# Exit 1 prints, as the last line:  SELFTEST FAIL: <k> of <n> cases failed
# Env TARGET_SCRIPT points the test at a different copy of the script (used to prove this test can fail: plant a broken counter in a copy and
# the self-test must go red).
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${TARGET_SCRIPT:-$HERE/projexa-boq-read-targets.sh}"
[ -f "$TARGET" ] || { echo "SELFTEST FAIL: script not found: $TARGET" >&2; exit 2; }
# The script finds its counter next to itself; a copy elsewhere needs the lib folder beside it.
if [ ! -f "$(dirname "$TARGET")/lib/count-api-scope-gets.mjs" ]; then
  echo "SELFTEST FAIL: no lib/count-api-scope-gets.mjs beside $TARGET" >&2; exit 2
fi

T="$(mktemp -d)" || { echo "SELFTEST FAIL: no temp directory" >&2; exit 2; }
trap 'rm -rf "$T"' EXIT
NCASE=0
NFAIL=0

URL="https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-read"
CONST_OK="export const BOQ_READ_GATEWAY_URL = \"$URL\""

# mk <dir> <ScopeObjectClient body> <BoqDualViewGrid body> <constant file body>
mk() {
  mkdir -p "$1/src/components" "$1/src/lib"
  printf '%s\n' "$2" > "$1/src/components/ScopeObjectClient.tsx"
  printf '%s\n' "$3" > "$1/src/components/BoqDualViewGrid.tsx"
  [ -n "${4-}" ] && printf '%s\n' "$4" > "$1/src/lib/boq-gateway-client.ts"
  return 0
}

# One PATCH so the "no fetch at all" guard has something to count in the clean baseline.
WRITE_ONLY='async function save(id) { const res = await fetch(`/api/scope/line-items/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" }); return res.ok }
async function make() { return fetch("/api/scope/categories", { method: "POST" }) }
async function drop(id) { return fetch(`/api/scope/${id}`, { method: "DELETE" }) }'
GRID_CLEAN='async function patch(id) { return fetch(`/api/scope/line-items/${id}`, { method: "PATCH", body: "{}" }) }'

# run NAME EXPECT_RC EXPECT_LAST DIR [extra args]
run() {
  local name="$1" want_rc="$2" want_last="$3" dir="$4"; shift 4
  NCASE=$((NCASE+1))
  local out rc last
  out="$(bash "$TARGET" --from-dir "$dir" "$@" 2>/dev/null)"; rc=$?
  last="$(printf '%s' "$out" | tail -n 1)"
  if [ "$rc" -eq "$want_rc" ] && { [ -z "$want_last" ] || [ "$last" = "$want_last" ]; }; then
    printf 'ok   %s\n' "$name"
  else
    NFAIL=$((NFAIL+1))
    printf 'FAIL %s: exit %s (want %s), last line "%s" (want "%s")\n' "$name" "$rc" "$want_rc" "$last" "$want_last"
  fi
}

# --- clean baseline ---------------------------------------------------------------------------------------------------------------
D="$T/clean"; mk "$D" "$WRITE_ONLY" "$GRID_CLEAN" "$CONST_OK"
run "clean components: only PATCH, POST and DELETE to /api/scope" 0 "api_scope_get=0 gateway_const=1" "$D"

# --- each GET shape, planted alone -------------------------------------------------------------------------------------------------
plant() {   # plant NAME GETCODE [file: soc|grid]
  local name="$1" code="$2" which="${3:-soc}" d="$T/p-$NCASE-x"
  if [ "$which" = "soc" ]; then mk "$d" "$WRITE_ONLY
$code" "$GRID_CLEAN" "$CONST_OK"; else mk "$d" "$WRITE_ONLY" "$GRID_CLEAN
$code" "$CONST_OK"; fi
  run "$name" 1 "api_scope_get=1 gateway_const=1" "$d"
}
plant "GET: fetchJson with a generic type" 'const a = await fetchJson<Boq & { lineItems: Row[] }>(`/api/scope/${boqId}`)'
plant "GET: fetchJson with a generic holding => and nested braces" 'const a = await fetchJson<{ f: () => void; g: { h: string[] } }>(`/api/scope/${boqId}/compare`)'
plant "GET: fetchJson with a template holding a nested template" 'const a = await fetchJson(`/api/scope?projectId=${encodeURIComponent(`${a}-${b}`)}`)'
plant "GET: fetch with only a cache option" 'const r = await fetch(`/api/scope/${boqId}${view ? `?view=${view}` : ""}`, { cache: "no-store" })'
plant "GET: fetch with no options" 'const r = await fetch("/api/scope/list")'
plant "GET: explicit method GET, double quotes" 'const r = await fetch(`/api/scope/${id}`, { method: "GET" })'
plant "GET: explicit method get, single quotes" "const r = await fetch(\`/api/scope/\${id}\`, { method: 'get' })"
plant "GET: in BoqDualViewGrid too" 'const r = await fetch(`/api/scope/${boqId}`, { cache: "no-store" })' grid
plant "GET: the URL on its own line after the call opens" 'const a = await fetchJson<{ x: 1 }>(
  `/api/scope/${boqId}`
)'

# --- shapes that must NOT count -----------------------------------------------------------------------------------------------------
notgets() {  # notgets NAME CODE
  local name="$1" code="$2" d="$T/n-$NCASE-x"
  mk "$d" "$WRITE_ONLY
$code" "$GRID_CLEAN" "$CONST_OK"
  run "$name" 0 "api_scope_get=0 gateway_const=1" "$d"
}
notgets "not a GET: the request is in a line comment" '// const r = await fetch(`/api/scope/${id}`)'
notgets "not a GET: the request is in a block comment" '/* const r = await fetchJson(`/api/scope/${id}`) */'
notgets "not a GET: the request text is inside a string" 'const t = "await fetch(`/api/scope/x`)"'
notgets "not a GET: the request text is inside a template" 'const t = `call fetch("/api/scope/x") later`'
notgets "not a GET: a PATCH" 'const r = await fetch(`/api/scope/${id}`, { method: "PATCH", body: "{}" })'
notgets "not a GET: a POST with the method after the headers" 'const r = await fetch("/api/scope/import", { headers: { a: "b" }, method: "POST" })'
notgets "not a GET: a GET to another path" 'const r = await fetchJson("/api/vendors")'
notgets "not a GET: a method that is only a variable is reported, not counted" 'const r = await fetch(path, { method })'
notgets "not a GET: a route helper that only has fetch in its name" 'router.prefetch(`/api/scope/${id}`)'

# --- two files -----------------------------------------------------------------------------------------------------------------------
D="$T/both"; mk "$D" "$WRITE_ONLY
const a = await fetchJson(\`/api/scope/\${id}\`)" "$GRID_CLEAN
const b = await fetch(\`/api/scope/\${id}\`, { cache: 'no-store' })" "$CONST_OK"
run "GETs in both components add up" 1 "api_scope_get=2 gateway_const=1" "$D"

# --- the gateway constant ------------------------------------------------------------------------------------------------------------
D="$T/c1"; mk "$D" "$WRITE_ONLY" "$GRID_CLEAN" ""
run "constant: the file is missing" 1 "api_scope_get=0 gateway_const=0" "$D"
D="$T/c2"; mk "$D" "$WRITE_ONLY" "$GRID_CLEAN" 'export const BOQ_READ_GATEWAY_URL = "https://example.invalid/functions/v1/projexa-read"'
run "constant: the URL is another address" 1 "api_scope_get=0 gateway_const=0" "$D"
D="$T/c3"; mk "$D" "$WRITE_ONLY" "$GRID_CLEAN" "$CONST_OK
$CONST_OK"
run "constant: defined twice" 1 "api_scope_get=0 gateway_const=0" "$D"
D="$T/c4"; mk "$D" "$WRITE_ONLY" "$GRID_CLEAN" "const BOQ_READ_GATEWAY_URL = \"$URL\""
run "constant: not exported under the exact statement" 1 "api_scope_get=0 gateway_const=0" "$D"
D="$T/c5"; mk "$D" "$WRITE_ONLY" "$GRID_CLEAN" "// $CONST_OK"
run "constant: only in a comment does not count" 1 "api_scope_get=0 gateway_const=0" "$D"

# --- files and guards ----------------------------------------------------------------------------------------------------------------
D="$T/m1"; mk "$D" "$WRITE_ONLY" "$GRID_CLEAN" "$CONST_OK"; rm "$D/src/components/BoqDualViewGrid.tsx"
run "a component file is missing" 1 "api_scope_get=-1 gateway_const=0" "$D"
D="$T/m2"; mk "$D" "export const x = 1" "export const y = 2" "$CONST_OK"
run "no fetch call at all in the components exits 2, it is not a pass" 2 "" "$D"
D="$T/m3"; mk "$D" "$WRITE_ONLY" "$GRID_CLEAN" "$CONST_OK"
run "an unknown argument is a usage error" 2 "" "$D" --nope

if [ "$NFAIL" -eq 0 ]; then
  echo "SELFTEST PASS: $NCASE cases"
  exit 0
fi
echo "SELFTEST FAIL: $NFAIL of $NCASE cases failed"
exit 1
