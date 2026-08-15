-- Down migration for ../0224_erp_exchange_rates_source.sql (adds
-- erp_exchange_rates.source, NOT NULL DEFAULT 'manual').
--
-- Data loss: dropping this column permanently loses the distinction
-- between hand-entered ('manual') and live-fed ('live') exchange rates for
-- every existing row -- the rate values themselves are untouched. Confirm
-- the live exchange-rate feed (exchange-rate-feed-client.ts) is disabled
-- or tolerant of the column's absence before running this, since it writes
-- source='live' on every refresh.
--
-- IF EXISTS keeps this safe to re-run, matching the forward migration's own
-- IF NOT EXISTS convention.

ALTER TABLE compliance.erp_exchange_rates
  DROP COLUMN IF EXISTS source;
