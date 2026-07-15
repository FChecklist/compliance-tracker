-- Priority 17 Wave 1 (multi-currency Selling & Buying): erp-invoicing-
-- service.ts has had real multi-currency support since Wave 66
-- (resolveInvoiceCurrency() -- validates currencyId against erp_currencies,
-- requires+validates exchangeRate, converts to base currency for GL
-- posting) but erp-selling-service.ts (quotations, sales orders) and
-- erp-buying-service.ts (purchase orders) had ZERO currencyId references --
-- confirmed by grep -- every quotation/sales-order/purchase-order was
-- silently assumed to be in the org's base currency, with no way to quote a
-- foreign customer or buy from a foreign vendor in their own currency.
--
-- Unlike erp_sales_invoices/erp_purchase_invoices, erp_quotations/
-- erp_sales_orders/erp_purchase_orders never had this scaffolding sitting
-- unused from an earlier wave -- confirmed by reading schema.ts directly --
-- so this is a real, additive migration, not just wiring existing columns.
--
-- All 3 columns are nullable (currencyId) or NOT NULL with a default of '1'
-- (exchangeRate), matching erp_sales_invoices' exact Wave 66 shape -- safe
-- for the existing rows these 3 tables already carry from Priority 15's
-- Sales & CRM wave (every existing quotation/sales-order/purchase-order
-- simply reads as "org base currency, rate 1", identical to how they
-- behaved before this migration; no backfill needed beyond the DEFAULT).

ALTER TABLE compliance.erp_quotations
  ADD COLUMN IF NOT EXISTS currency_id text,
  ADD COLUMN IF NOT EXISTS exchange_rate numeric NOT NULL DEFAULT '1';

ALTER TABLE compliance.erp_sales_orders
  ADD COLUMN IF NOT EXISTS currency_id text,
  ADD COLUMN IF NOT EXISTS exchange_rate numeric NOT NULL DEFAULT '1';

ALTER TABLE compliance.erp_purchase_orders
  ADD COLUMN IF NOT EXISTS currency_id text,
  ADD COLUMN IF NOT EXISTS exchange_rate numeric NOT NULL DEFAULT '1';
