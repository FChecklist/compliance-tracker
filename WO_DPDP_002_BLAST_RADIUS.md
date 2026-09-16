# WO-DPDP-002 Section 5 — the blast-radius question

**Question:** can a PROJEXA-touching change break veridian-aios.com (the DPDP product), given both live in this one repo and deploy as one Vercel project?

**Answer: shared build, but the real risk was smaller and more specific than "one big blast radius" — and the one concrete shared-fate path found has been fixed, not just written up.**

## What's actually shared

This repo (`FChecklist/compliance-tracker`) builds one Next.js application. PROJEXA's proxy surface (`src/app/api/v1/projexa/**`) and the DPDP product (`src/app/dpdp/**`, `src/app/api/dpdp/**`) are both part of that one build, deployed as one Vercel project (`veridian-compliance-ai`). Splitting them into two separate Vercel projects would not remove this: both projects would still build the identical commit, so a commit that breaks `next build` breaks both projects identically — two projects sharing one repo is still one blast radius, just with twice the domain/env-var configuration to keep in sync. Not recommended for that reason.

## Why this is safer than it sounds

- **Build failures don't reach production.** CI (`.github/workflows/ci.yml`: lint → typecheck → build → test) must pass before a PR merges to `main`, and Vercel keeps serving the last successful deployment if a new build fails. A PROJEXA change that breaks the build never takes down the currently-live DPDP pages (or vice versa) — it just never ships.
- **Runtime failures are isolated per route.** Vercel deploys Next.js API routes as independent serverless functions. An unhandled exception in a PROJEXA-only route does not crash unrelated DPDP routes' functions.

## The one real, concrete shared-fate path — found and fixed

`src/proxy.ts` (Next.js 16's renamed `middleware.ts`) ran on **every** request via a catch-all matcher, unconditionally constructing a Supabase Auth SSR client and calling `supabase.auth.getUser()` — including for every `/dpdp/*` and `/api/dpdp/*` request, even though DPDP has its own, fully separate session mechanism (`dpdp-session.ts`: its own `dpdp_session` cookie, its own `dpdp.identity`/`dpdp.session` tables, never touches Supabase Auth). That meant a Supabase Auth outage or misconfiguration — a PROJEXA/main-app concern, not a DPDP one — could have broken every DPDP page load for no reason.

**Fixed:** `/dpdp` and `/api/dpdp` are now excluded from `proxy.ts`'s matcher, so DPDP requests never touch that code path at all. Verified both directions in `src/proxy.test.ts` — reverted the fix and confirmed the test fails exactly on the dpdp/api-dpdp cases (6/15), restored it and confirmed all 15 pass.

## Residual shared risk (not eliminated, judged acceptable)

- **Same Postgres connection pool.** DPDP uses its own `withDpdpContext` tenant-scoping wrapper rather than sharing `withTenantContext`, so it isn't exposed to the specific nested-transaction bug class documented elsewhere in this repo's history (R74/R75) — but it draws from the same pool, so a connection-exhaustion event anywhere in the app could still starve DPDP under real concurrent load. Not tested here (no live concurrent-load rig in this environment); flagged, not fixed.
- **Same env vars / same Supabase project.** A misconfigured or rotated env var (`DATABASE_URL`, service role key, etc.) affects both. This is inherent to one app in one repo; the alternative (a second, fully separate Supabase project just for DPDP) is a materially bigger architectural change, out of scope for this work order.

## Recommendation

Keep one Vercel project. Add `veridian-aios.com` as a custom domain on the existing project when Section 6 (going live) is reached. Rely on CI as the real gate against a broken build reaching production — which it already is — rather than introducing a second Vercel project that would still share the same build/commit risk.
