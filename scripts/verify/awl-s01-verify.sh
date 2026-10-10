#!/usr/bin/env bash
# register: BR-282
# PROJEXA-BUILD-001 phase 2 (U-44; audit defect A-23, V-1 to V-5): every FETCHED-S01 vendor fact in the Universal AI Work
# Link spec (26 facts: MCP 2026-07-28 transport rules, Supabase Edge Function limits and billing, Microsoft custom connector
# format) still matches the vendor page lines it was pinned to. Runs scripts/verify/ai-link/ailink_s01_verify.py.
#
# How a fact is pinned: the page, the line numbers of its normalised text, the SHA-256 prefix of each such line, and the
# identifiers and numbers that must appear on those lines. The vendor page text itself is NOT in this public repository (only
# hashes and identifiers are). The pages live in the PRIVATE package, or are fetched fresh from the vendor's public site.
#
# Where the pages come from:
#   default   PKG_PRIVATE_DIR must exist (the folder of the private package). Pinned page copies are read from its evidence
#             subfolder (S01_CACHE_DIR overrides that subfolder) when all eight are there, under the file names listed in
#             CACHE_NAME inside ailink_s01_verify.py. When none of the eight is there, the eight public pages are fetched now
#             (read-only GET requests to modelcontextprotocol.io, supabase.com and learn.microsoft.com, about 7 seconds); a
#             note on stderr says so. When only some are there the folder is incomplete and the script stops with exit 2.
#   --live    ignore the private package and fetch the eight public pages now.
# A page that cannot be reached counts as a failed fact, never as a pass.
#
# Exit 0 = all 26 facts match; stdout ends with exactly:  S01-VERIFY: 26 of 26 facts match
# Exit 1 = at least one fact differs or a page was unreachable; stdout ends with `S01-VERIFY: <n> of 26 facts match` and the
#          FAIL lines above it name the facts.
# Exit 2 = usage error or a missing prerequisite: no python, the private folder missing (default mode), an incomplete page cache.
# The last stderr line is `PASS BR-282` or `FAIL BR-282: <reason>`.
#
# Usage: bash scripts/verify/awl-s01-verify.sh [--live]
# Environment: PKG_PRIVATE_DIR (default: the PM's private package folder on this laptop, see PKG_PRIVATE_DEFAULT below),
#              S01_CACHE_DIR (default: $PKG_PRIVATE_DIR/evidence).
set -u

ID="BR-282"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HDIR="$ROOT/scripts/verify/ai-link"
CHECKER="$HDIR/ailink_s01_verify.py"
WANT_LAST="S01-VERIFY: 26 of 26 facts match"
PKG_PRIVATE_DEFAULT="C:/Users/Dell/AppData/Local/Temp/claude/C--ct-ct/5ad1b41c-4c64-40a2-9d8c-7e6a4052cd5b/scratchpad/build001/pkg_private"
PKG_PRIVATE_DIR="${PKG_PRIVATE_DIR:-$PKG_PRIVATE_DEFAULT}"

finish_ok()    { printf 'PASS %s\n' "$ID" >&2; exit 0; }
finish_fail()  { printf 'FAIL %s: %s\n' "$ID" "$1" >&2; exit 1; }
finish_usage() { printf 'FAIL %s: %s\n' "$ID" "$1" >&2; exit 2; }

PY=""
for c in python python3; do
  if "$c" -c 'import sys' >/dev/null 2>&1; then PY="$c"; break; fi
done
[ -n "$PY" ] || finish_usage "python is not available on PATH"
winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
export PYTHONDONTWRITEBYTECODE=1
export PYTHONIOENCODING=utf-8

LIVE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --live) LIVE=1; shift ;;
    *) finish_usage "unknown argument: $1 (usage: awl-s01-verify.sh [--live])" ;;
  esac
done
[ -f "$CHECKER" ] || finish_usage "missing $CHECKER"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

CACHE_ARGS=()
if [ "$LIVE" -eq 1 ]; then
  printf 'note: --live, fetching the eight public vendor pages now\n' >&2
else
  if [ ! -d "$PKG_PRIVATE_DIR" ]; then
    finish_usage "the private package folder is missing: $PKG_PRIVATE_DIR. Set PKG_PRIVATE_DIR to it (the vendor page copies are kept only in the private package, never in this public repo), or pass --live to fetch the public pages now"
  fi
  CACHE_DIR="${S01_CACHE_DIR:-$PKG_PRIVATE_DIR/evidence}"
  # The file names come from the checker itself, so the two never disagree.
  "$PY" -c 'import sys; sys.path.insert(0, sys.argv[1]); import ailink_s01_verify as m; print("\n".join(m.CACHE_NAME.values()))' \
    "$(winpath "$HDIR")" >"$TMP/names" 2>"$TMP/names.err" || finish_usage "cannot read the page file names from the checker: $(head -c 200 "$TMP/names.err" | tr '\n' ' ')"
  tr -d '\r' <"$TMP/names" >"$TMP/names.lf"
  HAVE=0; WANT=0; ABSENT=""
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    WANT=$((WANT + 1))
    if [ -f "$CACHE_DIR/$name" ]; then HAVE=$((HAVE + 1)); else ABSENT="$ABSENT $name"; fi
  done <"$TMP/names.lf"
  if [ "$HAVE" -eq "$WANT" ] && [ "$WANT" -gt 0 ]; then
    CACHE_ARGS=(--cache "$(winpath "$CACHE_DIR")")
    printf 'note: reading the %d pinned page copies in %s\n' "$WANT" "$CACHE_DIR" >&2
  elif [ "$HAVE" -eq 0 ]; then
    printf 'note: no pinned page copies in %s; fetching the %d public vendor pages now\n' "$CACHE_DIR" "$WANT" >&2
  else
    finish_usage "the page cache $CACHE_DIR is incomplete: $HAVE of $WANT files present, missing:$ABSENT"
  fi
fi

"$PY" "$(winpath "$CHECKER")" ${CACHE_ARGS[@]+"${CACHE_ARGS[@]}"} >"$TMP/out" 2>"$TMP/err"
RC=$?
tr -d '\r' <"$TMP/out"
LAST="$(tr -d '\r' <"$TMP/out" | tail -n 1)"
if [ -s "$TMP/err" ]; then head -c 2000 "$TMP/err" >&2; fi

if [ "$RC" -eq 0 ] && [ "$LAST" = "$WANT_LAST" ]; then finish_ok; fi
case "$LAST" in
  "S01-VERIFY: "*" facts match")
    if grep -q 'page unreachable' "$TMP/out"; then
      finish_fail "at least one page was unreachable (network or cache read failed), so its facts count as failed: '$LAST'"
    fi
    finish_fail "$LAST (see the FAIL lines above)" ;;
  *) finish_usage "the checker stopped unexpectedly with exit $RC (last line: '$LAST')" ;;
esac
