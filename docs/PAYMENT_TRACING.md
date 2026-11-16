# Payment tracing: which payment was for which product and which variation

Written 2026-10-11 (owner instruction: "ensure that we maintain clear payment at our end internally to trace which payment was for which product and which variation").

All products take money the same way: our own server creates a Razorpay **Order**, Razorpay's window runs in the registered pay frame of **IT Services by Rajat Agarwal**, and the server confirms with Razorpay before it books anything. Because three different products use one Razorpay account, every order is labelled so a payment can be traced both ways: from Razorpay to our records, and from our records to Razorpay.

## The labels

| Where | What it says |
|---|---|
| Razorpay order `notes.product` | `veridian_dpdp`, `corporate_tambola` or `startup_coach` |
| Razorpay order `notes.variation` | the exact thing bought (table below) |
| Razorpay order `receipt` | our own payment id, so one search finds the row on our side |
| Razorpay order `notes.*` ids | DPDP: `org_id`, `attempt_id`, `plan`, `interval`. Tambola: `payment_ref`, `pack`, `currency`. Coach: `startup`, `startups`, buyer contact |

| Product | `product` | `variation` | `receipt` | Our own record |
|---|---|---|---|---|
| VERIDIAN DPDP (veridian-aios.com) | `veridian_dpdp` | `<plan key>_<interval>`, e.g. `firm_growth_year` | `dpdp_<attempt id>` | Supabase `dpdp.payment_attempt` (product, variation, receipt, order and payment ids), booked rows in `dpdp.payment`; one joined view: `dpdp.payment_ledger` |
| Corporate Tambola | `corporate_tambola` | `pack_<participants>` (e.g. `pack_100`), `payment_test` | `pay_<id>` | D1 table `payment` (pack, amount, order and payment ids), `entitlement`, `invoice` |
| Startup coaching | `startup_coach` | `startups_<n>` | `sc_<id>` | Razorpay order notes only (the site stores nothing; e-mails go to the buyer and the owner) |

The two products in the owner's words, **Corporate Tambola and VERIDIAN DPDP, are different products**: they never share a table, an endpoint or a price list. Only the Razorpay account, the pay frame and these labels are shared.

## Checking it

The script `scripts/razorpay-ledger-report.mjs` was retired on 2026-11-16: it called Razorpay directly with API keys, and no product holds those keys any more (every payment goes through the central service of IT Services by Rajat Agarwal). Use instead:

- **The central ledger** of IT Services (`https://itservices-rajat-agarwal.pages.dev/`): every payment by website, product (`product`) and plan (`variation`), the master ledger and the tax summary.
- **DPDP's own report**, `POST /dpdp-pay/ledger {"month":"2026-11"[,"format":"csv"]}` with the platform owner's sign-in (or `select public.dpdp_owner_ledger('2026-11')`): every website payment with all its Razorpay attempts, refunds, commissions, and `issues` (should be empty): paid twice, captured but not booked, captured without a website payment, amount differs, commission on a refunded sale.

Orders made before 2026-10-11 carry the old labels (`engagement`, `payment test`, `Startup coaching program (12 steps)`) and show up as their own groups; they are history, not errors.

## Adding a fourth product

Use the same three words: pick a `product` code, define its `variation` values, make the receipt start with something that names the product, and write them on the Razorpay order notes AND on your own row. Add the product to the table above.
