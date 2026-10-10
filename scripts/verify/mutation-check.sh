#!/usr/bin/env bash
# register: BR-405
#
# Mutation check runner (PROJEXA-BUILD-001, unit U-27; first used by BR-405, the falsifiability partner of BR-404).
#
# WHAT IT PROVES. A green test only means something if it goes red when the code it guards is broken. This applies ONE
# named, reviewed mutation (a plausible bug, written down in scripts/verify/mutations.tsv) to one tracked file, runs
# that mutation's test command, ALWAYS puts the file back, and reports whether the test caught it:
#   MUTANT KILLED <name>     the test passed on the real code and FAILED under the mutation (the result a register row wants)
#   MUTANT SURVIVED <name>   the test still passed with the bug in place: the test does not guard what it claims to
#
# THE TABLE. scripts/verify/mutations.tsv (or the file named by MUTATIONS_TSV; the self-test uses that). One mutation per
# line, five fields separated by one tab each:
#   name          letters, digits, dot, dash, underscore; unique in the table
#   file          path relative to the repository root; must be tracked by git
#   find          the exact text to replace; must occur exactly once in the file (one line, no tab)
#   replacement   the text put in its place; may be empty (the mutation then deletes the find text)
#   command       the test command, run with bash -c from the repository root, for example
#                 bun test --isolate src/app/api/v1/construction/boq/route.d11.test.ts
# Lines that start with # and empty lines are ignored. A trailing carriage return on a line is ignored.
#
# THE STEPS. (1) the file must have no change in the working tree or the index (git diff and git diff --cached empty);
# (2) the find text must occur exactly once; (3) the command runs on the unmutated file and must pass (a test that
# already fails would "kill" every mutant); (4) the mutation is applied; (5) the command runs again; (6) the file is
# restored with git checkout, and the trap does the same on any exit, error, Ctrl-C or TERM; (7) git diff for the file
# must be empty again and its sha256 must equal the value taken in step 1. Test output goes to stderr; stdout carries
# only this script's own lines, and its last line is the verdict.
#
# USAGE   bash scripts/verify/mutation-check.sh <name>
# EXIT    0  MUTANT KILLED <name> (last stdout line)
#         1  MUTANT SURVIVED <name> (last stdout line)
#         2  usage or setup problem (unknown name, bad table line, dirty file, find text not exactly once, baseline test
#            failed, test command not found, restore failed); the last stderr line says which
set -u

fail_usage() { printf 'MUTATION CHECK ERROR: %s\n' "$1" >&2; exit 2; }

[ $# -eq 1 ] || fail_usage "usage: bash scripts/verify/mutation-check.sh <name>"
NAME="$1"
case "$NAME" in ''|*[!A-Za-z0-9._-]*) fail_usage "the mutation name may hold only letters, digits, dot, dash and underscore" ;; esac

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || fail_usage "not inside a git repository"
cd "$ROOT" || fail_usage "cannot enter the repository root"
TABLE="${MUTATIONS_TSV:-scripts/verify/mutations.tsv}"
[ -f "$TABLE" ] || fail_usage "mutation table not found: $TABLE"
command -v node >/dev/null 2>&1 || fail_usage "node is required to apply a mutation byte for byte"
command -v sha256sum >/dev/null 2>&1 || fail_usage "sha256sum is required"

TAB="$(printf '\t')"
FOUND=0
LINE=""
while IFS= read -r raw || [ -n "$raw" ]; do
  raw="${raw%$'\r'}"
  case "$raw" in ''|'#'*) continue ;; esac
  [ "${raw%%"$TAB"*}" = "$NAME" ] || continue
  FOUND=$((FOUND + 1))
  LINE="$raw"
done < "$TABLE"
[ "$FOUND" -eq 1 ] || fail_usage "mutation '$NAME' appears $FOUND times in $TABLE (expected exactly once)"

FIELDS="$(printf '%s' "$LINE" | awk -F'\t' '{ print NF }')"
[ "$FIELDS" = "5" ] || fail_usage "mutation '$NAME' has $FIELDS tab-separated fields (expected 5: name, file, find, replacement, command)"
# Split with awk, not `read`: read treats a tab IFS as whitespace and would merge an empty replacement field away.
FILE="$(printf '%s' "$LINE" | awk -F'\t' '{ print $2 }')"
FIND="$(printf '%s' "$LINE" | awk -F'\t' '{ print $3 }')"
REPLACE="$(printf '%s' "$LINE" | awk -F'\t' '{ print $4 }')"
CMD="$(printf '%s' "$LINE" | awk -F'\t' '{ print $5 }')"
[ -n "$FILE" ] || fail_usage "mutation '$NAME' names no file"
[ -n "$FIND" ] || fail_usage "mutation '$NAME' has an empty find text"
[ -n "$CMD" ] || fail_usage "mutation '$NAME' has no test command"
[ "$FIND" != "$REPLACE" ] || fail_usage "mutation '$NAME' replaces the find text with itself"
case "$FILE" in /*|*..*) fail_usage "the file must be a path inside the repository: $FILE" ;; esac
[ -f "$FILE" ] || fail_usage "file not found: $FILE"
git ls-files --error-unmatch -- "$FILE" >/dev/null 2>&1 || fail_usage "file is not tracked by git: $FILE"

# Step 1: a clean file, so restoring it with git checkout cannot throw away anyone's work.
git diff --quiet -- "$FILE" || fail_usage "file has uncommitted changes, refusing to mutate it: $FILE"
git diff --cached --quiet -- "$FILE" || fail_usage "file has staged changes, refusing to mutate it: $FILE"
SHA_BEFORE="$(sha256sum "$FILE" | cut -d' ' -f1)"

# Step 2: the find text occurs exactly once (counted on bytes, overlapping occurrences included).
COUNT="$(MC_FILE="$FILE" MC_FIND="$FIND" node -e '
const b = require("fs").readFileSync(process.env.MC_FILE); const f = Buffer.from(process.env.MC_FIND, "utf8");
let n = 0; for (let i = b.indexOf(f); i >= 0; i = b.indexOf(f, i + 1)) n++; console.log(n)')" || fail_usage "could not read $FILE"
[ "$COUNT" = "1" ] || fail_usage "the find text of '$NAME' occurs $COUNT times in $FILE (expected exactly once)"

run_test() {
  bash -c "$CMD" 1>&2
}

# Step 3: the test must pass on the real code.
printf 'MUTATION %s: baseline run of the test on the unmutated %s\n' "$NAME" "$FILE"
run_test
BASE=$?
[ "$BASE" -ne 126 ] && [ "$BASE" -ne 127 ] || fail_usage "the test command could not be run (exit $BASE): $CMD"
[ "$BASE" -eq 0 ] || fail_usage "the test fails WITHOUT the mutation (exit $BASE), so a failure under it would prove nothing: $CMD"

RESTORED=0
restore() {
  if [ "$RESTORED" -eq 0 ]; then
    git checkout -- "$FILE" 2>/dev/null
    RESTORED=1
  fi
}
trap 'restore' EXIT
trap 'restore; printf "MUTATION CHECK ERROR: interrupted, %s restored\n" "$FILE" >&2; exit 130' INT
trap 'restore; printf "MUTATION CHECK ERROR: terminated, %s restored\n" "$FILE" >&2; exit 143' TERM

# Step 4: apply the mutation, byte for byte.
MC_FILE="$FILE" MC_FIND="$FIND" MC_REPLACE="$REPLACE" node -e '
const fs = require("fs"); const b = fs.readFileSync(process.env.MC_FILE); const f = Buffer.from(process.env.MC_FIND, "utf8");
const i = b.indexOf(f); if (i < 0) process.exit(3);
fs.writeFileSync(process.env.MC_FILE, Buffer.concat([b.subarray(0, i), Buffer.from(process.env.MC_REPLACE, "utf8"), b.subarray(i + f.length)]))' \
  || fail_usage "could not apply the mutation to $FILE"
git diff --quiet -- "$FILE" && fail_usage "the mutation left $FILE unchanged"
printf 'MUTATION %s: applied to %s, running: %s\n' "$NAME" "$FILE" "$CMD"

# Step 5: the test under the mutation.
run_test
MUTANT=$?

# Steps 6 and 7: restore and prove it.
restore
trap - EXIT INT TERM
git diff --quiet -- "$FILE" || fail_usage "RESTORE FAILED: git diff for $FILE is not empty"
SHA_AFTER="$(sha256sum "$FILE" | cut -d' ' -f1)"
[ "$SHA_AFTER" = "$SHA_BEFORE" ] || fail_usage "RESTORE FAILED: $FILE is not byte-identical to its state before the mutation"
printf 'MUTATION %s: %s restored, git diff empty, sha256 unchanged\n' "$NAME" "$FILE"

[ "$MUTANT" -ne 126 ] && [ "$MUTANT" -ne 127 ] || fail_usage "the test command could not be run under the mutation (exit $MUTANT): $CMD"
if [ "$MUTANT" -ne 0 ]; then
  printf 'MUTANT KILLED %s\n' "$NAME"
  exit 0
fi
printf 'MUTANT SURVIVED %s\n' "$NAME"
exit 1
