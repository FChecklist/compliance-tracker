# RCA: Overnight Gap-Closure Mission Dispatch Failure (2026-07-19 ~17:15 UTC to 2026-07-20 ~02:15 UTC)

## What happened

The Owner directed a 2045-row VERIDIAN Framework reevaluation + full-autonomy gap-closure mission, targeting completion by 0800 IST 2026-07-20 (02:30 UTC), with explicit delegated decision authority (all non-monetary decisions). The reevaluation itself succeeded: PR #487 merged at 17:33:50 UTC with a real, evidence-grounded gap count and a 25-task execution plan (`ai-os/SUPERBOSS_IMPLEMENTATION_PLAN_2026-07-19_v2.md`).

**The execution phase did not run.** From 17:33 UTC to the 02:14 UTC status check (~8.7 hours), zero worker tasks were dispatched from that plan. `completed=52, failed=164` in the health-check log stayed completely static across every 15-minute sample from 21:15 UTC onward (and, by inference, from shortly after 17:33 UTC). One PR merged in that entire window (PROJEXA #49, itself dispatched before the plan existed).

## Root cause

The mechanism responsible for driving continuous multi-agent dispatch was a **Claude Desktop local scheduled task** (`veridian-glm-superboss-supervision`), repurposed mid-session from a pure-audit role into an active-dispatch role. This scheduler's own tool description states plainly: *"Scheduled tasks run while this app is open. If the app is closed when a task is due, it runs on next launch."* The app was not continuously open/active on the Owner's laptop through the relevant overnight window, so the cron-style `*/15 * * * *` firing simply did not happen at the intended cadence — evidenced directly: `list_scheduled_tasks` showed exactly one `lastRunAt` (14:48:53Z) in the ~9 hours since the task was created/updated around 17:12 UTC, with `nextRunAt` skipping forward to 16:48Z rather than backfilling the missed 15-minute windows.

This was a **known, disclosed risk at design time** — every version of this scheduled task's prompt included the caveat that it depends on the app being open — but the actual impact was underestimated: the risk was treated as "some audit cycles get skipped," not "the entire execution mechanism for a 9-hour unattended mission never fires." No independent, laptop-independent fallback was built alongside it, even though one already existed in the codebase (`queue-dispatcher.py`) and had been proven in production before.

**Contributing factor, not the root cause:** `queue-dispatcher.py` — a real, already-built, cron-driven, file-locked, concurrency-capped, self-syncing dispatcher that exactly fits this job and requires no Claude Desktop involvement at all — was sitting disabled in crontab (`#DISABLED-2026-07-18`) the entire time, for reasons not re-investigated before building a new mechanism instead of using it. Building the new Claude-Desktop-based mechanism without first checking whether a laptop-independent one already existed was itself a process gap.

## Why this class of failure is easy to miss

Every other automated mechanism built during this session (`health-check-15min.py`, `cost-usage-60min.py`, the GLM-5.2 proxy, `worker-entrypoint.sh`'s budget cap) is a **server-side cron job or systemd service** — genuinely independent of this laptop. The dispatch loop was the one exception, and it was built under time pressure by extending an existing mechanism (the scheduled-task skill) rather than stepping back to ask "does this specific responsibility need to survive the laptop being closed for 9 hours?" The answer, given the Owner's explicit "I will talk to you at 0800 IST, work must not stop until then," was obviously yes — and that requirement was not weighted heavily enough against the convenience of reusing an already-open tool.

## Prevention (implemented, not just recommended)

1. **`queue-dispatcher.py` re-enabled in crontab** (`*/10 * * * *`), running entirely server-side via cron — no dependency on this laptop, Claude Desktop, or any interactive session. Live-verified: a manual test run dispatched 5 real tasks and hit its concurrency cap correctly on the first invocation.
2. **Concurrency raised from 3 to 5** (`CONCURRENCY_CAP`), a real approximation of the Owner's "~80% capacity" instruction on this 8-core, currently-idle box.
3. **`build_prompt()` extended** to accept a pre-written `full_prompt` field per queue item, so the 25 already-properly-scoped V2 plan tasks (each with real READ FIRST/WHAT TO BUILD/DONE CRITERIA) dispatch with their real spec intact, rather than being forced through the generic CSV-finding-only prompt format the script was originally built for.
4. **`gap_queue.yaml` populated** from the 25 V2 plan tasks (24 auto-queued; 1 excluded as pure-projexa-scoped since this dispatcher instance is hardcoded to compliance-tracker, handled as a known, disclosed limitation rather than silently mis-dispatched).
5. **Going forward**: the Claude Desktop scheduled task is being reverted to audit-only (checking cron's own dispatch log, correcting real discrepancies, making delegated decisions) — it is no longer the thing responsible for *whether* agents run at all, only for whether they're running *correctly*. That responsibility now sits with a mechanism proven to survive this laptop being closed.

## Standing lesson

Before building any new "this needs to run unattended for N hours" mechanism on this project: (a) check whether a server-side/cron-based mechanism already exists for the job before reaching for a client-side scheduler, and (b) explicitly ask "does this survive the operator's machine being off/asleep for the full required duration?" — if the answer isn't a confident yes, it is not the right mechanism for an overnight or unattended commitment, regardless of how convenient it is to set up in the moment.
