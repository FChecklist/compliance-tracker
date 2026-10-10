#!/usr/bin/env bash
# register: AW-601
# PROJEXA-BUILD-002 WP-10 and WP-01: way one, a person uploads the ZOOMIES workbook in PROJEXA, a project is created and filled, and the database says so.
#
# Two halves, run one after the other, and BOTH must pass. They are kept apart on purpose (the spec e2e/upload-proposals.spec.ts says the same): a stubbed
# screen test is never read as a database proof, and a database test never proves a screen.
#
#   1. SCREEN. One Playwright spec of the projexa repository, through scripts/verify/projexa-playwright.sh (a local PROJEXA server, a synthetic signed-in
#      browser, the page's /api calls answered in the browser): the upload screen sends the file with its hash and the chosen product, shows the questions and
#      the shortfall in words, asks the person to confirm, and lands on the created project. Needs the projexa checkout on main (the WP-10 spec is there):
#      set PROJEXA_DIR to it. Needs about 2 GB of free memory: with less than 1.5 GB available this half is NOT run and the script exits 1, never 0.
#   2. DATABASE. The real route POST/GET /api/v1/projexa/projects/from-document and the real importer on PGlite (in-process Postgres with the live table
#      definitions), each count read back from the tables, no live database, no secret, a stand-in model:
#        route.test.ts          one project, one BOQ and every line; a second submit of the same file is the same project; a hostile model creates nothing
#        route.job.test.ts      the ZOOMIES upload: questions first, then created; a shortfall creates nothing until acknowledged; the job states
#        route.email-job.test.ts the confirmed job: a project and 53 lines that add up to AED 1,596,280, read back from the tables
#        route.multisheet.test.ts the 22-sheet workbook into an existing project: one BOQ, total 1,596,280
#        document-extraction-reconcile.test.ts   the reconciliation to AED 1,596,280 (Play 1,343,445, Vet 252,835)
#
#   bash scripts/verify/way1-zoomies.sh             both halves (AW-601)
#   bash scripts/verify/way1-zoomies.sh --db-only   the database half alone; prints DB-HALF ONLY and exits 3, so a partial run is never read as a pass
#
# Exit 0 = both halves passed. Exit 1 = a half failed or the screen half could not run. Exit 2 = a tool is missing. Exit 3 = --db-only and the database half passed.
# The last stderr line is `PASS AW-601` / `FAIL AW-601: <reason>` / `DB-HALF ONLY AW-601`.
set -u

cd "$(dirname "$0")/../.." || exit 2
HERE="$(pwd)"
MODE=both
case "${1:-}" in
  "") ;;
  --db-only) MODE=db ;;
  *) printf 'FAIL AW-601: unknown argument (only --db-only is accepted)\n' >&2; exit 2 ;;
esac
command -v bun >/dev/null 2>&1 || { printf 'FAIL AW-601: bun is not available on PATH\n' >&2; exit 2; }

if [ "$MODE" = both ]; then
  [ -n "${PROJEXA_DIR:-}" ] || { printf 'FAIL AW-601: set PROJEXA_DIR to a projexa checkout on main (the screen half needs its e2e/upload-proposals.spec.ts)\n' >&2; exit 2; }
  [ -f "$PROJEXA_DIR/e2e/upload-proposals.spec.ts" ] || { printf 'FAIL AW-601: %s/e2e/upload-proposals.spec.ts does not exist\n' "$PROJEXA_DIR" >&2; exit 2; }
fi

printf '== AW-601, first run: the database half, read back from the tables ==\n' >&2
if ! bun test --isolate \
  src/app/api/v1/projexa/projects/from-document/route.test.ts \
  src/app/api/v1/projexa/projects/from-document/route.job.test.ts \
  src/app/api/v1/projexa/projects/from-document/route.email-job.test.ts \
  src/app/api/v1/projexa/scope/import/route.multisheet.test.ts \
  src/lib/services/document-extraction-reconcile.test.ts; then
  printf 'FAIL AW-601: a database-half test failed (see above)\n' >&2
  exit 1
fi
if [ "$MODE" = db ]; then
  printf 'DB-HALF ONLY AW-601 (the screen half was not run)\n' >&2
  exit 3
fi

printf '== AW-601, second run: the screen half (Playwright, local PROJEXA) ==\n' >&2
avail_mb="$(powershell.exe -NoProfile -Command "[int](Get-Counter '\\Memory\\Available MBytes').CounterSamples.CookedValue" 2>/dev/null | tr -d '\r' | tail -1)"
case "$avail_mb" in ''|*[!0-9]*) printf 'FAIL AW-601: could not read the available memory\n' >&2; exit 1 ;; esac
if [ "$avail_mb" -lt 1500 ]; then
  printf 'FAIL AW-601: %s MB of memory is available and the screen half needs about 1500 MB or more; it was not run\n' "$avail_mb" >&2
  exit 1
fi
export PROJEXA_DIR
export BOQ_LOCAL_BUNDLER="${BOQ_LOCAL_BUNDLER:-webpack}"
if ! bash "$HERE/scripts/verify/projexa-playwright.sh" e2e/upload-proposals.spec.ts; then
  printf 'FAIL AW-601: the upload-screen spec failed (see above)\n' >&2
  exit 1
fi
printf 'PASS AW-601\n' >&2
exit 0
