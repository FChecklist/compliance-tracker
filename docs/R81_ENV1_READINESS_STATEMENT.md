# PROJEXA-AI.COM — environment 1 readiness statement

**As at** 2026-09-08 · **Prepared by** R81 · **Status: PROVISIONAL**
Provisional because the concurrent R80 session has work in flight that moves
several of these figures. Every number below is traceable to a query or a commit;
nothing is estimated.

---

## The answer

**Environment 1 is not ready to put in front of a paying customer, and the
reasons are a short list rather than a long one.**

Nine gaps block release. Three of them need **you**, not an engineer, and two of
those three are single settings changes. The product itself — the ERP a
construction firm actually buys — is in better shape than the paperwork
suggested: the requirement ledger was found to *under*-credit it more often than
it over-credited it.

---

## Headline figures

| # | Figure | Value | Source |
|---|---|---|---|
| 1 | Requirements tracked | **70** | `platform.sumeet_requirements` |
| 2 | Stored CLOSED | **48** | same |
| 3 | **Defensible CLOSED** | **42** | 48 minus six citing a spec that skips itself |
| 4 | BLOCKED | **13** | 12 are built in source; they need a test that *ran* |
| 5 | OPEN | **4** | R-50, R-C11, R-C15, R-C16 |
| 6 | NOT_TESTABLE | **5** | owner/legal actions, not code |
| 7 | Gaps recorded | **24** | `platform.r81_gap` |
| 8 | **Gaps blocking launch** | **9** | G-01, G-02, G-03, G-06, G-07, G-08, G-19, G-21, G-23 |
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

### Needs engineering, assigned and in flight

6. **G-06 / G-07** — transaction nesting on money paths, and the AI audit row that vanishes in production. R80, largely landed.
7. **G-08** — no password reset in **either** repo. A locked-out customer has no recovery path.
8. **G-23** — five UI-surfaced modules advertise capabilities with no executor, with the failing sentence in the composer's own placeholder. **The single most damaging thing a first customer would meet**, and the cheapest of these to fix: the screens already work, only the wiring is missing.
9. **G-02 / G-03** — AI attribution, and six closures resting on a test that skips itself.

---

## What is genuinely good, and should be said

- **Tenant isolation holds.** `orgId` is never taken from client input; RLS is complete on both schemas; the cross-repo cache hazard is now enforced by a test rather than a comment.
- **The ERP works end to end.** PO → goods receipt → stock was proven through the real UI, including the free-text/stock-item split that had been dead.
- **The ledger under-credits the product.** Twelve of thirteen BLOCKED requirements are fully built in source; they were recorded against a paused environment, not against the code.
- **The build now defends itself** where it previously could not: migration journal parity, auth-guard enforcement, comment rot, closure-citation skips, cache safety. Each proven falsifiable. Figure 17 is what stops them mattering.

---

## What I could not establish, stated rather than glossed

- **Whether the six skipped closures pass.** `demo-gate-smoke` **does** run against environment 1 — it doesn't skip — but dies on a 90s timeout, not an assertion, and the APIs it tests return 200 with correct data when called directly. A warm-up loop should settle it. Until then 42 is the honest number.
- **Whether environment 1 can be rebuilt.** It cannot today (figure 16). Whether that matters depends on a decision you have not yet made: recovery by replaying migrations, or recovery by restoring a backup.
- **Composer executor coverage beyond the registry.** Confirmed 8 registered functions across 7 modules; whether a second dispatch path exists was not re-derived from my side.

---

## The one sentence to keep

Of the nine blockers, **three are settings changes only you can make**, two are
**rulings** no amount of engineering can substitute for, and the four remaining
engineering items are assigned and moving. That is a short list — but figure 17
means none of the automation built to protect it can currently hold a line.
