# GST tax invoice check (report only, nothing changed)

Checked: what the product sends after a payment (`supabase/functions/_shared/billing-mail.ts` `renderReceipt`, sent by `dpdp-invoice-email` and the Razorpay webhook path) against what a GST tax invoice normally shows. For the CA to confirm; not tax advice.

The pricing page says "Every payment gets a GST invoice" and "exclusive of GST".

| Normally on a tax invoice | In the receipt today |
|---|---|
| Supplier name, address, GSTIN | Yes (legal name, registered office, GSTIN 09AAZCS4477M1Z3, CIN) |
| Invoice number, consecutive, one series | No. There is a payment reference (Razorpay id) but no invoice number |
| Invoice date | Partly: "Confirmed" date |
| Customer name | Yes (organisation name) |
| Customer address and GSTIN (needed for a registered business customer) | No. Not collected |
| Description of the service and HSN/SAC code | Plan name and period only. No SAC code |
| Taxable value, GST rate, CGST+SGST or IGST amounts | No. One amount is shown, "Rs N"; whether it includes GST is not stated |
| Place of supply | No |
| Total in figures (and the signature or e-signature line) | Total only |

Reading: the e-mail is a payment receipt, not a GST tax invoice. If the pricing promise stands, an invoice with the missing fields needs to be produced for each payment. If not, the pricing wording should say "a receipt" until it is. Decision for the owner and the CA. Nothing was changed in this pass.

Also check: how the amount in the receipt relates to the amount Razorpay charged (whether GST is added on top), and where the invoice number series would live (`dpdp.payment` has no invoice number column today).
