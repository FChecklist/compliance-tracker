# R72 Parity Gap Register — Local Development vs. Vercel Production

Generated: 2026-09-04, R72 Phase 5 ("Reconciliation, Local-First Development, Vercel Production-Only").
Every entry below was directly observed this session — none is carried forward from memory without
re-verification. Where a value could only be confirmed by exposing a secret, that limit is stated
explicitly rather than guessed at.

## 1. No local database of any kind is possible on this machine (CRITICAL, structural)
Docker, WSL, and a native PostgreSQL install are all absent (confirmed directly: `docker --version`
fails, `wsl --status` reports "not installed", no `psql`/`pg_dump` on PATH, no PostgreSQL under
Program Files, no registered Windows service). Neither of R72 Phase 4's two sanctioned local-DB paths
is available without installing new system-level software or enabling a Windows feature — both cross
this session's standing safety boundary and were correctly left undone (R72 Phase 4, claude_log id 194,
STOP-PHASE). **Consequence:** every database-touching verification in this entire R65–R72 series has
run directly against the live Supabase project (`pcrjmlpuqsbocqfwoxod`), never an isolated local copy.
"Local-first development" as titled by this very work order is not literally achievable on this laptop
today without an owner-approved system change.

## 2. `.env.local` was pointed at the WRONG Supabase project (FIXED this session)
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in the local `.env.local` were a
matched, self-consistent pair for **`evpckeuxgvahguwsaeul`** — PROJEXA's own separate Supabase
project, not this repo's. Confirmed by decoding the anon key's JWT payload (`"ref":"evpckeuxgvahguwsaeul"`)
and cross-checked against Vercel's own authoritative values (`vercel env ls production` shows
`NEXT_PUBLIC_SUPABASE_URL` = `https://pcrjmlpuqs…` — the correct project — set 68 days ago across
Production, Preview, and Development). 30 files consume this variable directly, including
passcode-login, SSO ACS callback, client-portal document access, and document routes — meaning any
local session exercising those paths was silently talking to PROJEXA's tenant instead of this
project's own. **Remediated**: backed up the old file, ran `vercel env pull .env.local
--environment=development`, restored the 3 genuinely local-only vars it doesn't track
(`RAJAT_USER_ID`, `CRON_SECRET`, `DEMO_API_KEY_IDS`), verified the corrected file now targets
`pcrjmlpuqsbocqfwoxod`. `.env.local` itself remains git-ignored, as it must.

## 3. `DATABASE_URL`'s pooler endpoint was stale
The old local `DATABASE_URL` connected via a raw IP (`3.109.171.244:6543`) rather than Supabase's
current standard pooler hostname. Vercel's authoritative value (pulled alongside item 2) uses the
proper `aws-1-ap-south-1…` pooler hostname. Same remediation as item 2 — now corrected locally.

## 4. Six env vars were entirely absent from local dev before this session's pull
`OPENROUTER_API_KEY`, `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `AI_CONFIG_ENCRYPTION_KEY`,
`NEXT_PUBLIC_APP_URL`, and `VERCEL_OIDC_TOKEN` did not exist in the local file at all. Any local run
touching OpenRouter-based AI calls, transactional email (Resend), service-role Supabase admin
operations, app-URL-dependent redirects, or OIDC-based auth would previously have hit a different
code path (missing-config fallback, or a hard failure) than production does. Now present locally.

## 5. Production build OOMs locally under Node's default heap
`bun run build` fails with exit 134 ("JavaScript heap out of memory") under Node's default ~2.1GB
V8 old-space limit, on a machine with 8GB total RAM (confirmed via `wmic OS get
FreePhysicalMemory,TotalVisibleMemorySize`). Reproducible and independently confirmed twice this
series (R71 Phase 4, log id 176; R72 Phase 3, log id 193). Succeeds locally only with
`NODE_OPTIONS=--max-old-space-size=6144` set explicitly. Vercel's own build infrastructure clearly
has enough headroom that this has never been an issue in production.

## 6. The repo's own `start` script cannot run locally
`package.json`'s `start` script (`bun .next/standalone/server.js`) fails outright locally
("Module not found") because `next.config.ts` never sets `output: 'standalone'`, so `next build`
never produces that directory. This has never been caught because Vercel's own deploy/serve pipeline
does not invoke this repo's `start` script at all — it has its own internal serving mechanism.
Verified the build itself is sound by serving 3 real routes via Next's own `next start` instead
(all 200s). Filed as a real, pre-existing, currently-unfixed defect (R72 Phase 3, log id 193) — not
fixed here since Phase 3's scope was verification, not repair.

## 7. AI provider differs by design, not just by environment drift
Local dev is configured for `AI_PROVIDER=claude-cli` (Claude Code CLI Max, gated on `RAJAT_USER_ID`
being set) while production routes through OpenRouter.ai. This is an intentional, already-documented
difference (see this session's own prior memory record on dev-vs-prod AI provider model), not a bug —
included here because it is a real behavioral divergence a local tester needs to know about: a code
path that behaves one way against Claude Code CLI can behave differently against whatever OpenRouter
model production resolves to.

## 8. No error-monitoring telemetry locally
`SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` are unset locally, so the Sentry SDK no-ops (confirmed live
via this session's own `vercel dev` startup log). This is a known, already-documented gap (the
app's own code cites `ai-os/SUPERBOSS_IMPLEMENTATION_PLAN_2026-07-19_v2.md` C17 as the tracking item)
requiring an Owner/Vercel-dashboard action to provision a DSN. Whether production itself has a DSN
configured was not checked here (would require reading a secret value with no clear need to), but the
local no-op state itself is directly confirmed. **Consequence:** a bug that would raise a Sentry alert
in production produces zero signal in local testing.

## 9. `.github/workflows/ci.yml` exists but has never run against this series' own commits
The repo genuinely has CI (`ci.yml` runs lint/typecheck/test/migration-integrity checks;
`domain-drift-check.yml` polls Vercel every 15 minutes) — but both are PR-triggered, and this
whole R65–R72 series' established, PM-sanctioned pattern has been pushing directly to `main`,
never opening a PR. So while CI infrastructure is real, it has never once run against any commit
in this series (R71 Phase 4's own title: "the only gate that exists, no CI" — accurate for THIS
series' own commits, not a claim the repo has zero CI anywhere). Every pass/fail signal on this
series' own work has come from a human or an AI session choosing to run these commands by hand —
that remains a real process-level parity gap versus what a PR-based contribution would get for
free, and nothing guarantees the same checks run before every real deploy of this series' work.

## 10. No local equivalent of Vercel's Runtime Logs / Web Analytics
Locally, request-level behavior is visible only via console/terminal output. In production, this
session has repeatedly relied on Vercel's own Runtime Logs and Web Analytics APIs (via MCP) for
request-level debugging — there is no local substitute for that observability surface. This helps
explain why so much of this project's audit history has had to investigate directly against live
production rather than reproducing issues locally first.

---
**Owner decision carried into the R72 Owner Register:** whether to authorize installing Docker
Desktop + WSL2 (or a native PostgreSQL install) on this laptop, to close gap #1 — the only gap in
this register that cannot be closed by a config-file fix.

**See also:** `R72_OWNER_SUMMARY.md` (plain-language version of this file and R71/R72 overall),
`R72_DEPLOY_RITUAL.md` (the deploy procedure item 3/6's Vercel findings feed into), `CLAUDE.md`
(keeps the current state of every item above up to date for the next session, human or AI).
