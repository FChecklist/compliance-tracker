-- FI-AR-004 (SAP gap-analysis "Dunning List", HIGH priority): minimal
-- reminder-tracking mechanism for the new dunningList()/recordDunningAction()
-- functions in erp-invoicing-service.ts.
--
-- dunning_level: plain integer, NOT NULL DEFAULT 0 (0=no reminder sent,
-- 1=Friendly Reminder, 2=Formal Notice, 3=Final Demand -- see
-- erp-invoicing-service.ts's DUNNING_LEVEL_LABELS). Defaults rather than
-- nullable so `> 0` comparisons never need a null check, matching this
-- table's existing numeric-column convention (exchange_rate, subtotal,
-- etc. are all NOT NULL with a default, not nullable).
--
-- last_dunning_sent_at: nullable timestamp, null until recordDunningAction()
-- first sets it -- no default because "never dunned" genuinely has no
-- sensible non-null value.
--
-- Additive and backward-compatible: every pre-existing invoice is correctly
-- labelled dunning_level=0/last_dunning_sent_at=null (accurate -- no
-- invoice has ever been dunned, since this mechanism didn't exist before),
-- and any code path that does not set these keeps inserting the same
-- default as before. IF NOT EXISTS keeps this safe to re-run, matching
-- this repo's additive-column convention (e.g. 0224's erp_exchange_rates.source).

ALTER TABLE compliance.erp_sales_invoices
  ADD COLUMN IF NOT EXISTS dunning_level integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_dunning_sent_at timestamp;
