#!/usr/bin/env bash
# register: BR-225
# PROJEXA-BUILD-001 phase 2 (U-21, E-04, PMD-11): read-only count of the Vercel function invocations attributable to one
# route pattern over the last N complete billing days of one Vercel project.
#
# Exit 0 = the project ran functions in the window and none of the request log entries matches the pattern.
#          stdout last line: INVOCATIONS=0
# Exit 1 = at least one request log entry in the window matches the pattern. stdout last line: INVOCATIONS=<n>
# Exit 2 = no data, or the window cannot be covered. stdout last line: INVOCATIONS=unknown (not printed for a usage error).
#          Cases: Vercel reports no function usage for the project in the window, which is what a locked project looks
#          like (paused, deploys ignored, PMD-11): a zero then proves nothing, so BR-225 stays blocked_owner; the request
#          logs are empty or do not reach into the first billing day of the window (retention), or stop at the read
#          limit; the response is for another window; a usage error; a CLI failure.
# The last stderr line is `PASS BR-225` or `FAIL BR-225: <reason>`.
#
# How it reads: two GET-only calls through the authenticated Vercel CLI; stderr of each is discarded (the CLI prints a
# plugin hint there). Nothing is started, changed or toggled.
#   1. vercel usage --scope <scope> --from <first day> --to <last day> --group-by project --format json
#      Billing data has no route dimension. It gives the project's "Function Invocations" cost for the window (USD), which
#      says whether the project ran any function at all. No row for the project, or a zero cost, is "no data" (exit 2).
#   2. vercel logs --project <project> --scope <scope> --no-branch --since <window start> --until <window end> --json
#      --limit <L>
#      The request log carries requestPath and source per request. An entry counts when its path, with the query string
#      removed, matches the pattern (shell-style: * ? [..]) and its source is not "static". Function and middleware
#      entries both count, so the count errs toward non-zero. --no-branch stops the CLI from filtering by the git branch of
#      the directory it runs in.
#   Coverage: the entries must reach into the first billing day of the window and their number must stay below L;
#   otherwise part of the window is unread and the result is exit 2, not a zero. Log retention depends on the Vercel plan
#   (a read on 2026-09-25 returned entries about 6 days old), so a long window can end in exit 2 for that reason alone.
#   The CLI pages slowly: on 2026-09-25 it returned 500 entries in 108 s and 10,000 in about 600 s, so a busy window takes
#   minutes. The whole log of the window is read on purpose, not a server-side path filter, because the coverage test needs
#   the earliest entry of any path. Measured run, 2026-09-25, window 2026-09-18..2026-09-24 of veridian-compliance-ai:
#   billing showed function invocations (0.000798 USD), the log read stopped at the 10,000 limit, exit 2.
# Window: the N complete Pacific billing days ending with --end-day (default: the last complete one). A billing day runs
# 07:00Z to 07:00Z in daylight time and 08:00Z to 08:00Z in winter; the usage response's period must be exactly those days.
#
# Usage: bash scripts/verify/vercel-invocations.sh <route pattern> <days> [--end-day YYYY-MM-DD]
#   <route pattern>  path starting with /, for example /api/internal/exchange-rate-refresh/run
#   <days>           whole number 1..31
#   --end-day        last billing day of the window (Pacific date); must be complete
# Environment: VERCEL_BIN (default vercel), VERCEL_SCOPE (default veridian-ai-os), VERCEL_PROJECT (default
#              veridian-compliance-ai, the project that serves /api/internal/*), VERCEL_LOG_LIMIT (default 10000).
set -u

ID="BR-225"
VERCEL_BIN="${VERCEL_BIN:-vercel}"
VERCEL_SCOPE="${VERCEL_SCOPE:-veridian-ai-os}"
VERCEL_PROJECT="${VERCEL_PROJECT:-veridian-compliance-ai}"
VERCEL_LOG_LIMIT="${VERCEL_LOG_LIMIT:-10000}"

finish_ok()      { printf '%s\n' "$1"; printf 'PASS %s\n' "$ID" >&2; exit 0; }
finish_fail()    { printf '%s\n' "$1"; printf 'FAIL %s: %s\n' "$ID" "$2" >&2; exit 1; }
finish_nodata()  { printf 'INVOCATIONS=unknown\n'; printf 'FAIL %s: %s\n' "$ID" "$1" >&2; exit 2; }
finish_usage()   { printf 'FAIL %s: %s\n' "$ID" "$1" >&2; exit 2; }

PY=""
for c in python python3; do
  if "$c" -c 'import sys' >/dev/null 2>&1; then PY="$c"; break; fi
done
[ -n "$PY" ] || finish_usage "python is not available on PATH"
winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

PATTERN=""
DAYS=""
END_DAY=""
POS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --end-day) [ $# -ge 2 ] || finish_usage "--end-day needs a value"; END_DAY="$2"; shift 2 ;;
    --*) finish_usage "unknown option: $1" ;;
    *)
      POS=$((POS + 1))
      if [ "$POS" -eq 1 ]; then PATTERN="$1"; elif [ "$POS" -eq 2 ]; then DAYS="$1"; else finish_usage "too many arguments"; fi
      shift ;;
  esac
done
[ -n "$PATTERN" ] && [ -n "$DAYS" ] || finish_usage "usage: vercel-invocations.sh <route pattern> <days> [--end-day YYYY-MM-DD]"
case "$PATTERN" in /*) : ;; *) finish_usage "the route pattern must start with /, got '$PATTERN'" ;; esac
case "$DAYS" in ''|*[!0-9]*) finish_usage "<days> must be a whole number, got '$DAYS'" ;; esac
[ "$DAYS" -ge 1 ] && [ "$DAYS" -le 31 ] || finish_usage "<days> must be between 1 and 31, got $DAYS"
case "$VERCEL_LOG_LIMIT" in ''|*[!0-9]*) finish_usage "VERCEL_LOG_LIMIT must be a whole number" ;; esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/window.py" <<'PYEOF'
import datetime
import re
import sys

days, end_day = int(sys.argv[1]), sys.argv[2]
now = datetime.datetime.now(datetime.timezone.utc)
if end_day:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", end_day):
        print("BAD --end-day must be YYYY-MM-DD")
        sys.exit(0)
    try:
        last = datetime.date.fromisoformat(end_day)
    except ValueError:
        print("BAD --end-day is not a real date")
        sys.exit(0)
else:
    # 8 hours back is the Pacific date or the day before it, in both daylight and winter time; minus one day is complete
    last = (now - datetime.timedelta(hours=8)).date() - datetime.timedelta(days=1)
closes = datetime.datetime(last.year, last.month, last.day, 8, tzinfo=datetime.timezone.utc) + datetime.timedelta(days=1)
if closes > now:
    print("BAD the billing day %s is not complete yet (it ends by %s)" % (last.isoformat(), closes.strftime("%Y-%m-%dT%H:%M:%SZ")))
    sys.exit(0)
first = last - datetime.timedelta(days=days - 1)
print("OK %s %s %s" % (first.isoformat(), last.isoformat(), (last + datetime.timedelta(days=1)).isoformat()))
PYEOF

WIN="$("$PY" "$(winpath "$TMP/window.py")" "$DAYS" "$END_DAY" 2>/dev/null)"
case "$WIN" in
  "OK "*) : ;;
  BAD*)   finish_usage "${WIN#BAD }" ;;
  *)      finish_usage "could not compute the window" ;;
esac
FIRST="$(printf '%s' "$WIN" | cut -d' ' -f2)"
LAST="$(printf '%s' "$WIN" | cut -d' ' -f3)"
AFTER="$(printf '%s' "$WIN" | cut -d' ' -f4)"

# Read 1: billing, grouped by project.
"$VERCEL_BIN" usage --scope "$VERCEL_SCOPE" --from "$FIRST" --to "$LAST" --group-by project --format json > "$TMP/usage.json" 2>/dev/null
RC=$?
[ $RC -eq 0 ] || finish_usage "vercel usage failed with exit $RC (is the Vercel CLI installed and logged in?)"

cat > "$TMP/usage.py" <<'PYEOF'
import json
import re
import sys

path, first, after, project = sys.argv[1:5]
try:
    data = json.loads(open(path, encoding="utf-8-sig").read())
    period = data["period"]
    groups = data["groupBy"]["data"]
    assert data["groupBy"].get("dimension") == "project"
    assert isinstance(groups, list)
except Exception:
    print("BADDATA the usage response is not the expected JSON (period, groupBy.dimension=project, groupBy.data)")
    sys.exit(0)


def norm(stamp):
    return re.sub(r"\.\d+Z$", "Z", str(stamp))


starts = {"%sT07:00:00Z" % first, "%sT08:00:00Z" % first}
ends = {"%sT07:00:00Z" % after, "%sT08:00:00Z" % after}
if norm(period.get("from")) not in starts or norm(period.get("to")) not in ends:
    print("BADDATA the usage response covers %s to %s, not the billing days %s to the day before %s" % (period.get("from"), period.get("to"), first, after))
    sys.exit(0)
mine = [g for g in groups if g.get("name") == project]
if not mine:
    print("NODATA Vercel reports no usage row for project %s from %s to %s: the project is locked or unknown, so a zero count would prove nothing" % (project, norm(period["from"]), norm(period["to"])))
    sys.exit(0)
cost = 0.0
for g in mine:
    for s in g.get("services") or []:
        if s.get("name") == "Function Invocations":
            cost += float(s.get("pricingQuantity") or 0) + float(s.get("billedCost") or 0)
if cost <= 0:
    print("NODATA Vercel reports zero function invocations for project %s from %s to %s: the project is locked (PMD-11), so a zero count for the route would prove nothing" % (project, norm(period["from"]), norm(period["to"])))
    sys.exit(0)
fi_cost = sum(float(s.get("billedCost") or 0) for g in mine for s in (g.get("services") or []) if s.get("name") == "Function Invocations")
print("OK %s %s %.7f" % (norm(period["from"]), norm(period["to"]), fi_cost))
PYEOF

U="$("$PY" "$(winpath "$TMP/usage.py")" "$(winpath "$TMP/usage.json")" "$FIRST" "$AFTER" "$VERCEL_PROJECT" 2>/dev/null)"
case "$U" in
  "OK "*)    : ;;
  NODATA*)   finish_nodata "${U#NODATA }" ;;
  BADDATA*)  finish_nodata "${U#BADDATA }" ;;
  *)         finish_nodata "could not read the usage response" ;;
esac
W_FROM="$(printf '%s' "$U" | cut -d' ' -f2)"
W_TO="$(printf '%s' "$U" | cut -d' ' -f3)"
FI_COST="$(printf '%s' "$U" | cut -d' ' -f4)"
echo "window: $W_FROM to $W_TO ($DAYS billing days), project $VERCEL_PROJECT, scope $VERCEL_SCOPE"
echo "billing: project Function Invocations cost $FI_COST USD in the window (the project ran functions; billing has no route dimension)"

# Read 2: request logs for the same window.
"$VERCEL_BIN" logs --project "$VERCEL_PROJECT" --scope "$VERCEL_SCOPE" --no-branch --since "$W_FROM" --until "$W_TO" --json --limit "$VERCEL_LOG_LIMIT" > "$TMP/logs.jsonl" 2>/dev/null
RC=$?
[ $RC -eq 0 ] || finish_nodata "vercel logs failed with exit $RC"

cat > "$TMP/logs.py" <<'PYEOF'
import datetime
import fnmatch
import json
import sys

path, w_from, w_to, pattern, limit = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5])
if not pattern.startswith("/"):
    print("BADDATA the route pattern arrived as %r, not as a path starting with / (shell path conversion?)" % pattern)
    sys.exit(0)


def ms(stamp):
    return int(datetime.datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)


lo, hi = ms(w_from), ms(w_to)
first_day_end = lo + 24 * 3600 * 1000
lines = [l for l in open(path, encoding="utf-8-sig").read().splitlines() if l.strip()]
entries, bad = [], 0
for l in lines:
    try:
        d = json.loads(l)
        t = int(float(d["timestamp"]))
        entries.append((t, str(d.get("requestPath") or ""), str(d.get("source") or "")))
    except Exception:
        bad += 1
if lines and not entries:
    print("BADDATA the log output has %d lines and none is a JSON log entry with a timestamp" % len(lines))
    sys.exit(0)
if len(lines) >= limit:
    print("NOCOVER the log read returned %d lines, the limit; older entries of the window may be missing (raise VERCEL_LOG_LIMIT)" % len(lines))
    sys.exit(0)
inside = [e for e in entries if lo <= e[0] < hi]
if not inside:
    print("NOCOVER the project ran functions in the window but the request log returned no entry for it (retention or access); zero cannot be shown")
    sys.exit(0)
earliest = min(e[0] for e in inside)
stamp = lambda t: datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
if earliest >= first_day_end:
    print("NOCOVER the earliest request log entry is %s, after the first billing day of the window (%s to %s); that day is unread" % (stamp(earliest), w_from, stamp(first_day_end)))
    sys.exit(0)
hits = {}
n = 0
for t, p, src in inside:
    if src == "static":
        continue
    if fnmatch.fnmatchcase(p.split("?", 1)[0], pattern):
        n += 1
        hits[src or "(none)"] = hits.get(src or "(none)", 0) + 1
detail = ", ".join("%s=%d" % kv for kv in sorted(hits.items())) or "none"
print("OK %d %d %s %d %s" % (n, len(inside), stamp(earliest), bad, detail))
PYEOF

# Git Bash rewrites an argument that starts with / into a Windows path (/api/x -> C:/Program Files/Git/api/x) before a
# native program sees it; the two MSYS variables switch that off for this call, so the pattern reaches python unchanged.
L="$(MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' "$PY" "$(winpath "$TMP/logs.py")" "$(winpath "$TMP/logs.jsonl")" "$W_FROM" "$W_TO" "$PATTERN" "$VERCEL_LOG_LIMIT" 2>/dev/null)"
case "$L" in
  "OK "*)    : ;;
  NOCOVER*)  finish_nodata "${L#NOCOVER }" ;;
  BADDATA*)  finish_nodata "${L#BADDATA }" ;;
  *)         finish_nodata "could not read the request log output" ;;
esac
COUNT="$(printf '%s' "$L" | cut -d' ' -f2)"
READ="$(printf '%s' "$L" | cut -d' ' -f3)"
EARLIEST="$(printf '%s' "$L" | cut -d' ' -f4)"
SKIPPED="$(printf '%s' "$L" | cut -d' ' -f5)"
BYSRC="$(printf '%s' "$L" | cut -d' ' -f6-)"
echo "logs: $READ entries in the window, earliest $EARLIEST, $SKIPPED lines not JSON; matching $PATTERN by source: $BYSRC"
if [ "$COUNT" = "0" ]; then
  finish_ok "INVOCATIONS=0"
fi
finish_fail "INVOCATIONS=$COUNT" "$COUNT request(s) to $PATTERN on project $VERCEL_PROJECT between $W_FROM and $W_TO"
