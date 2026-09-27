#!/usr/bin/env bash
# register: AW-606
# PROJEXA-BUILD-002 WP-15: the ZOOMIES project, made in every way, is the same project: the total re-read from the database equals AED 1,596,280
# and each line is attributed to a real person.
#
#   way 1  upload            \
#   way 2  internal chat      >  ways-reconcile.pglite.test.ts: all three on real Postgres (PGlite), each figure read back from the tables, the three
#   way 4  email             /   BOQs compared line by line (item code, unit, quantity, rate); the BOQ's creator and the project's lead are a real user
#   way 3  external AI link     way3-zoomies.sh: the persona run's own tables: 53 lines, AED 1,596,280, every change a submission via the link by the person
#   way 5  scheduler folder     way5-zoomies.sh: ends in ONE parked proposal and creates NO project, by design (WP-13). It has no project to reconcile, and
#                               there is no approve action for a scanned proposal (owner decision D-1; approving one also needs the owner's Drive or mailbox
#                               connection). That is a gap in the product, not in this script.
#
# Exit 0 = ALL FIVE ways left a project that reconciles. That is not possible until way 5 can create one, so today:
# Exit 3 = ways 1 to 4 reconcile and way 5's proposal checks hold, but way 5 has no project (the row stays pending). Exit 1 = a check failed.
# Exit 2 = bun is not available. The last stderr line is `PASS AW-606` / `PARTIAL AW-606: ...` / `FAIL AW-606: <reason>`.
set -u

cd "$(dirname "$0")/../.." || exit 2
command -v bun >/dev/null 2>&1 || { printf 'FAIL AW-606: bun is not available on PATH\n' >&2; exit 2; }

printf '== ways 1, 2 and 4: one project, the same lines, attributed ==\n' >&2
bun test --isolate src/lib/services/ways-reconcile.pglite.test.ts || { printf 'FAIL AW-606: ways 1, 2 and 4 do not reconcile (see above)\n' >&2; exit 1; }

printf '== way 3: the external AI through the link ==\n' >&2
bash scripts/verify/way3-zoomies.sh || { printf 'FAIL AW-606: way 3 did not reconcile (see above)\n' >&2; exit 1; }

printf '== way 5: the scheduled scan (a proposal, no project) ==\n' >&2
bash scripts/verify/way5-zoomies.sh || { printf 'FAIL AW-606: a way-5 check failed (see above)\n' >&2; exit 1; }

printf 'PARTIAL AW-606: ways 1, 2, 3 and 4 reconcile to AED 1,596,280 with every row attributed; way 5 creates a parked proposal and no project, so there is nothing of it to reconcile until an approve action exists (owner decision D-1)\n' >&2
exit 3
