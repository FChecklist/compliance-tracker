#!/usr/bin/env bash
# BR-122 (PROJEXA-BUILD-001, phase 1): EDGE_CANDIDATES.csv exists and every row is classified MOVE_TO_EDGE, STAY or KILL
# with a non-empty reason.
#
# Exit 0 = the file has at least one data row and no row is bad. stdout is exactly one line (numbers are the measured ones):
#   EDGE_CANDIDATES_OK rows=35 bad=0
# Exit 1 = a row is bad or the file has no data rows (reasons on stderr). Exit 2 = usage error or the file is missing.
# The last stderr line is `PASS BR-122` or `FAIL BR-122: <reason>`.
#
# A row is bad when its classification, trimmed, is not exactly MOVE_TO_EDGE, STAY or KILL, when its reason is empty after
# trimming, or when it has a different number of cells than the header. The header must contain classification and reason.
#
# Usage: bash scripts/verify/edge-candidates.sh
# Environment: PKG_DIR (default: ai-os/projexa-build-001 under the repo root), EDGE_FILE (default: $PKG_DIR/EDGE_CANDIDATES.csv).
set -u

ID="BR-122"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PKG_DIR="${PKG_DIR:-$ROOT/ai-os/projexa-build-001}"
EDGE_FILE="${EDGE_FILE:-$PKG_DIR/EDGE_CANDIDATES.csv}"

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
[ -f "$EDGE_FILE" ] || finish_usage "candidates file not found: $EDGE_FILE"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/check.py" <<'PYEOF'
import csv
import io
import sys

ENUM = {"MOVE_TO_EDGE", "STAY", "KILL"}
raw = open(sys.argv[1], encoding="utf-8-sig", newline="").read().replace("\r\n", "\n")
rows = list(csv.reader(io.StringIO(raw)))
if not rows:
    print("BAD the file is empty")
    sys.exit(1)
header = [h.strip() for h in rows[0]]
for col in ("classification", "reason"):
    if col not in header:
        print("BAD the header has no '%s' column" % col)
        sys.exit(1)
i_class, i_reason = header.index("classification"), header.index("reason")
data = [r for r in rows[1:] if r]
if not data:
    print("BAD the file has no data rows")
    sys.exit(1)
reasons = []
bad = 0
for n, r in enumerate(data, start=2):
    if len(r) != len(header):
        bad += 1
        reasons.append("row %d has %d cells, expected %d" % (n, len(r), len(header)))
    elif r[i_class].strip() not in ENUM:
        bad += 1
        reasons.append("row %d classification '%s' is not MOVE_TO_EDGE, STAY or KILL" % (n, r[i_class].strip()))
    elif not r[i_reason].strip():
        bad += 1
        reasons.append("row %d has an empty reason" % n)
if bad:
    print("BAD bad=%d of %d rows: %s" % (bad, len(data), "; ".join(reasons[:4])))
    sys.exit(1)
print("OK rows=%d bad=0" % len(data))
PYEOF

RESULT="$("$PY" "$(winpath "$TMP/check.py")" "$(winpath "$EDGE_FILE")" 2>"$TMP/py.err")"
if [ "${RESULT#OK }" != "$RESULT" ]; then finish_ok "EDGE_CANDIDATES_OK ${RESULT#OK }"; fi
if [ "${RESULT#BAD }" != "$RESULT" ]; then finish_fail "${RESULT#BAD }"; fi
finish_usage "the check program stopped unexpectedly: $(head -c 300 "$TMP/py.err" 2>/dev/null)"
