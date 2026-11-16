# How DPDP takes payment (16 November 2026)

**Short version.** DPDP takes money exactly the way the games do: the product website hands over to **IT Services by Rajat Agarwal**, which uses **Razorpay**. There is no separate Razorpay account for DPDP and none is needed. This was already built and is already in place; this page records it, with the checks that were made, so nobody rebuilds it.

## The path

1. The owner of an organisation presses **Pay online** in the Billing panel and ticks the Terms box. The browser never sends an amount; the database picks the price.
2. The edge function `dpdp-pay` opens the order through the **central payment service** of IT Services (`/api/pay/order`, header `x-site-key`, the site is `veridian-aios.com`, **site code DPD**). Every payment lands in that one ledger.
3. The app opens Razorpay's window inside the registered **pay frame** (`https://itservices-rajat-agarwal.pages.dev/payframe/`). No card field and no Razorpay script exists on the DPDP site.
4. The browser reports Razorpay's signed result to `dpdp-pay/verify`. The function checks the signature, asks Razorpay what really happened, tells the central service (`/api/pay/verify`), and books the payment once. A webhook (`dpdp-pay/webhook`) is the backstop for someone who closes the tab.
5. One id ties the three ledgers together: `DPD-dpdp_<attempt id>` (Razorpay, the central ledger, and DPDP's own ledger C).

Wording a person sees: English, payee "IT Services by Rajat Agarwal", Razorpay as the only way to pay.

## What was checked on 16 November 2026

| Check | Result |
|---|---|
| Edge function `dpdp-pay` | deployed, answers (no sign-in: 401, bad webhook signature: 401, bad verify body: 400); it is **not** answering "not switched on" |
| Edge secrets | `PAY_SERVICE_KEY`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` are all set; compared by hash, never printed: `PAY_SERVICE_KEY` is DPDP's own key for site `veridian-aios.com`, the three Razorpay values equal the ones held in the owner's local env file |
| Central service accepts DPDP's key | yes (a request with the key and an invalid amount was refused for the amount, not for the key; nothing was created) |
| Site code DPD | present in the central service's site table and the pay-frame allow-list holds the DPDP app addresses |
| Real payments so far | none: `dpdp.payment_attempt` is empty. The path is wired but has never carried a real payment |
| Tests | `dpdp-pay-logic` and `dpdp-pay-ledger` (102 pass), the dpdp-app payment tests (43 pass), and the new `src/lib/services/dpdp-pay-games-pattern.test.ts` (6 pass; each of four planted changes was caught, then restored) |

The Razorpay keys are **live** keys. A real payment moves real money.

## Left for the owner

1. In Razorpay, check that the webhook list holds the `dpdp-pay/webhook` address of the DPDP backend with `payment.captured` and `order.paid`, and the same secret as `RAZORPAY_WEBHOOK_SECRET`. Only the backstop needs it; the normal path does not.
2. One real, small, refundable payment from a trial organisation, as the end-to-end proof. This is the owner's call because it is real money.

## One difference from the games, on purpose left as it is

If the central service cannot be reached, `dpdp-pay` opens the order directly with Razorpay using the same IT Services keys (the games do the same). That is a resilience fallback, not a second account. Removing it would make DPDP stop taking payments whenever the central service is down; say so if that is wanted.

## Not done here

`dpdp-app/OPERATIONS.md`, section "Online payment (Razorpay)", still lists six steps for the owner (create keys, add the webhook, set secrets, test, go live) that describe the situation before the keys were set. Updating it touches `dpdp-app/`, which redeploys the app, so it waits until the independent check is done.
