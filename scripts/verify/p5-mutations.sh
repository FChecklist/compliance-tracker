#!/usr/bin/env bash
# register: BR-525
#
# Phase-5 mutation runner (PROJEXA-BUILD-001, unit U-42a, register row BR-525).
#
# WHAT IT PROVES. Each phase-5 unit has a test file that claims to guard one behaviour. This runs five named mutations from
# scripts/verify/mutations.tsv, one per phase-5 unit, through scripts/verify/mutation-check.sh (which applies ONE planted bug,
# requires the unit's test to pass on the real code and to FAIL under the bug, and always restores the file), counts how many
# were caught, and proves the tree is exactly as it was before:
#   p5-u36b-cap-at-equality      U-36b spend cap (budget.ts of the projexa-document-extract Edge Function)
#   p5-u36-cell-hidden-chars     U-36 injection defence (document-extraction-service.ts)
#   p5-u37-idempotency-lookup    U-37 idempotency of POST /api/v1/projexa/projects/from-document
#   p5-u38-drawing-no-supersede  U-38 registry trap: create_drawing supersedes the previous revision
#   p5-u40-secret-not-compared   U-40 scheduler bridge: the shared-secret check of the run route
# The table holds the file, the exact find text, the replacement and the one test command of each; its comment header says why
# each is a plausible bug.
#
# THE STEPS. (1) the working tree must be clean for tracked files (git status --porcelain --untracked-files=no is empty), so
# nothing anyone is working on can be touched; (2) each name must occur exactly once in the table, and the sha256 of every file
# the five rows name is taken; (3) mutation-check.sh runs each mutation in turn (its own lines go to stdout, test output to
# stderr); (4) afterwards the tree must be clean again and every file's sha256 must equal the value taken in step 2.
#
# USAGE   bash scripts/verify/p5-mutations.sh
#         (no arguments; MUTATIONS_TSV names another table and MUTATION_CHECK_SCRIPT another copy of mutation-check.sh, both for
#         the self-test scripts/verify/p5-mutations.selftest.sh)
# OUTPUT  the last stdout line is always   caught=<n> of 5 tree_clean=<yes|no>   when the run started
# EXIT    0  all five killed and tree_clean=yes
#         1  a mutant survived, a mutation could not be checked (mutation-check.sh exit 2, reported as ERROR), or tree_clean=no
#         2  usage or precondition problem (an argument, not in a git repository, a dirty tree, a name missing or doubled in the
#            table); nothing was mutated and no summary line is printed
set -u

fail_usage() { printf 'P5 MUTATIONS ERROR: %s\n' "$1" >&2; exit 2; }

[ $# -eq 0 ] || fail_usage "usage: bash scripts/verify/p5-mutations.sh (no arguments)"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK="${MUTATION_CHECK_SCRIPT:-$HERE/mutation-check.sh}"
[ -f "$CHECK" ] || fail_usage "mutation-check.sh not found: $CHECK"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || fail_usage "not inside a git repository"
cd "$ROOT" || fail_usage "cannot enter the repository root"
TABLE="${MUTATIONS_TSV:-scripts/verify/mutations.tsv}"
[ -f "$TABLE" ] || fail_usage "mutation table not found: $TABLE"
export MUTATIONS_TSV="$TABLE"
command -v sha256sum >/dev/null 2>&1 || fail_usage "sha256sum is required"

NAMES="p5-u36b-cap-at-equality p5-u36-cell-hidden-chars p5-u37-idempotency-lookup p5-u38-drawing-no-supersede p5-u40-secret-not-compared"
TOTAL=5

# Step 1: a clean tree.
DIRTY="$(git status --porcelain --untracked-files=no)"
[ -z "$DIRTY" ] || fail_usage "the working tree has changes to tracked files; commit or stash them first:
$DIRTY"

# Step 2: every name once in the table, and the files the rows name.
FILES=""
for name in $NAMES; do
  rows="$(awk -F'\t' -v n="$name" '{ sub(/\r$/, "") } /^#/ { next } $1 == n { print $2 }' "$TABLE")"
  count="$(printf '%s' "$rows" | grep -c '^' || true)"
  [ "$count" = "1" ] || fail_usage "mutation '$name' appears $count times in $TABLE (expected exactly once)"
  [ -f "$rows" ] || fail_usage "mutation '$name' names a file that does not exist: $rows"
  case " $FILES " in *" $rows "*) ;; *) FILES="$FILES $rows" ;; esac
done
SHAS_BEFORE="$(for f in $FILES; do sha256sum "$f"; done)"

# Step 3: each mutation through mutation-check.sh.
CAUGHT=0
RESULTS=""
for name in $NAMES; do
  out="$(bash "$CHECK" "$name")"
  rc=$?
  [ -n "$out" ] && printf '%s\n' "$out"
  last="$(printf '%s\n' "$out" | tail -n 1)"
  if [ "$rc" -eq 0 ] && [ "$last" = "MUTANT KILLED $name" ]; then
    CAUGHT=$((CAUGHT + 1))
    RESULTS="$RESULTS
killed    $name"
  elif [ "$rc" -eq 1 ] && [ "$last" = "MUTANT SURVIVED $name" ]; then
    RESULTS="$RESULTS
SURVIVED  $name"
  else
    RESULTS="$RESULTS
ERROR     $name (mutation-check.sh exit $rc; its last stderr line says why)"
  fi
done

# Step 4: the tree as it was.
TREE_CLEAN=yes
[ -z "$(git status --porcelain --untracked-files=no)" ] || TREE_CLEAN=no
SHAS_AFTER="$(for f in $FILES; do sha256sum "$f"; done)"
[ "$SHAS_AFTER" = "$SHAS_BEFORE" ] || TREE_CLEAN=no

printf 'P5 MUTATIONS:%s\n' "$RESULTS"
printf 'caught=%s of %s tree_clean=%s\n' "$CAUGHT" "$TOTAL" "$TREE_CLEAN"
[ "$CAUGHT" -eq "$TOTAL" ] && [ "$TREE_CLEAN" = "yes" ] && exit 0
exit 1
