#!/usr/bin/env bash
# BR-140 (PROJEXA-BUILD-001, phase 1): the plan package is present in the KT Drive folder PROJEXA_BUILD-001_PLAN_2026-09-25
# and every file of the local package has the same byte size there. Read-only: one `rclone lsjson` listing, nothing is
# uploaded, changed or deleted.
#
# Exit 0 = the Drive folder is non-empty, every local package file exists in it, and no size differs. stdout is exactly one line:
#   KT_PLAN_OK missing=0 size_mismatch=0
# Exit 1 = the folder is missing or empty, a file is missing, or a size differs (details on stderr).
# Exit 2 = usage error, rclone not found, the local package is empty, or the listing failed for another reason.
# The last stderr line is `PASS BR-140` or `FAIL BR-140: <reason>`.
#
# Comparison: every file under PKG_DIR (recursive, path relative to PKG_DIR with forward slashes) against the recursive
# file listing of the Drive folder. Files that exist only in Drive (for example an evidence/ folder kept in the private copy)
# are not counted. Point PKG_DIR at the package that was uploaded: the public repo copy and the private KT copy can differ in
# size for files where the repo copy has text removed.
#
# Usage: bash scripts/verify/kt-drive-plan.sh
# Environment: PKG_DIR (default: ai-os/projexa-build-001 under the repo root), RCLONE_BIN (default: rclone from PATH, then the
#   winget install path on this laptop), KT_REMOTE (default: gdrive), KT_ROOT_FOLDER_ID (default: 1vJdIG_4w2eMjgsSn3ofHGy4ylgBIhKXp),
#   KT_FOLDER (default: PROJEXA_BUILD-001_PLAN_2026-09-25). rclone's stderr is discarded (it prints a client_id notice).
set -u

ID="BR-140"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PKG_DIR="${PKG_DIR:-$ROOT/ai-os/projexa-build-001}"
KT_REMOTE="${KT_REMOTE:-gdrive}"
KT_ROOT_FOLDER_ID="${KT_ROOT_FOLDER_ID:-1vJdIG_4w2eMjgsSn3ofHGy4ylgBIhKXp}"
KT_FOLDER="${KT_FOLDER:-PROJEXA_BUILD-001_PLAN_2026-09-25}"
WINGET_RCLONE="/c/Users/Dell/AppData/Local/Microsoft/WinGet/Packages/Rclone.Rclone_Microsoft.Winget.Source_8wekyb3d8bbwe/rclone-v1.75.1-windows-amd64/rclone.exe"

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
[ -d "$PKG_DIR" ] || finish_usage "the local package folder does not exist: $PKG_DIR"

RCLONE="${RCLONE_BIN:-}"
if [ -z "$RCLONE" ]; then
  if command -v rclone >/dev/null 2>&1; then RCLONE="rclone"
  elif [ -x "$WINGET_RCLONE" ]; then RCLONE="$WINGET_RCLONE"
  fi
fi
[ -n "$RCLONE" ] || finish_usage "rclone was not found (PATH, RCLONE_BIN, or the winget install path)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

"$RCLONE" lsjson "$KT_REMOTE:$KT_FOLDER" --drive-root-folder-id "$KT_ROOT_FOLDER_ID" --recursive --files-only > "$TMP/remote.json" 2>/dev/null
RC=$?
if [ $RC -eq 3 ]; then finish_fail "the Drive folder $KT_FOLDER does not exist (rclone exit 3)"; fi
[ $RC -eq 0 ] || finish_usage "rclone lsjson failed with exit $RC"

cat > "$TMP/check.py" <<'PYEOF'
import json
import os
import sys

pkg, listing = sys.argv[1], sys.argv[2]
local = {}
for dirpath, _dirs, files in os.walk(pkg):
    for name in files:
        full = os.path.join(dirpath, name)
        rel = os.path.relpath(full, pkg).replace(os.sep, "/")
        local[rel] = os.path.getsize(full)
if not local:
    print("USAGE the local package folder has no files")
    sys.exit(0)
try:
    remote_rows = json.loads(open(listing, encoding="utf-8-sig").read() or "[]")
except Exception:
    print("USAGE the rclone listing is not valid JSON")
    sys.exit(0)
remote = {row["Path"]: int(row["Size"]) for row in remote_rows if not row.get("IsDir")}
if not remote:
    print("BAD the Drive folder is empty")
    sys.exit(0)
missing = sorted(p for p in local if p not in remote)
mismatch = sorted(p for p in local if p in remote and remote[p] != local[p])
if missing or mismatch:
    parts = []
    if missing:
        parts.append("missing=%d (%s)" % (len(missing), ", ".join(missing[:4])))
    if mismatch:
        parts.append("size_mismatch=%d (%s)" % (len(mismatch), ", ".join("%s local=%d drive=%d" % (p, local[p], remote[p]) for p in mismatch[:3])))
    print("BAD " + "; ".join(parts))
    sys.exit(0)
print("OK missing=0 size_mismatch=0")
PYEOF

RESULT="$("$PY" "$(winpath "$TMP/check.py")" "$(winpath "$PKG_DIR")" "$(winpath "$TMP/remote.json")" 2>"$TMP/py.err")"
case "$RESULT" in
  "OK "*)    finish_ok "KT_PLAN_OK ${RESULT#OK }" ;;
  "BAD "*)   finish_fail "${RESULT#BAD }" ;;
  "USAGE "*) finish_usage "${RESULT#USAGE }" ;;
esac
finish_usage "the check program stopped unexpectedly: $(head -c 300 "$TMP/py.err" 2>/dev/null)"
