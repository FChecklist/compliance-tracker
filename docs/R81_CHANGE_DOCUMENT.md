# R81 CHANGE DOCUMENT

Authored by Claude Code (session `claude-code-r81`), 2026-09-08, from the gap ledger
`platform.r81_gap` (16 rows) and `platform.r43_faults` (`R81_F01`..`R81_F36`).

**What this is for.** Agents are briefed from this file. Every entry names an exact file
path and an exact change, the requirement it serves, what must be true before it starts,
and the test that will prove it. No entry says "refactor the module".

**What this is not.** It is not a schedule and it does not commit anyone to a date. The
sequence below is a dependency order, not an estimate.

---

## THE ONE THING TO READ FIRST

Two of these entries cannot be started by an engineer at all, and one of those blocks a
whole downstream work order:

- **C-01 is an owner decision about licensing**, not a code change. `adapter.ts:80` states
  in its own error text that Claude Code OAuth/subscription auth "permits ordinary
  individual use only — never to serve a request on behalf of a different person". The
  ruled end-user default therefore cannot be delivered as specified. Until it is resolved,
  every AI entry below is unmeasurable, and R81 Addendum C — which builds the Institutional
  Memory Graph on top of L1 — would measure nothing.
- **C-14 requires a credential rotation**, which is the owner's act.

Everything else in this document can proceed today.

---

## SEQUENCE

Group A runs first and its members are independent of each other. Group B depends on A.
Group C is quality work that changes no correctness guarantee.

| Group | Entries | Depends on |
|---|---|---|
| A — launch blockers | C-01 … C-06 | nothing |
| B — correctness and coverage | C-07 … C-12 | A for the AI entries only |
| C — quality and measurement | C-13 … C-16 | B |

Parallel groups are sized to **measured free RAM**, not to the entry count. This machine
has 7.82 GB total and has repeatedly fallen to 0.04–0.5 GB free with two dev servers and
two Claude sessions running. Observed floor: **one browser-driving agent at a time**, and
no browser work at all below ~1 GB free. A second concurrent session (R80 Addendum) shares
this machine; coordinate before taking the browser slot.

---

## GROUP A — LAUNCH BLOCKERS

### C-01 — Resolve the AI provider licensing question *(OWNER)*
- **File:** `ct/src/lib/ai/adapter.ts:65-92`, plus the Vercel environment
- **Change:** choose **OpenRouter** or an **Anthropic API key**, then set `AI_PROVIDER`
  accordingly. API-key auth may lawfully serve other people and keeps "Sonnet High" as the
  end-user default in substance; subscription auth may not.
- **Serves:** G-01 · fault `R81_F05` · all of Stream 3 · R81 Addendum C
- **Precondition:** none. **Blocks:** C-02, C-03, and Addendum C entirely.
- **Test:** `surface=API`. Call an AI surface as a **non-owner** role and assert a real
  completion rather than `AiProviderRefusalError`.
  **Falsifiability:** unset the variable and assert the refusal returns.
  *Today this test cannot pass for any user, including the owner, because `if (!allowed)`
  throws before the identity comparison.*

### C-02 — Persist whether the AI acted
- **File:** `ct/src/lib/pipeline/run-submission.ts:1020` (`executor` is hardcoded
  `"software"`); `openrouter.ts:59,:78-84` (model id resolved then discarded);
  `run-submission.ts:300-304` (prompt hash never computed); `level1.ts:102-106`
  (retrieved item ids never written)
- **Change:** assign `executor` truthfully; add `source`/`level` to `pipeline_tasks` by
  **additive** migration; persist model id, prompt hash and retrieved item ids.
- **Serves:** G-02 · fault `R81_F21`
- **Owned by:** the R80 Addendum session (pipeline is theirs). Coordinate; do not edit.
- **Test:** `surface=API`. Run one AI-resolved and one software-resolved task; assert the
  database distinguishes them. **Falsifiability:** force the AI path and assert the row does
  not say `software`.
- **Note:** the 95/5 split **cannot** be measured by counting model calls — `0` is exactly
  what a switched-off AI produces. Success and absence read identically until this lands.

### C-03 — Write the AI audit row the constitution requires
- **File:** `ct/src/lib/services/orchestra-execution-logger.ts` and its seven callers
  (`crm-accounts`, `crm-service` ×2, `fm-register-digitization`, `veri-meeting`,
  `task-execution-engine`)
- **Change:** thread the open `db` handle, or hoist the call outside the transaction.
- **Serves:** G-07 · fault `R81_F35` · `VERIDIAN_AI_CONSTITUTION #19` / `SEC-03`
- **Test:** `surface=API`. Trigger an AI action inside a transaction; assert the audit row
  exists. **Falsifiability:** revert the threading and assert the row disappears while the
  request still succeeds — which is the production behaviour today.

### C-04 — Close the eleven remaining nested-transaction sites
- **Files:** `erp-invoicing-service.ts:410,:560,:1583`,
  `erp-payment-entries-service.ts:426`, `construction-valuation-service.ts:197`,
  `erp-contract-service.ts:240`, `crm-service.ts:456`, `kpi-hub-service.ts:100`,
  `pms-budget-service.ts:88`
- **Change:** thread the open handle. **Where the callee begins with an enablement gate
  (`requireErpEnabled` / `requireSalesEnabled`), threading alone is NOT sufficient** — the
  gate opens its own transaction first. Use the `…WithDb` variant. This applies to 6 of the
  14 callees and is exactly the mistake `6b56c00b` made and `afe275c9` corrected.
- **Serves:** G-06 · fault `R81_F34`
- **Test:** `surface=API`, the shape proven in
  `erp-goods-receipt-nested-transaction.test.ts`. **Falsifiability:** revert one gate and
  assert the verbatim nesting error plus the stranded row.
- **Note:** `pms-budget-service.ts:88` nests **once per time entry** — the worst pool
  amplifier in the inventory.

### C-05 — Prevent the cross-tenant cache leak structurally
- **File:** `projexa/src/lib/veridian-client.ts:842-846` and `fetchWithTimeout`
- **Change:** assert `fetchWithTimeout` never receives a cache mode other than `no-store`.
- **Serves:** G-05 · fault `R81_F28`
- **Test:** `surface=API`. Assert the guarantee in code.
  **Falsifiability:** pass `next: { revalidate }` and assert the test fails.
- **Note:** Next's fetch caches on URL + method + body, **not headers**; tenancy rides
  solely on a per-org Bearer token and paths are identical across orgs. The only thing
  holding this shut is a convention repeated at four call sites.

### C-06 — Implement password reset
- **File:** absent from **both** repos. `ct/src/app/forgot-password/page.tsx` is a 17-line
  redirect to `/login`; `resetPasswordForEmail` returns zero hits in either repo.
- **Serves:** G-08 · fault `R81_F06`
- **Test:** `surface=BROWSER`. Request a reset, follow the link, sign in with the new
  credential. **Falsifiability:** break the token check and assert sign-in fails.
- **Note:** worst for a sole owner, who cannot be helped by any other member.

---

## GROUP B — CORRECTNESS AND COVERAGE

### C-07 — Route live connector reads through the scope gate
- **File:** `ct/src/lib/services/connector-data-service.ts:117,:211` (they call
  `executeAction` directly, bypassing `executeGatedConnectorAction`)
- **Change:** route both through the gate; add a per-user consent record — no
  `consent_`/`granted_scopes`/`scope_grant` column exists anywhere today.
- **Serves:** G-11 · fault `R81_F23`
- **Test:** `surface=API`. Assert a delete-capable scope is refused on the live path.
  **Falsifiability:** bypass the gate and assert the refusal disappears.
- **Note:** latent only because `COMPOSIO_API_KEY` is unprovisioned. The gate's passing
  tests currently read as proof it is enforced. It is not.

### C-08 — Fix the single-purchase-order read
- **File:** `ct/src/app/api/v1/projexa/procurement/purchase-orders/[id]/route.ts` →
  `erp-buying-service.ts getPurchaseOrder`
- **Change:** find why `ctx.orgId` resolves differently here than for the list route.
- **Serves:** G-14 · fault `R81_F27`
- **Test:** `surface=API`. Assert every id the list returns is openable individually.
  **Falsifiability:** it is currently failing; assert the 404 before the fix.
- **Note:** this blocks *verification*, so a broken instrument reads as a broken product.

### C-09 — Provision the four missing roles and sweep
- **File:** the seeded E2E org; `projexa/src/lib/authz/roles.ts`
- **Change:** create `admin`, `pm`, `site_engineer`, `client_viewer` accounts.
- **Serves:** G-09 · fault `R81_F12`
- **Test:** `surface=BROWSER`, `--workers=1`. Sweep the main screens under each role.
  **Falsifiability:** an empty screen for a role that should see data is a defect.
- **Note:** `R43_MGR_01` was found only because someone tested a second role.

### C-10 — Fix the `/api/me` null race
- **File:** the `/api/me` handler; ~14 pages doing a bare fetch on mount
- **Change:** fix the server-side race; apply `fetchMeWithSessionRetry` meanwhile.
- **Serves:** G-16 · fault `R81_F30`
- **Test:** `surface=BROWSER`. Assert entitlement state renders correctly under a raced load.
  **Falsifiability:** stub a null response and assert the page does not silently hide modules.

### C-11 — Enforce pill dispatchability by assertion
- **File:** `projexa/src/components/veri-chat/veri-chat-context.tsx:126-143`
- **Change:** assert every rendered pill is dispatchable, instead of relying on
  `SHOW_UNDISPATCHABLE_MODULE_CHAINS = false`.
- **Serves:** G-15 · R-81 · fault `R81_F32`
- **Test:** `surface=BROWSER`. Assert zero disabled pills **and** that no rendered pill
  dead-ends. **Falsifiability:** flip the flag and assert the test fails.

### C-12 — Close the two guard-fused nesting sites
- **File:** `fm-asset-dedup-service.ts:70`, `fm-register-digitization-service.ts:126`
- **Serves:** G-06 · fault `R81_F36`
- **Test:** as C-04. **Falsifiability:** as C-04.
- **Note:** dormant only because one has no route yet (planned work) and the other has no
  callers while its live twin nests identically. Fix before the fuse is lit, not after.

---

## GROUP C — QUALITY AND MEASUREMENT

### C-13 — Make login-to-dashboard meet 400 ms
- **File:** `projexa` `/api/shell` (1,738 ms), `/api/work-progress` (1,094 ms),
  `/api/tasks` (596 ms), `/api/scope` (542 ms)
- **Serves:** G-10 · fault `R81_F16`
- **Test:** `surface=BROWSER`, warm, in-page timing. Assert a bound.
- **Note:** do **not** implement `R75_PART5_DASHBOARD_PERF_WORK_ORDER.md` as written — it
  targets `getOrgDashboard`, which is **not on this route** (it serves `/dashboard/overview`
  and an AI tool). Measured warm median 3,716–3,907 ms, TTFB only 207 ms.

### C-14 — Rotate the two live credentials *(OWNER)*
- **Where:** the committed E2E password (`e2e/users.ts:19`,
  `scripts/measure-perf.mjs:23`) and the demo admin credential found in a recovered Drive
  document. Values deliberately not reproduced anywhere.
- **Serves:** faults `R81_F04`, `R-A1`, `R-A2`
- **Note:** `RAJAT_USER_ID` points at the same demo identity, so rotating it also changes
  the value the AI guard depends on. Sequence with C-01.

### C-15 — Give the 37 proofless `img_spec` rows a proof, or mark them unmeasurable
- **File:** `platform.img_spec`
- **Serves:** G-12 · fault `R81_F18`
- **Note:** those 37 sit at `result_bool = false`, which is a **default, not a finding**.
  `IMG-016` was stored `true` while its own proof returned `0`. Always report **two
  figures**: N of M executed proofs true, **and** K of 74 never measured.

### C-16 — Bind the memory guards to every role
- **File:** `compliance.memory_records` / `memory_versions` / `memory_sources`,
  `graph_node`, `graph_edge`
- **Change:** extend the guards beyond `app_runtime`; add an UPDATE guard to `graph_edge`;
  rewrite `IMG-036` to test the right trigger event.
- **Serves:** G-13 · fault `R81_F20`
- **Test:** `surface=API`, inside a transaction that **ROLLS BACK**. Requires a verified
  backup first.
- **Note:** `memory_versions` **is** the audit trail, and `service_role`/`postgres` bypass
  every guard today.

---

## WHAT IS DELIBERATELY NOT HERE

- **R-C16's split** — four claims, three options, already filed and awaiting the owner. Not
  decided here (`XG-15`: changing what a requirement means is not ours).
- **The nesting guard's production behaviour** — it warns instead of throwing. Flipping it
  would turn today's silent splits into live 500s on money paths. Owner decision.
- **RULES.txt** — most of its 90 FALSE rows are obsolete, not gaps; 33 depend on a server
  the owner deliberately deleted. Rewriting it unilaterally is prohibited.
