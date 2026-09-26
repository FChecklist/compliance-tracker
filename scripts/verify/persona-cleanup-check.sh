#!/usr/bin/env bash
# register: AW-703
# PROJEXA-BUILD-002 WP-14: after a persona run nothing is left behind. This script makes the mess on purpose (four throwaway links, two people demoted),
# proves it is a mess by re-reading the links table and the users' roles, runs the same cleanup every persona scenario ends with (each link revoked through
# the signed-in app route, each role restored), then re-reads: no link is active, every role equals its value at the start, every throwaway address answers
# 410, and a new link of the restored manager carries the manager's functions again. It also proves the rule that a second link for the same person and
# project revokes the first. Local execution host in dry mode: no live database, no secret.
# The transcript is written to ai-os/projexa-build-002/persona-runs/<date>-dry-cleanup-transcript.md.
#
# Exit 0 = every assertion held. Exit 1 = an assertion failed. Exit 2 = bun is not available. Last stderr line: `PASS AW-703` / `FAIL AW-703: <reason>`.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2
command -v bun >/dev/null 2>&1 || { printf 'FAIL AW-703: bun is not available on PATH\n' >&2; exit 2; }

if bun run scripts/verify/persona/persona-run.ts --scenario cleanup; then
  printf 'PASS AW-703\n' >&2
  exit 0
fi
printf 'FAIL AW-703: an assertion of the cleanup run failed (see above)\n' >&2
exit 1
