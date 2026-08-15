# VERIDIAN AI — Configuration Reference

VERIDIAN Review Framework gap closure (task-20260801-173750, AI-Readable
Configuration Documentation, [Medium], 2026-08-01). Gap was "no
consolidated configuration reference." `CLAUDE.md`'s "Env Vars Required"
section covers only the 4 baseline Supabase/DB vars; this doc indexes the
full set actually referenced in `src/`, plus notable in-code constants/flags
that aren't env vars but function as configuration.

## Environment variables

Found via a full-tree `process\.env\.[A-Z_]+` scan of `src/` (33 distinct
names, deduped; `CLAUDE.md`'s existing 4 marked accordingly). Correction
(2026-08-02, independent audit on PR #684): an earlier version of this
table said 11 and claimed LLM provider credentials are never read from
`process.env` at all — both were wrong. `src/lib/llm-client.ts` itself
does have zero `process.env` references (DB-stored per-org credentials
are still the primary path, see below), but `src/lib/orchestra-model-
resolver.ts`'s `platformApiKeyFor()` does read 6 provider keys as a real
platform-level fallback/default when no per-org key is configured.
Re-verified 2026-08-07 (task-20260807-071602, re-landing this doc after
PR #684 went stale/unmerged): re-ran the same scan against current
`main` — still exactly 33 names, same set, but the table itself was
missing one of the 33 (`EMAIL_FROM`) despite claiming full coverage;
added below.

| Var | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes (already in `CLAUDE.md`) | Postgres connection string, `postgres` role (Drizzle default, RLS-bypassing — used only for the few legitimate pre-tenant-context operations like new-org signup). |
| `APP_RUNTIME_DATABASE_URL` | **Yes — was missing from `CLAUDE.md`, added below** | Separate connection string, `app_runtime` role (`NOSUPERUSER NOBYPASSRLS`) — what every tenant-scoped query actually runs as. See `docs/master/MODULE_MAP.md`'s Auth/Multi-Tenancy section for the full RLS mechanism this backs. |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes (already in `CLAUDE.md`) | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes (already in `CLAUDE.md`) | Supabase anon key (client-side auth). |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes (already in `CLAUDE.md`) | Supabase service role key, server-side only. |
| `AI_TEAM_LOG_SECRET` | Server-side only, gates AI Team activity logging | See `ai-os/INCIDENT_11K_API_CALLS_RCA.md` for the incident this closed. |
| `CRON_SECRET` | Yes for scheduled jobs | Authenticates Vercel Cron → `internal/loops/run` and the other cron-triggered internal endpoints. **Historical note**: this was empty in production for a period, silently disabling all 3 scheduled cron jobs — see `TEST_LOG.md`. Fixed; don't re-flag as open. |
| `PLATFORM_AUDIT_ORG_ID` | Platform-level audit tooling only | Scopes cross-org audit/reporting scripts to a specific real org id. |
| `VERCEL_DEPLOYMENT_WEBHOOK_SECRET` | Deployment-webhook consumers only | Verifies Vercel deployment webhook payloads. |
| `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_DSN` | Optional | Sentry error tracking — absent means no error tracking, not a broken build. |
| `NODE_ENV` / `NEXT_RUNTIME` / `VERCEL_URL` / `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_SITE_URL` | Framework-managed | Standard Next.js/Node/Vercel runtime vars, not VERIDIAN-specific config. |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, `GOOGLE_API_KEY`, `OPENROUTER_API_KEY`, `CEREBRAS_API_KEY` | Optional, platform-level fallback only | Read by `orchestra-model-resolver.ts`'s `platformApiKeyFor()` as a fallback when an org has no DB-stored per-org model credential configured. Not the primary credential path (see below) — an org with its own `customerModelConfig`/`clientModelConfig` entry never touches these. |
| `COMPOSIO_API_KEY`, `EXCHANGE_RATE_API_KEY`, `RESEND_API_KEY` | Feature-specific | Composio connector auth, live FX-rate feed, transactional email (`email.ts`) respectively. |
| `EMAIL_FROM` | Optional (has a code default) | From-address used by `src/lib/email.ts`'s Resend-backed sender — was missing from this table (2026-08-07 correction, real var, `src/lib/email.ts:11`). |
| `AI_CONFIG_ENCRYPTION_KEY` | Yes if any org has a DB-stored AI model credential | Encrypts/decrypts `customerModelConfig`/`clientModelConfig` secrets at rest. |
| `SUPABASE_DB_PASSWORD`, `GITHUB_DISPATCH_PAT`, `OPS_SYNC_SECRET`, `DEMO_API_KEY_IDS`, `MEMVID_TELEMETRY`, `ORCHESTRA_PAYLOAD_RETENTION_DAYS` | Various ops/tooling | Narrow-purpose vars for specific scripts/integrations — see each var's own call site for detail, not repeated here to avoid drifting out of sync with the code. |

**DB-stored, not env-var, by design (primary path)**: LLM provider
credentials for a specific org are stored via `customerModelConfig`/
`clientModelConfig`/BYO-model config (see `docs/master/MODULE_MAP.md`'s
Orchestra section), not `.env` keys — this is intentional so each org/
tenant can bring its own model credentials. The 6 provider `*_API_KEY`
vars above are the platform-level fallback for orgs that haven't
configured their own, not a substitute for the per-org path.

## Notable in-code constants & flags

Not exhaustive — the ones with real, non-obvious operational effect if
changed, worth knowing exist before assuming a value is hardcoded
correctly forever:

| File | What it holds |
|---|---|
| `src/lib/guardrail-registrations.ts` | AI-governance sanity-ceiling constants: `MAX_GST_RATE_PERCENT` (40), `MAX_LOAN_TENURE_MONTHS` (600), `MAX_LOAN_ANNUAL_RATE_PERCENT` (60), `MAX_LOAN_PRINCIPAL` (₹100cr), plus gratuity/commission/demand-amount ceilings — see `ai-os/registry/business-rules-registry.yaml` for the cross-referenced business-rule detail. |
| `src/lib/engines/payroll-engine.ts` | `STATUTORY_CAP = 2_000_000` — Payment of Gratuity Act ceiling. |
| `src/lib/db/schema.ts` (organisations table, `monthlyCostCapUsd`/`costCapEnforcementEnabled`) | Per-org AI spend cap — DB-stored, not an env var or code constant, but the single most consequential "configuration" in the system for cost control. |
| `src/lib/purpose-bound-ai.ts` | `DOMAIN_ALLOWED_TOOLS` — hard, server-enforced allowlist of which tools an AI call may use per domain (compliance/project_management/erp/facilities_management/the_firm). A live AI feature with no entry here is denied by default. |
| `src/lib/model-tier-eligibility.ts` | Which models qualify for `mechanical`/`integrative`/`judgment`-tier AI Dev Team dispatch (AGENTS.md Rule 10). |
| `src/lib/floor-tier-escalation.ts` | Floor-tier model escalation thresholds. |

## Maintenance

Hand-maintained, same genre/limitation as
`ai-os/registry/business-rules-registry.yaml` — no CI check currently
verifies this table stays in sync with `process.env` usage in `src/`. A
future extension could grep `process\.env\.[A-Z_]+` and diff against this
table's first column; not built this pass.
