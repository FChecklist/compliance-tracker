#!/usr/bin/env bash
# register: BR-420 BR-421
#
# PROJEXA-BUILD-001 U-33, register rows BR-420 (E-09, the BOQ screen renders its line items with the network offline after one online load)
# and BR-421 (E-10, filtering a 10,907-line fixture runs in a Web Worker with no main-thread task over 50 ms). It runs ONE Playwright spec of
# the projexa repository against a LOCAL projexa server, through playwright.boq-local.config.ts in that checkout. That config starts the
# server itself (next dev on port 3117, both browser-first switches on) and a local stand-in for the Supabase Auth endpoints, so a synthetic
# signed-in browser is accepted; the Edge gateway and the page's /api calls are answered from synthetic fixture data inside the browser.
# No session is minted against any real project, nothing is deployed, and nothing reaches Vercel.
#
# Usage: bash scripts/verify/projexa-playwright.sh e2e/<name>.spec.ts
#   rows: bash scripts/verify/projexa-playwright.sh e2e/boq-offline.spec.ts        (BR-420)
#         bash scripts/verify/projexa-playwright.sh e2e/boq-worker-filter.spec.ts  (BR-421)
# Environment:
#   PROJEXA_DIR         the projexa checkout to run in. Default: ../projexa next to this repository, then C:/ct/projexa.
#   BOQ_LOCAL_BUNDLER   set to webpack to start the server with `next dev --webpack` (needed when the checkout's node_modules is a link to a
#                       folder outside it: Turbopack refuses that).
#   BOQ_LOCAL_PORT, BOQ_LOCAL_SUPABASE_PORT   the two local ports (defaults 3117 and 54399).
# PLAYWRIGHT_BASE_URL is removed for the run, so nothing can point these specs at a deployed site.
#
# COST. This starts Next.js dev and a Chromium: about 2 GB of memory and several minutes on the first compile. On the 8 GB development
# laptop run it through C:\ct\ct-worktrees\heavy.ps1 and only with 2 GB or more free.
#
# Exit 0 = Playwright exited 0 AND printed at least one `N passed` line and no `failed` or `flaky` line. Its own output is printed, and the
# summary line (for example `  1 passed (41.2s)`) is printed last. Exit 1 = the spec failed, or nothing passed (a skipped or empty run is
# not a pass). Exit 2 = usage error, or the checkout, the config or the spec is not there (for example the branch is not merged yet).
# The last stderr line is `PASS <row>` or `FAIL <row>: <reason>`.
set -u

ID="BR-420/BR-421"
finish_usage() { printf 'FAIL %s: %s\n' "$ID" "$1" >&2; exit 2; }
finish_fail()  { printf 'FAIL %s: %s\n' "$ID" "$1" >&2; exit 1; }

[ $# -eq 1 ] || finish_usage "usage: projexa-playwright.sh e2e/<name>.spec.ts"
SPEC="$1"
case "$SPEC" in
  /*|*..*|*\\*|*" "*) finish_usage "the spec path must be relative, with no .., no backslash and no space: $SPEC" ;;
esac
printf '%s' "$SPEC" | grep -q -E '^e2e/[A-Za-z0-9._-]+\.spec\.ts$' || finish_usage "the spec must be e2e/<name>.spec.ts, got: $SPEC"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="${PROJEXA_DIR:-}"
if [ -z "$DIR" ]; then
  for candidate in "$HERE/../../../projexa" "C:/ct/projexa"; do
    if [ -d "$candidate" ]; then DIR="$candidate"; break; fi
  done
fi
[ -n "$DIR" ] || finish_usage "no projexa checkout found: set PROJEXA_DIR"
[ -d "$DIR" ] || finish_usage "PROJEXA_DIR is not a folder: $DIR"
CONFIG="playwright.boq-local.config.ts"
[ -f "$DIR/$CONFIG" ] || finish_usage "$DIR/$CONFIG does not exist (the U-33 branch of projexa is not on this checkout)"
[ -f "$DIR/$SPEC" ] || finish_usage "$DIR/$SPEC does not exist (the U-33 branch of projexa is not on this checkout)"
command -v bunx >/dev/null 2>&1 || finish_usage "bunx is not on PATH"

OUT="$(mktemp)" || finish_usage "no temp file"
trap 'rm -f "$OUT"' EXIT

unset PLAYWRIGHT_BASE_URL
printf 'projexa checkout: %s\nspec: %s\n' "$DIR" "$SPEC" >&2
( cd "$DIR" && bunx playwright test -c "$CONFIG" "$SPEC" --workers=1 ) 2>&1 | tee "$OUT"
rc="${PIPESTATUS[0]}"

# The summary lines Playwright's list reporter ends with, for example "  1 passed (41.2s)" or "  1 failed".
SUMMARY="$(grep -E '^[[:space:]]*[0-9]+ (passed|failed|flaky|skipped|did not run)' "$OUT" | sed 's/\r$//')"

if [ "$rc" -ne 0 ]; then
  [ -n "$SUMMARY" ] && printf '%s\n' "$SUMMARY"
  finish_fail "playwright exited $rc"
fi
if printf '%s\n' "$SUMMARY" | grep -q -E '^[[:space:]]*[0-9]+ (failed|flaky)'; then
  printf '%s\n' "$SUMMARY"
  finish_fail "the run reports a failed or flaky test"
fi
PASSED_LINE="$(printf '%s\n' "$SUMMARY" | grep -E '^[[:space:]]*[0-9]+ passed' | tail -n 1)"
if [ -z "$PASSED_LINE" ]; then
  [ -n "$SUMMARY" ] && printf '%s\n' "$SUMMARY"
  finish_fail "playwright exited 0 but printed no 'N passed' line, so nothing is proven"
fi
printf '%s\n' "$PASSED_LINE"
printf 'PASS %s\n' "$ID" >&2
exit 0
