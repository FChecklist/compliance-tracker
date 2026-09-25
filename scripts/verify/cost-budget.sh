#!/usr/bin/env bash
# BR-503 (PROJEXA-BUILD-001, phase 5, U-35): ai-os/projexa-build-001/COST_BUDGET.csv names a per-call cost ceiling for every
# extraction and scheduler path, and the projected monthly Vercel gross charge (the sum of the Vercel components plus the monthly
# ceiling of every path that runs on Vercel) is at most USD 20.00 (PROJEXA-COST-001, measured on gross charges under PMD-13).
#
# This is a consistency check of the committed budget, not a measurement: the measured figure over 30 completed days after the
# owner's go-live is BR-504 (scripts/verify/vercel-gross-30d.sh, owner-blocked). The check fails when a path has no ceiling, when a
# ceiling is not a number, when a path that runs on Vercel has no monthly ceiling, or when the projection exceeds 20.00.
#
# Usage: bash scripts/verify/cost-budget.sh
# Environment: PKG_DIR (default ai-os/projexa-build-001 under the repository root), BUDGET_FILE (default $PKG_DIR/COST_BUDGET.csv),
#   CUMULATIVE_USD (default 29.2436, the gross charges 2026-08-26 to 2026-09-25 read in A08_billing_notes.md, printed for the record).
# Exit 0 = the budget holds; stdout ends with the line
#   paths_without_ceiling=0 projected_gross_usd<=20.00 cumulative_2026-08-26_to_2026-09-25=29.2436
# Exit 1 = a check failed (the stdout line then names the failing figure, for example projected_gross_usd=25.00). Exit 2 = usage error.
# The last stderr line is `PASS BR-503` or `FAIL BR-503: <reason>`.
set -u

ID="BR-503"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PKG_DIR="${PKG_DIR:-$ROOT/ai-os/projexa-build-001}"
BUDGET_FILE="${BUDGET_FILE:-$PKG_DIR/COST_BUDGET.csv}"
CUMULATIVE_USD="${CUMULATIVE_USD:-29.2436}"
CAP="20.00"

[ -f "$BUDGET_FILE" ] || { printf 'FAIL %s: budget file not found: %s\n' "$ID" "$BUDGET_FILE" >&2; exit 2; }

PY=""
for c in python python3; do
  if "$c" -c 'import sys' >/dev/null 2>&1; then PY="$c"; break; fi
done
[ -n "$PY" ] || { printf 'FAIL %s: python is not available on PATH\n' "$ID" >&2; exit 2; }
if command -v cygpath >/dev/null 2>&1; then BUDGET_ARG="$(cygpath -m "$BUDGET_FILE")"; else BUDGET_ARG="$BUDGET_FILE"; fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/check.py" <<'PYEOF'
import csv
import decimal
import sys

path, cap = sys.argv[1], decimal.Decimal(sys.argv[2])
rows = list(csv.DictReader(open(path, encoding="utf-8-sig", newline="")))
need = ["kind", "id", "description", "runs_on", "max_usd_per_call", "max_calls_per_month", "max_usd_per_month", "vercel_billed", "basis"]
if not rows or list(rows[0].keys()) != need:
    print("BAD the header is not: " + ",".join(need))
    sys.exit(1)


def money(v):
    try:
        d = decimal.Decimal(v.strip())
    except (decimal.InvalidOperation, AttributeError):
        return None
    return d if d >= 0 else None


problems = []
paths = [r for r in rows if r["kind"] == "path"]
comps = [r for r in rows if r["kind"] == "vercel_component"]
if not paths:
    problems.append("no path rows")
if not comps:
    problems.append("no vercel_component rows")
ids = [r["id"] for r in rows]
if len(set(ids)) != len(ids):
    problems.append("duplicate ids")
for r in rows:
    if r["kind"] not in ("path", "vercel_component"):
        problems.append("%s has kind %s" % (r["id"], r["kind"]))
without = 0
projected = decimal.Decimal("0")
for r in paths:
    if money(r["max_usd_per_call"]) is None:
        without += 1
        continue
    if r["vercel_billed"].strip() == "yes":
        m = money(r["max_usd_per_month"])
        if m is None:
            problems.append("%s runs on Vercel and has no monthly ceiling" % r["id"])
        else:
            projected += m
for r in comps:
    m = money(r["max_usd_per_month"])
    if m is None:
        problems.append("%s has no monthly figure" % r["id"])
    else:
        projected += m
if projected > cap:
    problems.append("projected_gross_usd=%s is above %s" % (projected, cap))
print("%d|%s|%s" % (without, projected, "; ".join(problems)))
PYEOF

OUT="$("$PY" "$TMP/check.py" "$BUDGET_ARG" "$CAP" 2>"$TMP/py.err")"
if [ "${OUT#BAD }" != "$OUT" ]; then printf 'FAIL %s: %s\n' "$ID" "${OUT#BAD }" >&2; exit 1; fi
[ -n "$OUT" ] || { printf 'FAIL %s: the check program stopped: %s\n' "$ID" "$(head -c 300 "$TMP/py.err" | tr '\n' ' ')" >&2; exit 2; }
WITHOUT="${OUT%%|*}"; REST="${OUT#*|}"; PROJECTED="${REST%%|*}"; PROBLEMS="${REST#*|}"

if [ "$WITHOUT" != "0" ] || [ -n "$PROBLEMS" ]; then
  printf 'paths_without_ceiling=%s projected_gross_usd=%s cumulative_2026-08-26_to_2026-09-25=%s\n' "$WITHOUT" "$PROJECTED" "$CUMULATIVE_USD"
  printf 'FAIL %s: %s\n' "$ID" "${PROBLEMS:-$WITHOUT path(s) without a ceiling}" >&2
  exit 1
fi
printf 'paths_without_ceiling=0 projected_gross_usd<=%s cumulative_2026-08-26_to_2026-09-25=%s\n' "$CAP" "$CUMULATIVE_USD"
printf 'PASS %s\n' "$ID" >&2
exit 0
