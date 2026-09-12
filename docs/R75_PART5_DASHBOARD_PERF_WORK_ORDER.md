# Work Order: `getOrgDashboard` query consolidation (dashboard performance)

**Filed:** 2026-09-06, R75 Part 5, for a fresh session with real RAM headroom.
**Do not attempt blind.** This is deliberately NOT started in this session —
see "Why this is its own work order" below.

## The measurement (real, not estimated)

- Full login-to-loaded-dashboard flow, measured via the Navigation Timing
  API in a real browser against the real local stack: **6.7s**, against a
  400ms target (~15-17x over).
- `/api/shell` (PROJEXA) fans out to 8 lookups via `Promise.allSettled` —
  correctly concurrent at the JS level — but its slowest member,
  `/api/v1/projexa/dashboard` (compliance-tracker), dominates: measured via
  direct `curl` in ISOLATION (no concurrent load, no browser) at **1.46s –
  3.3s per request**, repeatably.
- `server-timing: app;dur=<ms>` on that same route confirmed this is real
  APPLICATION time, not network/connection overhead: one sample read
  `app;dur=2912`.
- A raw network-RTT probe (plain `postgres` client, `SELECT 1`, same
  connection-string/pooler config as production code) against the SAME
  Supabase project measured the real per-statement round-trip floor at
  **~32ms**, both cold-adjacent and inside an explicit transaction (cold
  connect: 480ms once, amortized).
- A synthetic 8-concurrent-request test against the same route DID show
  real tail-latency growth (2.5s → 4.3s across the 6 non-rate-limited
  requests) and correctly triggered the demo API key's 30/min rate limiter
  (2 requests got a legitimate 429 — working as designed, not a bug). This
  confirms SOME concurrency-sensitivity exists, but it is not the dominant
  effect — see root cause below — and the concurrent-load numbers are
  further confounded by this session's own tight RAM at the time they were
  taken, so treat them as directional, not precise.

## Root cause: refined, not "pool contention" as originally hypothesized

The original ask was to "confirm the pool-contention hypothesis." The
literal hypothesis (requests queueing because the DB connection pool is
exhausted under concurrent load) is **not the primary driver**, and this
was verified rather than assumed:

- The relevant pool (`src/lib/db/tenant-scoped.ts`'s `withTenantContext`,
  `max: 5`) is not undersized for the concurrency this route actually sees
  in a single-user demo/test scenario — an ISOLATED, SEQUENTIAL single
  request already costs 1.5-3s with zero concurrent competition for a
  connection.
- The Supabase transaction-mode pooler's own network RTT floor (~32ms) is
  two orders of magnitude smaller than the observed per-request cost, so
  "N round trips add up over the network" cannot explain it on its own
  either.

**The real cause, read directly from the source**
(`src/lib/services/construction-dashboard-service.ts`,
`getOrgDashboardWithDb`, currently spanning roughly lines 986-1468): the
function makes **up to ~19 SEQUENTIALLY AWAITED database statements**
inside ONE already-open transaction, in this rough order:

1. `isConstructionEnabledForOrgWithDb`
2. (conditional) department → lead-user → project-id lookup (2 queries)
3. `projectRows` (the active-project id list everything below depends on)
4. `revenueByProject` (grouped sum)
5. `expensesByProject` (grouped sum)
6. `tasksByProject` (grouped count)
7. `budgetByProject` (grouped sum, joined)
8. `latestBoqPerProject` (raw `DISTINCT ON` SQL)
9. `valueByBoq` (grouped sum, depends on #8)
10. `poByProject` (grouped sum)
11. `activityRows`
12. (conditional) `latestRows` (raw `DISTINCT ON` SQL, depends on #11)
13. `permitsByProject` (grouped count)
14. `progressByProject` (raw aggregate SQL)
15-19. (conditional, earned-value block) `allLineItems`, then up to 4 more
    (`qtyRows`, `percentRows`, `evQtyRowsPrev`, `percentRowsPrev`), each
    gated on `itemIds.length > 0`

Each of these costs real Postgres execution time (not just the ~32ms RTT
floor) — most are `GROUP BY` aggregates or `DISTINCT ON` window-style
queries over tables that are not tiny in a real org
(`compliance.construction_work_progress_entries` in particular). At an
average of even ~100-150ms of real execution+RTT per statement, 15-19
sequential statements alone accounts for the bulk of the observed 1.5-3s —
consistent with what was actually measured.

**Why they are sequential, not parallel, today — this is load-bearing
context, not an oversight to casually "fix" by wrapping in `Promise.all`:**
every one of these statements shares the SAME open transaction/connection
(`db`, from the outer `withTenantContext`). A single Postgres connection
processes one statement at a time on the wire — firing these concurrently
via `Promise.all` on the SAME `db` handle would not achieve real
wall-clock parallelism (postgres.js would still serialize them over one
socket) and risks subtle behavior change if any two of them are not
actually independent (several already have real data dependencies: #9
depends on #8, #12 depends on #11, #15-19 depend on #14's `activeBoqIds`
by way of earlier steps). This is exactly the shape the file's own R43_MGR_01
history already fixed ONE degenerate case of (a **per-project fan-out**
that opened up to `2N` *separate* transactions/connections, which really
did exhaust the pool) — the current, already-fixed shape correctly avoids
that failure mode by staying on ONE connection, at the cost of paying every
statement's latency sequentially instead.

## Proposed approach (not started — for the next session to evaluate and own)

Reduce the STATEMENT COUNT, not the connection count, since connection
count is already right. Options, roughly in order of expected payoff vs.
risk, all preserving the single-transaction/single-connection shape:

1. **Consolidate the independent grouped aggregates (revenue, expenses,
   tasks, budget, PO, permits) into a small number of CTEs in ONE
   statement**, each still scoped by the same `ids` array, UNION'd or
   joined together and read back as one result set. These six are mutually
   independent (none depends on another's output) and only require
   `projectRows`'s `ids` first — a natural single consolidation target.
   Expected: ~6 round trips → 1.
2. The BOQ-dependent chain (`latestBoqPerProject` → `valueByBoq`) and the
   activity/progress chain (`activityRows` → `latestRows` /
   `progressByProject`) each have a REAL sequential dependency and are
   harder to merge into step 1's CTE without a more invasive rewrite (a
   single query with a lateral join per dependent step). Worth attempting
   as a SEPARATE, second pass once step 1 is shipped and proven safe — not
   bundled into the same PR.
3. The earned-value block (5-19) is the most complex (conditional, per-BOQ
   in-memory computation via `computeEarnedValue()`) and the highest-risk
   to touch — recommend leaving it sequential in a first pass and
   revisiting only if step 1+2 don't close enough of the gap.

## Files affected

- `src/lib/services/construction-dashboard-service.ts` (the function
  itself — `getOrgDashboardWithDb`, and its already-existing
  `getOrgDashboard` wrapper; also worth checking `getProjectDashboards`/
  `getProjectDashboardsWithDb` in the same file for the same pattern, not
  audited this pass).
- `src/lib/services/construction-dashboard-service.test.ts` — the existing
  ~99-plus test suite (per this session's own earlier work, including the
  R-50 and R75 Part 2/3 additions) is the regression net; every currently
  passing assertion must stay byte-for-byte identical after consolidation,
  since this function's output feeds real financial-redaction logic
  (`hasRole(ctx.dbUser, "manager")` gating in the route) — a correctness
  regression here is a real financial-data-exposure risk, not just a UI
  bug.
- `src/app/api/v1/projexa/dashboard/route.ts` — the caller; should need NO
  changes if the service function's return shape is preserved exactly.

## What could break

- **Silent financial-figure drift.** Several of the existing queries have
  subtle, deliberately-documented edge-case rules in comments (e.g., "null,
  not 0, when nothing matched", the exact BOQ tiebreaker `version DESC,
  created_at DESC`, the permit-expiry window being bounded at BOTH ends).
  A CTE consolidation that doesn't reproduce EVERY one of these edge rules
  exactly would produce a wrong number silently, not an error.
- **Test-suite false confidence.** The existing tests use a fake/mocked
  `db` harness (`fakeOrgDb`, per the R-50 test added this session) — a
  consolidated query changes the SHAPE of what `db.execute`/`db.select` is
  called with, and the fakes will need real updating, not just passing
  by accident. Falsifiability must be personally re-proven the same way
  this session has for every other change: break one specific piece of the
  new consolidated query on purpose, confirm the SPECIFIC expected test
  fails, restore, confirm green.
- **`db.execute(sql\`...\`)` raw-SQL portions** (the two `DISTINCT ON`
  queries and the progress aggregate) are harder to fold into a
  Drizzle-query-builder CTE cleanly — likely means the consolidated version
  is ALSO largely raw SQL, which is fine (precedent already exists in this
  same file) but needs the same `sql.join(ids.map(...), sql\`, \`)` pattern
  for safe parameterization the existing code already uses (not string
  interpolation).
- **Do not attempt to also parallelize via multiple connections** as an
  alternative to consolidation — that reopens the exact pool-exhaustion
  failure mode R43_MGR_01 already fixed once. If a future session is
  tempted by "just `Promise.all` with a couple of extra
  `withTenantContext` calls," re-read that fault's full history in
  `platform.r43_faults` first.

## Why this is its own work order, not attempted here

This is a real architectural change to a financially-redacted,
security-sensitive function with a documented history of two prior
incidents (the original `max:1` pool starvation, and R43_MGR_01's
per-project fan-out). It needs dedicated time for: writing the
consolidated query, updating the test fakes, re-proving every existing
edge-case assertion, and a live before/after timing comparison — not a
bolt-on inside a broader sweep, and not attempted under today's RAM
constraint where a live re-measurement wasn't even possible. Refusing to
fix it blind was the right call under R75 Part 4; this document is the
concrete next step, not a deferral into silence.
