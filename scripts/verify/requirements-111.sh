#!/usr/bin/env bash
# BR-115 (PROJEXA-BUILD-001, phase 1): REQUIREMENTS_111_REGISTER.csv holds all 111 requirement ids -- 80 register rows
# (R- ids) plus EXC-ITEM-01 to EXC-ITEM-31 (three of them META) -- the 80 R- ids equal the ids in the live table
# platform.sumeet_requirements, and nothing in the file refers to platform.sumeet_gap.
#
# Exit 0 = all checks hold. stdout is exactly one line:
#   REQ111_OK exc=31 meta=3 live_missing=0 live_extra=0 gap_refs=0
# Exit 1 = a check failed (reasons on stderr). Exit 2 = usage error or a missing prerequisite.
# The last stderr line is `PASS BR-115` or `FAIL BR-115: <reason>`.
#
# Checks on the file (always): header starts with req_id; 111 distinct ids, each R-<letters or digits> or EXC-ITEM-<2 digits>;
#   exactly 80 R- ids; the EXC-ITEM ids are 01 to 31; the rows whose title ends in (META) are EXC-ITEM-29, -30, -31;
#   zero lines mention sumeet_gap.
# Live comparison (default): two read-only SELECTs through scripts/verify/sql-assert.mjs against verdian-ai
#   (needs node, node_modules and VERIFY_DATABASE_URL). live_missing = ids in the file that the table lacks;
#   live_extra = ids in the table that the file lacks. The id column is `id` (LIVE_ID_COLUMN overrides it).
#
# Usage: bash scripts/verify/requirements-111.sh [--offline | --live-ids <file>]
#   --offline         skip the live comparison; stdout then says live_missing=skipped live_extra=skipped (not the register line)
#   --live-ids <file> read the live ids from a file (one per line) instead of the database
# Environment: PKG_DIR (default: ai-os/projexa-build-001 under the repo root), REQ_FILE (default: $PKG_DIR/REQUIREMENTS_111_REGISTER.csv).
set -u

ID="BR-115"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PKG_DIR="${PKG_DIR:-$ROOT/ai-os/projexa-build-001}"
REQ_FILE="${REQ_FILE:-$PKG_DIR/REQUIREMENTS_111_REGISTER.csv}"
LIVE_ID_COLUMN="${LIVE_ID_COLUMN:-id}"
case "$LIVE_ID_COLUMN" in
  *[!a-z_]*|"") printf 'FAIL BR-115: LIVE_ID_COLUMN must be lower-case letters and underscores\n' >&2; exit 2 ;;
esac

finish_ok()    { printf '%s\n' "$1"; printf 'PASS %s%s\n' "$ID" "${2:-}" >&2; exit 0; }
finish_fail()  { printf 'FAIL %s: %s\n' "$ID" "$1" >&2; exit 1; }
finish_usage() { printf 'FAIL %s: %s\n' "$ID" "$1" >&2; exit 2; }

PY=""
for c in python python3; do
  if "$c" -c 'import sys' >/dev/null 2>&1; then PY="$c"; break; fi
done
[ -n "$PY" ] || finish_usage "python is not available on PATH"
winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

MODE="live"
LIVE_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --offline)  MODE="offline"; shift ;;
    --live-ids) [ $# -ge 2 ] || finish_usage "--live-ids needs a file"; MODE="file"; LIVE_FILE="$2"; shift 2 ;;
    *) finish_usage "unknown argument: $1" ;;
  esac
done
[ -f "$REQ_FILE" ] || finish_usage "register file not found: $REQ_FILE"
if [ "$MODE" = "file" ] && [ ! -f "$LIVE_FILE" ]; then finish_usage "live ids file not found: $LIVE_FILE"; fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/check.py" <<'PYEOF'
import csv
import io
import re
import sys

mode, path = sys.argv[1], sys.argv[2]
raw = open(path, encoding="utf-8-sig", newline="").read().replace("\r\n", "\n")
rows = list(csv.reader(io.StringIO(raw)))
if not rows or not rows[0] or rows[0][0] != "req_id":
    print("BAD the header row does not start with req_id")
    sys.exit(1)
data = [r for r in rows[1:] if r]
ids = [r[0].strip() for r in data]

problems = []
if len(data) != 111:
    problems.append("%d data rows, expected 111" % len(data))
if len(set(ids)) != len(ids):
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    problems.append("duplicate ids: %s" % ",".join(dupes[:5]))
for i in ids:
    if not re.fullmatch(r"R-[0-9A-Z]+|EXC-ITEM-\d{2}", i):
        problems.append("id '%s' is neither R-<code> nor EXC-ITEM-<nn>" % i)
r_ids = [i for i in ids if i.startswith("R-")]
exc_ids = [i for i in ids if i.startswith("EXC-ITEM-")]
if len(r_ids) != 80:
    problems.append("%d R- ids, expected 80" % len(r_ids))
want_exc = ["EXC-ITEM-%02d" % n for n in range(1, 32)]
if sorted(exc_ids) != want_exc:
    problems.append("EXC-ITEM ids are not exactly 01 to 31 (found %d)" % len(exc_ids))
meta = sorted(r[0].strip() for r in data if r[0].strip().startswith("EXC-ITEM-") and len(r) > 2 and r[2].rstrip().endswith("(META)"))
if meta != ["EXC-ITEM-29", "EXC-ITEM-30", "EXC-ITEM-31"]:
    problems.append("META rows are %s, expected EXC-ITEM-29, -30, -31" % (",".join(meta) or "none"))
gap_refs = sum(1 for line in raw.split("\n") if re.search("sumeet_gap", line, re.IGNORECASE))
if gap_refs != 0:
    problems.append("%d lines mention sumeet_gap" % gap_refs)

if mode == "check":
    if problems:
        print("BAD " + "; ".join(problems[:6]))
        sys.exit(1)
    print("OK exc=%d meta=%d gap_refs=%d" % (len(exc_ids), len(meta), gap_refs))
elif mode == "ids":
    print("\n".join(r_ids))
elif mode == "compare":
    live = set(x.strip() for x in open(sys.argv[3], encoding="utf-8-sig").read().split("\n") if x.strip())
    mine = set(r_ids)
    print("missing=%d extra=%d" % (len(mine - live), len(live - mine)))
    if mine - live:
        print("missing_ids=" + ",".join(sorted(mine - live)[:8]))
    if live - mine:
        print("extra_ids=" + ",".join(sorted(live - mine)[:8]))
PYEOF

CHECK="$("$PY" "$(winpath "$TMP/check.py")" check "$(winpath "$REQ_FILE")" 2>"$TMP/py.err")"
if [ "${CHECK#BAD }" != "$CHECK" ]; then finish_fail "${CHECK#BAD }"; fi
[ "${CHECK#OK }" != "$CHECK" ] || finish_usage "the check program stopped unexpectedly: $(head -c 300 "$TMP/py.err" 2>/dev/null)"
SUMMARY="${CHECK#OK }"          # exc=31 meta=3 gap_refs=0
EXC_META="${SUMMARY% gap_refs=*}"  # exc=31 meta=3
GAP="gap_refs=${SUMMARY##*gap_refs=}"

if [ "$MODE" = "offline" ]; then
  finish_ok "REQ111_OK $EXC_META live_missing=skipped live_extra=skipped $GAP" " (offline: the live comparison was skipped)"
fi

if [ "$MODE" = "file" ]; then
  CMP="$("$PY" "$(winpath "$TMP/check.py")" compare "$(winpath "$REQ_FILE")" "$(winpath "$LIVE_FILE")" 2>"$TMP/py.err")"
  MISSING="$(printf '%s\n' "$CMP" | sed -n 's/^missing=\([0-9]*\) extra=[0-9]*$/\1/p')"
  EXTRA="$(printf '%s\n' "$CMP" | sed -n 's/^missing=[0-9]* extra=\([0-9]*\)$/\1/p')"
  [ -n "$MISSING" ] && [ -n "$EXTRA" ] || finish_usage "the comparison program stopped unexpectedly"
else
  command -v node >/dev/null 2>&1 || finish_usage "node is not on PATH (needed for scripts/verify/sql-assert.mjs)"
  [ -n "${VERIFY_DATABASE_URL:-}" ] || finish_usage "cannot run the live comparison: VERIFY_DATABASE_URL is not set (use --offline or --live-ids <file>)"
  IDLIST="$("$PY" "$(winpath "$TMP/check.py")" ids "$(winpath "$REQ_FILE")" | tr -d '\r' | sed "s/.*/'&'/" | paste -sd, -)"
  [ -n "$IDLIST" ] || finish_usage "no R- ids to compare"
  RUNNER="$(winpath "$ROOT/scripts/verify/sql-assert.mjs")"
  SQL_MISSING="select count(*) from unnest(array[$IDLIST]) as v(rid) where v.rid not in (select $LIVE_ID_COLUMN from platform.sumeet_requirements)"
  SQL_EXTRA="select count(*) from platform.sumeet_requirements where $LIVE_ID_COLUMN not in ($IDLIST)"
  MISSING="$(node "$RUNNER" --project ct --sql "$SQL_MISSING" --equals 0 2>"$TMP/sql1.err")"; RC1=$?
  EXTRA="$(node "$RUNNER" --project ct --sql "$SQL_EXTRA" --equals 0 2>"$TMP/sql2.err")"; RC2=$?
  for rc in $RC1 $RC2; do
    case "$rc" in 0|1) ;; *) finish_usage "the live query could not run (sql-assert exit $rc): $(head -c 200 "$TMP/sql1.err" "$TMP/sql2.err" 2>/dev/null | tr '\n' ' ')" ;; esac
  done
  MISSING="$(printf '%s' "$MISSING" | tr -d '\r\n ')"
  EXTRA="$(printf '%s' "$EXTRA" | tr -d '\r\n ')"
fi

if [ "$MISSING" != "0" ] || [ "$EXTRA" != "0" ]; then
  finish_fail "the file and the live table differ: live_missing=$MISSING live_extra=$EXTRA"
fi
finish_ok "REQ111_OK $EXC_META live_missing=$MISSING live_extra=$EXTRA $GAP"
