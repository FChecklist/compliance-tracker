# PROGRESS -- task-20260718-073004-api-governance--rate-limiting--versionin

## Scope

VERIDIAN Review Framework gap-closure: API Governance (Rate Limiting,
Versioning, Webhooks) / Webhook Reliability & Security -- 1 finding:

- [Low] Webhook delivery reliability with retry/backoff.
  Gap: retry capped at 3 attempts with no dead-letter/manual-replay path.
  Recommended approach: add a redeliver button backed by existing
  `webhookDeliveries` data.

Re-verified against current code before starting (per task instructions):
the gap was real and current. `deliverWebhook` in `src/lib/webhook-deliver.ts`
does cap automatic retries at 3 attempts with exponential backoff, and a
delivery that failed all 3 just sat in `webhook_deliveries` as a terminal
failed row with no recovery path in either the API or `WebhookSection.tsx`.

## Completed

- [x] Schema: added nullable `webhook_deliveries.redelivery_of_id` column
      (`src/lib/db/schema.ts`) -- set only on rows created by a manual
      redelivery, points back at the original failed delivery it replayed.
      Additive, no backfill needed.
- [x] Migration `drizzle/0313_webhook_manual_redelivery.sql`
      (`ADD COLUMN IF NOT EXISTS`, matches this repo's additive-column
      convention). Originally authored as 0225; renumbered to 0313 while
      merging main in (main had independently taken 0225 for an unrelated
      migration by the time this branch caught up -- see "Merge" below).
- [x] `src/lib/webhook-deliver.ts`: factored the actual HTTP-send-and-sign
      logic out of `deliverWebhook` into a shared `sendWebhookAttempt`, then
      added `redeliverWebhookDelivery(webhook, originalDelivery)` which
      replays a stored delivery's payload/eventType against the webhook's
      *current* URL/secret and records a new delivery row linked via
      `redeliveryOfId`. The automatic 3-attempt cap itself is intentionally
      unchanged.
- [x] `POST /api/settings/webhooks/[id]/redeliver` (new route): auth-gated
      (`requireAuth`), tenant-scoped (`withTenantContext`), confirms both the
      webhook and the target delivery belong to the caller's org before
      replaying (webhook_deliveries has no org_id of its own, so it's scoped
      transitively via the already-confirmed webhookId).
- [x] `GET /api/settings/webhooks` now returns `redeliveryOfId` on each
      `recentDeliveries` entry so the UI can tell replay rows apart from
      automatic ones.
- [x] `WebhookSection.tsx`: a "Redeliver" action (retry icon) on any failed
      delivery row in the expanded delivery log, with a per-row loading
      state and a "Manual" badge on rows that are themselves replays.
- [x] Unit tests (`src/lib/webhook-deliver.test.ts`, bun:test) covering
      `sendWebhookAttempt`'s signing/success/failure/network-error paths and
      `redeliverWebhookDelivery`'s use of the *original* delivery's stored
      payload/eventType. 5/5 pass.
- [x] `bun test src/lib/webhook-deliver.test.ts` -- 5 pass, 0 fail.
- [x] `tsc --noEmit` -- no errors in any changed file.
- [x] `eslint` on all changed/new files -- clean, no warnings.
- [x] Did not touch `src/lib/services/permission-service.ts` or its
      `ERP_ACTION_ROLES` table (not needed for this gap -- webhook routes
      already gate on `requireAuth` + org-scoped tenant context, same as the
      existing GET/PATCH/DELETE routes in this file).
- [x] Merge: PR #1231 came back `mergeable: CONFLICTING` against `main`
      (this branch's workspace had gone shallow since 2026-07-18; unshallowed
      via `git fetch --unshallow` to get a real merge-base). Real conflicts
      in `src/lib/webhook-deliver.ts` -- `main` had independently added a
      `webhook-delivery-outcome-monitor` (RES-02 Phase 1) call inside
      `deliverWebhook`'s retry loop. Resolved by combining both: kept this
      task's shared `sendWebhookAttempt()` abstraction and
      `redeliverWebhookDelivery()`, plus `main`'s `delivered`/
      `attemptsMade`/`lastStatusCode` tracking and post-loop
      `runWebhookDeliveryOutcomeMonitor` call -- the manual redeliver path
      deliberately does not invoke that monitor (it's for the automatic
      pipeline, not a human-initiated replay). Also renumbered the migration
      0225 -> 0313 (`main` had independently taken 0225 for an unrelated
      migration by merge time). `PROGRESS.md`/`ai-os/boss/ACTIVE-CLAIMS.yaml`
      conflicts were both shared/additive files -- kept this task's own
      entries, `main`'s content for both is otherwise unrelated to this
      task's scope. Re-ran `bun test`/`tsc`/`eslint` after resolving --
      all clean.

## Remaining

- [ ] None -- merged with main, verified, ready for CI.
