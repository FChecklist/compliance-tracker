# OCID-056 — Real Credential Register

**Date:** 2026-08-04. No credential value appears in this document — names, providers, purposes, and rotation-age only. "Rotation age" = days since the credential was last **set/updated in its actual storage location** (GitHub Actions secret store, where checkable), not a claim about when the underlying provider issued it — that distinction is called out per-row where it matters. Today = 2026-08-04.

This is a register for the Owner to decide **which, if any, to rotate and in what order** — no rotation has been performed for any row below.

## 1. GitHub Actions repository secrets (`FChecklist/compliance-tracker`)

Source: `gh secret list --repo FChecklist/compliance-tracker --json name,updatedAt` (real, live query — names and update timestamps only; GitHub's API never exposes secret values). 51 secrets configured.

| Secret | Provider / purpose | Age (days) | Notes |
|---|---|---:|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase — full RLS-bypass DB admin, used by CI/migrations | 24 | Highest-privilege secret in this list. Age is consistent with the documented 2026-07-10 "Wave 0" cutover that repointed everything to the current live project and reset its DB password (`orchestra_changes.md`). |
| `SUPABASE_URL` | Supabase — current project's REST/auth base URL | 24 | Not secret-shaped itself, but grouped with the key above since both were set together. |
| `DATABASE_URL` | Postgres connection string (Drizzle) | 36 | Older than the service-role key above — worth confirming it was actually re-pointed during the July 10 cutover rather than left stale (see Environment Security Report §2). |
| `SUPABASE_DB_PASS` | Postgres direct password | 36 | Same caveat as `DATABASE_URL`. |
| `SUPABASE_ACCESS_TOKEN` | Supabase Management API PAT (used by MCP tooling / CLI) | 19 | Broad account-level access, not project-scoped. |
| `SUPABASE_PAT` | Supabase personal access token (appears to duplicate `SUPABASE_ACCESS_TOKEN`'s purpose) | 19 | Two tokens with overlapping purpose is itself worth the Owner's attention — see §4 below. |
| `SUPABASE_PROJECT_REF` | Project ref identifier (not secret) | 36 | — |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client-side Supabase config (anon key is public-by-design) | 36 | Not sensitive on their own. |
| `PAT_FCHECKLIST` | GitHub PAT — used by both AI agents (AGENTS.md) for repo-level operations (branches, PRs) | 36 | Full repo-level authority per AGENTS.md; the single most-relied-on credential for this project's entire AI-agent workflow. |
| `VERCEL_ACCESS_TOKEN` / `VERCEL_TOKEN` | Vercel deploy/admin API | 36 | Two Vercel tokens present — confirm both are still needed (see §4). |
| `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` / `VERCEL_PROJECT_ID_CT` | Vercel identifiers (not secret) | 36 | `VERCEL_PROJECT_ID_CT` likely a leftover from the now-deleted `compliance-tracker` Vercel project (`prj_80z9Rz3BYvvExvGXyt5LNoPPMgiZ`, deleted per `orchestra_changes.md`) — candidate for cleanup, not rotation. |
| `ANTHROPIC_API_KEY` | Claude/Anthropic — AI Dev Team dispatch | 18 | |
| `OPENROUTER_API_KEY` / `OPENROUTER_MANAGEMENT_KEY` | OpenRouter — model routing | 30 / 26 | |
| `GROQ_API_KEY` | Groq — platform-default floor-tier inference | 24 | Load-bearing: per AGENTS.md/CLAUDE.md, this is the platform-default provider every org falls back to. |
| `CEREBRAS_API_KEY` | Cerebras — model provider | 24 | |
| `ZAI_API_KEY` / `ZAI_BASE_URL` / `ZAI_OWNER_EMAIL` / `ZAI_OWNER_USER_ID` | Z.ai GLM — primary full-access agent (AGENTS.md) | 36 | |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_MID` / `RAZORPAY_ACCOUNT_EMAIL` | Razorpay — payment provider | 24 | Live financial-transaction credential; not tested/used in this pass. |
| `RESEND_API_KEY` | Resend — transactional email | 36 | |
| `COMPOSIO_API_KEY` / `COMPOSIO_ENTITY_ID` / `COMPOSIO_ORG_ID` / `COMPOSIO_PROJECT_ID` / `COMPOSIO_USER_ID` / `COMPOSIO_GDRIVE_CONN` / `COMPOSIO_YOUTUBE_CONN` | Composio — third-party OAuth connector broker (Gmail/Drive/Slack/etc. integrations) | 36 | |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_DRIVE_FOLDER_ID` | Google OAuth / Drive | 36 | Client ID only (public half of OAuth) — no client secret found registered under this name; confirm whether a client secret is managed elsewhere. |
| `GRAPHY_API_KEY` / `GRAPHY_API_BASE_URL` / `GRAPHY_MID` | Graphy (third-party service) | 36 | |
| `ORSHOT_API_KEY` / `ORSHOT_MCP_URL` | Orshot (third-party service) | 36 | |
| `ACTIVEPIECES_MCP_URL` | ActivePieces MCP endpoint | 36 | |
| `JWT_SECRET` | App-level JWT signing (purpose not confirmed against current code — see §4) | 36 | |
| `MCP_DEV_SECRET` | Dev-mode MCP auth bypass | 35 | Confirm this cannot be reached in production (dev-only guard). |
| `AI_TEAM_LOG_SECRET` | AI Dev Team dispatch logging auth | 15 | |
| `AI_TEAM_SUPABASE_URL` / `AI_TEAM_SUPABASE_ANON_KEY` | Separate Supabase config scoped to AI Team logging | 27 | |
| `HETZNER_API_TOKEN` | Hetzner (infra provider) | 14 | Newest secret in the registry; purpose not fully traced in this pass (no `process.env.HETZNER_API_TOKEN` reference found in `src/`/`scripts/` — likely used outside this repo, e.g. server provisioning). |

## 2. App-code env vars (referenced directly by `process.env.*` in `src/`, `ai-os/`, `scripts/`)

Source: `git grep -hoE 'process\.env\.[A-Z_][A-Z0-9_]*'` — 55 unique names. Cross-references almost entirely with §1's GitHub secrets (same credentials, consumed at runtime) plus these **not** present in the GitHub secret list above — meaning they're either Vercel-only env vars, CI-derived (`GITHUB_*`, `PR_NUMBER`, `BASE_REF` — supplied by the Actions runtime itself, not secrets), or task-instruction-shaped (`AI_TEAM_TASK_*` — structured fields passed between dispatch calls, not credentials):

| Var | Purpose | Where it lives |
|---|---|---|
| `AI_CONFIG_ENCRYPTION_KEY` | Encrypts BYO AI-provider keys stored per-org in the database | Vercel env only (added in the 2026-07-01 Wave 0 cutover per `orchestra_changes.md`) — not in the GitHub secret list, meaning CI cannot decrypt these at build time (by design). |
| `CRON_SECRET` | Shared-secret auth for all `/api/internal/*` scheduled routes | Vercel env only. **Real prior incident**: this exact secret going missing in production caused a fail-closed 401 outage on every cron route (documented in `secrets-audit/run/route.ts`'s own header) — the reason that route's missing-var detector exists at all. |
| `AI_TEAM_ROLE_KEY` | Per-role auth for AI Dev Team dispatch | Vercel env only |
| `VERCEL_DEPLOYMENT_WEBHOOK_SECRET` | Verifies inbound Vercel deployment webhooks | Vercel env only |
| `OPS_SYNC_SECRET` | Internal ops-task-sync route auth | Vercel env only |
| `DEMO_API_KEY_IDS`, `EXCHANGE_RATE_API_KEY`, `GOOGLE_API_KEY`, `OPENAI_API_KEY`, `VERIDIAN_API_KEY`, `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`, `EMAIL_FROM` | Various — feature-specific keys/config not found in the GitHub secret list, meaning they exist (if at all) only as Vercel env vars, not exercised in CI. `OPENAI_API_KEY` and `GOOGLE_API_KEY` in particular are referenced in code but have **no matching GitHub secret** — confirm with the Owner whether these are genuinely configured in Vercel or are dead/aspirational references. |

## 3. Local operator credentials (`/opt/veridian/shared/.env`, this server's own operating environment — not part of the app's runtime, used by agent sessions themselves)

Names only, confirmed present via `grep -oE '^[A-Z_]+=' /opt/veridian/shared/.env` (values never read/printed): `ANTHROPIC_API_KEY`, `CEREBRAS_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `GITHUB_PAT`, `GITHUB_PAT_ZAI_KIMI`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_MANAGEMENT_KEY`, `OPS_SYNC_SECRET`, `RAZORPAY_TEST_KEY_ID`, `RAZORPAY_TEST_KEY_SECRET`, `RESEND_API_KEY`, `SUPABASE_ACCESS_TOKEN`, `VERCEL_ACCESS_TOKEN`, `ZAI_API_KEY`. These largely mirror §1's GitHub secrets by purpose — meaning several of these providers (Anthropic, Cerebras, Groq, OpenRouter, Resend, Supabase, Vercel, Z.ai) have **two independently-held copies** of a credential with the same purpose: one in GitHub Actions secrets, one on this server's local disk. Neither copy's age could be verified against the other (no timestamp metadata on a plain `.env` file) — flagged in the Environment Security Report as a duplication concern, not assessed as an exposure (this file is not committed to any repo and is outside version control).

## 4. Open items for the Owner (register-only, not exposure findings)

- `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PAT` (§1) appear to serve the same purpose (Supabase Management API access) under two different secret names — confirm both are needed, or retire one.
- `VERCEL_ACCESS_TOKEN` and `VERCEL_TOKEN` (§1) — same overlap question.
- `VERCEL_PROJECT_ID_CT` (§1) references a Vercel project already confirmed deleted (`orchestra_changes.md`) — safe to remove, not a security issue.
- `OPENAI_API_KEY` / `GOOGLE_API_KEY` (§2) — referenced in app code, no corresponding GitHub secret found; confirm actual configuration status in Vercel.
- `MCP_DEV_SECRET` (§1) — confirm this dev-mode auth bypass is genuinely unreachable in production.
