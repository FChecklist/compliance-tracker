# Package lf-e5-overview (laptop app, repo projexa)

Branch `claude/lf-e5-overview` from `origin/feat/local-first-complete`. Read `ai-os/cloud-agents/lf-e-COMMON.md` (compliance-tracker clone, branch `origin/feat/lf-sync-backend`) right after the PREAMBLE: it holds the module-conversion rules.

## Cluster: overview
Cluster file `src/lib/local-first/shell/clusters/overview.ts`, nav orders 0 to 9 for the dashboard, 80 to 99 for the rest. Modules (visible ones in `src/lib/module-catalogue.ts`): **dashboard**, **reports**, **analysis**. These screens show NUMBERS the server computes (KPIs, budgets vs actuals, progress percentages, reports). The rules are stricter here: **money and approvals are never computed on the laptop**.

Design to implement (and describe in the report):
1. **Snapshot cache** (new file `src/lib/local-first/shell/snapshot-cache.ts` plus tests): a per-person IndexedDB store (use the person's `projexa-local:<userId>` database or the device-meta store, whichever the engine already uses for meta: read `local-db.ts`) that keeps the last server answer for a named read (key: route + project + query), with `fetchedAt`. While online the screen fetches the same endpoint the online page uses and refreshes the snapshot; offline (or server down) it shows the last snapshot labelled plainly "As of <date and time>, from this laptop" and never a computed substitute. A snapshot belongs to one person: another person on the same laptop never reads it; sign-out removes it (coordinate with `sign-out.ts` through the exported helper only: do not edit that file; export a `clearSnapshots(userId)` and say so in the report).
2. **Locally derived, non-money facts** the replica can answer exactly (counts of open tasks, RFIs by status, activities by state, items due this week) may be computed on the laptop for the dashboard; anything involving money, budgets, valuation, approvals or the critical path is a snapshot or "recalculated when online".
3. Dashboard first (nav order 0): it must open instantly offline with the person's projects, the sync state (use the existing connectivity/sync state hooks), pending edits waiting to be sent, and what needs the person (`OutboxAttention`).
4. Reports and analysis: each report/analysis screen uses the snapshot cache; an export is online-only unless the data is on the laptop (say so calmly).
