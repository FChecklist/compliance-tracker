# PROJEXA-AI.COM — release plan for environment 1

**Written** 2026-09-08 by R81, after a 12-agent audit across six dimensions, each
dimension adversarially verified. Agreed with the R80 session.
**Scope:** environment 1 = local + Supabase + GitHub. Vercel (environment 2) is
**not a gate** and appears only in the last section.

---

## The honest state

Nine gaps were recorded as launch-blocking. Independent verification says **four**
of them actually stop a real customer using the product. The rest are real, and
several are serious, but they do not stop a user transacting — conflating those
two is how a blocker list becomes a wish list nobody can act on.

Two **critical** holes found during this pass were of a class nobody had filed:
a privileged routine trusting a caller-supplied identity. Both are now closed and
proved closed (HTTP 200 → 401 against the live APIs).

| Requirement ledger | Count |
|---|---|
| Stored CLOSED | 48 |
| **Defensible CLOSED** | **42** — six cite a spec that skips itself |
| BLOCKED | 13 (12 built in source; they need a test that *ran*) |
| OPEN | 4 |
| NOT_TESTABLE | 5 |

---

## PHASE 0 — owner only. Minutes of work, and it gates everything else

Nothing here can be done by either session. Items 1 and 2 are security holes that
are **open right now**, not at launch.

| # | Action | Where | Why it cannot wait |
|---|---|---|---|
| 1 | **Set `MINT_SECRET`** | Supabase `evpckeuxgvahguwsaeul` → Edge Functions → Secrets | Retires the secret published in the public repo. The function reads it immediately, no redeploy. Until then, one demo account is mintable by anyone who reads GitHub. |
| 2 | **Remove `compliance` from Exposed Schemas** | Supabase `pcrjmlpuqsbocqfwoxod` → API settings | The root enabler behind the anon-RPC hole. Revoking four functions treated the symptom; this closes every current *and future* anon-reachable object in that schema at once. |
| 3 | **Branch protection on `main`, both repos** | GitHub settings | `projexa` main is unprotected; `compliance-tracker` main requires **zero** status checks. Every CI gate either session has built — auth guard, secret scanning, migration parity — is **advisory today**. A red build merges. |
| 4 | **Rule on R-50** | — | The requirement says project value must match the BOQ total; the code deliberately does the opposite on a standing ruling recorded at `construction-dashboard-service.ts:159-163`. Only the owner can say which is wrong. **Do not let anyone "fix" this in code** — reconciling them reintroduces the R67 D-62 "three money stories" defect. |
| 5 | **Rule on the AI provider** (+ spend) | — | `adapter.ts:78-82` states subscription auth may not serve another person. Lawful routes are OpenRouter or an Anthropic **API key**. This is a licensing decision with a cost, not a config fix. |
| 6 | **Git history purge** | runbook `docs/R81_SECRET_HISTORY_PURGE_RUNBOOK.md` | Prepared, not run — rewriting public history changes every commit SHA. Do **after** item 1; before it, the purge achieves nothing. |

---

## PHASE 1 — the four real blockers, both sessions in parallel

Split by **surface**, which is what has kept the two sessions from colliding:
R80 takes `src/lib/services/**`, `src/components/**`, `e2e/**`;
R81 takes `scripts/**`, `drizzle/**`, `.github/**`, `src/lib/db/**`,
`src/lib/veridian-client.ts`, and all `platform.*`.

**R80**
1. **G-06 nesting class** — 22 reachable sites (not 11). *In flight.* Carry the caveat: 6 of 14 callees open a transaction in an enablement gate **before** their own, so threading a handle alone is not a fix — that is exactly how `6b56c00b` looked correct and fixed nothing.
2. **G-08 password reset** — missing from **both** repos (`resetPasswordForEmail` count is 0 in each); `forgot-password` is a 17-line redirect to `/login`. Cheapest real blocker, and a locked-out customer has no recovery path at all.
3. **G-11 connector scope gate** — `executeGatedConnectorAction` has zero production call sites while live paths call `executeAction` directly.
4. **G-01b** — the L2 batch bypasses the AI gate, and its justification ("no `claude` binary on serverless") is env-2 reasoning that fails on env 1, where the binary exists.

**R81**
1. Requirement ledger and `closure_state` — the 20 disputed entries.
2. `r43_faults`, including every reachable site from the 22-site inventory.
3. Migration debt — 8 remaining journal orphans (`R81_F37`).
4. `platform.*` schema and RLS.
5. The G-01 owner item, written so the owner is not asked to choose between "OpenRouter or API key" when the real answer is that the provider axis itself is wrong.

---

## PHASE 2 — earn the closures back

The 12 BLOCKED requirements are **built in source**; what is missing is a test
that *ran*. Three spec files already cover them
(`r81-d603-scope`, `-work-progress`, `-chain`) — this is not twelve specs of work.

1. Fix `R-82`'s spec: it has a **bare `return` before any assertion**, so it passes while proving nothing — the same false-closure mechanism as the self-skipping demo gate.
2. Run the specs against env 1 (`E2E_PROJEXA_ORIGIN=http://localhost:3100`) until green **in CI**.
3. `demo-gate-smoke` needs a warm-up loop and a timeout above 90s: on env 1 it gets past auth and TC-01 and dies on the clock, not on an assertion. If it goes green, **six closures become defensible** and 42 moves up for the first time on evidence rather than assertion.
4. Then flip `check-closure-citation-skips.mjs` from report-only to blocking.

---

## PHASE 3 — close the nesting class properly

Strict order, agreed between both sessions:

1. R80 fixes all 22 sites.
2. R81's instrumentation (`getNestingObservations()`, ct `163e00d4`) reports **zero** across real traffic. This is the gate: "every site is fixed" was a claim resting on a static sweep, and a static sweep cannot see dynamic dispatch.
3. **Only then** flip `assertNotNested` from warn to throw in production.

Flipping earlier converts silent transaction splits into live 500s on financial
paths — trading a data-integrity risk for a customer-facing outage.

---

## PHASE 4 — sign-off

Env-1 readiness statement with the 18 headline figures, every number traceable to
a query or a commit. No figure quoted that a citation cannot survive.

---

## THEN, and only then: environment 2

When the owner recharges Vercel credits:

- **`G-22` first.** `projexa-ai.com` and `www.projexa-ai.com` are **not attached to the canonical `projexa` project** — the repo's own drift check is failing on it. Fix that *before* unpausing, or the domain will not serve PROJEXA at the exact moment it matters. Read `ai-os/DOMAIN_OWNERSHIP.yaml` first; the check's own error says **do not** use `vercel domains rm`.
- Then unpause, deploy, and re-run the env-1 gates against env 2.

---

## Standing rules that produced this document

- **A green check that answered a question it never asked is worse than no check** — it gets quoted as proof. Found three times today: a CI job green because its only test skipped; an auth-guard check that exited 0 on every change; a payload gate reporting fabrication over letter case.
- **Establish the environment before attributing a failure to product code.** The one time that was skipped this session, a Critical was filed against code that was never at fault.
- **Check before filing.** It prevented four false findings today, including one where an audit flagged a "false closure" whose evidence file it had never opened.
