# PROJEXA-AI.COM — environment 1 readiness statement

**As at** 2026-09-08 · **Prepared by** R81 · **Status: PROVISIONAL — revised 2026-09-09**
Provisional because the concurrent R80 session has work in flight that moves
several of these figures. Every number below is traceable to a query or a commit;
nothing is estimated.

---

## The answer

**Environment 1 is not ready to put in front of a paying customer, and the
reasons are a short list rather than a long one.**

Four gaps block release, and **every one of them needs you rather than an engineer**.
Two are single settings changes; two are rulings. There is no engineering blocker
left that either session knows of. The product itself — the ERP a
construction firm actually buys — is in better shape than the paperwork
suggested: the requirement ledger was found to *under*-credit it more often than
it over-credited it.

---

## Headline figures

| # | Figure | Value | Source |
|---|---|---|---|
| 1 | Requirements tracked | **70** | `platform.sumeet_requirements` |
| 2 | Stored CLOSED | **48** | same |
| 3 | **Defensible CLOSED** | **48** | was 42; the six are now demonstrated on env 1 (four runs, two sessions) |
| 4 | BLOCKED | **13** | 12 are built in source; they need a test that *ran* |
| 5 | OPEN | **4** | R-50, R-C11, R-C15, R-C16 |
| 6 | NOT_TESTABLE | **5** | owner/legal actions, not code |
| 7 | Gaps recorded | **26** | `platform.r81_gap` |
| 8 | **Gaps blocking launch** | **4** | G-01, G-02, G-19, G-21 — **all four are owner actions or rulings** |
| 9 | Faults filed this programme | **44** | `platform.r43_faults` `R81_%` |
| 10 | Critical faults | **9** (2 closed, **7 open**) | same |
| 11 | High faults | **23** (2 closed) | same |
| 12 | **Critical security holes found and closed today** | **3** | F40 hardened, F41 closed ×2 databases |
| 13 | `platform` tables without RLS | **0 of 91** | was 2; `drizzle/0573`, `0575` |
| 14 | `compliance` tables without RLS | **0 of 513** | already sound |
| 15 | Migration files unreachable by the build | **2** (+7 correctly excluded) | was 9; `R81_F37` |
| 16 | **Statements failing on replay-from-empty** | **371** | measured, `G-24` |
| 17 | **CI checks that can block a merge** | **0**, both repos | `R81_F44`, verified via GitHub API |
| 18 | Decisions recorded in the durable log | **30** rows | `platform.claude_log` |

---

## What blocks release, honestly grouped

### Needs you — minutes of work, gates everything

1. **Set `MINT_SECRET`** (Supabase → Edge Functions → Secrets). Retires a secret published in a public repo. One action, no redeploy.
2. **Remove `compliance` from Exposed Schemas.** The root enabler behind the anon-RPC hole; I revoked four functions, this closes the class.
3. **Branch protection on `main`, both repos.** Until this exists, figure 17 stands: every check either session built is a notification. **A red build merges.**

### Needs a ruling, not code

4. **R-50** — the code deliberately implements the opposite of the requirement, on your own standing ruling. Cannot be resolved by engineering.
5. **The AI provider** — `adapter.ts` states subscription auth may not serve other people. My recommendation is to ship with the AI **explicitly disabled** (option C in the decision memo): zero customers, the ERP is what's being bought, and the paid routes cost money that buys nothing yet.

### Needs engineering — **none left blocking**

6. ~~**G-06 / G-07**~~ — **CLOSED.** The nesting register went from **20 entries to 1**, verified by running the guard (11 pass / 0 fail). The one remaining entry is `G-26`, a product decision rather than a threading task — and it is *already failing silently today*, which is why it is carried separately rather than parked.
7. ~~**G-08**~~ — **RESOLVED.** PROJEXA now has `/forgot-password` + `/reset-password` (projexa `7e0c902`). My original claim that *neither* repo had a recovery path was **wrong about ct**: it offers magic-link, passcode, Google and SSO against exactly one password sign-in, and its redirect is a documented decision. A locked-out ct user was never locked out.
8. ~~**G-23**~~ — **DOWNGRADED, and this was my error.** I called it "the single most damaging thing a first customer would meet". I filed that on two facts — the module advertises a sentence, no executor exists — and never checked the third: what the user actually *sees*. `dry-run.ts:266` already returns an honest, routed refusal ("*not enabled for this workspace — Open Permits*"). The real defect was narrower: 19 of 25 modules fell through to a generic "Open Home", which R80 has fixed. Fifty sentences still have no executor — real, sizeable, no longer a launch judgement call.
9. **G-02** — AI attribution. (`G-03` is resolved: the six closures are now demonstrated on environment 1.)

---

## What is genuinely good, and should be said

- **Tenant isolation holds.** `orgId` is never taken from client input; RLS is complete on both schemas; the cross-repo cache hazard is now enforced by a test rather than a comment.
- **The ERP works end to end.** PO → goods receipt → stock was proven through the real UI, including the free-text/stock-item split that had been dead.
- **The ledger under-credits the product.** Twelve of thirteen BLOCKED requirements are fully built in source; they were recorded against a paused environment, not against the code.
- **The build now defends itself** where it previously could not: migration journal parity, auth-guard enforcement, comment rot, closure-citation skips, cache safety. Each proven falsifiable. Figure 17 is what stops them mattering.

---

## What I could not establish, stated rather than glossed

- ~~Whether the six skipped closures pass.~~ **SETTLED — they pass.** Demonstrated four times across two sessions against environment 1 (37.6s / 21.4s / 29.3s / 24.3s). Two corrections to what this statement first said: the spec never ran against env 1 *by default* — `PROJEXA_ORIGIN` defaults to the paused env 2 and the probe skips correctly — and the 90s timeout was an env-2 budget, now environment-aware at 240s locally. **Defensible CLOSED moves 42 → 48.** What remains is narrower and is filed as `G-25`: CI does not re-check it, so this is true today with nothing automated to notice if it stops being true.
- **Whether environment 1 can be rebuilt.** It cannot today (figure 16). Whether that matters depends on a decision you have not yet made: recovery by replaying migrations, or recovery by restoring a backup.
- **Composer executor coverage beyond the registry.** Confirmed 8 registered functions across 7 modules; whether a second dispatch path exists was not re-derived from my side.

---

## The one sentence to keep

All four remaining blockers are yours: **two settings changes** and **two rulings**.
The engineering queue is empty. What stands between environment 1 and a first
customer is now decisions, not code. That is a short list — but figure 17
means none of the automation built to protect it can currently hold a line.
