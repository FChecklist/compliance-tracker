# Sev-1 Incident Command Runbook

**Scope:** VERIDIAN AI OS internal operations (this repository + its Vercel
project `compliance-tracker-ai` / `prj_mRRWcMvhyuxgRZtcfp4ArSzcOvII` +
Supabase database). Not to be confused with `src/app/(app)/incidents` /
`src/app/api/incidents` — that's a **customer-facing GRC feature** for
tenant organisations to log and track their own incidents; it is a product
capability, not our internal ops tooling, and this runbook does not use it.

**Written against this codebase's actual, real operating model — not an
invented one.** There is no dedicated ops team, no on-call rotation, and no
paging service (PagerDuty/Opsgenie/Slack alerting) wired anywhere in this
repo. That is a real, load-bearing constraint on everything below, not an
oversight this document is pretending doesn't exist. See "Honest gaps" at
the end for what a Sev-1 process here genuinely cannot do yet.

---

## 1. Who does what (real roles, per `AGENTS.md`)

| Role | Who | Can do during an incident | Cannot do |
|---|---|---|---|
| **Owner** | Rajat Agarwal (`raajat.agarwal@gmail.com`) | The only human. Sole approver for anything irreversible (Vercel/Supabase production changes, Rule 7(e)) and for weakening any guardrail (Rule 9). **The only person who can be paged, because no one else exists to page.** | — |
| **Super Boss** | Interactive Claude Code / Claude Desktop session, run directly by the Owner | Everything below, plus can direct the other two agents, review/merge PRs, run live DB migrations via the Supabase MCP. This is the fastest-responding role because it's interactive (an actual session the Owner is driving), not a queued dispatch. | Push/merge directly to `main` — Rule 6 applies with no exception, including during an incident (`enforce_admins` is on; there is no break-glass bypass documented anywhere). |
| **Z.ai GLM** / **Claude Code (Secondary Agent)** | Headless, triggered via `repository_dispatch` (`zai-task` / `claude-task`) | Full read/write access, can open a fix PR asynchronously. | Same `main` restriction. Not interactive — not the right tool for "stop the bleeding right now."|

**Consequence for Sev-1 specifically:** the fastest real response to an
active incident is the Owner opening (or already having open) an
interactive Super Boss session and working the incident directly, using the
levers in Section 4. Dispatching a headless agent is the right move for the
*follow-up fix PR*, not for immediate mitigation.

## 2. What counts as Sev-1 here

Calibrated to what this app actually does (compliance/ERP/CRM/PM SaaS for
Indian businesses) and what would genuinely justify dropping everything:

- **Site-wide outage** — the Vercel deployment is failing to build/serve, or
  every request 5xx's (not one tenant, not one page).
- **Database unreachable or corrupted** — Supabase connection failures
  affecting all tenants, or evidence of data loss/corruption.
- **Confirmed cross-tenant data exposure** — an RLS gap or auth bug that let
  one organisation see another's data (the exact class of bug the
  `FORCE ROW LEVEL SECURITY` gap-closure work and `PLATFORM-01`'s
  RLS-bypass audit exist to prevent). Treat any *credible report* of this as
  Sev-1 until disproven — do not wait for confirmation to start Section 4.
- **Leaked secret in a merged commit** — an API key, service-role key, or
  encryption key committed to `main` (gitleaks in `sentinel.yml` catches
  most of these pre-merge with `continue-on-error: true`, i.e. it warns but
  does **not** block the PR — a real, disclosed gap, not a safety net you
  can assume caught something).
- **Auth bypass** — any path where `requireAuth()` / `requireAuthOrApiKey()`
  is provably skippable on a route that should require it.

This repo has two real, on-the-record precedents of this severity class,
cited directly in `src/app/api/internal/secrets-audit/run/route.ts`'s own
header comment: a **`CRON_SECRET`** incident (empty secret meant every cron
route silently 401'd) and a **`GROQ_API_KEY`** incident (same root pattern).
Both are the model for "how a missing/misconfigured secret becomes a
silent, fail-closed outage" — read that file's comment before assuming a
new incident is genuinely novel.

## 3. Detection — what actually notices, and the gap in each

Nothing here pages the Owner automatically. Everything below is either
something the Owner has to be looking at, or an AI-internal mechanism that
tops out at Super Boss (an AI role) with no further escalation to a human:

- **Sentry** (`@sentry/nextjs`, `sentry.server.config.ts`,
  `sentry.edge.config.ts`, `src/app/global-error.tsx`) — catches unhandled
  server/render errors. **Verify `SENTRY_DSN` is actually set in the Vercel
  project before relying on this**: `Sentry.init` with an unset DSN
  silently no-ops (per `src/instrumentation.ts`'s own comment) — it does
  not error, it just does nothing. If it's not configured, Sentry is not a
  real detection mechanism right now, only an installed one.
- **`compliance.application_errors` table** (`src/lib/db/schema.ts`,
  migration `0119_wave137_application_errors_table.sql`) — the
  zero-dependency fallback that captures the same server errors regardless
  of Sentry's config state. Query this table directly (via the Supabase
  MCP or dashboard) as the detection method that's guaranteed to work.
- **`secrets-audit` cron** (`vercel.json`, daily 07:00 UTC) — checks that
  `CRON_SECRET`, `DATABASE_URL`, `APP_RUNTIME_DATABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `AI_CONFIG_ENCRYPTION_KEY` are all present.
  Explicitly **not exhaustive** (its own header says so) — extend
  `REQUIRED_ENV_VARS` there when a new load-bearing secret is added.
- **`metric-alerts` cron** — evaluates configured metric-alert rules and
  notifies specific in-app `notifyUserIds`. This is an **in-app
  notification**, not a page — if no one is looking at the app, nothing
  reaches a human.
- **`escalation-ladder.ts` / `dispatch-completion-monitor.ts`** — the
  AI-internal escalation chain (see `docs/ESCALATION_MATRIX.md`). This tops
  out at Super Boss, an AI role. **It does not notify the Owner.** If the
  Owner isn't already in an active Super Boss session, an escalation
  reaching the top of this ladder produces no human-visible signal.
- **The Owner directly** — in practice, today, the most reliable detector
  is the Owner noticing (a customer report, a personal check of the app, or
  starting a session and finding `application_errors` non-empty).

## 4. Response — real levers that exist in this stack

In rough order of "fastest way to stop the bleeding" to "proper fix":

1. **Vercel Instant Rollback** — if the last deploy caused the incident,
   roll back to the previous production deployment from the Vercel
   dashboard (project `prj_mRRWcMvhyuxgRZtcfp4ArSzcOvII`) or via the Vercel
   API. This does **not** require a new commit/PR and is the fastest real
   mitigation available — use it before attempting a code fix under
   pressure.
2. **Secret rotation** — if a key is leaked/compromised: rotate it at the
   provider (Supabase/Groq/OpenRouter/etc.), update the GitHub Secret, then
   run the existing `Sync Env Vars to Vercel` workflow
   (`.github/workflows/sync-vercel-env.yml`, `workflow_dispatch`) to push
   the new value to Vercel and trigger a redeploy. That workflow currently
   only names `GROQ_API_KEY` explicitly — extend it inline for whichever
   secret is being rotated, following its existing curl pattern.
3. **Database-layer investigation** — use the Supabase MCP
   (`get_advisors`, `get_logs`, `execute_sql`) or the Supabase dashboard
   directly to check connection health, RLS policy state, and recent query
   errors. For a suspected cross-tenant RLS gap, check
   `FORCE ROW LEVEL SECURITY` status on the affected table(s) first — the
   exact gap class the `0179_rls_gap_fix_7_tables.sql` /
   `0116_wave134_force_rls_all_tables.sql` migrations closed previously.
4. **Code fix, through the normal gate — no exception, even for Sev-1.**
   `AGENTS.md` Rule 6 (branch protection, PR + CI required, no direct push,
   `enforce_admins` on) has **no documented break-glass exception**. A
   Sev-1 fix still goes: branch → PR → CI (Lint/Type Check/Build/Unit
   Tests) → merge. This is why step 1 (rollback) matters — it buys time to
   do the real fix properly instead of being tempted to bypass a governance
   rule under pressure.
5. **Communicate** — there is no status page and no customer notification
   automation (see "Honest gaps" below). Until one exists, the Owner is the
   contact point; `COMPANY.contactEmail` in `src/components/LegalShell.tsx`
   (`raajat.agarwal@gmail.com`) is the only address anywhere in this
   codebase customers are told to write to.

## 5. Post-incident

Write a dated retrospective in `docs/` — this repo already has a real,
established convention for this (`docs/master/AUDIT_2026-07-09.md`,
`docs/master/GAP_CLOSURE_LOG.md`, and the `secrets-audit`/
`CRON_SECRET`/`GROQ_API_KEY` write-ups referenced above). At minimum:
what happened, when it was detected vs. when it started (the gap between
those two is the number that matters most given Section 3's honest
limitations), what stopped it, and what closes the detection/response gap
that let it get that far. If the incident reveals a new load-bearing
secret, add it to `secrets-audit`'s `REQUIRED_ENV_VARS`. If it reveals a new
RLS gap, follow the same `FORCE ROW LEVEL SECURITY` migration pattern as
the two migrations cited in Section 4.

## 6. Honest gaps (don't pretend these are solved)

- **No paging.** Nothing in this stack wakes the Owner up. Detection is
  either the Owner looking, or an in-app notification/AI-internal
  escalation that assumes someone is already watching.
- **No status page.** Customers have no automated way to learn about an
  outage; the Owner's own email is the only channel.
- **Sentry's real detection value is unverified.** Its DSN configuration in
  Vercel hasn't been confirmed as part of this runbook — check it, don't
  assume it.
- **Gitleaks doesn't block merges.** `continue-on-error: true` in
  `sentinel.yml` means a secret-scan hit is a warning, not a gate.
- **No rehearsed disaster-recovery drill.** The only DR/RTO-shaped code in
  this repo (`it-dr` module, `0078_wave92_fraud_cases_it_disaster_recovery.sql`)
  is a customer-facing GRC feature tenants use to track *their own* DR
  posture — it is not this platform's own internal DR practice, and this
  platform has never rehearsed restoring itself from a Supabase backup.
  This runbook does not solve that; it names it so no one assumes otherwise.
