#!/usr/bin/env bash
# register: AW-701 (dry run, local execution host); AW-901 (--live, owner steps; not runnable here)
# PROJEXA-BUILD-002 WP-14: the persona run. The Claude Code session acts as the EXTERNAL AI of a project manager ("Sumeet") who manages the ZOOMIES project
# through his AI work link, over plain HTTP. It starts the local execution host in dry mode (scripts/awl-local-exec-host.ts --dry --seed persona: the real link
# function, the real exec function and the real pipeline over an in-process database; no live database, no secret, nothing leaves 127.0.0.1), makes a link the
# way the person does, and works a week (five links, one a day): it reads the manual, /context, /functions and /records, makes level-1 changes directly
# (progress, attendance, RFIs, punch list, diary, schedule, milestones, meetings and minutes, timesheets, material issues), drafts level-2 changes that
# the signed-in person confirms on the confirm-page path (roster, RFI answers, submittal reviews, timesheet approval, materials with money, site
# instructions, change orders, a billing claim, a KPI entry, the project's dates), and tries what it must not do (coding-like functions, a level-2 function
# straight to /actions, another project's ids, another organisation's project, a made-up token, a token in the address). Every assertion re-reads the
# persisted rows: attribution to the person, executor `ai`, via ai_link, model_calls 0, the value written.
# The transcript (tokens cut to six characters) is written to ai-os/projexa-build-002/persona-runs/<date>-dry-transcript.md.
#
#   bash scripts/verify/persona-zoomies.sh           AW-701 (a few minutes on the 8 GB laptop, mostly PGlite start-up; the person's confirm pauses move a local clock, nothing sleeps)
#   bash scripts/verify/persona-zoomies.sh --live    AW-901: NOT RUN by this script. It needs the owner's switch-on (ai-os/projexa-build-002/OWNER_SWITCH_ON_GUIDE.md)
#                                                    and a real link; it exits 2 and says so, so it can never pass by accident.
#
# Exit 0 = every assertion held. Exit 1 = an assertion failed (one FAIL line each on stderr). Exit 2 = a tool is missing, or --live was asked for.
# Last stderr line: `PASS AW-701` / `FAIL AW-701: <reason>`.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2

if [ "${1:-}" = "--live" ]; then
  printf 'NOT RUN AW-901: the live persona run needs the owner to switch writes on (OWNER_SWITCH_ON_GUIDE.md sections 3 to 5) and a real link; this script only runs the local dry mode\n' >&2
  exit 2
fi
[ $# -eq 0 ] || { printf 'FAIL AW-701: unknown argument (only --live is accepted)\n' >&2; exit 2; }
command -v bun >/dev/null 2>&1 || { printf 'FAIL AW-701: bun is not available on PATH\n' >&2; exit 2; }

if bun run scripts/verify/persona/persona-run.ts --scenario zoomies; then
  printf 'PASS AW-701\n' >&2
  exit 0
fi
printf 'FAIL AW-701: an assertion of the persona run failed (see above)\n' >&2
exit 1
