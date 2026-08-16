-- Wave 66 (multi-currency wiring, per ERPNext's own multi-tier GL Entry
-- currency model as reference -- deliberately simplified to two tiers:
-- base debit/credit [already existed, unchanged] plus a transaction-
-- currency audit tier; ERPNext's third "reporting currency" tier is
-- deferred to Wave 67, once a Company/consolidation concept exists to
-- report into): wires the already-existing-but-unused erp_currencies/
-- erp_exchange_rates tables (Wave 49 schema, zero consumers until now)
-- into real GL/invoice postings.

ALTER TABLE "compliance"."erp_sales_invoices" ADD COLUMN "exchange_rate" numeric NOT NULL DEFAULT 1;
ALTER TABLE "compliance"."erp_purchase_invoices" ADD COLUMN "exchange_rate" numeric NOT NULL DEFAULT 1;

ALTER TABLE "compliance"."erp_journal_entry_lines" ADD COLUMN "currency_id" text;
ALTER TABLE "compliance"."erp_journal_entry_lines" ADD COLUMN "exchange_rate" numeric;
ALTER TABLE "compliance"."erp_journal_entry_lines" ADD COLUMN "debit_in_currency" numeric;
ALTER TABLE "compliance"."erp_journal_entry_lines" ADD COLUMN "credit_in_currency" numeric;
