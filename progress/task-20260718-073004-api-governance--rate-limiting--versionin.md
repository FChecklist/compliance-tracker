# Per-task progress -- task-20260718-073004-api-governance--rate-limiting--versionin

(Mirrors the workspace's own PROGRESS.md, which this task's prompt requires
be maintained with the same checklist -- see that file for full detail.)

## Completed
- [x] Verified the gap against current code (still real, not stale).
- [x] Schema + migration: `webhook_deliveries.redelivery_of_id` (additive, nullable).
- [x] `redeliverWebhookDelivery()` + shared `sendWebhookAttempt()` in `src/lib/webhook-deliver.ts`.
- [x] New route: `POST /api/settings/webhooks/[id]/redeliver` (auth + tenant-scoped).
- [x] `GET /api/settings/webhooks` returns `redeliveryOfId` per delivery.
- [x] `WebhookSection.tsx` Redeliver button + "Manual" badge.
- [x] Unit tests `src/lib/webhook-deliver.test.ts` -- 5/5 pass.
- [x] `tsc --noEmit` and `eslint` clean on all changed files.
- [x] `permission-service.ts` untouched (not needed for this gap).

## Remaining
- [ ] None -- committing and opening PR.
