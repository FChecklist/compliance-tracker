#!/usr/bin/env bash
# register: AW-602
# PROJEXA-BUILD-002 WP-11: way two, the internal chat with the ZOOMIES workbook attached creates the project and fills it, and the model call is metered.
#
#   bash scripts/verify/way2-zoomies.sh   Runs the way-2 tests (no network, no live database, no secret; the model is a stand-in and the ledger is in memory):
#       chat-attachment.test.ts             propose creates nothing and says so (27 open questions for ZOOMIES); confirm creates ONE project and ONE BOQ of 53 lines
#                                            with no second model call; the words of the message never choose the function; a hostile model creates nothing
#       route.attachment.test.ts            the real POST /api/v1/projexa/assistant route: propose 200, confirm 201, the transaction is never nested, and the model call
#                                            wrote one ledger row for this organisation and person (product_orchestra, METERED_API); a key for one project is 403
#       internal-ai-policy.test.ts          which provider route the policy allows and refuses (no metered key = a refused answer, nothing read)
#       internal-model-gateway.test.ts      the metered caller: one METERED_API row per call, the model's JSON returned, failures written as rows too
#
# Exit 0 = every test passed. Exit 1 = a test failed (bun's own report is above). Exit 2 = bun is not available.
# The last stderr line is `PASS AW-602` / `FAIL AW-602: <reason>`.
set -u

cd "$(dirname "$0")/../.." || exit 2
[ $# -eq 0 ] || { printf 'FAIL AW-602: takes no argument\n' >&2; exit 2; }
command -v bun >/dev/null 2>&1 || { printf 'FAIL AW-602: bun is not available on PATH\n' >&2; exit 2; }

if bun test --isolate \
  src/lib/pipeline/chat-attachment.test.ts \
  src/app/api/v1/projexa/assistant/route.attachment.test.ts \
  src/lib/ai/internal-ai-policy.test.ts \
  src/lib/ai/internal-model-gateway.test.ts; then
  printf 'PASS AW-602\n' >&2
  exit 0
fi
printf 'FAIL AW-602: a way-2 test failed (see above)\n' >&2
exit 1
