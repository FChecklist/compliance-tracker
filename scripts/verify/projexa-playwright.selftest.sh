#!/usr/bin/env bash
# register: BR-420 BR-421
#
# Self-test for scripts/verify/projexa-playwright.sh (PROJEXA-BUILD-001 U-33). The runner is what turns a Playwright run into an exit code
# for two register rows, so it must fail when the spec fails and must not pass an empty run. This puts a stand-in `bunx` first on PATH
# (no browser, no server, no network) and a stand-in projexa checkout, and drives the runner through every outcome.
#
# Cases: a passing run (exit 0, the `1 passed` line is the last stdout line); a failing run (exit 1); exit 0 with a `skipped` summary only
# (exit 1); exit 0 with no summary at all (exit 1); exit 0 with a `failed` line in the summary (exit 1); a non-zero exit after a `passed`
# line (exit 1); the arguments the runner hands to
# playwright (config, spec, one worker); PLAYWRIGHT_BASE_URL removed; the bundler and port variables passed through; bad spec paths (not
# under e2e/, absolute, with .., with a backslash, wrong extension, several arguments, none); a missing checkout, config and spec file.
#
# Exit 0 prints, as the last line:  SELFTEST PASS: <n> cases
# Exit 1 prints, as the last line:  SELFTEST FAIL: <k> of <n> cases failed
# Env TARGET_SCRIPT points the test at a different copy of the runner (used to prove this test can fail: plant a broken runner in a copy and
# the self-test must go red).
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${TARGET_SCRIPT:-$HERE/projexa-playwright.sh}"
[ -f "$TARGET" ] || { echo "SELFTEST FAIL: runner not found: $TARGET" >&2; exit 2; }

T="$(mktemp -d)" || { echo "SELFTEST FAIL: no temp directory" >&2; exit 2; }
trap 'rm -rf "$T"' EXIT
NCASE=0
NFAIL=0

# ------------------------------------------------------------- stand-in projexa checkout and bunx
PX="$T/projexa"
mkdir -p "$PX/e2e" "$T/bin"
: > "$PX/playwright.boq-local.config.ts"
: > "$PX/e2e/boq-offline.spec.ts"
: > "$PX/e2e/boq-worker-filter.spec.ts"

# The stand-in bunx records how it was called and then behaves as FAKE_MODE says.
cat > "$T/bin/bunx" <<'EOF'
#!/usr/bin/env bash
{
  echo "cwd=$PWD"
  echo "args=$*"
  echo "base_url=${PLAYWRIGHT_BASE_URL-unset}"
  echo "bundler=${BOQ_LOCAL_BUNDLER-unset}"
  echo "port=${BOQ_LOCAL_PORT-unset}"
} > "$FAKE_LOG"
case "${FAKE_MODE:-pass}" in
  pass)     echo "  ok 1 [boq-local] > e2e/boq-offline.spec.ts:1:1 > the spec"; echo "  1 passed (3.1s)"; exit 0 ;;
  fail)     echo "  x  1 [boq-local] > e2e/boq-offline.spec.ts:1:1 > the spec"; echo "  1 failed"; exit 1 ;;
  skipped)  echo "  1 skipped"; exit 0 ;;
  nosummary) echo "Running 0 tests"; exit 0 ;;
  failedzero) echo "  1 passed (1s)"; echo "  1 failed"; exit 0 ;;
  flaky)    echo "  1 flaky"; echo "  1 passed (1s)"; exit 0 ;;
  crashafter) echo "  1 passed (1s)"; echo "web server exited with code 1"; exit 1 ;;
esac
EOF
chmod +x "$T/bin/bunx"

# run NAME EXPECT_RC EXPECT_LAST_STDOUT_LINE MODE -- args...   (env PROJEXA_DIR is set by the caller through the environment)
run() {
  local name="$1" want_rc="$2" want_last="$3" mode="$4"; shift 5
  NCASE=$((NCASE+1))
  local out rc last
  LAST_RUN="$NCASE"
  export FAKE_LOG="$T/log-$NCASE.txt"
  out="$(FAKE_MODE="$mode" PATH="$T/bin:$PATH" bash "$TARGET" "$@" 2>/dev/null)"; rc=$?
  last="$(printf '%s' "$out" | tail -n 1 | sed 's/\r$//')"
  if [ "$rc" -eq "$want_rc" ] && { [ -z "$want_last" ] || [ "$last" = "$want_last" ]; }; then
    printf 'ok   %s\n' "$name"
  else
    NFAIL=$((NFAIL+1))
    printf 'FAIL %s: exit %s (want %s), last stdout line "%s" (want "%s")\n' "$name" "$rc" "$want_rc" "$last" "$want_last"
  fi
}

logHas() {   # logHas NAME NEEDLE   (looks at the log of the latest run)
  NCASE=$((NCASE+1))
  if grep -q -F -- "$2" "$T/log-$LAST_RUN.txt" 2>/dev/null; then printf 'ok   %s\n' "$1"; else NFAIL=$((NFAIL+1)); printf 'FAIL %s: the bunx call did not contain "%s"\n' "$1" "$2"; fi
}
logHasNot() {
  NCASE=$((NCASE+1))
  if grep -q -F -- "$2" "$T/log-$LAST_RUN.txt" 2>/dev/null; then NFAIL=$((NFAIL+1)); printf 'FAIL %s: the bunx call contained "%s"\n' "$1" "$2"; else printf 'ok   %s\n' "$1"; fi
}

export PROJEXA_DIR="$PX"

# --- outcomes ------------------------------------------------------------------------------------------------------------------------
run "a passing run exits 0 and its 'N passed' line is the last stdout line" 0 "  1 passed (3.1s)" pass -- e2e/boq-offline.spec.ts
run "a failing spec exits 1" 1 "  1 failed" fail -- e2e/boq-offline.spec.ts
run "exit 0 with only a skipped summary is not a pass" 1 "  1 skipped" skipped -- e2e/boq-offline.spec.ts
run "exit 0 with no summary line at all is not a pass" 1 "" nosummary -- e2e/boq-offline.spec.ts
run "exit 0 whose summary also reports a failed test is not a pass" 1 "" failedzero -- e2e/boq-offline.spec.ts
run "a flaky test is not a pass" 1 "" flaky -- e2e/boq-worker-filter.spec.ts
run "a non-zero exit after a 'passed' line is a failure" 1 "  1 passed (1s)" crashafter -- e2e/boq-offline.spec.ts

# --- what the runner hands to playwright ---------------------------------------------------------------------------------------------------
run "for the log checks: a passing run of the worker spec" 0 "  1 passed (3.1s)" pass -- e2e/boq-worker-filter.spec.ts
logHas "playwright runs in the projexa checkout" "cwd=$PX"
logHas "playwright is given the local config" "-c playwright.boq-local.config.ts"
logHas "playwright is given the spec" "e2e/boq-worker-filter.spec.ts"
logHas "playwright runs one worker" "--workers=1"
PLAYWRIGHT_BASE_URL="https://example.invalid" run "with PLAYWRIGHT_BASE_URL set" 0 "  1 passed (3.1s)" pass -- e2e/boq-offline.spec.ts
logHas "PLAYWRIGHT_BASE_URL is removed for the run" "base_url=unset"
BOQ_LOCAL_BUNDLER=webpack BOQ_LOCAL_PORT=3999 run "with the bundler and port variables set" 0 "  1 passed (3.1s)" pass -- e2e/boq-offline.spec.ts
logHas "the bundler variable is passed through" "bundler=webpack"
logHas "the port variable is passed through" "port=3999"

# --- bad arguments and a checkout that is not ready ------------------------------------------------------------------------------------------
run "no argument" 2 "" pass --
run "two arguments" 2 "" pass -- e2e/boq-offline.spec.ts e2e/boq-worker-filter.spec.ts
run "a path outside e2e/" 2 "" pass -- src/boq-offline.spec.ts
run "an absolute path" 2 "" pass -- /e2e/boq-offline.spec.ts
run "a path with .." 2 "" pass -- e2e/../boq-offline.spec.ts
run "a path with a backslash" 2 "" pass -- 'e2e\boq-offline.spec.ts'
run "a file that is not a spec" 2 "" pass -- e2e/boq-offline.ts
run "a spec in a sub-folder" 2 "" pass -- e2e/support/boq-offline.spec.ts
run "a spec file that is not on the checkout" 2 "" pass -- e2e/not-there.spec.ts
rm "$PX/playwright.boq-local.config.ts"
run "a checkout without the local config" 2 "" pass -- e2e/boq-offline.spec.ts
: > "$PX/playwright.boq-local.config.ts"
PROJEXA_DIR="$T/no-such-dir" run "a checkout folder that does not exist" 2 "" pass -- e2e/boq-offline.spec.ts

if [ "$NFAIL" -eq 0 ]; then
  echo "SELFTEST PASS: $NCASE cases"
  exit 0
fi
echo "SELFTEST FAIL: $NFAIL of $NCASE cases failed"
exit 1
