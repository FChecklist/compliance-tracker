#!/usr/bin/env bash
# register: AW-104
#
# One-name mutation runner (PROJEXA-BUILD-002, WP-01, register row AW-104). p5-mutations.sh runs a fixed list of five;
# this runs ONE named mutation from scripts/verify/mutations.tsv through scripts/verify/mutation-check.sh and proves the tree
# is exactly as it was before. The mutation-check.sh contract is unchanged: the test must pass on the real code, fail under the
# planted bug, and the file is always put back.
#
# multisheet-no-reconcile (AW-104): the reconciliation step of the multi-sheet bill reader
# (src/lib/ingest/multisheet-bill-reader.ts) is replaced by a stub that reports "reconciled" with no totals and no differences,
# which is the bug this guards against: a reader that stops comparing the lines with the totals the file prints and still says
# everything matches. multisheet-bill-reader.test.ts (AW-101) must fail.
#
# THE STEPS. (1) the working tree must be clean for tracked files, so nothing anyone is working on can be touched; (2) the name
# must occur exactly once in the table, and the sha256 of the file it names is taken; (3) mutation-check.sh runs the mutation
# (its own lines go to stdout, test output to stderr); (4) afterwards the tree must be clean again and the file's sha256 must
# equal the value taken in step 2.
#
# USAGE   bash scripts/verify/mutation-run.sh <name>
#         (MUTATIONS_TSV names another table and MUTATION_CHECK_SCRIPT another copy of mutation-check.sh, both for self-tests)
# OUTPUT  on success the last stdout line is   mutation detected and tree restored
#         otherwise one of                      mutation NOT detected (the test still passed under the bug)
#                                               tree NOT restored
# EXIT    0  killed and tree restored
#         1  the mutant survived, or the tree is not as it was
#         2  usage or precondition problem (an argument, not in a git repository, a dirty tree, a name missing or doubled in the
#            table, mutation-check.sh could not run the check); nothing was mutated or the file was restored by mutation-check.sh
set -u

fail_usage() { printf 'MUTATION RUN ERROR: %s\n' "$1" >&2; exit 2; }

[ $# -eq 1 ] || fail_usage "usage: bash scripts/verify/mutation-run.sh <name>"
NAME="$1"
case "$NAME" in ''|*[!A-Za-z0-9._-]*) fail_usage "the mutation name may hold only letters, digits, dot, dash and underscore" ;; esac

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK="${MUTATION_CHECK_SCRIPT:-$HERE/mutation-check.sh}"
[ -f "$CHECK" ] || fail_usage "mutation-check.sh not found: $CHECK"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || fail_usage "not inside a git repository"
cd "$ROOT" || fail_usage "cannot enter the repository root"
TABLE="${MUTATIONS_TSV:-scripts/verify/mutations.tsv}"
[ -f "$TABLE" ] || fail_usage "mutation table not found: $TABLE"
export MUTATIONS_TSV="$TABLE"
command -v sha256sum >/dev/null 2>&1 || fail_usage "sha256sum is required"

# Step 1: a clean tree.
DIRTY="$(git status --porcelain --untracked-files=no)"
[ -z "$DIRTY" ] || fail_usage "the working tree has changes to tracked files; commit or stash them first:
$DIRTY"

# Step 2: the name once in the table, and the file it names.
FILE="$(awk -F'\t' -v n="$NAME" '{ sub(/\r$/, "") } /^#/ { next } $1 == n { print $2 }' "$TABLE")"
COUNT="$(printf '%s' "$FILE" | grep -c '^' || true)"
[ "$COUNT" = "1" ] || fail_usage "mutation '$NAME' appears $COUNT times in $TABLE (expected exactly once)"
[ -f "$FILE" ] || fail_usage "mutation '$NAME' names a file that does not exist: $FILE"
SHA_BEFORE="$(sha256sum "$FILE")"

# Step 3: the mutation through mutation-check.sh.
OUT="$(bash "$CHECK" "$NAME")"
RC=$?
[ -n "$OUT" ] && printf '%s\n' "$OUT"
LAST="$(printf '%s\n' "$OUT" | tail -n 1)"

# Step 4: the tree as it was.
TREE_CLEAN=yes
[ -z "$(git status --porcelain --untracked-files=no)" ] || TREE_CLEAN=no
[ "$(sha256sum "$FILE")" = "$SHA_BEFORE" ] || TREE_CLEAN=no

if [ "$TREE_CLEAN" != "yes" ]; then
  printf 'tree NOT restored\n'
  exit 1
fi
if [ "$RC" -eq 0 ] && [ "$LAST" = "MUTANT KILLED $NAME" ]; then
  printf 'mutation detected and tree restored\n'
  exit 0
fi
if [ "$RC" -eq 1 ] && [ "$LAST" = "MUTANT SURVIVED $NAME" ]; then
  printf 'mutation NOT detected (the test still passed under the bug)\n'
  exit 1
fi
printf 'MUTATION RUN ERROR: mutation-check.sh exit %s (its last stderr line says why)\n' "$RC" >&2
exit 2
