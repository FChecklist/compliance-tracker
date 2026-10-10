#!/usr/bin/env bash
# Self-test of scripts/verify/cost-budget.sh (BR-503): the committed budget passes, and each planted defect makes the check fail.
# Offline; works on temporary copies of COST_BUDGET.csv. Exit 0 when every case behaves as required.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
V="$ROOT/scripts/verify/cost-budget.sh"
SRC="$ROOT/ai-os/projexa-build-001/COST_BUDGET.csv"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
pass=0; bad=0

want() { # name, expected exit, file (or empty for default), extra needle expected in stdout+stderr
  local name="$1" code="$2" file="$3" needle="$4" out rc
  if [ -n "$file" ]; then out="$(BUDGET_FILE="$file" bash "$V" 2>&1)"; rc=$?; else out="$(bash "$V" 2>&1)"; rc=$?; fi
  if [ "$rc" = "$code" ] && printf '%s' "$out" | grep -q -F -- "$needle"; then pass=$((pass+1)); printf 'ok   %s\n' "$name"
  else bad=$((bad+1)); printf 'FAIL %s (exit %s, wanted %s; needle "%s")\n%s\n' "$name" "$rc" "$code" "$needle" "$out"; fi
}

want "committed budget passes" 0 "" "paths_without_ceiling=0 projected_gross_usd<=20.00 cumulative_2026-08-26_to_2026-09-25=29.2436"

# a path loses its ceiling
sed 's/^path,X-02,\(.*\),supabase_edge,0.00,0,0.00,no,/path,X-02,\1,supabase_edge,,0,0.00,no,/' "$SRC" > "$TMP/no_ceiling.csv"
want "a path without a ceiling fails" 1 "$TMP/no_ceiling.csv" "paths_without_ceiling=1"

# a ceiling that is not a number
sed 's/^path,X-01,\(.*\),supabase_edge,0.00,2000,0.00,no,/path,X-01,\1,supabase_edge,cheap,2000,0.00,no,/' "$SRC" > "$TMP/word.csv"
want "a ceiling that is not a number fails" 1 "$TMP/word.csv" "paths_without_ceiling=1"

# the Speed Insights line comes back
sed 's/^vercel_component,V-02,\(.*\),vercel,,,0.00,yes,/vercel_component,V-02,\1,vercel,,,20.00,yes,/' "$SRC" > "$TMP/over.csv"
want "a projection above 20.00 fails" 1 "$TMP/over.csv" "projected_gross_usd=40.00"

# a path on Vercel with a monthly ceiling pushes the sum over the cap
sed 's/^path,X-03,\(.*\),vercel_function,0.00,0,0.00,yes,/path,X-03,\1,vercel_function,0.05,100,1.50,yes,/' "$SRC" > "$TMP/vercel_path.csv"
want "a Vercel path adds to the projection" 1 "$TMP/vercel_path.csv" "projected_gross_usd=21.50"

# wrong header
sed '1s/kind,id/kind,name/' "$SRC" > "$TMP/header.csv"
want "a wrong header fails" 1 "$TMP/header.csv" "header is not"

want "a missing file exits 2" 2 "$TMP/none.csv" "budget file not found"

printf -- '----\n'
if [ "$bad" = "0" ]; then printf 'PASS cost-budget selftest: %s cases behaved as required\n' "$pass"; exit 0; fi
printf 'FAIL cost-budget selftest: %s case(s) failed\n' "$bad"; exit 1
