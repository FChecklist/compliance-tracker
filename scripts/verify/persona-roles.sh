#!/usr/bin/env bash
# register: AW-702
# PROJEXA-BUILD-002 WP-14: the role limits, run as the external AI over plain HTTP against the local execution host in dry mode (no live database, no secret).
#   * a MEMBER's link (rank 2): its function list holds no rank-3 function, a rank-3 function sent to /actions or /drafts is refused (403), and every money
#     column is hidden in records/boq_lines, roster, materials and boqs and in the CSV form; what a member may do (a progress entry) works and is
#     attributed to her; a money change on her link is a DRAFT (nothing is written until it is confirmed) and straight to /actions is LEVEL_NOT_ALLOWED;
#   * a VIEWER may make a level-0 link only and it lists rank-1 functions only; a person of another organisation cannot make a link for the project;
#   * a link for ANOTHER project of the same organisation is refused the ZOOMIES project and reads its records as absent, with nothing written;
#   * a DEMOTION changes what an existing link may do at once (functions, money redaction) and a draft confirmed after it is refused (ROLE_CHANGED).
# The transcript is written to ai-os/projexa-build-002/persona-runs/<date>-dry-roles-transcript.md.
#
# Exit 0 = every assertion held. Exit 1 = an assertion failed. Exit 2 = bun is not available. Last stderr line: `PASS AW-702` / `FAIL AW-702: <reason>`.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2
command -v bun >/dev/null 2>&1 || { printf 'FAIL AW-702: bun is not available on PATH\n' >&2; exit 2; }

if bun run scripts/verify/persona/persona-run.ts --scenario roles; then
  printf 'PASS AW-702\n' >&2
  exit 0
fi
printf 'FAIL AW-702: an assertion of the roles run failed (see above)\n' >&2
exit 1
