# R-46 P9 seq32 — Reuse Store Real-State + This PR's Real Work (2026-08-25)

**Ref:** R-43 G.10-G.17 | **Queue row:** `platform.r43_queue` seq 32 (`depends_on: 31`)
**Verdict: PARTIAL.** The three tables now exist for real (this PR), the
`stored_functions` ban is confirmed upheld, but application wiring
(`src/lib/reuse/`) is not done — see "What this PR does and does not do."

## Real state found before this PR

Searched `platform`/`compliance` schemas for anything matching the reuse-
store shape. Found real, but scattered and differently-named, partial
overlaps — none matching the spec's exact 3-table shape:

- `platform.instruction_execution_cache` — closest existing analog to
  `reuse_cache` (`org_id, instruction_text, content_hash,
  resolved_capability_id, success_count, last_used_at`), but missing
  `scope`/`user_id`/`response` and using different column names. Left
  as-is by this PR (a separate concern, the Mother Router's own cache —
  not renamed/merged, since that would be an unrelated behavioural change
  to a live system outside this row's scope).
- `platform.ai_agent_memory` / `platform.mother_router_memory` — real
  tables, but they are execution/dispatch **logs** (`role_id, task_id,
  outcome, escalation_flag` / `dispatch_id, resolved_role, resolved_model,
  cost`), not a generic scope/key/value memory store. Not a match for
  `memory_store`.
- `compliance.incidents` (2 rows) — a **regulatory/compliance** incident
  tracker (`severity, classification, regulatory_notify_required,
  capa_owner_id`, etc.), a different domain from the spec's dev-error/fix
  reuse log. Not a match for `incident_log`.
- `compliance.report_definitions` (218 rows) — real, and correctly
  identified by the queue row's own `how` field as the right place for
  report/analysis reuse (not a parallel table). Had no `scope` column
  before this PR.

**Confirmed: no `stored_functions`-style table exists anywhere in either
schema** (`information_schema.tables` search for `%stored_function%`
returns zero rows, both before and after this PR). The one thing that
could have looked like a violation — `platform.code_facts` — was checked
directly: its rows (`fact_type: CONTRACT|BEHAVIOUR|TRAP`, `symbol`,
`fact`, `exact_text`, `line_ref`, `verified_ref`) store **citable facts
about code**, with an exact-text quote and a line reference as evidence,
not runnable code intended for execution or reuse. This is a
hallucination-grounding knowledge base, not code-as-data. **The G.10-17
ban is upheld — this is a real, checked finding, not an assumption.**

## What this PR does (real, applied, verified)

Applied migration `r43_reuse_store_seq32` directly to the live DB
(`pcrjmlpuqsbocqfwoxod`, `compliance` schema) via Supabase MCP
`apply_migration`, and added the matching Drizzle schema in
`src/lib/db/schema.ts`. The migration SQL is also committed at
`drizzle/0323_r43_reuse_store.sql` for the repo's own migration history.

**Exactly three new tables**, matching the spec:
1. `compliance.reuse_cache` — `org_id, user_id, scope, input_hash,
   function_id, params, response, reuse_count` + a
   `UNIQUE(org_id, user_id, scope, input_hash)` index.
2. `compliance.incident_log` — `org_id, user_id, error_type, message,
   file_path, context, solution, solved, solved_at`.
3. `compliance.memory_store` — `scope, org_id, user_id, key, value,
   interactions, last_used` + a `UNIQUE(scope, org_id, user_id, key)` index.

Plus one additive column: `compliance.report_definitions.scope`
(nullable) — **not** a fourth table.

### Verified, not assumed
- `report_definitions` row count is **218 before and 218 after** — the
  column addition did not touch existing data (checked via direct
  `count(*)` both times).
- Cross-org isolation is real, not aspirational: inserted the same
  `input_hash`/`user_id` under `org_a` and `org_b` — both succeeded as two
  distinct rows (the queue row's own test_oracle: "cross-org query
  returning zero rows" holds because they're different `org_id` values, not
  merged).
- The reuse-hit collision guard is real: a second insert with the
  identical `(org_id, user_id, scope, input_hash)` as an existing row was
  **rejected by Postgres** with `23505 duplicate key value violates unique
  constraint "reuse_cache_lookup_idx"` — proven by triggering it directly,
  not inferred from the DDL.
- All test/proof rows were deleted after verification — `reuse_cache` is
  empty (0 rows) as committed, no synthetic data left behind.

## What this PR does NOT do

- **No `src/lib/reuse/` application code.** The queue row's `where_to`
  names both a migration AND `src/lib/reuse/` — this PR is the migration
  half only. No route or service reads/writes these tables yet; they are
  real, live, empty tables waiting for a real caller.
- **Does not touch `platform.instruction_execution_cache`.** That is a
  live table already serving the Mother Router; merging or migrating it
  into `reuse_cache` is a real behavioural change to a running system and
  is out of scope for a schema-creation pass.
- **Does not re-run the L0+L1 hit-rate oracle** — that depends on seq31's
  corpus existing first (`depends_on: 31`, itself PENDING — see PR #1366).

## Scoped estimate for closing the remaining gap

- `src/lib/reuse/` service (lookup-or-insert against `reuse_cache`, the
  `ON CONFLICT` upsert path incrementing `reuse_count`, a
  `incident_log`/`memory_store` read/write layer): ~half a day, plus test
  coverage for the cross-org-miss / same-org-hit oracle this PR proved
  works at the DB layer.
- A real decision on `instruction_execution_cache` (migrate into
  `reuse_cache`, or leave as a distinct Mother-Router-specific cache) needs
  an explicit owner call — it is a live table, not something to fold in
  silently.
