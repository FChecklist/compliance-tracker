#!/usr/bin/env bash
# register: AW-510
# PROJEXA-BUILD-002 WP-09b (spec 10.9): the kill-switch drill of the Universal AI Work Link write path. It starts the local execution host in dry mode
# (scripts/awl-local-exec-host.ts: the real link function, the real exec function and the real pipeline over an in-process database), switches
# platform.ai_work_link_settings.writes_enabled off and proves that every write path is refused and NO row is written, then switches it on again and proves
# the same recorded intent runs once. No live database, no secret, no network beyond 127.0.0.1.
#
# Exit 0 = every assertion held. stdout last line: AWL_KILLSWITCH actions=403 exec=refused rows_written=0 resumed=done
# Exit 1 = an assertion failed (one FAIL line each on stderr). Exit 2 = bun is not available.
# Runtime: about 30 seconds on the 8 GB laptop (PGlite start-up dominates). Usage: bash scripts/verify/awl-killswitch-drill.sh
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
command -v bun >/dev/null 2>&1 || { echo "FAIL AW-510: bun is not available on PATH" >&2; exit 2; }
cd "$ROOT" || exit 2
exec bun run scripts/verify/awl-killswitch-drill.ts
