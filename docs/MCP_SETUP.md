# MCP / CLI Tooling Readiness — Vercel, Supabase, GitHub

R46 P9 seq43 (ref J.4). Verified from a fresh dispatch of this session (not
assumed from memory) with one real, non-destructive call per tool, run on
2026-08-25. Config locations recorded so a new machine can be re-provisioned
without guessing.

## Result summary

| Tool | Status | Real call made | Evidence |
|---|---|---|---|
| Supabase MCP | PASS | `execute_sql` against project `pcrjmlpuqsbocqfwoxod`, schema `platform` (multiple `SELECT`s this session, e.g. `platform.r43_queue`, `platform.claude_log`, `platform.test_closure`) | Rows returned with real data every time; zero connection errors across ~10 calls this session |
| Vercel MCP | PASS | `list_teams` → 1 team (`MeetTrack's projects`, `team_Iqx3zyb7sDdsdzcNskCFFsHD`); `list_projects` on that team → 2 projects (`projexa` = `prj_JA9mwUdOfW3SKSxjG4jdPo0R2iVM`, `veridian-compliance-ai` = `prj_mRRWcMvhyuxgRZtcfp4ArSzcOvII`, the Vercel project name for the `compliance-tracker` repo); `list_deployments` on the projexa project id → 20 real deployments returned with commit SHAs, PR numbers and states | Deployment list includes today's/yesterday's real commits (e.g. `dpl_5QRFdfuQ828gk9ffyjXNDSDTP22Y`, PR #121, state QUEUED at call time) |
| GitHub (gh CLI) | PASS | `gh auth status` → logged in as `FChecklist` (keyring-backed PAT); `gh pr list --repo FChecklist/projexa` → real open PRs (e.g. #120); `gh pr list --repo FChecklist/compliance-tracker` → real open PRs (e.g. #1361) | One `gh repo view FChecklist/projexa` call hit a transient TLS/network timeout (`dial tcp ... connectex: ... failed to respond`); the very next call (`gh pr list` on the same repo) succeeded immediately — a transient blip, not an auth or config failure. `git fetch origin main` in this repo also needed one retry before succeeding, same pattern. See `MEMORY.md` → "3-tier retry on connectivity fluctuation" for the standing mitigation (retry, don't treat a single timeout as down) |

All three: **3 for 3 PASS**, each proven by a real call in this session, not by
reading a config file and assuming it works.

## Exact config location (for re-provisioning on a new machine)

### Supabase
- Access is via the Supabase MCP server (tool prefix
  `mcp__0eeaf7ae-9a54-4761-86e9-a030a24c2153__*` in this session — the id is
  session-specific, re-negotiated per connection, not a value to hardcode).
- Project id used throughout this project: `pcrjmlpuqsbocqfwoxod`, schemas
  `platform` + `compliance`.
- No project-local `.mcp.json` or `supabase/config.toml` MCP block exists in
  either `compliance-tracker` or `projexa` — the MCP connection is configured
  at the Claude Code **host/session** level (added via `claude mcp add` or the
  IDE/CLI's MCP settings), not committed to either repo. A new machine needs
  the Supabase MCP server re-added there with a personal access token /
  project-scoped credential; there is nothing to `git pull` for this.
- Runtime `DATABASE_URL` / `APP_RUNTIME_DATABASE_URL` used by the deployed
  apps (separate from the MCP tool) are Vercel environment variables — see
  `MEMORY.md` → R31 entry for the pooler-format gotcha already fixed.

### Vercel
- Same pattern: MCP server (`mcp__72d04256-...__*` this session) configured
  at the host/session level, not in either repo.
- Team: `MeetTrack's projects` (`team_Iqx3zyb7sDdsdzcNskCFFsHD`), plan
  `hobby`.
- Projects: `projexa` (`prj_JA9mwUdOfW3SKSxjG4jdPo0R2iVM`, linked to GitHub
  `FChecklist/projexa`) and `veridian-compliance-ai`
  (`prj_mRRWcMvhyuxgRZtcfp4ArSzcOvII`, linked to GitHub
  `FChecklist/compliance-tracker`).
- `compliance-tracker/.claude/launch.json` exists locally for launching a dev
  server preview — that is a Claude Code launch config, not the Vercel MCP
  credential; it does not need to be touched for MCP readiness.
- A new machine needs the Vercel MCP server re-added at the host level with a
  Vercel personal token scoped to this team (or an interactive OAuth login).

### GitHub
- `gh` CLI, authenticated via the OS keyring, account `FChecklist`,
  `git_protocol=https`, token is a fine-grained PAT
  (`github_pat_11AL4BWDI0g...`, truncated by `gh auth status` itself — the
  full value was never displayed or logged by this session).
- Both repos confirmed reachable: `FChecklist/projexa` (default branch
  `main`), `FChecklist/compliance-tracker` (default branch `main`).
- A new machine needs `gh auth login` run interactively once (or
  `GH_TOKEN`/`GITHUB_TOKEN` exported with an equivalent PAT) — there is no
  repo-committed credential to restore.

## What this does NOT cover

- PR **create/merge** was not re-tested by this seq (would require opening a
  throwaway PR purely to prove the write path); `gh pr list` (read) plus the
  fact that real merges landed earlier this same session (PRs #116–#121,
  #1354–#1361, all via this same `gh` auth) is treated as sufficient
  behavioural evidence the write path works too, without a redundant
  destructive-adjacent test here.
- Supabase `apply_migration` (DDL) was not re-tested by this seq for the same
  reason — real migrations were applied earlier this session (e.g. the
  `security_audit_log` table, per PR #121's commit message) under the same
  credential.
- This file records **connectivity/auth**, not credential **rotation
  schedule** — see `MEMORY.md` R31/PR#9 entries for rotation and retention
  policy, which are separate concerns.
