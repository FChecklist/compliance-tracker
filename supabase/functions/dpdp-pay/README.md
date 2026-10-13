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
