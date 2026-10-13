# dpdp-pay (Razorpay online payment)

Two endpoints, one function. Full owner steps: `dpdp-app/OPERATIONS.md`, "Online payment (Razorpay)".

- `POST /dpdp-pay` - signed-in org owner; creates a Razorpay Order for the yearly plan (the Corporate Tambola method) and returns `hop` (the registered IT Services pay frame) + the window options. The browser sends no amount: the database (`dpdp_pay_begin`) picks the price. Order notes: `product=veridian_dpdp`, `variation=<plan>_<interval>`; receipt `dpdp_<attempt id>` (see `docs/PAYMENT_TRACING.md`).
- `POST /dpdp-pay/verify` - the browser reports Razorpay's signed result; the signature is checked and Razorpay is asked what really happened before the payment is booked (the same booking function the webhook uses).
- `POST /dpdp-pay/webhook` - Razorpay; `X-Razorpay-Signature` is HMAC-SHA256 of the raw body under `RAZORPAY_WEBHOOK_SECRET`.

Files: `index.ts` (wiring), `logic.ts` (pure, tested by `src/lib/services/dpdp-pay-logic.test.ts`), shared `../_shared/billing-mail.ts`, `mail-outbound.ts`, `mail-taxonomy.ts`.

The K3 box (`drizzle/0748_dpdp_terms_acceptance.sql`): `POST /dpdp-pay` needs `termsVersion` (the current Terms version) and `termsAccepted: true` in the body. Without them it answers 400 `{"error":"Please tick the box to continue.","code":"consent-required"}` before any Razorpay call, and the database (`dpdp_pay_begin`) refuses the same way and records the tick against the payment attempt. The version constant is `../_shared/terms.ts`.

Deploy: `verify_jwt: false` (Razorpay cannot send a Supabase JWT; the create endpoint's owner check is in the database). Needs migrations `0673_dpdp_razorpay_sales_lifecycle.sql`, `0747_dpdp_pay_order_product_variation.sql` and `0748_dpdp_terms_acceptance.sql` first (deploying this version before 0748 is applied makes every payment attempt fail: the database would not know the two new arguments). Optional secret `PAY_HOP_URL` (default `https://itservices-rajat-agarwal.pages.dev/payframe/`).

Secrets (Edge env, set by the Owner only): `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. Optional: `RESEND_API_KEY`, `DPDP_EMAIL_FROM`, `APP_ORIGIN`. With the keys missing every call answers 503 `{"code":"not_enabled"}` and the app falls back to bank transfer.

Webhook answers: 401 bad signature; 200 booked / duplicate / flagged second payment / ignored event type; 400 unreadable, wrong amount, wrong currency, wrong org; 404 unknown order; 500 temporary fault (Razorpay retries).

## Ledger C (payment ledger, 2026-10-14; `ledger.ts`, `drizzle/0749_dpdp_ledger_c.sql`)

Owner order 2026-10-13: Razorpay (A), the central ledger of IT Services by Rajat Agarwal (B) and this database (C) carry the same ids. Spec: `PAYMENT_LEDGER_ABC_SPEC_2026-10-13.md`. Site code `DPD`.

- **txn_id** = `DPD-dpdp_<attempt id>` = `DPD-` + the receipt. One "Pay online" press = one `dpdp.payment_attempt` row = one txn_id (a generated column, so it exists the moment `dpdp_pay_begin` inserts the row). It is in the Razorpay order notes (the central service adds it; the direct-order fallback adds it too), in the receipt, in B (`payment.txn_id`) and in C. The `POST /dpdp-pay` answer returns it as `txnId`.
- **Every Razorpay attempt** (authorized / captured / failed, with method, bank, masked card / UPI, rrn, Razorpay's error fields, fee and GST on the fee, times) is one row of `dpdp.ledger_payment_attempt` (PK = `rzp_payment_id`). Status only moves forward. Written by the webhook (any of `payment.authorized|captured|failed`, `order.paid`, `payment_link.paid`) and by `/verify` (Razorpay's own answer, also for a failed payment). Refunds (`refund.created|processed|failed`) are rows of `dpdp.ledger_refund`. Nothing about a card beyond its last four digits, and no payer e-mail or phone, is stored.
- **Repeat deliveries**: `dpdp.ledger_event_seen` (PK = `x-razorpay-event-id`, or a derived key `d:<event>:<id>:<time>` when the header did not arrive). A delivery is marked seen only after the booking AND the ledger write succeeded.
- **C -> B**: `POST /api/pay/site-summary` (current + previous Indian month, at most every 30 minutes, decided in the database by `dpdp_ledger_summary_claim`) and `POST /api/pay/commission` (`dpdp.referral_commission` pending -> `accrued`, paid -> `paid`; `site_ref` = the commission id). Triggered after every payment event and by pg_cron `dpdp-ledger-tick` (every 30 minutes) calling `POST /dpdp-pay/ledger-tick` with the Vault bearer. Needs the secret `PAY_SERVICE_KEY` (already used for the central order); without it nothing is pushed.
- **Owner report**: `rpc dpdp_owner_ledger(p_month)` or `POST /dpdp-pay/ledger {"month":"2026-10"[,"format":"csv"]}` with the platform owner's sign-in (anyone else gets 403). It lists every website payment with all its Razorpay attempts, unmatched attempts, refunds, commissions with their sync state, and `issues` (should be empty): `paid_twice_for_one_site_payment`, `captured_but_not_booked`, `captured_without_a_website_payment`, `amount_differs`, `commission_on_refunded_sale`.
- DPDP has no "void" commission state, so a commission on a refunded sale is only flagged (`commission_on_refunded_sale`), never cancelled in B: that is a policy decision for the owner.
- Tests: `src/lib/services/dpdp-pay-ledger.test.ts`.
