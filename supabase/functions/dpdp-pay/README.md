# dpdp-pay (Razorpay online payment)

Two endpoints, one function. Full owner steps: `dpdp-app/OPERATIONS.md`, "Online payment (Razorpay)".

- `POST /dpdp-pay` - signed-in org owner; returns a Razorpay-hosted Payment Link for the yearly plan. The browser sends no amount: the database (`dpdp_pay_begin`) picks the price.
- `POST /dpdp-pay/webhook` - Razorpay; `X-Razorpay-Signature` is HMAC-SHA256 of the raw body under `RAZORPAY_WEBHOOK_SECRET`.

Files: `index.ts` (wiring), `logic.ts` (pure, tested by `src/lib/services/dpdp-pay-logic.test.ts`), shared `../_shared/billing-mail.ts`, `mail-outbound.ts`, `mail-taxonomy.ts`.

Deploy: `verify_jwt: false` (Razorpay cannot send a Supabase JWT; the create endpoint's owner check is in the database). Needs migration `drizzle/0673_dpdp_razorpay_sales_lifecycle.sql` first.

Secrets (Edge env, set by the Owner only): `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. Optional: `RESEND_API_KEY`, `DPDP_EMAIL_FROM`, `APP_ORIGIN`. With the keys missing every call answers 503 `{"code":"not_enabled"}` and the app falls back to bank transfer.

Webhook answers: 401 bad signature; 200 booked / duplicate / flagged second payment / ignored event type; 400 unreadable, wrong amount, wrong currency, wrong org; 404 unknown order; 500 temporary fault (Razorpay retries).
