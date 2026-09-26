#!/usr/bin/env bash
# register: BR-491 BR-492 BR-495 BR-496 BR-498 BR-499 (self-test of the scripts) and BR-490 (its environment-variable form)
# PROJEXA-BUILD-001 U-46b2: proves that each scripts/verify/awl-*.sh script (a) exits 2, never 0, when its environment variables are
# missing, (b) passes and prints its expected last line when the behaviour is there, and (c) exits 1 for each behaviour broken in turn.
# The "deployed function" is scripts/verify/awl-selftest-stub.mjs (a local node server, one broken rule per --mode); for the harness form
# of BR-490 it is the Python reference mock scripts/verify/ai-link/ai_link_mock_server.py. Only 127.0.0.1 is contacted. No database, no
# Vercel, no secret: the tokens used here are made up (pxa_ and one repeated hex letter).
# Cases print as `ok   <name>` and the last line is `SELFTEST PASS: <n> cases`. Exit 0 only when every case behaved as required.
# Takes about a minute (the rate-limit cases wait for a 2.5 second window three times).
# The real handler is proven separately, under bun, by src/lib/ai-links/conformance.edge.test.ts.
# Usage: bash scripts/verify/awl-scripts.selftest.sh
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
V="$ROOT/scripts/verify"
TMP="$(mktemp -d)"
STUB_PID=""
MOCK_PID=""
cleanup() {
  [ -n "$STUB_PID" ] && kill "$STUB_PID" 2>/dev/null
  [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null
  rm -rf "$TMP"
}
trap cleanup EXIT
pass=0; bad=0

command -v node >/dev/null 2>&1 || { echo "FAIL the self-test needs node on PATH"; exit 2; }
command -v curl >/dev/null 2>&1 || { echo "FAIL the self-test needs curl on PATH"; exit 2; }
PY=""
for c in python python3; do if "$c" -c 'import sys' >/dev/null 2>&1; then PY="$c"; break; fi; done

tok() { printf 'pxa_%s' "$(printf '%064d' 0 | tr '0' "$1")"; }
TA="$(tok a)"; TM="$(tok b)"; TBIG="$(tok c)"; TT="$(tok d)"; TD="$(tok e)"; TUNK="$(tok 9)"

stop_stub() { [ -n "$STUB_PID" ] && kill "$STUB_PID" 2>/dev/null; STUB_PID=""; }
# start_stub <modes> [window-ms]: sets BASE (the /fn root of the stub) and ORIGIN
start_stub() {
  stop_stub
  : > "$TMP/stub.out"
  node "$V/awl-selftest-stub.mjs" --mode "$1" --window-ms "${2:-60000}" > "$TMP/stub.out" 2>/dev/null &
  STUB_PID=$!
  local i port=""
  for i in $(seq 1 100); do
    port="$(sed -n 's/^PORT //p' "$TMP/stub.out" | head -n 1 | tr -d '\r')"
    [ -n "$port" ] && break
    sleep 0.1
  done
  [ -n "$port" ] || { echo "FAIL the stub did not start"; exit 2; }
  ORIGIN="http://127.0.0.1:$port"
  BASE="$ORIGIN/fn"
}

# check <name> <expected exit> <needle in stdout+stderr> -- <command...>   (the needle "" means none; runs with the current environment)
check() {
  local name="$1" want="$2" needle="$3" out rc
  shift 4
  out="$("$@" 2>&1)"; rc=$?
  if [ "$rc" = "$want" ] && { [ -z "$needle" ] || printf '%s' "$out" | grep -q -F -- "$needle"; }; then
    pass=$((pass + 1)); printf 'ok   %s\n' "$name"
  else
    bad=$((bad + 1)); printf 'FAIL %s (exit %s, wanted %s; needle "%s")\n' "$name" "$rc" "$want" "$needle"; printf '%s\n' "$out" | tail -n 12
  fi
}

# check_last <name> <expected exit> <exact last stdout line> -- <command...>
check_last() {
  local name="$1" want="$2" last="$3" out rc got
  shift 4
  out="$("$@" 2>/dev/null)"; rc=$?
  got="$(printf '%s\n' "$out" | tail -n 1 | tr -d '\r')"
  if [ "$rc" = "$want" ] && [ "$got" = "$last" ]; then
    pass=$((pass + 1)); printf 'ok   %s\n' "$name"
  else
    bad=$((bad + 1)); printf 'FAIL %s (exit %s, wanted %s; last line "%s", wanted "%s")\n' "$name" "$rc" "$want" "$got" "$last"
  fi
}

# no_token <name> -- <command...>: neither stdout nor stderr may hold a pxa_ token
no_token() {
  local name="$1" out
  shift 2
  out="$("$@" 2>&1)"
  if printf '%s' "$out" | grep -Eq 'pxa_[0-9a-f]{64}'; then
    bad=$((bad + 1)); printf 'FAIL %s (a token was printed)\n' "$name"
  else
    pass=$((pass + 1)); printf 'ok   %s\n' "$name"
  fi
}

# want_section <name>: AWL_SELFTEST_ONLY=<reach|rate|money|static|authority|page|harness> runs one section (used when a script is mutated on purpose)
want_section() { [ -z "${AWL_SELFTEST_ONLY:-}" ] || [ "$AWL_SELFTEST_ONLY" = "$1" ]; }

CLEAN_ENV="env -u AWL_LINK -u AWL_LINK_B -u AWL_LINK_M -u AWL_LINK_REVOKED -u AWL_LINK_DEMOTED -u AWL_LINK_BIG -u AWL_LINK_T -u AWL_LINK_T_ID -u AWL_F -u AWL_OWNER_JWT -u AWL_CONFIRM_HOST -u AWL_STATIC_SCHEME -u AWL_SQL_ASSERT -u AWL_RATE_WAIT -u VERIFY_DATABASE_URL -u VERIFY_SQL_MODE"

# ------------------------------------------------------------------------------------------------ BR-491 awl-reachability.sh
if want_section reach; then
S="$V/awl-reachability.sh"
check "reachability: no AWL_LINK exits 2" 2 "AWL_LINK" -- $CLEAN_ENV bash "$S"
start_stub ""
check_last "reachability: clean stub passes 8 of 8" 0 "AWL_REACH passed=8 failed=0" -- $CLEAN_ENV AWL_LINK="$BASE/$TA" bash "$S"
no_token "reachability: no token is printed" -- $CLEAN_ENV AWL_LINK="$BASE/$TA" bash "$S"
LONG="$BASE/$TA?pad=$(printf 'x%.0s' $(seq 1 260))"
check "reachability: a link over 250 characters fails H04" 1 "FAIL H04" -- $CLEAN_ENV AWL_LINK="$LONG" bash "$S"
check "reachability: an unresolvable host fails H06" 1 "FAIL H06" -- $CLEAN_ENV AWL_CURL_TIMEOUT=5 AWL_LINK="http://no-such-host.invalid/fn/$TA" bash "$S"
for m in "redirect:H05" "robots-open:H07" "ua-block:H08" "ctype-plain:H16" "no-cors:H17" "card-token:H19" "card-big:H19"; do
  start_stub "${m%%:*}"
  check "reachability: mode ${m%%:*} fails ${m##*:}" 1 "FAIL ${m##*:}" -- $CLEAN_ENV AWL_LINK="$BASE/$TA" bash "$S"
done
fi

# ------------------------------------------------------------------------------------------------ BR-492 awl-rate-limits.sh
if want_section rate; then
S="$V/awl-rate-limits.sh"
check "rate limits: no variables exits 2" 2 "AWL_LINK" -- $CLEAN_ENV bash "$S"
check "rate limits: only AWL_LINK exits 2" 2 "AWL_F" -- $CLEAN_ENV AWL_LINK="http://127.0.0.1:9/fn/$TA" bash "$S"
start_stub "" 2500
check_last "rate limits: clean stub answers 429 three times" 0 "AWL_RATE link_121st=429 unknown_31st=429 rotated_31st=429" -- $CLEAN_ENV AWL_LINK="$BASE/$TA" AWL_F="$BASE" AWL_RATE_WAIT=3 bash "$S"
start_stub "no-limit" 2500
check_last "rate limits: no throttle at all fails" 1 "AWL_RATE link_121st=200 unknown_31st=410 rotated_31st=410" -- $CLEAN_ENV AWL_LINK="$BASE/$TA" AWL_F="$BASE" AWL_RATE_WAIT=1 bash "$S"
start_stub "xff-bypass" 2500
check_last "rate limits: a rotated X-Forwarded-For that escapes the throttle fails" 1 "AWL_RATE link_121st=429 unknown_31st=429 rotated_31st=410" -- $CLEAN_ENV AWL_LINK="$BASE/$TA" AWL_F="$BASE" AWL_RATE_WAIT=3 bash "$S"
start_stub "" 2500
args=(); for _ in $(seq 1 130); do args+=(-o /dev/null "$BASE/$TA/context"); done
curl -s "${args[@]}" >/dev/null 2>&1
check "rate limits: a link whose minute was already used is not counted as a pass" 1 "already used" -- $CLEAN_ENV AWL_LINK="$BASE/$TA" AWL_F="$BASE" AWL_RATE_WAIT=3 bash "$S"
start_stub "" 2500
check "rate limits: skipping the wait between series is caught" 1 "rotated call was already 429" -- $CLEAN_ENV AWL_LINK="$BASE/$TA" AWL_F="$BASE" AWL_RATE_WAIT=0 bash "$S"
check "rate limits: a bad AWL_RATE_WAIT exits 2" 2 "AWL_RATE_WAIT" -- $CLEAN_ENV AWL_LINK="$BASE/$TA" AWL_F="$BASE" AWL_RATE_WAIT=soon bash "$S"
fi

# ------------------------------------------------------------------------------------------------ BR-495 awl-member-money.sh
if want_section money; then
S="$V/awl-member-money.sh"
check "member money: no AWL_LINK_M exits 2" 2 "AWL_LINK_M" -- $CLEAN_ENV bash "$S"
start_stub ""
check_last "member money: every money value null passes" 0 "AWL_MEMBER_MONEY non_null=0" -- $CLEAN_ENV AWL_LINK_M="$BASE/$TM" bash "$S"
no_token "member money: no token is printed" -- $CLEAN_ENV AWL_LINK_M="$BASE/$TM" bash "$S"
check "member money: a dead link is not a pass" 1 "must be 200" -- $CLEAN_ENV AWL_LINK_M="$BASE/$TUNK" bash "$S"
start_stub "member-leak"
check_last "member money: one leaked rate fails" 1 "AWL_MEMBER_MONEY non_null=1" -- $CLEAN_ENV AWL_LINK_M="$BASE/$TM" bash "$S"
start_stub "member-empty"
check "member money: an empty page proves nothing" 1 "holds no BOQ line" -- $CLEAN_ENV AWL_LINK_M="$BASE/$TM" bash "$S"
start_stub "member-manager"
check "member money: a link that can see money is not a member link" 1 "not a member-role link" -- $CLEAN_ENV AWL_LINK_M="$BASE/$TM" bash "$S"
fi

# ------------------------------------------------------------------------------------------------ BR-496 awl-static-pages.sh
if want_section static; then
S="$V/awl-static-pages.sh"
check "static pages: no AWL_CONFIRM_HOST exits 2" 2 "AWL_CONFIRM_HOST" -- $CLEAN_ENV bash "$S"
check "static pages: a host with a path exits 2" 2 "host name only" -- $CLEAN_ENV AWL_CONFIRM_HOST="example.com/x" bash "$S"
start_stub ""
HOSTP="${ORIGIN#http://}"
check_last "static pages: two pages, no Vercel header, two inputs passes" 0 "AWL_STATIC pages=2 vercel_headers=0 confirm_code=2" -- $CLEAN_ENV AWL_CONFIRM_HOST="$HOSTP" AWL_STATIC_SCHEME=http bash "$S"
start_stub "static-vercel"
check_last "static pages: an x-vercel-id header fails" 1 "AWL_STATIC pages=2 vercel_headers=1 confirm_code=2" -- $CLEAN_ENV AWL_CONFIRM_HOST="${ORIGIN#http://}" AWL_STATIC_SCHEME=http bash "$S"
start_stub "static-nocode"
check_last "static pages: a missing confirm-code input fails" 1 "AWL_STATIC pages=2 vercel_headers=0 confirm_code=1" -- $CLEAN_ENV AWL_CONFIRM_HOST="${ORIGIN#http://}" AWL_STATIC_SCHEME=http bash "$S"
start_stub "static-404"
check_last "static pages: a 404 page counts for nothing" 1 "AWL_STATIC pages=1 vercel_headers=0 confirm_code=1" -- $CLEAN_ENV AWL_CONFIRM_HOST="${ORIGIN#http://}" AWL_STATIC_SCHEME=http bash "$S"
fi

# ------------------------------------------------------------------------------------------------ BR-498 awl-live-authority.sh
if want_section authority; then
S="$V/awl-live-authority.sh"
cat > "$TMP/fake-sql-assert.mjs" <<'EOF'
// stands in for scripts/verify/sql-assert.mjs: reads the link id out of the SQL and asks the stub what the row says
const a = process.argv.slice(2)
const sql = a[a.indexOf("--sql") + 1] ?? ""
const want = a[a.indexOf("--equals") + 1]
const id = /id = '([A-Za-z0-9_-]+)'/.exec(sql)?.[1]
const res = await fetch(`${process.env.AWL_STUB_ORIGIN}/__state/links/${id}`)
const row = await res.json()
process.exit(row.status === want ? 0 : 1)
EOF
auth_env() { $CLEAN_ENV AWL_STUB_ORIGIN="$ORIGIN" AWL_F="$BASE" AWL_OWNER_JWT="owner-jwt-selftest" AWL_LINK_T_ID="lnk_throwaway_1" AWL_LINK_T="$BASE/$TT" AWL_LINK_D="$BASE/$TD" AWL_SQL_ASSERT="$TMP/fake-sql-assert.mjs" "$@"; }
check "live authority: no variables exits 2" 2 "AWL_F" -- $CLEAN_ENV bash "$S"
start_stub ""
check_last "live authority: revoke, 410, row revoked, demoted write 403 passes" 0 "AWL_AUTHORITY revoked_next_call=410 demoted_write=403" -- auth_env bash "$S"
start_stub ""
no_token "live authority: no token is printed" -- auth_env bash "$S"
start_stub ""
check "live authority: no database access exits 2 and revokes nothing" 2 "VERIFY_DATABASE_URL" -- $CLEAN_ENV AWL_F="$BASE" AWL_OWNER_JWT="owner-jwt-selftest" AWL_LINK_T_ID="lnk_throwaway_1" AWL_LINK_T="$BASE/$TT" AWL_LINK_D="$BASE/$TD" bash "$S"
check "live authority: the link is still live after that refusal" 0 "200" -- bash -c "test \"\$(curl -s -o /dev/null -w '%{http_code}' '$BASE/$TT/context')\" = 200 && echo 200"
check "live authority: an id with a quote exits 2" 2 "letters, digits" -- auth_env AWL_LINK_T_ID="x'; drop" bash "$S"
start_stub "revoke-noop"
check_last "live authority: a revoke that changes nothing fails" 1 "AWL_AUTHORITY revoked_next_call=200 demoted_write=403" -- auth_env bash "$S"
start_stub "revoke-401"
check "live authority: a revoke route that answers 401 fails" 1 "revoke route answered 401" -- auth_env bash "$S"
start_stub "row-active"
check "live authority: a row that does not read revoked fails" 1 "does not read revoked" -- auth_env bash "$S"
start_stub "t-never-live"
check "live authority: a link that was never live fails" 1 "never live" -- auth_env bash "$S"
start_stub "demoted-writes"
check_last "live authority: a demoted link that can still write fails" 1 "AWL_AUTHORITY revoked_next_call=410 demoted_write=201" -- auth_env bash "$S"
fi

# ------------------------------------------------------------------------------------------------ BR-499 awl-largest-page.sh
if want_section page; then
S="$V/awl-largest-page.sh"
check "largest page: no AWL_LINK_BIG exits 2" 2 "AWL_LINK_BIG" -- $CLEAN_ENV bash "$S"
start_stub ""
check_last "largest page: 200, fast, small passes" 0 "AWL_PAGE status=200 under_2s=yes under_1mb=yes" -- $CLEAN_ENV AWL_LINK_BIG="$BASE/$TBIG" bash "$S"
no_token "largest page: no token is printed" -- $CLEAN_ENV AWL_LINK_BIG="$BASE/$TBIG" bash "$S"
start_stub "big-slow"
check_last "largest page: 2.1 seconds fails" 1 "AWL_PAGE status=200 under_2s=no under_1mb=yes" -- $CLEAN_ENV AWL_LINK_BIG="$BASE/$TBIG" bash "$S"
start_stub "big-huge"
check_last "largest page: over 1 MB fails" 1 "AWL_PAGE status=200 under_2s=yes under_1mb=no" -- $CLEAN_ENV AWL_LINK_BIG="$BASE/$TBIG" bash "$S"
start_stub "big-500"
check_last "largest page: a 500 fails" 1 "AWL_PAGE status=500 under_2s=yes under_1mb=yes" -- $CLEAN_ENV AWL_LINK_BIG="$BASE/$TBIG" bash "$S"
start_stub "big-empty"
check "largest page: an empty page proves nothing" 1 "0 row(s)" -- $CLEAN_ENV AWL_LINK_BIG="$BASE/$TBIG" bash "$S"
stop_stub
fi

# ------------------------------------------------------------------------------------------------ BR-490 awl-harness.sh readonly, environment form
if want_section harness; then
S="$V/awl-harness.sh"
if [ -z "$PY" ]; then
  bad=$((bad + 1)); echo "FAIL harness: python is not available"
else
  PORT="$(node -e "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")"
  "$PY" "$V/ai-link/ai_link_mock_server.py" --port "$PORT" >/dev/null 2>&1 &
  MOCK_PID=$!
  MB="http://127.0.0.1:$PORT/functions/v1/ai-work-link"
  for _ in $(seq 1 100); do curl -s -o /dev/null "$MB/$TA" && break; sleep 0.2; done
  TR="$(tok d)"; TDEM="$(tok f)"
  harness_env() { $CLEAN_ENV AWL_LINK="$MB/$TA" AWL_LINK_B="$MB/$TBIG" AWL_LINK_M="$MB/$TM" AWL_LINK_REVOKED="$MB/$TR" AWL_LINK_DEMOTED="$MB/$TDEM" "$@"; }
  check_last "harness readonly: five links from the environment give 23 of 23" 0 "RESULT: 23 passed, 0 failed" -- harness_env bash "$S" readonly
  no_token "harness readonly: no token is printed" -- harness_env bash "$S" readonly
  check "harness readonly: a missing variable exits 2" 2 "AWL_LINK_DEMOTED" -- $CLEAN_ENV AWL_LINK="$MB/$TA" AWL_LINK_B="$MB/$TBIG" AWL_LINK_M="$MB/$TM" AWL_LINK_REVOKED="$MB/$TR" bash "$S" readonly
  check "harness readonly: no variables at all exits 2" 2 "AWL_LINK" -- $CLEAN_ENV bash "$S" readonly
  check "harness readonly: a live link handed over as the revoked one fails H19" 1 "FAIL H19" -- harness_env AWL_LINK_REVOKED="$MB/$TA" bash "$S" readonly
  check "harness readonly: the old form with --link still runs the 19 base checks" 0 "RESULT: 19 passed, 0 failed" -- $CLEAN_ENV bash "$S" readonly --link "$MB/$TA"
fi
fi

printf -- '----\n'
if [ "$bad" = "0" ]; then printf 'SELFTEST PASS: %s cases\n' "$pass"; exit 0; fi
printf 'SELFTEST FAIL: %s case(s) failed, %s passed\n' "$bad" "$pass"
exit 1
