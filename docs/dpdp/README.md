# VERIDIAN DPDP: product knowledge (index)

Written 14 November 2026. This folder is the written memory of the DPDP product's weekly **Identify, Classify, Prove** cycle, so that a person or an AI session who was not there can understand what was built, why, where it lives, how to run it and what is left.

This is a public repository. Nothing in these pages is a secret, key, token, person's e-mail or phone number, real customer or organisation name, price or private owner decision. Where real data is described, only counts are given.

## The whole thing in plain English

VERIDIAN DPDP helps Indian schools, universities and CA or CS firms keep up with India's data-protection law (the DPDP Act) with a short routine, once a week, instead of a one-off panic.

Every week the person in charge does three short things:

1. **Identify.** Write down what personal data the organisation holds (student records, staff files, CCTV), where it sits, and which outside helpers touch it. Only names of things go in, never a person's details.
2. **Classify.** For each line, say whose data it is, whether it is about children, why it is held, on what legal basis and for how long. The page then says in plain words what needs a look (for example children's data with no parent-consent answer).
3. **Prove.** Keep dated records that show the work was done: documents (only a fingerprint is stored, the file never leaves the organisation), breaches with their two time limits, requests and complaints, erasures, and a signed-off week. One click makes a printable evidence pack.

The page shows "N of M steps of this week's routine". That is a count of routine steps. It is never called "compliant" and it is not a legal rating.

On Monday morning an e-mail (the "Monday e-mail") repeats the same three steps with a button that opens the right page. A CA firm's e-mail also lists the clients that person acts for, worst first. **That e-mail block is built and deployed but switched OFF**, until the boss decides to turn it on.

**State on 14 November 2026:** the cycle is live in production (database, edge function and app). The Monday e-mail block is off. A few small items are open (see `05-LIVE-STATE-AND-OPEN-ITEMS.md`).

## Pages

| Page | Answers |
|---|---|
| [01-WHAT.md](01-WHAT.md) | What was built: the weekly cycle, the views for each kind of person, the Monday e-mail, migrations 0761 to 0763 |
| [02-WHY.md](02-WHY.md) | Why it is shaped this way: the owner's decisions with dates, the six audit rounds and what each found |
| [03-WHERE.md](03-WHERE.md) | Where everything is: files, tables, functions, the edge function, the Cloudflare Pages project, the workflows |
| [04-HOW.md](04-HOW.md) | How to run it locally and in mock mode, how to test it, how the deploy order works (and why it was changed), how to turn the Monday e-mail on or off, how to roll back |
| [05-LIVE-STATE-AND-OPEN-ITEMS.md](05-LIVE-STATE-AND-OPEN-ITEMS.md) | What is live as of 14 November, the rollback ids, and what is still open |
| [OWNER-NOTE.md](../../dpdp-app/docs/icp/OWNER-NOTE.md) | The owner note, in plain words (written before the go-live; where it says "nothing applied", read `05` for the live state) |
| [PLAN.md](../../dpdp-app/docs/icp/PLAN.md), [GAP-ANALYSIS.md](../../dpdp-app/docs/icp/GAP-ANALYSIS.md), [ROUND-LOG.md](../../dpdp-app/docs/icp/ROUND-LOG.md) | The plan, the gap list, and the full round-by-round audit log (the long source for `02-WHY.md`) |

## Which repository holds this

Only `FChecklist/compliance-tracker`: these pages in `docs/dpdp/`, and the earlier working documents in `dpdp-app/docs/icp/`. (These pages live outside `dpdp-app/` on purpose: any change under `dpdp-app/` redeploys the app to Cloudflare Pages.) The repository `FChecklist/veridian-dpdp` exists and is **public, not private**; it is a stale copy of compliance-tracker made on 3 November 2026 (last pushed that day) and does not hold the weekly-cycle work or any product notes of its own, so nothing was added to it. (Since 14 November the owner has made all repositories public except those holding secrets, so it is public by design.)
