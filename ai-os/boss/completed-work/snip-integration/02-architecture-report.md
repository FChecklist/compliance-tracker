# snip Architecture Report

## 1. What snip actually is, mechanically

snip is a `PreToolUse` hook for Claude Code (and equivalent hooks for Cursor, Codex, Pi, Windsurf, Cline, Copilot, Gemini, Kilocode, Antigravity, Grok). Concretely: when a Claude Code session is about to run a shell command via its `Bash` tool, Claude Code invokes the hook command (`/home/rajat/.local/bin/snip hook`) with the proposed command on stdin; snip matches the command against a library of declarative YAML filters (132 built-in + this project's own custom ones), and if a filter matches, snip **runs the real command itself**, pipes its real output through the filter's pipeline (strip ANSI codes, drop known-noisy lines, truncate, summarize), and returns the filtered result to Claude Code in place of the raw output. If nothing matches, or the filter itself errors, the real raw output passes through unchanged (`on_error: "passthrough"` on every filter, built-in and custom).

**The mechanism's one hard requirement: there must be a shell command for the hook to intercept.** This is the single fact that determines where snip can and cannot apply anywhere in VERIDIAN.

## 2. THE FINDING: the Mother Router / child-router AI Dev Team dispatch pipeline is NOT a snip integration point — confirmed, not softened

This is the most important finding in this whole report, so it is stated plainly and first, not buried in a caveat later.

`src/lib/ai-router/mother-router.ts` and its child routers (Software/Legal/Finance/Sales/Compliance/HR/Support), dispatched via `POST /api/ai/team/dispatch`, are backend TypeScript modules running inside the Next.js app. They call LLM providers **directly over HTTP** — through `anthropic_openrouter_proxy.py`/`anthropic_openrouter_proxy_v2.py` and similar HTTP-based dispatch paths — as ordinary `fetch()` calls from server-side code. They are not Claude Code CLI sessions. They do not have a Bash tool. They do not run shell commands as any part of their core dispatch mechanism.

**Independently re-verified this session** (not just inherited from the prior investigation this task was briefed on): `grep -rn 'child_process\|spawn(\|execSync\|exec(\|execFile' src/lib/ai-router/` over the full 487-line `mother-router.ts` and every file in that directory returns **zero matches**. There is no subprocess call anywhere in this dispatch path for snip's PreToolUse hook to ever see.

**Conclusion: snip's actual, real mechanism (shell-command output interception via a Claude Code PreToolUse hook) has no genuine attachment point on the Mother Router or any child router.** Nothing was built to fake an integration here. If the Owner wants the Mother Router's own verbose LLM-call logging reduced, that is a legitimately different, unexplored feature request — e.g., a request to trim `console.log`/response-logging inside `mother-router.ts` itself, or to compress what gets written to `activity_log`/`orchestraExecutions` — and it would need its own separate investigation and design. **Installing snip does not accomplish it, and nothing in this PR claims otherwise.**

## 3. Where snip DOES genuinely, meaningfully apply

### 3a. Interactive Claude Code CLI sessions on VERIDIAN-DEV (confirmed live)

Any interactive `claude` session run by the `rajat` account on this server picks up the hook automatically, because `snip init` wrote the hook registration to `~/.claude/settings.json` — Claude Code's **global, user-level** settings file (confirmed by direct read; see Configuration Report §1). This file's resolution scope is per-user, not per-project, so the hook applies to every project directory this account works in, not just `compliance-tracker`.

This is a real, heavily-used environment: this exact background-task session alone generated large volumes of verbose `gh pr checks`/build/CI/`bun test` output over its lifetime, all of which is exactly the class of output snip's built-in and custom filters target.

### 3b. Headless `veridian-worker@<id>.service` Claude Code CLI processes (confirmed live, not assumed)

`/opt/veridian/scripts/worker-entrypoint.sh` runs `claude -p "$PROMPT" --dangerously-skip-permissions --max-budget-usd "$WORKER_BUDGET_CAP_USD" --output-format json` (line 128) — a genuine headless Claude Code CLI invocation, authenticated via a local translation proxy (`anthropic_openrouter_proxy_v2.py` on `127.0.0.1:8787`, forwarding to OpenRouter/GLM-5.2) rather than a direct Anthropic API key.

**This was tested live, end-to-end, not assumed to work by analogy with interactive mode:**
- Ran a real headless invocation with the exact same env vars/flags `worker-entrypoint.sh` uses (`ANTHROPIC_BASE_URL=http://127.0.0.1:8787`, `ANTHROPIC_API_KEY=proxy-routed-not-a-real-anthropic-key`, `--dangerously-skip-permissions --max-budget-usd 0.30 --output-format json`), prompting it to run `git log -30` via its Bash tool.
- Result: `{"type":"result","subtype":"success","is_error":false,"result":"DONE","total_cost_usd":0.287435,"num_turns":2}` — the model genuinely called the Bash tool.
- `snip hook-audit` recorded a real entry: `2026-07-21 18:50  git log -30  git  yes  yes` (matched, rewritten).
- `tracking.db` gained a real new row (id 6, `git log -30`, 26.7% savings) timestamped to that exact run.

**Conclusion: the hook fires identically in headless (`-p --dangerously-skip-permissions`) mode as in interactive mode.** This is because the hook is a Claude Code CLI-level mechanism keyed off the global `~/.claude/settings.json`, not something specific to interactive terminals — headless mode is still a real Claude Code process reading the same settings file. Currently 0 `veridian-worker@` systemd units are running (confirmed via `systemctl`), so there is no live worker traffic to observe today, but the mechanism and template are proven correct for when workers next run.

### 3c. Explicitly NOT genuine integration points (checked, not assumed)

- **`preflight-guard.py`** — invoked directly by `worker-entrypoint.sh` itself (line 63, `python3 /opt/veridian/scripts/preflight-guard.py ...`), i.e. by the *supervisor/launcher*, never as a Bash-tool call *from inside* a running Claude Code session. It never reaches the PreToolUse hook. Same non-applicability class as the Mother Router.
- **`run-logged.sh`** — confirmed via `crontab -l` to be invoked exclusively by cron (`sync-repos`, `sync-vercel-env`, `queue-dispatcher`, `health-check-15min`, `cost-usage-60min`, `system-sync`, etc.), never by a Claude Code session. Same non-applicability class.
- **Redis (`redis-cli`)** — genuinely not used anywhere on this server or in this codebase. `redis-cli` is not installed, and `src/lib/services/asset-registry-cache.ts`'s own header states outright: *"Deliberately in-process memory, NOT Redis... zero real redis/upstash hits... Redis stays a scoped, ready-to-[add later, optional]"* item. Building a Redis filter would be fabricating coverage for a tool this project deliberately does not use.
- **`supabase` CLI** — not installed as a global binary; a `supabase/migrations` directory exists in the repo but this project's real migration workflow runs entirely through `drizzle-kit` (`db:generate`/`db:migrate`/`db:push`/`db:studio` in `package.json`). Zero real invocation of `supabase db push`/`supabase functions deploy`/`npx supabase` anywhere in scripts, workflows, or docs. Not genuinely used.

## 4. Where custom filters were built (the real, remaining gap)

`bun` (confirmed primary package manager — `bun.lock` present, no `package-lock.json`/`pnpm-lock.yaml`) and the globally-installed Vercel CLI (`v56.3.1`) are genuinely used and genuinely uncovered by snip's 132 built-in filters. See the Configuration Report for the filter library itself and the Verification Report for how each was tested.
