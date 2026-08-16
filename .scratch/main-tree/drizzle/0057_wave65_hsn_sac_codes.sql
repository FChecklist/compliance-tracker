-- Wave 65 (India GST compliance gap-fill, per ERPNext's Item.gst_hsn_code
-- field shape as reference): HSN (goods) / SAC (services) classification
-- codes, required on GST invoices/returns above the notified turnover
-- threshold. A free-text code on erp_items (the HSN/SAC master list is a
-- government-published code list, not org-editable data), snapshotted onto
-- invoice line items at invoice-creation time so a later item HSN change
-- never silently rewrites a past invoice's GST classification.

ALTER TABLE "compliance"."erp_items" ADD COLUMN "hsn_sac_code" text;
ALTER TABLE "compliance"."erp_sales_invoice_items" ADD COLUMN "hsn_sac_code" text;
ALTER TABLE "compliance"."erp_purchase_invoice_items" ADD COLUMN "hsn_sac_code" text;
