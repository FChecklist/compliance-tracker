-- Gap-closure: API Governance (Rate Limiting, Versioning, Webhooks) --
-- Webhook delivery reliability with retry/backoff.
--
-- Automatic delivery (webhook-deliver.ts's deliverWebhook) still stops after
-- 3 attempts with exponential backoff -- that cap is intentional and is not
-- changed here. What was missing was any way to recover a delivery that
-- failed all 3: the failed row just sat in webhook_deliveries forever with
-- no dead-letter/manual-replay path. This adds a single nullable column so
-- a manually-replayed delivery (POST /api/settings/webhooks/[id]/redeliver)
-- can record which original failed delivery it replayed, letting the UI
-- (WebhookSection.tsx) show a "Redeliver" action against any failed row and
-- surface the resulting attempt as linked to it.
--
-- Additive and backward-compatible: NULL for every row the automatic retry
-- loop has ever written or will write; only set on rows created by the new
-- manual redelivery path. No backfill, no RLS/index change needed.
-- IF NOT EXISTS keeps this safe to re-run, matching this repo's additive-
-- column convention (e.g. 0224's erp_exchange_rates.source).

ALTER TABLE compliance.webhook_deliveries
  ADD COLUMN IF NOT EXISTS redelivery_of_id text;
