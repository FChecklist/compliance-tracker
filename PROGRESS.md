# PROGRESS -- task-20260719-132247-cost-incident-rca--api-called--11000-tim

## Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml`, registered this session's claim, committed +
      pushed it standalone before real work per the file's own protocol.
- [x] Pulled real OpenRouter activity data (`/api/v1/activity`, management key): lifetime
      total across all retained history (2026-07-04 to 2026-07-18, 89 rows) is only **1,877
      requests** -- no bucket anywhere near 11,000. Notably **zero rows for 2026-07-08**
      (the day of the already-documented $12.34 spend incident) -- the activity API's
      retention/indexing does not cover that day, a real, cited gap, not filled in.
- [x] Checked Groq: no reachable usage/request-count API with this key (`/usage`,
      `/organization/usage`, `/dashboard/usage` all 404 "unknown_url") -- honestly documented
      as unqueryable, not guessed around.
- [x] Pulled real GitHub Actions run counts via `gh api .../actions/runs` and per-workflow
      `.../workflows/{id}/runs`: compliance-tracker totals 6,460 runs all-time (largest single
      workflow: CI, 1,786); projexa 60; claude-control 1. No single workflow or short window
      approaches 11,000.
- [x] Read `/opt/veridian/logs/queue-dispatcher.log` (birth timestamp 2026-07-18T05:00:01,
      i.e. cron-driven dispatch's actual recorded lifetime) + `crontab -l` (both
      queue-dispatcher.py and supervisor-sweep.sh show `#DISABLED-2026-07-18`, confirming the
      systemctl/cron bug fix already landed that day, not re-fixing it). Found the systemctl
      `daemon-reload`/dbus failure caused exactly 3 wasted dispatch attempts right at the
      start of the log, self-corrected on the next 10-min tick; queue-dispatcher.py's own
      `MAX_RETRIES = 3` produced 122 retried dispatches across 34 distinct gap-groups over
      ~12.5 hours (~180 total `CREATED` worker sessions that day from this script alone) --
      real, but nowhere near 11,000 by itself.
- [x] **Found the real match**: `~/.claude/projects/*/*.jsonl` (this box's own first-party
      Claude Code session transcripts) show **11,165 real Anthropic Messages-API calls on
      2026-07-18 alone** (each JSONL `assistant` event carries a genuine `usage` token-count
      field, i.e. a completed API response, not a failed attempt) -- vs. 211 on 07-17 and
      6,915 on 07-19 (partial day). Driven by 574 distinct Claude Code sessions active that
      single day (vs. 14 the day before) -- the queue-dispatcher retry storm plus the
      already-flagged "many uncoordinated parallel Claude sessions" issue (AGENTS.md Rule 11,
      ACTIVE-CLAIMS.yaml) layering on top of normal gap-closure/rescue-PR/interactive work.
      Confirmed these are Anthropic Messages API calls made via `claude -p` under
      CLAUDE_CODE_OAUTH_TOKEN (worker-entrypoint.sh) -- a completely separate code path from
      OpenRouter/Groq/orchestra_executions/token_usage_ledger, which is exactly why none of
      those systems show anything close to 11,000: they instrument a different subsystem
      (the app's own in-product AI Dev Team roster + VERI Chat), not this box's Claude Code
      CLI sessions.
- [x] Confirmed `costCapEnforcementEnabled` default-false bug (fixed today, drizzle/0216) is
      **unrelated** to this incident: `cost-guard.ts` only gates `organisations.
      monthlyCostCapUsd` against `token_usage_ledger` rows with `scope='product_orchestra'`
      -- a different code path entirely from the Claude Code CLI worker sessions that
      produced the 07-18 spike.
- [x] Confirmed `AI_TEAM_LOG_SECRET` is genuinely still missing from Vercel production env
      (`vercel env ls production` -- not in the list) despite existing as a GitHub Secret
      since 2026-07-08 (`gh secret list` shows `AI_TEAM_LOG_SECRET  2026-07-08T04:04:02Z`) --
      confirmed root cause of `token_usage_ledger` having zero `scope=ai_team_internal` rows
      (src/app/api/ai/team/log-usage/route.ts returns 500 "not configured" without it).
      **Fixed**: generated a fresh shared secret, set identically via `gh secret set
      AI_TEAM_LOG_SECRET --repo FChecklist/compliance-tracker` and `vercel env add
      AI_TEAM_LOG_SECRET production` -- takes effect on the next deploy (no extra redeploy
      trigger needed).
- [x] Implemented real prevention in `/opt/veridian/scripts/worker-entrypoint.sh` (server-side
      script, not tracked in any of the 3 repos' git history -- confirmed via `git
      rev-parse --show-toplevel` failing there -- so no PR applies to it; full before/after
      cited in the RCA doc instead): added a real, CLI-enforced `--max-budget-usd` cap
      (default $100, ~2x the highest real per-invocation cost seen across 90 historical
      `result.json` files, $48.98) to every `claude -p` invocation (main task run + each
      auto-fix continuation), plus an explicit post-invocation check that turns a budget-cap
      hit into a distinct, human-visible `blocked` checkpoint status instead of looking like
      ordinary success/failure or silently retrying. `bash -n` syntax-checked clean.
- [x] Wrote `ai-os/INCIDENT_11K_API_CALLS_RCA.md` with full cited evidence, confidence level,
      and what remains unexplained (OpenRouter's 07-08 data gap).

## Remaining
- [ ] Final tsc/lint/test/build pass on the compliance-tracker repo itself (no TS/JS source
      touched by this task, but running the gates anyway before opening the PR).
- [ ] Update this session's ACTIVE-CLAIMS.yaml entry with completed_at + PR number.
- [ ] Commit + push the RCA doc and ACTIVE-CLAIMS.yaml update; open the PR against main
      (tier2 -- touches nothing schema/migration, but the AI_TEAM_LOG_SECRET rotation +
      worker-entrypoint.sh budget-cap change are cost-guard-adjacent; holding for Owner
      sign-off per task constraints regardless of CI outcome).
