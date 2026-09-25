#!/usr/bin/env bash
# BR-121 (PROJEXA-BUILD-001, phase 1): CRON_PLACEMENT.csv classifies every declared Vercel cron -- 29 in the
# compliance-tracker vercel.json and 1 in the projexa vercel.json -- with the five-value enum
# {PG_CRON, EDGE_FN_VIA_PG_CRON, GITHUB_ACTIONS, VERCEL, KILL}, and at least one row is PG_CRON or EDGE_FN_VIA_PG_CRON.
#
# Exit 0 = all checks hold. stdout is exactly one line (numbers are the measured ones):
#   CRON_PLACEMENT_OK vercel_rows=30 bad_enum=0
# Exit 1 = a check failed (reasons on stderr). Exit 2 = usage error or a missing prerequisite.
# The last stderr line is `PASS BR-121` or `FAIL BR-121: <reason>`.
#
# Checks:
#   - the header has the columns repo, path_or_name, classification.
#   - a Vercel row is a row whose path_or_name starts with `vercel.json cron `; the rest of the cell is the cron path.
#   - bad_enum = rows (of all rows) whose classification, trimmed, is not exactly one of the five values. A suffixed value such as
#     `GITHUB_ACTIONS (existing)` counts as bad: the file must hold the normalised value.
#   - the number of PG_CRON plus EDGE_FN_VIA_PG_CRON rows is above 0.
#   - the Vercel rows of each repo name exactly the cron paths of that repo's vercel.json on main (no path twice, none missing, none extra).
#
# Usage: bash scripts/verify/cron-placement.sh
# Environment: PKG_DIR (default: ai-os/projexa-build-001 under the repo root), CRON_FILE (default: $PKG_DIR/CRON_PLACEMENT.csv),
#   CT_VERCEL_JSON / PX_VERCEL_JSON (saved vercel.json files; skip the git and network reads),
#   CT_REF (default: origin/main, then main, then HEAD), PX_REF (default: main).
set -u

ID="BR-121"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PKG_DIR="${PKG_DIR:-$ROOT/ai-os/projexa-build-001}"
CRON_FILE="${CRON_FILE:-$PKG_DIR/CRON_PLACEMENT.csv}"

finish_ok()    { printf '%s\n' "$1"; printf 'PASS %s\n' "$ID" >&2; exit 0; }
finish_fail()  { printf 'FAIL %s: %s\n' "$ID" "$1" >&2; exit 1; }
finish_usage() { printf 'FAIL %s: %s\n' "$ID" "$1" >&2; exit 2; }

PY=""
for c in python python3; do
  if "$c" -c 'import sys' >/dev/null 2>&1; then PY="$c"; break; fi
done
[ -n "$PY" ] || finish_usage "python is not available on PATH"
winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

[ $# -eq 0 ] || finish_usage "this script takes no arguments"
[ -f "$CRON_FILE" ] || finish_usage "placement file not found: $CRON_FILE"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

CT_JSON="${CT_VERCEL_JSON:-}"
if [ -z "$CT_JSON" ]; then
  CT_USED=""
  for r in ${CT_REF:-origin/main main HEAD}; do
    if git -C "$ROOT" rev-parse --verify --quiet "$r^{commit}" >/dev/null 2>&1; then CT_USED="$r"; break; fi
  done
  [ -n "$CT_USED" ] || finish_usage "no compliance-tracker git ref found"
  git -C "$ROOT" show "$CT_USED:vercel.json" > "$TMP/ct-vercel.json" 2>/dev/null || finish_usage "git could not read vercel.json at $CT_USED"
  CT_JSON="$TMP/ct-vercel.json"
elif [ ! -f "$CT_JSON" ]; then
  finish_usage "CT_VERCEL_JSON not found: $CT_JSON"
fi

PX_JSON="${PX_VERCEL_JSON:-}"
if [ -z "$PX_JSON" ]; then
  command -v gh >/dev/null 2>&1 || finish_usage "gh is not installed and PX_VERCEL_JSON was not given"
  gh api -H "Accept: application/vnd.github.raw" "repos/FChecklist/projexa/contents/vercel.json?ref=${PX_REF:-main}" > "$TMP/px-vercel.json" 2>/dev/null \
    || finish_usage "gh api could not read the projexa vercel.json"
  PX_JSON="$TMP/px-vercel.json"
elif [ ! -f "$PX_JSON" ]; then
  finish_usage "PX_VERCEL_JSON not found: $PX_JSON"
fi

cat > "$TMP/check.py" <<'PYEOF'
import csv
import io
import json
import re
import sys

cron_csv, ct_json, px_json = sys.argv[1:4]
ENUM = {"PG_CRON", "EDGE_FN_VIA_PG_CRON", "GITHUB_ACTIONS", "VERCEL", "KILL"}
PREFIX = "vercel.json cron "


def die(msg):
    print("BAD " + msg)
    sys.exit(1)


raw = open(cron_csv, encoding="utf-8-sig", newline="").read().replace("\r\n", "\n")
rows = list(csv.reader(io.StringIO(raw)))
if not rows:
    die("the file is empty")
header = [h.strip() for h in rows[0]]
for col in ("repo", "path_or_name", "classification"):
    if col not in header:
        die("the header has no '%s' column" % col)
i_repo, i_path, i_class = header.index("repo"), header.index("path_or_name"), header.index("classification")
data = [r for r in rows[1:] if r]
problems = []
for n, r in enumerate(data, start=2):
    if len(r) != len(header):
        problems.append("row %d has %d cells, the header has %d" % (n, len(r), len(header)))
data = [r for r in data if len(r) == len(header)]

bad_enum = sum(1 for r in data if r[i_class].strip() not in ENUM)
placed = sum(1 for r in data if r[i_class].strip() in ("PG_CRON", "EDGE_FN_VIA_PG_CRON"))
if placed < 1:
    problems.append("no row is PG_CRON or EDGE_FN_VIA_PG_CRON")
if bad_enum:
    bad_values = sorted({r[i_class].strip() for r in data if r[i_class].strip() not in ENUM})
    problems.append("bad_enum=%d (values: %s)" % (bad_enum, ", ".join(repr(v) for v in bad_values[:4])))

csv_paths = {"compliance-tracker": [], "projexa": []}
vercel_rows = 0
for r in data:
    cell = r[i_path]
    if not cell.startswith(PREFIX):
        continue
    vercel_rows += 1
    repo = r[i_repo].strip()
    if repo not in csv_paths:
        problems.append("Vercel row for unknown repo '%s'" % repo)
        continue
    csv_paths[repo].append(cell[len(PREFIX):].strip())


def live_paths(path, label):
    try:
        doc = json.loads(open(path, encoding="utf-8-sig").read())
    except Exception:
        die("%s vercel.json is not valid JSON" % label)
    crons = doc.get("crons", [])
    return [c.get("path", "") for c in crons]


live = {"compliance-tracker": live_paths(ct_json, "compliance-tracker"), "projexa": live_paths(px_json, "projexa")}
for repo in ("compliance-tracker", "projexa"):
    mine, theirs = csv_paths[repo], live[repo]
    if len(set(mine)) != len(mine):
        problems.append("%s: a cron path appears twice in the file" % repo)
    if len(set(theirs)) != len(theirs):
        problems.append("%s: a cron path appears twice in vercel.json" % repo)
    missing = sorted(set(theirs) - set(mine))
    extra = sorted(set(mine) - set(theirs))
    if missing:
        problems.append("%s: %d crons in vercel.json have no row (%s)" % (repo, len(missing), ", ".join(missing[:3])))
    if extra:
        problems.append("%s: %d rows are not crons in vercel.json (%s)" % (repo, len(extra), ", ".join(extra[:3])))

if problems:
    die("; ".join(problems[:6]))
print("OK vercel_rows=%d bad_enum=%d" % (vercel_rows, bad_enum))
PYEOF

RESULT="$("$PY" "$(winpath "$TMP/check.py")" "$(winpath "$CRON_FILE")" "$(winpath "$CT_JSON")" "$(winpath "$PX_JSON")" 2>"$TMP/py.err")"
if [ "${RESULT#OK }" != "$RESULT" ]; then finish_ok "CRON_PLACEMENT_OK ${RESULT#OK }"; fi
if [ "${RESULT#BAD }" != "$RESULT" ]; then finish_fail "${RESULT#BAD }"; fi
finish_usage "the check program stopped unexpectedly: $(head -c 300 "$TMP/py.err" 2>/dev/null)"
