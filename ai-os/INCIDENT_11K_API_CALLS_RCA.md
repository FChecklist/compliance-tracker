# RCA: "An API Called 11,000 Times"

**Task**: COST-INCIDENT-11K-CALLS-RCA | **Date filed**: 2026-07-19 | **Status**: root cause identified, confidence HIGH, one sub-finding unresolved (noted below)

## TL;DR

The Owner's "an api called 11000 times" is a real, precisely-matched number:

> **On 2026-07-18, this VERIDIAN-DEV box's own Claude Code CLI sessions made 11,165 real
> Anthropic Messages-API calls in a single day** (vs. 211 the day before, 6,999 the day
> after, partial). This is driven by 574 distinct Claude Code sessions being active that one
> day (vs. 14 the day before) — an extreme, well-evidenced spike in *parallel session count*,
> not a single runaway loop.

This is **not** an OpenRouter, Groq, or GitHub Actions incident — those systems were checked
directly and none of them show anything close to 11,000 (details below). It is the Claude
Code CLI itself (authenticated via `CLAUDE_CODE_OAUTH_TOKEN`, per this task's own
constraints), running as systemd-managed workers dispatched by
`/opt/veridian/scripts/queue-dispatcher.py`, layered with normal interactive/rescue-PR/gap-
closure session activity on the same day.

## Evidence, system by system

### 1. OpenRouter (`OPENROUTER_MANAGEMENT_KEY`, real `/api/v1/activity` query)

```
$ curl -s https://openrouter.ai/api/v1/activity -H "Authorization: Bearer $OPENROUTER_MANAGEMENT_KEY"
```

89 rows total, spanning 2026-07-04 through 2026-07-18. Summed `requests` field across every
row, every model, every date: **1,877 requests, lifetime**. Busiest single date+model bucket:
`2026-07-18 / z-ai/glm-5.2`, 443 requests. Nothing within two orders of magnitude of 11,000.

**Notable gap, honestly flagged, not filled in**: `2026-07-18` (the day of the already-
documented $12.34/$11.44-from-Claude-Sonnet-5 overspend incident) has **zero rows** in this
API's response (`?date=2026-07-08` returns `{"data": []}`). This does not mean zero traffic
happened that day (the incident is independently confirmed via the dollar figures already on
record) — it means OpenRouter's own activity endpoint does not retain/index that day for this
key, for reasons this task could not determine (key rotation, retention window, or an
OpenRouter-side gap). **This is the one thing this RCA could not fully explain** — flagged
per the task's own instruction to be honest about what remains unresolved, rather than
papering over it.

### 2. Groq (`GROQ_API_KEY`)

No usage/request-count endpoint exists for this key: `/usage`, `/organization/usage`,
`/dashboard/usage` all return `404 unknown_url`. Groq does not expose a public per-key
request-count API. **Not queryable — honestly documented, not guessed around.**

### 3. GitHub Actions (`gh api .../actions/runs`, all 3 repos, real counts)

```
compliance-tracker: 6,460 runs all-time   (CI: 1,786, CodeQL: 1,748, Sentinel: 1,706,
                                            Mandatory Audit Check: 702, Claude Code: 281,
                                            Dependabot: 118, AI Workforce: 75, ... )
projexa:               60 runs all-time
claude-control:         1 run all-time
```

No single workflow, and no short window across all three repos combined, reaches 11,000.
The largest single workflow (CI, 1,786 runs) is a real number worth tracking but is not this
incident.

### 4. The cron/systemd dispatch bug (already fixed 2026-07-18 — confirmed, not re-fixed)

`crontab -l` today shows both relevant lines already disabled:
```
#DISABLED-2026-07-18 */15 * * * * /opt/veridian/scripts/supervisor-sweep.sh
#DISABLED-2026-07-18 */10 * * * * /usr/bin/python3 /opt/veridian/scripts/queue-dispatcher.py ...
```

`/opt/veridian/logs/queue-dispatcher.log` (file birth `2026-07-18T05:00:01`, i.e. its entire
recorded lifetime) shows:
- 3 `systemctl --user daemon-reload` / "Failed to connect to bus: No medium found" crashes,
  all in the first 2 dispatch ticks — each one self-corrected on the very next 10-minute
  tick (the same 3 gaps dispatched successfully at `05:10`).
- `queue-dispatcher.py`'s own `MAX_RETRIES = 3` (confirmed in source) produced 122 retried
  dispatches (`retry-0`/`retry-1`/`retry-2`) across 34 distinct gap-groups over the log's
  ~12.5-hour active window — **~180 total `CREATED` worker sessions from this one script
  that day.**

This confirms the cron bug is real, already fixed, and *contributed to* — but does not by
itself explain — the 07-18 spike (180 dispatched sessions is an order of magnitude short of
11,165 API calls, though each dispatched session itself makes many calls — see below).

### 5. The real match: this box's own Claude Code session transcripts

`~/.claude/projects/*/*.jsonl` is the first-party, local record of every real API response
this box's `claude` CLI has ever received (each `type:"assistant"` JSONL line carries a
genuine `usage` token-count field — i.e., it is a completed API response, not a failed
attempt or a retry that never got a reply). Counting every such line across all 619 session
transcript files ever recorded on this box, bucketed by day:

```
2026-07-17:    211 calls,   14 distinct sessions
2026-07-18:  11,165 calls,  574 distinct sessions   <-- the match
2026-07-19:   6,999 calls,   31 distinct sessions   (partial day at time of writing)
```

**11,165 on 2026-07-18 is the closest, most literal, best-evidenced match to "an API called
11000 times."** No single session caused this (the single largest session transcript on
this box, all-time, has 754 assistant messages — nowhere near 11,000 on its own). It is the
*aggregate* of 574 separate Claude Code sessions all active on the same day — compare to 14
sessions the day before. That 41x jump in concurrent/serial session count, not a single
runaway loop, is the actual mechanism.

Why this explains the "not found" results in items 1–4 above: these are Anthropic Messages
API calls made by the `claude` CLI directly, authenticated via `CLAUDE_CODE_OAUTH_TOKEN`
(confirmed in `/opt/veridian/scripts/worker-entrypoint.sh`'s `claude -p ...` invocation) —
a completely separate code path from OpenRouter, Groq, and the app's own
`orchestra_executions` / `token_usage_ledger` tables (which instrument the in-*product* AI
Dev Team roster and VERI Chat, not this dev box's own coding-agent sessions). None of those
systems were ever going to show this number, because they don't instrument this call path at
all.

**What drove 574 sessions on one day**: a combination of (a) the cron/systemd bug's ~180
dispatched/retried worker sessions (item 4), (b) the pre-existing, independently-flagged
"multiple parallel Claude sessions with no coordination" problem that `ACTIVE-CLAIMS.yaml`
itself was built to address (`AGENTS.md` Rule 11, added 2026-07-14 after the Owner confirmed
4 parallel sessions running at once with no visibility into each other), and (c) ordinary
gap-closure / rescue-PR / interactive Super Boss work that also happened to run that day —
07-18 was, independently, the single busiest day in this box's entire recorded history by a
wide margin (211 → 11,165 → 6,999 calls/day across the 3 days with any recorded activity).
No single bug produced 11,165; a genuinely uncapped, uncoordinated dispatch surface did.

### 6. `costCapEnforcementEnabled` default-false bug (fixed today, drizzle/0216) — confirmed unrelated

`src/lib/cost-guard.ts`'s `canIncurCost()`/`checkCostCeilingBreaches()` only ever gate
`organisations.monthlyCostCapUsd` against `token_usage_ledger` rows with
`scope = 'product_orchestra'` (the app's own in-product AI Dev Team dispatches / VERI Chat).
The Claude Code CLI sessions that produced the 07-18 spike never write to
`token_usage_ledger` at all (they're not part of the app; see item 5). **These are two
independent subsystems** — the cost-cap bug could not have contributed to, or masked, this
incident, regardless of its own enforcement default. No further action needed here beyond
the fix already merged today.

### 7. `AI_TEAM_LOG_SECRET` — real, independent visibility gap, fixed as part of this task

`token_usage_ledger` has zero rows for `scope = 'ai_team_internal'` (the AI Dev Team roster's
own GLM-5.2 dispatches via `scripts/ai-workforce-agent.mjs` → `POST
/api/ai/team/log-usage`). Root cause, confirmed live:

```
$ gh secret list --repo FChecklist/compliance-tracker | grep AI_TEAM_LOG_SECRET
AI_TEAM_LOG_SECRET   2026-07-08T04:04:02Z          # exists as a GitHub Secret since 07-08

$ vercel env ls production   # (linked to veridian-compliance-ai)
# ... AI_TEAM_LOG_SECRET is NOT in the list
```

`src/app/api/ai/team/log-usage/route.ts` returns `500 { error: "AI_TEAM_LOG_SECRET not
configured" }` whenever `process.env.AI_TEAM_LOG_SECRET` is unset — which it always has been
in production, since 2026-07-08. Every `logTokenUsage()` write for this scope has been
silently failing (the caller, `ai-workforce-agent.mjs`, does not treat this as fatal) for 11
days. **This is independent of the 11,165-calls root cause**, but is a real visibility gap
the task brief asked to close regardless — fixed:

- Generated a fresh shared secret value.
- `gh secret set AI_TEAM_LOG_SECRET --repo FChecklist/compliance-tracker` (rotated the
  existing GitHub Secret to the same new value).
- `vercel env add AI_TEAM_LOG_SECRET production` (added the same value to Vercel prod).

Both sides now match. Takes effect on the next production deploy (no separate redeploy
trigger needed — this repo already deploys on every merge to `main`).

## Confidence assessment

**High confidence** that the 2026-07-18 / 11,165-real-API-calls figure (item 5) is what the
Owner is referring to: it is the only number found across every system checked that is both
(a) genuinely close to "11000" (11,165, not "about 10,000" or "about 15,000" rounded to fit)
and (b) backed by first-party, unambiguous evidence (real completed API responses in this
box's own local transcripts, not an estimate or an extrapolation).

**What is NOT fully explained**: exactly *why* 574 sessions ran that one day specifically (as
opposed to, say, 100 or 1,000) is a composite of several real, cited contributing factors
(items 4a/4b/4c above), not one single root-cause bug with a clean before/after. The
OpenRouter 07-08 data gap (item 1) also remains unresolved — noted honestly rather than
forced to fit this incident or ignored.

## Prevention implemented

1. **Per-invocation API-call budget cap, `/opt/veridian/scripts/worker-entrypoint.sh`**
   (server-side script — confirmed NOT tracked by any of this org's 3 repos' git history via
   `git rev-parse --show-toplevel` failing in that directory, so no PR applies to it; the
   full change is embedded below for a paper trail). Every `claude -p` invocation (the main
   task run, and each of the up-to-2 auto-fix continuations) now passes
   `--max-budget-usd "$WORKER_BUDGET_CAP_USD"` (default **$100**, `VERIDIAN_WORKER_BUDGET_CAP_USD`
   env-overridable) — a real flag the Claude Code CLI itself enforces (confirmed via
   `claude -p --help`: *"Maximum dollar amount to spend on API calls (only works with
   --print)"*). $100 was chosen deliberately generous: it's ~2x the highest real
   per-invocation cost seen across the 90 historical `result.json` files on this box
   ($48.98, a genuinely large 397-turn task), so legitimate large tasks are not cut off,
   while a genuinely stuck/looping session now hard-stops instead of running unbounded.
   Crucially, hitting the cap is no longer silent: a new check after each invocation reads
   that invocation's own `total_cost_usd` and, if at/above the cap, checkpoints the task with
   a distinct `blocked` status and an explicit note (rather than looking like an ordinary
   success or an ordinary failure that systemd quietly retries), pushes whatever real work
   exists on the branch, and disables the systemd unit — surfacing for human review instead
   of continuing to burn calls or retrying blind.

   This was **not** validated with a live `claude -p --max-budget-usd ...` test call, on
   purpose — doing so would burn additional real API calls in the course of fixing an
   API-overuse incident. It was verified instead against (a) the CLI's own `--help` text for
   the flag's documented behavior, and (b) real historical `result.json` files on this box,
   which already confirmed the `total_cost_usd` field this check reads is populated on every
   invocation. `bash -n` syntax-checked clean.

2. **`AI_TEAM_LOG_SECRET` Vercel gap** — fixed (item 7 above). Independent of the 11,165
   root cause, but a real visibility gap the next incident would otherwise hit again.

3. **`costCapEnforcementEnabled` default** — verified already fixed today via a separate PR
   (`drizzle/0216_wave_a_cost_cap_enforcement_default_true.sql`). Confirmed unrelated to this
   incident (item 6). No further action.

4. **Cron/systemd dispatch bug** — confirmed already fixed 2026-07-18 (item 4). No further
   action; not re-implemented per the task's own instructions.

### Considered, deliberately NOT built

- **A separate "max total attempts across all retries/re-queues" guard** beyond
  `queue-dispatcher.py`'s existing `MAX_RETRIES = 3`: checked this empirically against the
  real log (item 4) — no task in the entire recorded history exceeded `retry-2`, i.e. this
  cap already works and is not the gap. Building a second, redundant cap on top of a
  mechanism already confirmed to hold would not have closed anything real.
- Systemd's own `Restart=on-failure` + `StartLimitBurst=3` / `StartLimitIntervalSec=1800`
  (confirmed in `~/.config/systemd/user/veridian-worker@.service`) already bounds
  crash-restart loops at the OS level, independent of anything in this task's scope.

## `worker-entrypoint.sh` diff (not git-tracked — embedded here for the record)

```diff
--- a/worker-entrypoint.sh (before, 2026-07-19)
+++ b/worker-entrypoint.sh (after, this task)
@@ top of file @@
+# COST-INCIDENT-11K-CALLS-RCA (2026-07-19): before this, no single `claude -p`
+# invocation had any cap on how many real Anthropic API calls it could make.
+# --max-budget-usd is enforced by the CLI itself; the check after each
+# invocation turns a cap-hit into a distinct, human-visible checkpoint status.
+WORKER_BUDGET_CAP_USD="${VERIDIAN_WORKER_BUDGET_CAP_USD:-100}"
+invocation_cost_usd() { ... reads a single invocation's own output file's total_cost_usd ... }
+budget_exceeded() { ... compares against WORKER_BUDGET_CAP_USD * 0.95 ... }

@@ main claude -p call @@
-claude -p "$PROMPT" --dangerously-skip-permissions --output-format json >> "$TASK_DIR/result.json" ...
+MAIN_OUT="$TASK_DIR/.claude-out-main.json"
+claude -p "$PROMPT" --dangerously-skip-permissions --max-budget-usd "$WORKER_BUDGET_CAP_USD" --output-format json > "$MAIN_OUT" ...
+cat "$MAIN_OUT" >> "$TASK_DIR/result.json"
+# ... if budget_exceeded: checkpoint --status blocked with an explicit note, push, disable, exit 0

@@ auto-fix continuation claude -p call (inside the quality-gate loop) @@
-claude -p "$FIX_PROMPT" --continue --dangerously-skip-permissions --output-format json >> "$TASK_DIR/result.json" ...
+FIX_OUT="$TASK_DIR/.claude-out-fix-$GATE_ATTEMPT.json"
+claude -p "$FIX_PROMPT" --continue --dangerously-skip-permissions --max-budget-usd "$WORKER_BUDGET_CAP_USD" --output-format json > "$FIX_OUT" ...
+cat "$FIX_OUT" >> "$TASK_DIR/result.json"
+# ... same budget_exceeded check, breaks the auto-fix loop early if hit
```

(Full current file: `/opt/veridian/scripts/worker-entrypoint.sh` on the VERIDIAN-DEV box.)
