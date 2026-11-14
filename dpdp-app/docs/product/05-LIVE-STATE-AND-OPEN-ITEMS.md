# Live state (14 November 2026) and open items

## What is live

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
