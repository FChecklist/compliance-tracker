# OCID-056 — Real Environment Security Report (Dev / Staging / Production)

**Date:** 2026-08-04. Compares how credentials are scoped and shared across this platform's development, staging/preview, and production environments.

## 1. There is no separate "staging" *database* — only a staging *deployment lever*

`ai-os/STAGING_ENV_2026-07-20.md` (real, verified against the live Vercel REST API on 2026-07-20) establishes:

- The Vercel project (`prj_mRRWcMvhyuxgRZtcfp4ArSzcOvII`, Hobby plan) has exactly 3 **system** environments: `production` (branch `main`), `preview` (any other branch), `development` (local). A named **custom** "staging" environment is a Pro-plan-only feature and is explicitly blocked on the current Hobby plan (`0` allowed, confirmed via a live `400` from the Vercel API).
- The real, free lever available is a `gitBranch`-scoped env var (`target=["preview"]` + `gitBranch="staging"`), which lets a specific branch get its own env var values within the `preview` target — this is a deployment-config mechanism, not evidence that a genuinely separate staging *database* exists.
- That doc records `DATABASE_URL` as having "3 separate rows: production / preview / development" in Vercel's env-var store — confirmed 3 distinct **rows** exist, but a separate row does not by itself prove a separate **value**. This report did not re-verify live (see §5) whether the preview/development rows hold a different connection string from production's.

## 2. Local development is confirmed pointed at the live production database

Direct, first-hand check in this session (not sourced from a doc): `/opt/veridian/repos/compliance-tracker/.env.local`'s `NEXT_PUBLIC_SUPABASE_URL` resolves to `https://pcrjmlpuqsbocqfwoxod.supabase.co` — **the same project ref confirmed as the current live production database** (`pcrjmlpuqsbocqfwoxod`, "veridian-compliance-ai" per `orchestra_changes.md`'s Wave 0 cutover record). The same is true of its `.env.local.bak-2026-07-30` backup.

**This means local development on this machine runs against the real production Supabase project, not an isolated dev database.** Concretely:

- A bug in code being run locally (e.g. an unbounded delete, a migration tested by hand, an experimental script) can mutate real production data.
- The production `service_role`/`DATABASE_URL` credentials necessarily exist in plaintext on this local disk (`.env.local`) in addition to Vercel's own encrypted env store and GitHub Actions secrets (Credential Register §1) — a third live copy of the same high-privilege credential, on a machine with a different threat model (a shared dev/agent server) than either GitHub's or Vercel's secret stores.
- This is consistent with, and likely explains, why `DATABASE_URL`/`SUPABASE_DB_PASS` in the GitHub secret list carry a **36-day** age (Credential Register §1) rather than the 24-day age of `SUPABASE_SERVICE_ROLE_KEY` — if the DB password/connection string were rotated independently of the cutover, every environment sharing it (local dev included) would need updating in lockstep, which is exactly the kind of multi-environment coordination this task's own PM flagged as the risk class that caused a prior real incident.

**This is a real, load-bearing environment-security finding, not a hypothetical**: it is the single clearest instance in this audit of "shared/duplicated credentials across dev and production" that the PM's spec specifically asked this report to surface.

## 3. The CRON_SECRET and GROQ_API_KEY precedents

Two credentials in this platform have **already** caused real production incidents from environment-config drift, per this repo's own code comments (`src/app/api/internal/secrets-audit/run/route.ts`'s header, cited directly, not paraphrased from memory):

- `CRON_SECRET` going missing/mismatched in production caused every `/api/internal/*` route to fail-closed with a silent 401.
- `GROQ_API_KEY` had "the identical root pattern" — a separate real incident.

This is precisely the incident class the PM's spec references when it says "this platform already suffered [an incident] once before when a routine credential rotation drifted and broke the local environment file" — the codebase's own `secrets-audit` cron (checking 7 named required env vars every run) exists *because of* this exact failure mode, not as a hypothetical guardrail. §2's finding (local dev sharing prod's DB credential) is the same failure mode's mirror image: instead of an env var going *missing* in one environment, a credential is *shared* across environments that should be independent, so a rotation in one place requires perfect, simultaneous propagation everywhere the same value is held — GitHub Secrets, Vercel (×3 targets), and this local disk copy, minimum four locations for `DATABASE_URL` alone.

## 4. Build-artifact / `.gitignore` gap (historical, currently dormant)

Per the Exposure Report §"false positives," a `.next/` build-output directory was committed once (commit `2d2c91a68`, 2026-06-27) under a `apps/web/` path that no longer exists in the current tree. The root `.gitignore`'s `/.next/` rule is **anchored to the repository root** (leading `/`), so it would not have matched a nested `apps/web/.next/` path — meaning if that monorepo-style structure were ever reintroduced, build output containing Next.js's internal encryption/signing keys could be committed again undetected by `.gitignore` alone. Currently dormant risk (the path doesn't exist today), but worth a one-line `.gitignore` fix (`**/.next/` instead of `/.next/`) if the Owner wants it closed proactively — not performed here since it's a code change outside this task's discovery-only authorization.

## 5. What this report did NOT verify (honest limitation)

- Whether the Vercel `preview`/`development`-target rows for `DATABASE_URL` (and other env vars) hold genuinely different values from `production`, or are duplicates. Confirming this requires a live, authenticated `vercel env pull`/API call; the `vercel whoami` CLI call in this session hung waiting on interactive auth and was not forced through, to avoid leaving an unbounded background process running against a live account without the Owner present.
- Whether any of the shared credentials named in §2 have already been rotated since the dates cited here.
- The other repos under `/opt/veridian/repos/` (MeetTrack, Projexa, veda-advisors, etc.) each have their own dev/staging/prod story that was not compared here — this report is scoped to `compliance-tracker`'s own environments, with the one necessary exception of tracing where the leaked `jusqumifsmtcaujqyjuy` key actually points (Exposure Report §1), since that fact came directly from this repo's own history.
