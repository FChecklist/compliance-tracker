# How DPDP takes payment (16 November 2026)

**Short version.** DPDP takes money exactly the way the games do: the product website hands over to **IT Services by Rajat Agarwal**, which uses **Razorpay**. There is no separate Razorpay account for DPDP and none is needed. The path was already built the games' way and is deployed; on 16 November the last direct-to-Razorpay parts were removed (owner rule: no direct Razorpay and no separate KYC per product).

## The path

1. The owner of an organisation presses **Pay online** in the Billing panel and ticks the Terms box. The browser never sends an amount; the database picks the price.
2. The edge function `dpdp-pay` opens the order through the **central payment service** of IT Services (`/api/pay/order`, header `x-site-key`, the site is `veridian-aios.com`, **site code DPD**). Every payment lands in that one ledger.
3. The app opens Razorpay's window inside the registered **pay frame** (`https://itservices-rajat-agarwal.pages.dev/payframe/`). No card field and no Razorpay script exists on the DPDP site.
4. The browser reports Razorpay's signed result to `dpdp-pay/verify`. The function sends it to the central service (`/api/pay/verify`), which checks the signature, asks Razorpay what really happened and records it in its ledger; `dpdp-pay` then books the payment once, after checking the amount, currency and organisation against its own attempt. A webhook (`dpdp-pay/webhook`) is the backstop for someone who closes the tab.
5. One id ties the three ledgers together: `DPD-dpdp_<attempt id>` (Razorpay, the central ledger, and DPDP's own ledger C).

Wording a person sees: English, payee "IT Services by Rajat Agarwal", Razorpay as the only way to pay.

## What was checked on 16 November 2026

| Check | Result |
|---|---|
| Edge function `dpdp-pay` | deployed, answers (no sign-in: 401, bad webhook signature: 401, bad verify body: 400); it is **not** answering "not switched on" |
| Edge secrets | `PAY_SERVICE_KEY` and `RAZORPAY_WEBHOOK_SECRET` are set (the Razorpay API key pair is also still set but is no longer read); compared by hash, never printed: `PAY_SERVICE_KEY` is DPDP's own key for site `veridian-aios.com`, the others equal the owner's local env file |
| Central service accepts DPDP's key | yes (a request with the key and an invalid amount was refused for the amount, not for the key; nothing was created) |
| Site code DPD | present in the central service's site table and the pay-frame allow-list holds the DPDP app addresses |
| Real payments so far | none: `dpdp.payment_attempt` is empty. The path is wired but has never carried a real payment |
| Tests | `dpdp-pay-logic`, `dpdp-pay-ledger` and the new `dpdp-pay-games-pattern` (110 pass in all), the dpdp-app payment and guide tests (57 pass); seven planted changes to `index.ts` were each caught by the new test, then restored. The Deno wiring itself cannot be run by bun, so it is checked by pins on its source plus the pure functions; the first real payment is the end-to-end proof |

The key behind the central service is a **live** key. A real payment moves real money.

## Left for the owner

1. In Razorpay, check that the webhook list holds the `dpdp-pay/webhook` address of the DPDP backend with `payment.captured` and `order.paid`, and the same secret as `RAZORPAY_WEBHOOK_SECRET`. Only the backstop needs it; the normal path does not.
2. Deploy of the changed `dpdp-pay` (only after the independent check).
3. One real, small, refundable payment from a trial organisation, as the end-to-end proof. This is the owner's call because it is real money.

## No direct Razorpay (the change in this PR)

`dpdp-pay` no longer holds a Razorpay API key and makes no call to Razorpay. Before, it opened the order directly with Razorpay if the central service could not be reached, and it checked the payment with Razorpay itself. Now both go through the central service only. The checkout key id comes from the central service's answer (it is the public id, not a secret). If the central service is down, a payment simply does not start and the app shows the calm "not available right now" line. The only Razorpay value left on DPDP's side is the webhook secret (an inbound signature check). `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are still set on the edge function from before but nothing reads them; the owner can delete them in the Supabase dashboard when convenient.

## Not done here

`dpdp-app/OPERATIONS.md`, section "Online payment (Razorpay)", still lists six steps for the owner (create keys, add the webhook, set secrets, test, go live) that describe the situation before the keys were set. Updating it touches `dpdp-app/`, which redeploys the app, so it waits until the independent check is done.
