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

```
node scripts/razorpay-ledger-report.mjs --days 30
```

Read-only. It groups the last N days of Razorpay orders by product and variation (orders, paid, rupees paid), lists any order with no product label, and, when `SUPABASE_ACCESS_TOKEN` is set, compares every DPDP attempt with its Razorpay order in both directions:

- paid on Razorpay but not booked by us (needs a human: money arrived),
- booked by us but not paid on Razorpay,
- a Razorpay DPDP order we have no record of,
- variation or receipt that differs between the two.

Exit code 1 means "look at the output"; 0 means every order is labelled and every DPDP attempt agrees.

Orders made before 2026-10-11 carry the old labels (`engagement`, `payment test`, `Startup coaching program (12 steps)`) and show up as their own groups; they are history, not errors.

## Adding a fourth product

Use the same three words: pick a `product` code, define its `variation` values, make the receipt start with something that names the product, and write them on the Razorpay order notes AND on your own row. Add the product to the table above and to the report script's header comment.
