#!/usr/bin/env bash
# register: BR-281
# PROJEXA-BUILD-001 phase 2 (U-44, U-48; audit defects A-04, A-14, A-23): checks on ai-os/projexa-build-001/
# ai_link_capability_matrix.json, the table of what each AI surface needs before it can use a PROJEXA work link.
#
# File shape read: top-level `families`, each with `surfaces`, each surface with `surface` (name), `confidence` and `cells`
# (cell name -> { v, label, confidence, ... }). Three checks:
#   (a) every cell whose v is `admin_or_maker_setup` (an admin, owner or maker installs it for other people) carries the key
#       `shared_identity_risk` with a true or false value. A cell that lacks it, or holds anything but a boolean, is unmarked.
#   (b) the surface whose name starts `Claude in Chrome` has cell L6_paste_back with v `one_time_user_setup`: pasting the
#       answer back into the page is a one-time step for the person, not zero setup (audit A-14). A missing surface or any
#       other value fails. The value found is printed.
#   (c) each surface's `confidence` equals the lowest `confidence` among its cells, DESIGN cells left out, under the order
#       UNVERIFIED < PARTLY_VERIFIED < VERIFIED_FETCHED (`DESIGN` when the surface has no other cell); and every cell has a
#       non-empty `label` and `confidence`, where the confidence is one of UNVERIFIED, PARTLY_VERIFIED, VERIFIED_FETCHED, DESIGN.
#       confidence_mismatch counts the surfaces whose confidence differs plus the cells that lack a label or a valid confidence.
#
# Exit 0 = all three hold. stdout ends with exactly:
#   AWL_MATRIX admin_cells_unmarked=0 chrome_l6=one_time_user_setup confidence_mismatch=0
# Exit 1 = a check failed: the same line is still printed last with the real numbers, and one line per offender goes to stderr.
#          An unreadable or misshapen file exits 1 with a reason and no summary line.
# Exit 2 = usage error or a missing prerequisite (no python, no matrix file).
# The last stderr line is `PASS BR-281` or `FAIL BR-281: <reason>`.
#
# Usage: bash scripts/verify/awl-matrix-check.sh
# Environment: PKG_DIR (default: ai-os/projexa-build-001 under the repo root), MATRIX_FILE (default: $PKG_DIR/ai_link_capability_matrix.json).
set -u

ID="BR-281"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PKG_DIR="${PKG_DIR:-$ROOT/ai-os/projexa-build-001}"
MATRIX_FILE="${MATRIX_FILE:-$PKG_DIR/ai_link_capability_matrix.json}"

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
[ -f "$MATRIX_FILE" ] || finish_usage "matrix file not found: $MATRIX_FILE"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/check.py" <<'PYEOF'
import json
import sys

sys.stdout.reconfigure(encoding="utf-8", newline="\n")
sys.stderr.reconfigure(encoding="utf-8", newline="\n")

path = sys.argv[1]
ORDER = {"UNVERIFIED": 0, "PARTLY_VERIFIED": 1, "VERIFIED_FETCHED": 2}
KNOWN_CELL_CONFIDENCE = set(ORDER) | {"DESIGN"}


def bad(msg):
    print("BAD " + msg)
    sys.exit(1)


try:
    doc = json.loads(open(path, encoding="utf-8-sig").read())
except Exception:
    bad("the file is not valid JSON")
if not isinstance(doc, dict) or not isinstance(doc.get("families"), list) or not doc["families"]:
    bad("'families' is missing, empty or not a list")

surfaces = []
for fam in doc["families"]:
    if not isinstance(fam, dict) or not isinstance(fam.get("surfaces"), list):
        bad("a family has no 'surfaces' list")
    for surf in fam["surfaces"]:
        if not isinstance(surf, dict) or not isinstance(surf.get("cells"), dict) or not isinstance(surf.get("surface"), str):
            bad("a surface lacks 'surface' (name) or a 'cells' object")
        surfaces.append(surf)
if not surfaces:
    bad("no surfaces found")

offenders = []

# (a) admin or maker cells carry shared_identity_risk
unmarked = 0
for surf in surfaces:
    for name, cell in surf["cells"].items():
        if isinstance(cell, dict) and cell.get("v") == "admin_or_maker_setup":
            if not isinstance(cell.get("shared_identity_risk"), bool):
                unmarked += 1
                offenders.append("(a) %s / %s is admin_or_maker_setup and has no true or false shared_identity_risk" % (surf["surface"], name))

# (b) Claude in Chrome L6_paste_back
chrome = [s for s in surfaces if s["surface"].startswith("Claude in Chrome")]
values = []
for surf in chrome:
    cell = surf["cells"].get("L6_paste_back")
    values.append(cell.get("v") if isinstance(cell, dict) and isinstance(cell.get("v"), str) else "missing")
chrome_l6 = ",".join(values) if values else "missing"
if chrome_l6 != "one_time_user_setup":
    offenders.append("(b) Claude in Chrome L6_paste_back is '%s', expected 'one_time_user_setup'" % chrome_l6)

# (c) surface confidence is the lowest cell confidence; every cell has a label and a confidence
mismatch = 0
for surf in surfaces:
    ranks = []
    for name, cell in surf["cells"].items():
        label = cell.get("label") if isinstance(cell, dict) else None
        conf = cell.get("confidence") if isinstance(cell, dict) else None
        if not isinstance(label, str) or not label.strip():
            mismatch += 1
            offenders.append("(c) %s / %s has no label" % (surf["surface"], name))
        if conf not in KNOWN_CELL_CONFIDENCE:
            mismatch += 1
            offenders.append("(c) %s / %s has confidence %r, expected one of %s" % (surf["surface"], name, conf, sorted(KNOWN_CELL_CONFIDENCE)))
        elif conf != "DESIGN":
            ranks.append(conf)
    want = min(ranks, key=lambda c: ORDER[c]) if ranks else "DESIGN"
    if surf.get("confidence") != want:
        mismatch += 1
        offenders.append("(c) %s has confidence %r, its cells give %r" % (surf["surface"], surf.get("confidence"), want))

for line in offenders:
    print("OFFENDER " + line)
print("SUMMARY admin_cells_unmarked=%d chrome_l6=%s confidence_mismatch=%d surfaces=%d" % (unmarked, chrome_l6, mismatch, len(surfaces)))
sys.exit(1 if offenders else 0)
PYEOF

"$PY" "$(winpath "$TMP/check.py")" "$(winpath "$MATRIX_FILE")" >"$TMP/out" 2>"$TMP/py.err"
RC=$?

if [ "$RC" -gt 1 ] || { [ "$RC" -eq 1 ] && ! grep -q '^SUMMARY ' "$TMP/out" && ! grep -q '^BAD ' "$TMP/out"; }; then
  finish_usage "the check program stopped unexpectedly: $(head -c 300 "$TMP/py.err" 2>/dev/null | tr '\n' ' ')"
fi
BAD_LINE="$(grep -m1 '^BAD ' "$TMP/out" | tr -d '\r')"
if [ -n "$BAD_LINE" ]; then finish_fail "${BAD_LINE#BAD }"; fi

grep '^OFFENDER ' "$TMP/out" | tr -d '\r' | sed 's/^OFFENDER /  offender: /' >&2
SUMMARY="$(grep -m1 '^SUMMARY ' "$TMP/out" | tr -d '\r' | sed 's/^SUMMARY //')"
FIELDS="${SUMMARY% surfaces=*}"     # admin_cells_unmarked=N chrome_l6=V confidence_mismatch=N
SURFACES="${SUMMARY##*surfaces=}"
LINE="AWL_MATRIX $FIELDS"

if [ "$RC" -eq 0 ]; then
  printf 'checked %s surfaces\n' "$SURFACES" >&2
  finish_ok "$LINE"
fi
printf '%s\n' "$LINE"
finish_fail "the matrix breaks at least one rule (offenders above)"
