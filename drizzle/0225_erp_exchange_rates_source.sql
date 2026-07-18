-- REVIEW-FRAMEWORK-WAVE4, Track 1b item 1: live exchange-rate feed.
--
-- Adds erp_exchange_rates.source to distinguish rates typed in by hand
-- (createExchangeRate, always the pre-existing behaviour) from rates fetched
-- by the new daily live feed (refreshLiveExchangeRates ->
-- exchange-rate-feed-client.ts -> open.er-api.com).
--
-- Additive and backward-compatible: NOT NULL DEFAULT 'manual' means every
-- pre-existing row (all hand-entered) is correctly labelled 'manual' with no
-- backfill step, and any code path that does not set source keeps inserting
-- 'manual' rows exactly as before. The live refresh writes source='live' and
-- is idempotent per (org_id, rate_date): a daily re-run deletes and re-inserts
-- only that day's source='live' rows, so it never disturbs a 'manual' rate an
-- admin entered or any prior day's history.
--
-- IF NOT EXISTS keeps this safe to re-run, matching this repo's additive-column
-- convention (e.g. 0214's companyId columns). No RLS/index/ownership change --
-- erp_exchange_rates already carries the schema's standard org-scoped RLS.

ALTER TABLE compliance.erp_exchange_rates
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
