#!/usr/bin/env bash
# register: BR-405
#
# Self-test for scripts/verify/mutation-check.sh (PROJEXA-BUILD-001, unit U-27). A runner that prints MUTANT KILLED
# only means something if it is known to print MUTANT SURVIVED when a test does not guard the code, to refuse a
# mutation it cannot apply exactly, and never to leave a mutated or clobbered file behind. Offline: everything happens
# in a throwaway git repository under a temp directory, with a plain-shell "test" (grep) instead of bun, so no
# network, no database and no dependency install is needed.
#
# Cases: killed (and the mutation really was in place while the test ran); survived; an empty replacement (deletion);
# find text missing; find text twice; a dirty file (refused, and the uncommitted edit is kept); a staged file; a test
# that already fails without the mutation; a test command that does not exist; an unknown name; a duplicated name; a
# line with four fields; a bad name; no argument; a table line ending in CRLF; the runner killed by TERM while the test
# runs (file restored, exit 143); and after every case the file is byte-identical to its committed state.
#
# Exit 0 prints, as the last line:  SELFTEST PASS: <n> cases
# Exit 1 prints, as the last line:  SELFTEST FAIL: <k> of <n> cases failed
# Env RUNNER_SCRIPT points the test at a different copy of the runner (to prove this self-test can fail).
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="${RUNNER_SCRIPT:-$HERE/mutation-check.sh}"
[ -f "$RUNNER" ] || { echo "SELFTEST FAIL: runner not found: $RUNNER" >&2; exit 2; }

T="$(mktemp -d)" || { echo "SELFTEST FAIL: no temp directory" >&2; exit 2; }
trap 'rm -rf "$T"' EXIT
REPO="$T/repo"
mkdir -p "$REPO/src"
TAB="$(printf '\t')"

git -C "$REPO" init -q
git -C "$REPO" config user.email "selftest@example.test"
git -C "$REPO" config user.name "mutation selftest"
git -C "$REPO" config core.autocrlf false
printf 'const limit = 50\n// a comment the test never reads\nconst dup = 1\nconst dup = 1\n' > "$REPO/src/lib.ts"
git -C "$REPO" add src/lib.ts
git -C "$REPO" commit -q -m "fixture"
COMMITTED_SHA="$(sha256sum "$REPO/src/lib.ts" | cut -d' ' -f1)"

# The "test": passes while lib.ts still says limit = 50. It also copies what it saw, so a case can prove the mutation
# was really in place while the test ran.
PASSING_TEST="cp src/lib.ts '$T/seen.ts'; grep -qx 'const limit = 50' src/lib.ts"

table() {   # writes the table from the arguments, one line each
  : > "$T/mutations.tsv"
  printf '# selftest table\n' >> "$T/mutations.tsv"
  for line in "$@"; do printf '%s\n' "$line" >> "$T/mutations.tsv"; done
}
row() { printf '%s\t%s\t%s\t%s\t%s' "$1" "$2" "$3" "$4" "$5"; }

NCASE=0
NFAIL=0
# t NAME EXPECT_RC EXPECT_LAST_STDOUT_LINE_OR_- [RUNNER ARGUMENTS...]
t() {
  local name="$1" erc="$2" elast="$3" out rc last why=""
  shift 3
  out="$(cd "$REPO" && MUTATIONS_TSV="$T/mutations.tsv" bash "$RUNNER" "$@" 2> "$T/stderr")"; rc=$?
  last="$(printf '%s\n' "$out" | tail -n 1)"
  NCASE=$((NCASE + 1))
  [ "$rc" = "$erc" ] || why="exit code $rc, expected $erc"
  if [ -z "$why" ] && [ "$elast" != "-" ] && [ "$last" != "$elast" ]; then why="last stdout line '$last', expected '$elast'"; fi
  if [ -z "$why" ] && [ "$elast" = "-" ] && printf '%s\n' "$out" | grep -q '^MUTANT '; then why="a verdict was printed for a refused run"; fi
  if [ -z "$why" ] && [ "$(sha256sum "$REPO/src/lib.ts" | cut -d' ' -f1)" != "$EXPECT_SHA" ]; then why="src/lib.ts is not in the expected state afterwards"; fi
  if [ -z "$why" ]; then
    printf 'ok   %s\n' "$name"
  else
    NFAIL=$((NFAIL + 1))
    printf 'FAIL %s: %s\n' "$name" "$why"
    sed 's/^/     stderr: /' "$T/stderr" | tail -n 5
  fi
}
check() {   # check NAME CONDITION-COMMAND...
  local name="$1"; shift
  NCASE=$((NCASE + 1))
  if "$@"; then printf 'ok   %s\n' "$name"; else NFAIL=$((NFAIL + 1)); printf 'FAIL %s\n' "$name"; fi
}
EXPECT_SHA="$COMMITTED_SHA"

# ------------------------------------------------------------------------------------------------------ verdicts
table "$(row killed src/lib.ts 'const limit = 50' 'const limit = 5000' "$PASSING_TEST")"
rm -f "$T/seen.ts"
t "killed: the test fails under the mutation" 0 "MUTANT KILLED killed" killed
check "killed: the test really ran against the mutated file" grep -q 'const limit = 5000' "$T/seen.ts"
check "killed: git diff is empty afterwards" git -C "$REPO" diff --quiet

table "$(row survived src/lib.ts '// a comment the test never reads' '// A COMMENT' "$PASSING_TEST")"
t "survived: the test does not look at the mutated line" 1 "MUTANT SURVIVED survived" survived

table "$(row deleted src/lib.ts 'const limit = 50' '' "$PASSING_TEST")"
t "an empty replacement deletes the find text, and the test catches it" 0 "MUTANT KILLED deleted" deleted

printf '%s\r\n' "$(row crlf src/lib.ts 'const limit = 50' 'const limit = 51' "$PASSING_TEST")" > "$T/mutations.tsv"
t "a table line ending in CRLF still works" 0 "MUTANT KILLED crlf" crlf

# --------------------------------------------------------------------------------------------- refused (exit 2)
table "$(row missing src/lib.ts 'const limit = 999' 'x' "$PASSING_TEST")"
t "find text missing: refused" 2 - missing
table "$(row twice src/lib.ts 'const dup = 1' 'const dup = 2' "$PASSING_TEST")"
t "find text twice: refused" 2 - twice

table "$(row dirty src/lib.ts 'const limit = 50' 'const limit = 5000' "$PASSING_TEST")"
printf '// uncommitted work\n' >> "$REPO/src/lib.ts"
EXPECT_SHA="$(sha256sum "$REPO/src/lib.ts" | cut -d' ' -f1)"
t "dirty file: refused, and the uncommitted edit is kept" 2 - dirty
git -C "$REPO" add src/lib.ts
t "staged change: refused, and the staged edit is kept" 2 - dirty
git -C "$REPO" reset -q --hard
EXPECT_SHA="$COMMITTED_SHA"

table "$(row baseline src/lib.ts 'const limit = 50' 'const limit = 5000' "grep -qx 'const limit = 7' src/lib.ts")"
t "a test that already fails without the mutation: refused" 2 - baseline
table "$(row nocmd src/lib.ts 'const limit = 50' 'const limit = 5000' "definitely-not-a-command-u27 --run")"
t "a test command that does not exist: refused" 2 - nocmd

table "$(row killed src/lib.ts 'const limit = 50' 'const limit = 5000' "$PASSING_TEST")"
t "unknown name: refused" 2 - nosuch
table "$(row twin src/lib.ts 'const limit = 50' 'const limit = 1' "$PASSING_TEST")" "$(row twin src/lib.ts 'const limit = 50' 'const limit = 2' "$PASSING_TEST")"
t "a name listed twice: refused" 2 - twin
table "four${TAB}src/lib.ts${TAB}const limit = 50${TAB}const limit = 1"
t "a line with four fields: refused" 2 - four
table "$(row killed src/lib.ts 'const limit = 50' 'const limit = 5000' "$PASSING_TEST")"
t "a name with a space: refused" 2 - "bad name"
t "no argument: refused" 2 -

# ------------------------------------------------------------------------------------------------ interrupted run
# The signal is sent only from the run under the mutation (the baseline run sees the real file and just passes).
table "$(row term src/lib.ts 'const limit = 50' 'const limit = 5000' "if grep -qx 'const limit = 5000' src/lib.ts; then cp src/lib.ts '$T/seen.ts'; kill -TERM \$PPID; sleep 1; fi; grep -qx 'const limit = 50' src/lib.ts")"
rm -f "$T/seen.ts"
t "TERM while the test runs: file restored, exit 143" 143 - term
check "TERM: the mutation was in place when the signal came" grep -q 'const limit = 5000' "$T/seen.ts"
check "TERM: git diff is empty afterwards" git -C "$REPO" diff --quiet

# -------------------------------------------------------------------------------------------------------- summary
if [ "$NFAIL" -eq 0 ]; then
  printf 'SELFTEST PASS: %s cases\n' "$NCASE"
  exit 0
fi
printf 'SELFTEST FAIL: %s of %s cases failed\n' "$NFAIL" "$NCASE"
exit 1
