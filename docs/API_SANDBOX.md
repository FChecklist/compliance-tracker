# VERIDIAN AI OS — API Sandbox (interim)

**Status: interim guidance, not a dedicated sandbox environment.** This
document exists so external `/api/v1/**` integrators (mobile apps, ChatGPT
Actions, Claude connectors, reseller white-label apps, custom
integrations) have a real, safe way to test today, while being honest
about what does not exist yet. See [`docs/API_CHANGELOG.md`](API_CHANGELOG.md)
for what changed and when, and
[`/api/v1/openapi.json`](/api/v1/openapi.json) for the live contract.

## What exists today

There is **no dedicated sandbox environment, no test/live API key
distinction, and no per-integrator isolated org.** Every `/api/v1/**` API
key is scoped to a real organisation in the same production database as
every other tenant (`apiKeys.orgId`, `src/lib/db/schema.ts`) — confirmed by
reading `src/lib/supabase/api-key-auth.ts`, the `apiKeys` and
`organisations` schema definitions, and the API-key provisioning routes
(`/api/settings/api-keys`, `/api/v1/platform/provision-org`): none of them
have an `environment`/`isSandbox`/`isTest` concept.

**Two names that sound like a sandbox already exists, and why neither is
one:**
- `projexa_demo_org` is PROJEXA's shared production backend tenant, not a
  sandbox — it's the documented subject of a real multi-tenancy isolation
  gap (`PROJEXA-NO-TENANT-ISOLATION-01`: every PROJEXA customer currently
  shares this one backend identity). Do not point integrators at it.
- "Demo Company Pvt. Ltd." is a UI label seen when logged into VERIDIAN's
  own live production demo org (`src/components/RealProductDemo.tsx`) —
  real, but its actual org id/slug is not recorded anywhere in this repo,
  so it cannot yet be safely and reproducibly handed to an external
  integrator as a fixed sandbox target.

## Interim recommendation: the local seed org

`src/db/seed.ts` (`bun run db:seed`) creates a realistic, low-stakes,
sample-data-seeded organisation — `Acme Corp` (slug `acme-corp`, `pro`
plan) — with 4 departments, 7 users across every role
(`admin@acme.com` / `Test@1234`, plus manager/member/viewer accounts),
18 compliance items, audit points, tasks, notices, and documents. This is
the only reproducible "demo company"-style org that actually exists in
this codebase today, so it is the interim, honest answer to "where do I
test":

1. Run this app locally (or against your own Supabase project) and
   `bun run db:seed`.
2. Log in as `admin@acme.com` / `Test@1234`.
3. Generate an API key via **Settings → API Keys**
   (`src/components/ApiKeySection.tsx`, backed by
   `POST /api/settings/api-keys`) — scope it `read`, `write`, or
   `read:reports` as needed.
4. Use that key as a `Bearer` token against `/api/v1/**` — it behaves
   exactly like a production key (same rate limits, same auth path,
   same data model) because it targets a real org, just one seeded with
   disposable sample data instead of a real customer's.

This is explicitly an interim measure, not a hosted always-on sandbox —
there is no publicly reachable "sandbox.veridian.ai"-style deployment
today. If that changes, this document should be updated in the same PR
(matching this repo's standing changelog convention).

## What this does *not* solve (honest gaps, not implied-fixed)

- **No isolated per-integrator sandbox.** Every developer using the local
  seed shares the same seeded data model, not a private instance.
- **No test-vs-live key distinction.** A key generated against a seeded
  local org and a key generated against a real customer org look
  identical to the API — there is no `vk_test_...` prefix or `environment`
  field to tell them apart.
- **No safe hosted sandbox for integrators who can't run this app
  locally** (e.g. a ChatGPT Action or Claude connector developer without
  direct DB access). They currently have no option but a real org.

## Planned follow-up (not built in this change)

A dedicated `environment: 'live' | 'sandbox'` (or `isSandbox: boolean`)
column, additive and nullable, on `apiKeys` and/or `organisations` —
following the same precedent already established by `domainScope` and
`rateLimitPerMinute` on `apiKeys`, and `sessionLimitEnforcementEnabled` /
`seatEnforcementEnabled` on `organisations`. That flag would let
`validateApiKey()` (`src/lib/supabase/api-key-auth.ts`) mark a request as
sandboxed (e.g. for rate-limit exemption or synthetic-data routing)
without any change to `src/lib/services/permission-service.ts`'s
`ERP_ACTION_ROLES` table or `requireRoleOrScope()`'s role-rank logic. Left
for a follow-up task — this document closes the *interim* "integrators
have nowhere safe to test" gap, not the full dedicated-sandbox build.
