# Live state (updated 17 November 2026) and open items

## Update, 17 November 2026 (read this first; the sections below were written on 14 November)

**Payments are live and go the games' way.** Pull request 2213 (squash commit `64697f0a`) removed the last direct-to-Razorpay parts. The `dpdp-pay` edge function is deployed as **version 25** (version 23 was live before; rollback is to redeploy from commit `9d40babc`). Every payment goes product site, then IT Services by Rajat Agarwal (the central payment service), then Razorpay, under site code DPD. See [06-PAYMENTS.md](06-PAYMENTS.md). Live smoke after the deploy, all as expected: no sign-in refused (401); a bad checkout signature refused (400); a malformed verify body refused (400); a webhook with a bad signature refused (401); a webhook for an order DPDP never opened answered 200 and recorded nothing; a webhook for another site's payment answered 200 and recorded nothing. **No real payment has been made through DPDP yet**: no accounts and no payment attempts exist. The first real, small, refundable payment from a trial organisation is the owner's to make (it moves real money through a live key).

**Monday e-mail routine ran cleanly on 16 November.** Read-only check of the run log: 572 organisations, 1,017 digests, 1 sent, 0 failed (the rest were skipped because the addresses are fixtures); the week before had 3 failures. The daily legal-clock job ran on 17 November. The ICP block flag was not re-read on 17 November, so treat the "OFF" line below as the last recorded value.

**Tests.** The whole `dpdp-app` suite passes on a clean copy of `main` (833 pass, 0 fail, 53 files, run on the partner laptop). Note for anyone copying only part of the repo: several tests read `../drizzle/*.sql` and `../src/app/...`, so a partial copy fails ten tests for no real reason.

**Prices and plans** match the owner's decisions (read from the live plan table, not repeated here). Old tiers stay switched off.

**Open pull requests that touch DPDP** (none changed on 17 November; the owner decides):

| PR | What it is | State |
|---|---|---|
| 2206 | Older "Discover, Act, Confirm" weekly routine | Superseded by 2207 (merged). Candidate to close |
| 2187 | Hide the school or institution option in the app (owner order of 27 October) | Draft, merge conflicts, its dpdp-app e2e check fails. Later work (the two sign-up doors, PR 2198) may overlap it. Needs the owner to say: still wanted (then rebase) or close |
| 2198 | Two sign-up doors (professionals and organisations) | Checks green, behind `main`. Needs a rebase and the owner's go |
| 2205, 2204, 2202 | Marketing pass-through mailbox; auth e-mail hook follow-up; mock-mode erasure e2e spec | Older, not touched here |

**Waits on the owner:** the first real payment as end-to-end proof; checking in Razorpay that the webhook entry for `dpdp-pay/webhook` exists with `payment.captured` and `order.paid` and the same secret; deleting the two unused Razorpay API-key secrets on the edge function after the first real payment works (the webhook secret stays); the lawyer-gated line on the public pricing page that still mentions a bank transfer; the `/sw.js` cache setting and `CLM-004` (items 1 and 3 below). Partner commission payouts stay on UPI or bank until the central gate is live; do not change them before then.

## What is live (14 November)

| Layer | State |
|---|---|
| Code | Pull request 2207 merged to `main` as squash commit `d20db319` |
| Database | Migrations `0761`, `0762`, `0763` applied in order to the live project, each checked. 19 new public functions; new tables have row security on and no anonymous access; the append-only trigger works; the Prove stage has seven steps on a real organisation; the weekly e-mail function ran read-only for three real organisations (three stages, wrote nothing, callable only by the service role). `icp_item` and `icp_run` hold no rows yet because the e-mail, which writes the first snapshot, is off |
| Edge function | `dpdp-monday-email` deployed as version 41 (was 39); answers 401 without the bearer secret |
| App | Cloudflare Pages `veridian-dpdp-app`, deployment `5641e695` (commit `d20db319`); app host answers 200 |
| Vercel | No deploy ran; nothing paid |
| Monday e-mail ICP block | **OFF** (`DPDP_EMAIL_ICP_ENABLED=0`, set before the function was deployed); the Monday timer itself is untouched |

## What was verified, and what was not

Verified: CI green on the merged head (23 checks passed, one cross-repository job skipped); the live checks above. Not verified: a real dry run of the e-mail (the timer secret is not held by the deploying session); anyone signing in and clicking through the new screens on the live site; a lawyer's review of the new wording.

## Open items

1. **`CLM-004`** (`data/claims-register.yaml`): left `owner_approved: false`. The owner approved the older sentence on 2026-09-22; the reworded sentence needs approval. The same sentence is still published from `data/veridian-facts.yaml` under its older file-level approval; the owner should look at both. Waits for the owner.
2. **PR 2206** (the older Discover, Act, Confirm draft with proposed migration 0760): still open, untouched; nothing in it was applied; PR 2207 replaces it. Waits for the owner to close it or say so.
3. **The `/sw.js` cache setting.** The daily live check (`dpdp-live-smoke.yml`) fails one of 135 checks ("`/sw.js` sent no-cache"). The Pages deployments serve no-cache, but the `veridian-aios.com` Cloudflare zone serves the file with a 4-hour browser cache. It has failed every day since 7 November, before this work. Fix: in the Cloudflare dashboard set Browser Cache TTL to "respect existing headers". An owner dashboard setting, not code.
4. **The e-mail has not been dry-run** (see `04-HOW.md`, section 4). Do this before turning the block on.
5. **Low items from Audit 6** (see `02-WHY.md`): the 25-recipient cap is applied before clients are known; scoring is unbounded for very large firms; a few untested caps.
6. **Not built** (see `01-WHAT.md`, section 6): consent campaigns and parent links, guardian verification, some library jobs, one-tap actions in the e-mail, erasure on a locked account.
7. `drizzle/meta/_journal.json` already lists 0761 to 0763 (the migrations are applied live by the Management API, so a later `db:migrate` run must not re-apply them blindly; they are re-runnable and additive).

## Left out of these pages, and why

- **The UI/UX flow file** (25 real screenshots of the mock screens, role by role, plus two sample Monday e-mails): kept outside the repository; about 2.5 MB of images with mock organisation names, and it is a presentation for the owner rather than product knowledge. It can be regenerated from mock mode (`04-HOW.md`, section 1).
- **Secret values, tokens, the project reference, people's e-mail addresses, real organisation names, prices, and private owner decisions:** deliberately absent (this repository is public).
