#!/usr/bin/env bash
# BR-126 and BR-127 (PROJEXA-BUILD-001, phase 1): checks on surface_matrix.json, selected by a mode argument.
#
#   cells   (BR-126)  the matrix has 28 cells = 7 record types x 4 surfaces, one cell per (record type, surface) pair, each cell
#                     has the keys status, record_id and verify_command (verify_command is a non-empty string), and every
#                     cell status is `unproven`.
#                     Exit 0 prints:  SURFACE_CELLS_OK cells=28 unproven=28
#   tables  (BR-127)  the record types are the owner's seven in this order: daily_work_progress, rfi, punch_list, change_order,
#                     billing_claim, boq_progress, exception; record_type_tables lists the same seven in the same order; the
#                     exception type maps to a non-null description of the underlying flagged record and not to a new table name.
#                     Exit 0 prints:  SURFACE_TABLES_OK types=7 exception=non-null
#
# Exit 1 = a check failed (reasons on stderr). Exit 2 = usage error or a missing prerequisite.
# The last stderr line is `PASS BR-126`, `PASS BR-127` or `FAIL <id>: <reason>`.
#
# Usage: bash scripts/verify/surface-matrix.sh cells|tables
# Environment: PKG_DIR (default: ai-os/projexa-build-001 under the repo root), SURFACE_FILE (default: $PKG_DIR/surface_matrix.json).
set -u

ID="BR-126/BR-127"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PKG_DIR="${PKG_DIR:-$ROOT/ai-os/projexa-build-001}"
SURFACE_FILE="${SURFACE_FILE:-$PKG_DIR/surface_matrix.json}"

finish_ok()    { printf '%s\n' "$1"; printf 'PASS %s\n' "$ID" >&2; exit 0; }
finish_fail()  { printf 'FAIL %s: %s\n' "$ID" "$1" >&2; exit 1; }
finish_usage() { printf 'FAIL %s: %s\n' "$ID" "$1" >&2; exit 2; }

PY=""
for c in python python3; do
  if "$c" -c 'import sys' >/dev/null 2>&1; then PY="$c"; break; fi
done
[ -n "$PY" ] || finish_usage "python is not available on PATH"
winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

[ $# -eq 1 ] || finish_usage "usage: surface-matrix.sh cells|tables"
MODE="$1"
case "$MODE" in
  cells)  ID="BR-126" ;;
  tables) ID="BR-127" ;;
  *) finish_usage "unknown mode '$MODE' (use cells or tables)" ;;
esac
[ -f "$SURFACE_FILE" ] || finish_usage "matrix file not found: $SURFACE_FILE"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/check.py" <<'PYEOF'
import json
import re
import sys

mode, path = sys.argv[1], sys.argv[2]
OWNER_TYPES = ["daily_work_progress", "rfi", "punch_list", "change_order", "billing_claim", "boq_progress", "exception"]


def die(msg):
    print("BAD " + msg)
    sys.exit(1)


try:
    doc = json.loads(open(path, encoding="utf-8-sig").read())
except Exception:
    die("the file is not valid JSON")
if not isinstance(doc, dict):
    die("the top level is not an object")
problems = []

if mode == "cells":
    cells = doc.get("cells")
    if not isinstance(cells, list):
        die("'cells' is missing or is not a list")
    types = doc.get("record_types")
    surfaces = doc.get("surfaces")
    if not isinstance(types, list) or not isinstance(surfaces, list):
        die("'record_types' or 'surfaces' is missing")
    if len(cells) != 28:
        problems.append("%d cells, expected 28" % len(cells))
    if len(types) * len(surfaces) != 28:
        problems.append("%d record types x %d surfaces is not 28" % (len(types), len(surfaces)))
    pairs = []
    unproven = 0
    for n, cell in enumerate(cells):
        if not isinstance(cell, dict):
            problems.append("cell %d is not an object" % n)
            continue
        for key in ("status", "record_id", "verify_command"):
            if key not in cell:
                problems.append("cell %d has no '%s' key" % (n, key))
        vc = cell.get("verify_command")
        if not isinstance(vc, str) or not vc.strip():
            problems.append("cell %d has an empty verify_command" % n)
        if cell.get("status") == "unproven":
            unproven += 1
        else:
            problems.append("cell %d status is %r, not 'unproven'" % (n, cell.get("status")))
        pairs.append((cell.get("record_type"), cell.get("surface")))
    if len(set(pairs)) != len(pairs):
        problems.append("a (record_type, surface) pair appears twice")
    want = {(t, s) for t in types for s in surfaces}
    if set(pairs) != want:
        problems.append("the cells do not cover the record types x surfaces cross product exactly")
    if problems:
        die("; ".join(problems[:6]))
    print("OK cells=%d unproven=%d" % (len(cells), unproven))
elif mode == "tables":
    types = doc.get("record_types")
    tables = doc.get("record_type_tables")
    if types != OWNER_TYPES:
        problems.append("record_types is %s, expected the owner's seven in order" % json.dumps(types))
    if not isinstance(tables, dict) or list(tables.keys()) != OWNER_TYPES:
        problems.append("record_type_tables keys are not the owner's seven in order")
    exception = tables.get("exception") if isinstance(tables, dict) else None
    if not isinstance(exception, str) or not exception.strip():
        problems.append("the exception type maps to null or an empty value")
    elif re.fullmatch(r"[a-z_]+\.[a-z_]+", exception.strip()):
        problems.append("the exception type maps to a table name (%s), which would be a new table" % exception.strip())
    if problems:
        die("; ".join(problems[:6]))
    print("OK types=%d exception=non-null" % len(types))
PYEOF

RESULT="$("$PY" "$(winpath "$TMP/check.py")" "$MODE" "$(winpath "$SURFACE_FILE")" 2>"$TMP/py.err")"
if [ "${RESULT#OK }" != "$RESULT" ]; then
  if [ "$MODE" = "cells" ]; then finish_ok "SURFACE_CELLS_OK ${RESULT#OK }"; else finish_ok "SURFACE_TABLES_OK ${RESULT#OK }"; fi
fi
if [ "${RESULT#BAD }" != "$RESULT" ]; then finish_fail "${RESULT#BAD }"; fi
finish_usage "the check program stopped unexpectedly: $(head -c 300 "$TMP/py.err" 2>/dev/null)"
