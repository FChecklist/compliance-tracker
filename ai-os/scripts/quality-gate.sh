#!/bin/bash
# Runs whatever quality gates are actually detectable in a workspace (lint,
# build, test) before a worker's changes are allowed to reach pending_review.
# Gracefully skips gates that don't apply (e.g. a docs-only repo). Writes a
# JSON summary and exits non-zero if any detected gate failed.
set -uo pipefail
WORKSPACE="$1"
OUT="$2"
cd "$WORKSPACE"

RESULTS_FILE=$(mktemp)
echo "{}" > "$RESULTS_FILE"
OVERALL=0

run_gate() {
  local name="$1"; shift
  local cmd="$*"
  local logfile
  logfile=$(mktemp)
  eval "$cmd" > "$logfile" 2>&1
  local code=$?
  tail -c 4000 "$logfile" > "${logfile}.tail"
  NAME="$name" CODE="$code" LOGFILE="${logfile}.tail" RESULTS_FILE="$RESULTS_FILE" python3 <<'PYEOF'
import json, os
name = os.environ["NAME"]
code = int(os.environ["CODE"])
results_file = os.environ["RESULTS_FILE"]
with open(os.environ["LOGFILE"]) as f:
    tail = f.read()
with open(results_file) as f:
    r = json.load(f)
r[name] = {"ran": True, "passed": code == 0, "exit_code": code, "output_tail": tail}
with open(results_file, "w") as f:
    json.dump(r, f)
PYEOF
  if [ $code -ne 0 ]; then OVERALL=1; fi
  echo "--- $name: exit $code ---"
  tail -50 "$logfile"
  rm -f "$logfile" "${logfile}.tail"
}

if [ -f package.json ]; then
  PKG_MGR="npm"
  [ -f pnpm-lock.yaml ] && PKG_MGR="pnpm"
  # Bun-managed repo (bun.lock / bun.lockb): prefer Bun. npm/pnpm cannot
  # resolve some of this repo's peer-dep graphs (e.g. zod v3/v4 split that
  # @memvid/sdk requires), so running npm here leaves node_modules empty and
  # every downstream gate fails with "eslint: not found" / "next: not found"
  # (exit 127) — an environment failure, not a code defect. Bun's lockfile
  # resolves the same graph cleanly. Bun may not be on PATH in the gate's
  # invocation shell, so also check the standard install location.
  if [ -f bun.lock ] || [ -f bun.lockb ]; then
    if command -v bun >/dev/null 2>&1 || [ -x /home/rajat/.bun/bin/bun ]; then
      BUN_BIN="$(command -v bun 2>/dev/null || echo /home/rajat/.bun/bin/bun)"
      PKG_MGR="$BUN_BIN"
    fi
  fi
  echo "Detected Node project (package manager: $PKG_MGR)"

  if ! [ -d node_modules ]; then
    echo "--- installing deps ---"
    $PKG_MGR install 2>&1 | tail -20
  fi

  if grep -q '"lint"' package.json; then
    run_gate lint "$PKG_MGR run lint"
  fi
  if grep -q '"build"' package.json; then
    run_gate build "$PKG_MGR run build"
  fi
  if grep -q '"test"' package.json; then
    run_gate test "$PKG_MGR test -- --run 2>/dev/null || $PKG_MGR test"
  fi
elif [ -f pyproject.toml ] || [ -f requirements.txt ]; then
  echo "Detected Python project"
  if [ -f pyproject.toml ] && grep -q ruff pyproject.toml 2>/dev/null; then
    run_gate lint "ruff check ."
  fi
  if [ -d tests ] || ls test_*.py >/dev/null 2>&1; then
    run_gate test "python3 -m pytest -q"
  fi
else
  echo "No recognized project type (package.json / pyproject.toml / requirements.txt) — no automated gates apply, skipping."
fi

cp "$RESULTS_FILE" "$OUT"
rm -f "$RESULTS_FILE"
exit $OVERALL
