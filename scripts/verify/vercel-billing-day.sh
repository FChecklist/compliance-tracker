#!/usr/bin/env bash
# BR-116 (PROJEXA-BUILD-001, phase 1): read-only billing check for ONE Vercel billing day of the team
# team_Iqx3zyb7sDdsdzcNskCFFsHD (CLI scope veridian-ai-os). Sums billedCost of one service for that day and compares it
# with an expected value. A billing day is Pacific time and runs 07:00:00Z to 07:00:00Z of the next UTC day (Pacific daylight time).
#
# Exit 0 = the sum, rounded to --precision decimals (default 4), equals the expectation (default 0) rounded the same way,
#          or is within --tolerance of it when that option is given. stdout is exactly one line: the sum, e.g. `0.0000`.
# Exit 1 = the sum differs from the expectation, or the response is not for the requested window, or it holds no rows.
# Exit 2 = usage error (bad start time, window longer or shorter than one day, a day that has not begun, unknown option) or the billing data could not be read.
# The last stderr line is `PASS BR-116` or `FAIL BR-116: <reason>`.
#
# How it reads: one call to `vercel usage --scope <scope> --from <day> --to <day> --format json` through the authenticated
# Vercel CLI (GET only; the CLI treats --from and --to as Los Angeles midnight to end of day, which is the 07:00Z window).
# The CLI's other route for the same data, `vercel api /v1/billing/charges`, returns JSON Lines that the CLI cannot parse, so it is not used.
# The response period must equal the requested window exactly. The script starts nothing, changes nothing, toggles nothing.
#
# Usage: bash scripts/verify/vercel-billing-day.sh <start> [<service>] [--expect <n>] [--precision <n>] [--tolerance <x>] [--end <time>]
#   <start>      YYYY-MM-DDT07:00:00Z, the first instant of the billing day
#   <service>    service name, exact match (default: Speed Insights Plus)
#   --expect     expected sum (default 0)
#   --precision  decimals used for the printed sum and the comparison (default 4)
#   --tolerance  compare |sum - expect| <= x instead of comparing rounded values
#   --end        the end of the window; must be <start> plus exactly one day, otherwise exit 2 (multi-day windows are refused)
# Environment: VERCEL_BIN (default: vercel), VERCEL_SCOPE (default: veridian-ai-os).
# Acceptance runs: day 2026-09-24T07:00:00Z --expect 0.645161 --precision 6 exits 0 and prints 0.645161;
#                  the date-gated day 2026-09-26T07:00:00Z with the default expectation exits 0 and prints 0.0000.
set -u

ID="BR-116"
VERCEL_BIN="${VERCEL_BIN:-vercel}"
VERCEL_SCOPE="${VERCEL_SCOPE:-veridian-ai-os}"

finish_ok()    { printf '%s\n' "$1"; printf 'PASS %s\n' "$ID" >&2; exit 0; }
finish_fail()  { printf 'FAIL %s: %s\n' "$ID" "$1" >&2; exit 1; }
finish_usage() { printf 'FAIL %s: %s\n' "$ID" "$1" >&2; exit 2; }

PY=""
for c in python python3; do
  if "$c" -c 'import sys' >/dev/null 2>&1; then PY="$c"; break; fi
done
[ -n "$PY" ] || finish_usage "python is not available on PATH"
winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

START=""
SERVICE=""
EXPECT="0"
PRECISION="4"
TOLERANCE=""
END=""
POS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --expect)    [ $# -ge 2 ] || finish_usage "--expect needs a value";    EXPECT="$2";    shift 2 ;;
    --precision) [ $# -ge 2 ] || finish_usage "--precision needs a value"; PRECISION="$2"; shift 2 ;;
    --tolerance) [ $# -ge 2 ] || finish_usage "--tolerance needs a value"; TOLERANCE="$2"; shift 2 ;;
    --end)       [ $# -ge 2 ] || finish_usage "--end needs a value";       END="$2";       shift 2 ;;
    --*) finish_usage "unknown option: $1" ;;
    *)
      POS=$((POS + 1))
      if [ "$POS" -eq 1 ]; then START="$1"; elif [ "$POS" -eq 2 ]; then SERVICE="$1"; else finish_usage "too many arguments"; fi
      shift ;;
  esac
done
[ -n "$START" ] || finish_usage "usage: vercel-billing-day.sh <YYYY-MM-DDT07:00:00Z> [<service>] [--expect n] [--precision n] [--tolerance x] [--end time]"
[ -n "$SERVICE" ] || SERVICE="Speed Insights Plus"
case "$PRECISION" in ''|*[!0-9]*) finish_usage "--precision must be a whole number" ;; esac
[ "$PRECISION" -ge 0 ] && [ "$PRECISION" -le 9 ] || finish_usage "--precision must be between 0 and 9"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Window arithmetic and the comparison are done in python (Decimal, no floating point).
cat > "$TMP/window.py" <<'PYEOF'
import datetime
import re
import sys

start, end = sys.argv[1], sys.argv[2]
m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})T07:00:00Z", start)
if not m:
    print("BADSTART")
    sys.exit(0)
try:
    day = datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
except ValueError:
    print("BADSTART")
    sys.exit(0)
nxt = day + datetime.timedelta(days=1)
want_end = "%sT07:00:00Z" % nxt.isoformat()
if end and end != want_end:
    print("BADEND " + want_end)
    sys.exit(0)
started = datetime.datetime(day.year, day.month, day.day, 7, tzinfo=datetime.timezone.utc)
if started > datetime.datetime.now(datetime.timezone.utc):
    print("FUTURE")
    sys.exit(0)
print("OK %s %s" % (day.isoformat(), want_end))
PYEOF

WIN="$("$PY" "$(winpath "$TMP/window.py")" "$START" "$END" 2>/dev/null)"
case "$WIN" in
  BADSTART*) finish_usage "the start must be a real date in the form YYYY-MM-DDT07:00:00Z (a Pacific billing day starts at 07:00:00Z), got '$START'" ;;
  BADEND*)   finish_usage "the window must be exactly one day: --end has to be ${WIN#BADEND } for start $START, got '$END'" ;;
  FUTURE*)   finish_usage "the billing day starting $START has not begun; a zero sum for a future day proves nothing" ;;
  "OK "*)    : ;;
  *)         finish_usage "could not compute the window" ;;
esac
DAY="$(printf '%s' "$WIN" | cut -d' ' -f2)"
WANT_END="$(printf '%s' "$WIN" | cut -d' ' -f3)"

# The single billing read. The CLI prints a plugin hint on stderr; stderr is discarded.
"$VERCEL_BIN" usage --scope "$VERCEL_SCOPE" --from "$DAY" --to "$DAY" --format json > "$TMP/usage.json" 2>/dev/null
RC=$?
[ $RC -eq 0 ] || finish_usage "vercel usage failed with exit $RC (is the Vercel CLI installed and logged in?)"

cat > "$TMP/sum.py" <<'PYEOF'
import json
import re
import sys
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

path, start, want_end, service, expect, precision, tolerance = sys.argv[1:8]
try:
    data = json.loads(open(path, encoding="utf-8-sig").read(), parse_float=Decimal, parse_int=Decimal)
    period = data["period"]
    services = data["services"]
    assert isinstance(services, list)
except Exception:
    print("BADDATA the response is not the expected JSON (period, services)")
    sys.exit(0)


def norm(stamp):
    return re.sub(r"\.\d+Z$", "Z", str(stamp))


if norm(period.get("from")) != start or norm(period.get("to")) != want_end:
    print("MISMATCH the response covers %s to %s, not %s to %s" % (period.get("from"), period.get("to"), start, want_end))
    sys.exit(0)
if not services:
    print("EMPTY the response has no billing rows for the day, so a zero sum would prove nothing")
    sys.exit(0)
if data.get("pricingUnit", "USD") != "USD":
    print("MISMATCH pricingUnit is %s, not USD" % data.get("pricingUnit"))
    sys.exit(0)

rows = [s for s in services if s.get("name") == service]
total = sum((Decimal(str(s.get("billedCost", 0))) for s in rows), Decimal(0))
step = Decimal(1).scaleb(-int(precision))
shown = total.quantize(step, rounding=ROUND_HALF_UP)
try:
    wanted = Decimal(expect)
except InvalidOperation:
    print("BADDATA --expect is not a number")
    sys.exit(0)
if tolerance:
    try:
        holds = abs(total - wanted) <= Decimal(tolerance)
    except InvalidOperation:
        print("BADDATA --tolerance is not a number")
        sys.exit(0)
else:
    holds = shown == wanted.quantize(step, rounding=ROUND_HALF_UP)
note = "" if rows else " (no row named '%s' in the response; treated as 0)" % service
print("%s %s %s%s" % ("SAME" if holds else "DIFF", format(shown, "f"), format(wanted.quantize(step, rounding=ROUND_HALF_UP), "f"), note))
PYEOF

OUT="$("$PY" "$(winpath "$TMP/sum.py")" "$(winpath "$TMP/usage.json")" "$START" "$WANT_END" "$SERVICE" "$EXPECT" "$PRECISION" "$TOLERANCE" 2>/dev/null)"
case "$OUT" in
  BADDATA*)  finish_usage "${OUT#BADDATA }" ;;
  MISMATCH*) finish_fail "${OUT#MISMATCH }" ;;
  EMPTY*)    finish_fail "${OUT#EMPTY }" ;;
  SAME*|DIFF*) : ;;
  *)         finish_usage "could not read the billing response" ;;
esac
KIND="${OUT%% *}"
REST="${OUT#* }"
SHOWN="${REST%% *}"
REST2="${REST#* }"
WANTED="${REST2%% *}"
NOTE="${REST2#"$WANTED"}"
[ -z "$NOTE" ] || printf 'note:%s\n' "$NOTE" >&2
if [ "$KIND" = "SAME" ]; then
  finish_ok "$SHOWN"
fi
printf '%s\n' "$SHOWN"
finish_fail "service '$SERVICE' billed $SHOWN for the day starting $START, expected $WANTED"
