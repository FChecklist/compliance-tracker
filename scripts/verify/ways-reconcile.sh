#!/usr/bin/env bash
# register: AW-606
# PROJEXA-BUILD-002 WP-15: the ZOOMIES project, made in every way, is the same project: the total re-read from the database equals AED 1,596,280
# and each line is attributed to a real person.
#
#   ways 1, 2, 4 and 5: ways-reconcile.pglite.test.ts, all four on real Postgres (PGlite). Each figure is read back from the tables and the four
#     BOQs are compared line by line (item code, unit, quantity, rate); the BOQ's creator and the project's lead are a real user.
#       way 1  a person uploads the file
#       way 2  the internal chat with the file attached
#       way 4  the file arrives by email and its parked job is approved
#       way 5  a scheduler scans a connected folder and parks a proposal (nothing is made); the schedule owner's approval then fetches the
#              file again, checks its hash and finishes the parked job (folder-watch-approve.ts); no file is kept between scan and approval
#   way 3  an external AI through the link: way3-zoomies.sh, the persona run's own tables: 53 lines, AED 1,596,280, every change a
#          submission via the link by the person
#
# Also run: the approval's own tests (owner only, changed file refused, not connected, questions, one approval per proposal, two overlapping
# approvals make one project) and its route's transport tests, and way5-zoomies.sh (the scan itself, AW-605).
#
# Exit 0 = all five ways left a project that reconciles. Exit 1 = a check failed. Exit 2 = bun is not available.
# The last stderr line is `PASS AW-606` / `FAIL AW-606: <reason>`.
set -u

cd "$(dirname "$0")/../.." || exit 2
command -v bun >/dev/null 2>&1 || { printf 'FAIL AW-606: bun is not available on PATH
' >&2; exit 2; }

printf '== ways 1, 2, 4 and 5: one project, the same lines, attributed ==
' >&2
bun test --isolate src/lib/services/ways-reconcile.pglite.test.ts || { printf 'FAIL AW-606: ways 1, 2, 4 and 5 do not reconcile (see above)
' >&2; exit 1; }

printf '== way 5: the approval of a scanned proposal ==
' >&2
bun test --isolate src/lib/services/folder-watch-approve.test.ts || { printf 'FAIL AW-606: the way-5 approval checks failed (see above)
' >&2; exit 1; }
bun test --isolate "src/app/api/v1/projexa/scheduler-proposals/[id]/approve/route.test.ts" || { printf 'FAIL AW-606: the way-5 approve route checks failed (see above)
' >&2; exit 1; }

printf '== way 3: the external AI through the link ==
' >&2
bash scripts/verify/way3-zoomies.sh || { printf 'FAIL AW-606: way 3 did not reconcile (see above)
' >&2; exit 1; }

printf '== way 5: the scheduled scan (a proposal, no project) ==
' >&2
bash scripts/verify/way5-zoomies.sh || { printf 'FAIL AW-606: a way-5 scan check failed (see above)
' >&2; exit 1; }

printf 'PASS AW-606: ways 1, 2, 3, 4 and 5 all leave one project whose 53 lines add up to AED 1,596,280 with every row attributed to a real person
' >&2
exit 0
