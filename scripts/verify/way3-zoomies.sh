#!/usr/bin/env bash
# register: AW-603
# PROJEXA-BUILD-002 WP-14: way three, an external AI given only the link reads the ZOOMIES workbook itself and creates and fills the project through the link.
# Local execution host in dry mode, the ZOOMIES project NOT created beforehand (--seed persona-empty): the person clicks "New project with my AI" (POST
# /new-project: a shell project and a level-0 link), the AI reads the workbook (the public fixture as an .xlsx) with its own reading, and then drafts
# update_project, create_boq (empty), add_boq_lines in batches of 25, 25 and 3 (a repeated batch is a replay, not a copy) and seal_boq. The person confirms each
# draft on the confirm-page path. A seal with wrong control totals is refused with TOTAL_MISMATCH and seals nothing; a sealed BOQ takes no more lines.
# Re-read from the database: 53 lines, AED 1,596,280, no item code twice, every change a submission via ai_link by the person with model_calls 0.
# The transcript is written to ai-os/projexa-build-002/persona-runs/<date>-dry-way3-transcript.md.
#
# Exit 0 = every assertion held. Exit 1 = an assertion failed. Exit 2 = bun is not available. Last stderr line: `PASS AW-603` / `FAIL AW-603: <reason>`.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2
command -v bun >/dev/null 2>&1 || { printf 'FAIL AW-603: bun is not available on PATH\n' >&2; exit 2; }

if bun run scripts/verify/persona/persona-run.ts --scenario way3; then
  printf 'PASS AW-603\n' >&2
  exit 0
fi
printf 'FAIL AW-603: an assertion of the way-three run failed (see above)\n' >&2
exit 1
