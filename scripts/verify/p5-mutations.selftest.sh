#!/usr/bin/env bash
# register: BR-525
#
# Self-test for scripts/verify/p5-mutations.sh (PROJEXA-BUILD-001, unit U-42a). A runner that prints caught=5 of 5 only means
# something if it is known to print fewer when one of the five tests does not guard its code, to say tree_clean=no when a run
# leaves a tracked file changed, and to refuse to start on a dirty tree. Offline: everything happens in a throwaway git repository
# under a temp directory, with the REAL scripts/verify/mutation-check.sh and plain-shell "tests" (grep) instead of bun, so no
# network, no database and no dependency install is needed.
#
# Cases: all five killed (exit 0, caught=5 of 5 tree_clean=yes); one mutant survives (exit 1, caught=4 of 5 tree_clean=yes, the
# survivor named); one mutation whose test already fails without it (mutation-check.sh refuses it: exit 1, caught=4 of 5, reported
# as ERROR); a test that changes another tracked file (all five killed, but tree_clean=no and exit 1); a dirty tree before the start
# (exit 2, nothing mutated, no summary line, the uncommitted edit kept); a name missing from the table (exit 2); an argument (exit 2);
# and after every case the five fixture files are byte-identical to their committed state.
#
# Exit 0 prints, as the last line:  SELFTEST PASS: <n> cases
# Exit 1 prints, as the last line:  SELFTEST FAIL: <k> of <n> cases failed
# Env RUNNER_SCRIPT points the test at a different copy of the runner (to prove this self-test can fail).
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="${RUNNER_SCRIPT:-$HERE/p5-mutations.sh}"
CHECK="$HERE/mutation-check.sh"
[ -f "$RUNNER" ] || { echo "SELFTEST FAIL: runner not found: $RUNNER" >&2; exit 2; }
[ -f "$CHECK" ] || { echo "SELFTEST FAIL: mutation-check.sh not found: $CHECK" >&2; exit 2; }

T="$(mktemp -d)" || { echo "SELFTEST FAIL: no temp directory" >&2; exit 2; }
trap 'rm -rf "$T"' EXIT
REPO="$T/repo"
mkdir -p "$REPO/src"
TAB="$(printf '\t')"

git -C "$REPO" init -q
git -C "$REPO" config user.email "selftest@example.test"
git -C "$REPO" config user.name "p5 mutations selftest"
git -C "$REPO" config core.autocrlf false
FIXTURES="src/u36b.ts src/u36.ts src/u37.ts src/u38.ts src/u40.ts"
for f in $FIXTURES; do printf 'const guarded = 1\n// a comment no test reads\n' > "$REPO/$f"; done
printf 'unrelated\n' > "$REPO/src/other.ts"
git -C "$REPO" add src
git -C "$REPO" commit -q -m "fixture"
committed_shas() { (cd "$REPO" && for f in $FIXTURES src/other.ts; do git show "HEAD:$f" | sha256sum; done); }
current_shas() { (cd "$REPO" && for f in $FIXTURES src/other.ts; do sha256sum < "$f"; done); }
COMMITTED="$(committed_shas)"

guard() { printf "grep -qx 'const guarded = 1' %s" "$1"; }   # the "test": passes only while the file is unmutated
row() { printf '%s\t%s\t%s\t%s\t%s' "$1" "$2" "$3" "$4" "$5"; }
killed_row() { row "$1" "$2" 'const guarded = 1' 'const guarded = 2' "$(guard "$2")"; }
table() {   # the table: the five rows given as arguments
  : > "$T/mutations.tsv"
  printf '# selftest table\n' >> "$T/mutations.tsv"
  for line in "$@"; do printf '%s\n' "$line" >> "$T/mutations.tsv"; done
}
K1="$(killed_row p5-u36b-cap-at-equality src/u36b.ts)"
K2="$(killed_row p5-u36-cell-hidden-chars src/u36.ts)"
K3="$(killed_row p5-u37-idempotency-lookup src/u37.ts)"
K4="$(killed_row p5-u38-drawing-no-supersede src/u38.ts)"
K5="$(killed_row p5-u40-secret-not-compared src/u40.ts)"

NCASE=0
NFAIL=0
# t NAME EXPECT_RC EXPECT_LAST_STDOUT_LINE_OR_- EXPECT_TEXT_IN_STDOUT_OR_- [RUNNER ARGUMENTS...]
t() {
  local name="$1" erc="$2" elast="$3" etext="$4" out rc last why=""
  shift 4
  out="$(cd "$REPO" && MUTATIONS_TSV="$T/mutations.tsv" MUTATION_CHECK_SCRIPT="$CHECK" bash "$RUNNER" "$@" 2> "$T/stderr")"; rc=$?
  last="$(printf '%s\n' "$out" | tail -n 1)"
  NCASE=$((NCASE + 1))
  [ "$rc" = "$erc" ] || why="exit code $rc, expected $erc"
  if [ -z "$why" ] && [ "$elast" != "-" ] && [ "$last" != "$elast" ]; then why="last stdout line '$last', expected '$elast'"; fi
  if [ -z "$why" ] && [ "$elast" = "-" ] && printf '%s\n' "$out" | grep -q '^caught='; then why="a summary was printed for a refused run"; fi
  if [ -z "$why" ] && [ "$etext" != "-" ] && ! printf '%s\n' "$out" | grep -qF -- "$etext"; then why="stdout does not contain '$etext'"; fi
  if [ -z "$why" ] && [ "$(current_shas)" != "$EXPECT_SHAS" ]; then why="the fixture files are not in the expected state afterwards"; fi
  if [ -z "$why" ]; then
    printf 'ok   %s\n' "$name"
  else
    NFAIL=$((NFAIL + 1))
    printf 'FAIL %s: %s\n' "$name" "$why"
    sed 's/^/     stderr: /' "$T/stderr" | tail -n 5
  fi
}
EXPECT_SHAS="$COMMITTED"

# ------------------------------------------------------------------------------------------------------ verdicts
table "$K1" "$K2" "$K3" "$K4" "$K5"
t "all five killed: exit 0, caught=5 of 5 tree_clean=yes" 0 "caught=5 of 5 tree_clean=yes" "MUTANT KILLED p5-u40-secret-not-compared"

table "$K1" "$K2" "$K3" "$(row p5-u38-drawing-no-supersede src/u38.ts '// a comment no test reads' '// A COMMENT' "$(guard src/u38.ts)")" "$K5"
t "one mutant survives: exit 1, caught=4 of 5 tree_clean=yes" 1 "caught=4 of 5 tree_clean=yes" "SURVIVED  p5-u38-drawing-no-supersede"

table "$K1" "$(row p5-u36-cell-hidden-chars src/u36.ts 'const guarded = 1' 'const guarded = 2' "grep -qx 'const guarded = 7' src/u36.ts")" "$K3" "$K4" "$K5"
t "a test that fails without its mutation is not counted: exit 1, caught=4 of 5, ERROR" 1 "caught=4 of 5 tree_clean=yes" "ERROR     p5-u36-cell-hidden-chars"

# The fifth "test" also writes to a tracked file that no mutation restores, so the tree is not clean afterwards.
table "$K1" "$K2" "$K3" "$K4" "$(row p5-u40-secret-not-compared src/u40.ts 'const guarded = 1' 'const guarded = 2' "echo touched >> src/other.ts; $(guard src/u40.ts)")"
EXPECT_SHAS="$(cd "$REPO" && for f in $FIXTURES; do sha256sum < "$f"; done; printf 'unrelated\ntouched\ntouched\n' | sha256sum)"
t "a run that leaves a tracked file changed: all killed, but tree_clean=no and exit 1" 1 "caught=5 of 5 tree_clean=no" -
git -C "$REPO" checkout -q -- src/other.ts
EXPECT_SHAS="$COMMITTED"

# --------------------------------------------------------------------------------------------- refused (exit 2)
table "$K1" "$K2" "$K3" "$K4" "$K5"
printf '// uncommitted work\n' >> "$REPO/src/other.ts"
EXPECT_SHAS="$(current_shas)"
t "a dirty tree before the start: refused, nothing mutated, the edit kept" 2 - -
git -C "$REPO" checkout -q -- src/other.ts
EXPECT_SHAS="$COMMITTED"

table "$K1" "$K2" "$K3" "$K5"
t "a name missing from the table: refused" 2 - -
table "$K1" "$K2" "$K3" "$K4" "$K4" "$K5"
t "a name listed twice: refused" 2 - -
table "$K1" "$K2" "$K3" "$K4" "$K5"
t "an argument: refused" 2 - - p5-u36b-cap-at-equality

# -------------------------------------------------------------------------------------------------------- summary
if [ "$NFAIL" -eq 0 ]; then
  printf 'SELFTEST PASS: %s cases\n' "$NCASE"
  exit 0
fi
printf 'SELFTEST FAIL: %s of %s cases failed\n' "$NFAIL" "$NCASE"
exit 1
