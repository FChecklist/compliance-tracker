# Existing Module/Engine/Wiring/UTM Infrastructure — Collated & Spot-Verified Reference (2026-08-02)

**Purpose:** answer "does existing wiring already cover this?" for anyone working any item on
master directive `UMR-20260802-034545-3388`'s priority list (+ amendment `UMR-20260802-034651-6b2c`,
no-false-completion), BEFORE building anything new — this directly serves that directive's own
zero-duplication requirement (see `prompt.txt` line 3-6).

Produced by the parallel collation task `task-20260802-040131-parallel-job--collate-existing-module-en`
(Chat ID 2082026-02), run alongside the master directive and the separate traceability job
`task-20260802-035159-parallel-job--cross-reference-every-rele` (UMR-20260802-035156-85d2) without
blocking either. **Scope split, so the two don't compete:** that job cross-references
UMR/task/PR/CI *identifiers* back to the master directive (its own
`ai-os/MASTER_INITIATIVE_CROSS_REFERENCE_2026-08-02.md`, not yet committed as of this writing —
read directly from its workspace to confirm no overlap). This file instead collates and verifies
the pre-existing **module/engine/wiring infrastructure itself** — what's built and how the system
already knows it's wired. No code/logic was touched to produce this — collation and verification only.

**Discipline applied throughout (per this job's own CRITICAL CAVEAT):** this session's own
Kernel/TWO_ENGINE Phase 3 investigation tonight already found one wiring_registry relationship
claim — a Policy Engine "shared-citation bridge" — did NOT hold up against real source. So every
claim below that this document relies on for a real decision was spot-checked against current
source, not copied wholesale. Where a claim is unverified below, it is labeled unverified, not
implicitly trusted.

---

## 1. What already exists (the real mechanisms, one paragraph each)

### 1.1 `MASTER_INDEX.yaml` — the browsable entrypoint
- **Live path:** `/opt/veridian/ai-os/MASTER_INDEX.yaml` (canonical; a repo copy exists at
  `ai-os/MASTER_INDEX.yaml` inside compliance-tracker, kept in sync per its own `sync_mechanism`).
- **104 `registries:` entries** as of its last regen (`built_ts: 2026-07-30T03:57:58Z`,
  `regenerate_master_index.py`) — confirmed by direct count (`awk` over the `registries:` block),
  not read from the file's own prose. **This corrects this task's own SPEC premise**, which
  described it as "the central 31-registry entrypoint" — see §4 (Known-bad/stale claims) below.
- The file's own `search_layers_relationship` block (added 2026-07-30, lines 46-87) already
  documents — correctly, spot-checked below — that it is **one of 4 complementary layers**, not
  the only mechanism:
  1. **`MASTER_INDEX.yaml`** — hand-maintained, browsable, human-citation narrative/scope per
     registry.
  2. **`knowledge_engine`** table — the searchable, machine-authoritative drift-detection layer
     (`superboss-register.py query-knowledge <term>`).
  3. **`wiring_registry`** table — the code-level entity-relationship graph, "what calls /
     is-called-by what."
  4. **`system_index`** table — the fast existence-check/dedup gate
     (`superboss-register.py check-duplicate` / `search`) — **this is the check-before-build gate**
     the file's own top-level `protocol` field instructs every reader to use before writing any
     new script/table/register. This is the most directly relevant single command for this job's
     own goal (avoid duplicating priority-list work).

### 1.2 `superboss-register.sqlite` — the live database backing all 4 layers
- **Real path is `/opt/veridian/ai-os/memory/superboss-register.sqlite`** (227MB, last written
  2026-08-02T04:10Z) — **not** `/opt/veridian/ai-os/superboss-register.sqlite` (top-level, 0 bytes)
  or `superboss_register.sqlite3` (also 0 bytes), both of which are stale/empty decoys left from
  an earlier "empty-stub" state (see the `.empty-stub-superseded-2026-07-29` sibling file). The
  real `DB_PATH` is hardcoded in `scripts/superboss-register.py` line 63 via
  `os.environ.get("SUPERBOSS_REGISTER_DB", "/opt/veridian/ai-os/memory/superboss-register.sqlite")`
  — confirmed by reading the script, not assumed from a file that happened to have the expected
  name. **Anyone querying the wrong top-level path gets zero rows and a false "nothing here"
  read** — worth calling out explicitly since it's an easy mistake.
- Live row counts, queried directly (2026-08-02, this session):

  | Table | Rows | Purpose |
  |---|---|---|
  | `wiring_registry` | 7,918 | code-entity relationship graph |
  | `knowledge_engine` | 364 | artifact drift-detection registry |
  | `system_index` | 135 | existence-check/dedup index |
  | `capability_registry` | 11 | VERIDIAN capability lookup |
  | `umr_tasks` | (not counted this pass — traceability job's own scope) | |

  These are all **higher** than `MASTER_INDEX.yaml`'s last-recorded `source_registry_counts`
  snapshot (wiring_registry 7791, knowledge_engine 350, system_index 114) — expected drift since
  the system keeps running; not a discrepancy, just a reminder that `MASTER_INDEX.yaml`'s embedded
  counts are point-in-time, not live.

### 1.3 `wiring_registry` table — the entity-relationship graph
- Schema (verified via `sqlite_master`): `entity_id, entity_type CHECK(...), source_system
  CHECK('server'|'vercel'|'supabase'|'github'), path, relationships (JSON), last_verified_ts,
  verification_status CHECK('VERIFIED_MATCH'|'HASH_DRIFTED'|'PATH_MISSING'|'UNVERIFIED'),
  source_ref, metadata_json, content_hash`.
- `entity_type` breakdown (7,918 rows): `function` 5,027 · `file` 1,964 · `supabase_table` 444 ·
  `ai_role` 195 · `dispatch_event` 171 · `script` 40 · `engine` 20 · `cron_job` 17 ·
  `governance_doc` 10 · `gateway` 10 · `github_repo` 7 · `route` 6 · `browser_component` 4 ·
  `vercel_project` 3.
- `verification_status` breakdown: `VERIFIED_MATCH` 7,893 (99.7%) · `PATH_MISSING` 17 ·
  `HASH_DRIFTED` 5 · `UNVERIFIED` 3.
- **Critical caveat, confirmed by this session's own re-check (see §3):** `VERIFIED_MATCH` means
  the row's `path`/`content_hash` matches a real file on disk **at the time of last verification**
  — it does **not** mean the `relationships[]` JSON's own claims about *what that file is wired to*
  are accurate. That distinction is exactly where the Policy Engine false claim (below) lived: the
  file existed and hashed correctly, but the specific relationship asserted about it was fabricated
  or stale. **Treat `VERIFIED_MATCH` as "the artifact is real," not "every claim about the artifact
  is real."**
- The 20 `entity_type='engine'` rows map 1:1 to the VERIDIAN 20-Engine architecture (Intent,
  Context, CapabilityRegistry, Planning, **Policy** [engine-05], Rule, Decision, Workflow,
  Automation, Integration, Document, Notification, Data, **Metadata** [engine-14, believed —
  not independently confirmed this pass], Knowledge, Learning, UIComposition, Analytics, Audit,
  Observability) per `ai-os/20_ENGINES_10_GATEWAYS_PHASE_PLAN_2026-07-24.yaml`. **This is the
  namespace master directive priority #2's "Policy Engine / Metadata Engine bridge" (Kernel /
  TWO_ENGINE_TASK Phase 3) refers to** — confirmed distinct from the *separate* VCEL
  deterministic-computation engine registry (`ai-os/engines/ENGINES.yaml`, 247 engines / 41
  implemented, `registries.engine_registry`), which is a different namespace with the same word
  "engine." Do not conflate the two when scoping Kernel Phase 3 work.
- Already-documented, mechanically-confirmed real gap directly relevant to Kernel work
  (`registries.wiring_engine`'s own text, at the 2026-07-25 snapshot): of 19 `hops_through`
  relationships derived from the 5 populated routes in `ROUTE_REGISTRY_SCHEMA`, **zero** target a
  `gateway` entity — a measured confirmation of "no real end-to-end gateway flow proven yet," not
  just an impression. Worth re-running before Kernel Phase 3 starts, since the underlying data has
  grown (5 routes -> 6 now per the live `entity_type` breakdown above).

### 1.4 `knowledge_engine` table — artifact registry + UTM tagging
- Schema includes `utm_source, utm_medium, utm_campaign, utm_content, utm_term` columns —
  confirmed directly (`sqlite_master`). Same 5 UTM columns also exist on `capability_registry`.
- 364 rows, `verification_status`: `VERIFIED_MATCH` 345 · `PATH_MISSING` 13 · `HASH_DRIFTED` 6.
- Query: `python3 scripts/superboss-register.py query-knowledge "<term>" [--tag domain:<x>|
  source:SERVER|VERCEL|SUPABASE|GITHUB|LOCAL]`.

### 1.5 UTM tagging convention — confirmed real, but narrower than "SQLite + Postgres" implies
- `MASTER_INDEX.yaml`'s own `registries.utm_traceability_convention` entry (added 2026-07-30, its
  own text: "never had its own single entry... until this pass") describes this accurately: it is
  **not a single script or table** but a standing tagging convention across
  `instructions` / `work_items` / `actions` (all in `superboss-register.sqlite`), letting queries
  filter by `utm_campaign` the way a marketing UTM tag filters ad traffic. Confirmed live: the
  `utm_source/medium/campaign/content/term` columns exist on `knowledge_engine` and
  `capability_registry` too (§1.4).
- **Correction to this job's own SPEC premise:** grepping the compliance-tracker repo (app code,
  `src/`, `drizzle/`) for `utm` found **zero hits**. The UTM convention is a **host-level
  `superboss-register.sqlite` / dispatch-tooling convention only** — it does not exist as a
  Postgres/Supabase-side convention in the deployed product's own schema. "Both the SQLite and
  Postgres sides" in the task SPEC is not accurate as stated; there is no Postgres-side UTM
  tagging in the compliance-tracker app schema today. Flagged in §4.

### 1.6 `system_index` table — the existence-check / dedup gate
- 135 rows: `documentation` 84 · `python` 26 · `shell` 10 · `typescript` 8 · `database` 5 ·
  `ops` 1 · `server` 1.
- This is the layer to query **before** anyone on the master directive's priority list starts
  building anything new: `python3 scripts/superboss-register.py check-duplicate` /
  `search "<term>"`.

### 1.7 `ai-os/system-tree/` (compliance-tracker repo) — the audited live-codebase tree
- Not literally "tree1-4 under `ai-os/system-tree/`" as this job's own SPEC premise phrased it —
  the three trees are **three separate top-level directories**, cross-referenced by
  `MASTER_INDEX.yaml`'s `tree_lineage` block:
  - `ai-os/audit-tree/` = **tree1**, requirement-doc interpretation (9 source docs -> 28 domains).
    Status: `HISTORICAL_INPUT`.
  - `ai-os/system-tree/` = **tree3**, the audited live-codebase tree — 7 files
    (`10`-`40`-prefixed YAMLs + `50-merged-tree.yaml` + 2 audit-round `.md` files), covering all
    94 domains across compliance-tracker/projexa/veda-advisors/veridian-brain. Its own header
    (§1, confirmed by direct read) states its 377-table/106-enum counts are **known stale** —
    `MASTER_INDEX.yaml`'s `registries.database_catalog` (444 tables/124 enums, generated
    2026-07-20) is the current, mechanically-generated ground truth, itself now slightly stale
    too — see §3 spot-check.
  - `ai-os/tree4-unified/` = **tree4**, the canonical current merge of tree1+tree3 (149
    sub-branches), entrypoint `tree4-unified/00-INDEX.md`. **Read order for a new session:**
    tree4 first; tree1/tree3 only if tree4 cites them for detail — this read order is
    `MASTER_INDEX.yaml`'s own stated protocol, not this document's invention.
  - There is no separately-numbered "tree2" — the numbering (1/3/4) is as named in the source
    files themselves; not a gap in this collation.
- Directly useful, already-documented real gaps carried in `system-tree/00-INDEX.md`'s own
  "Honesty notes" (§ Structure, read directly this pass): only 11 explicit `.references()` FK
  constraints across all tables (everything else is naming-convention + service-layer discipline,
  a structural fact relevant to any ERP-priority work); PROJEXA's sidebar links to 7+ modules with
  no page yet (BOQ, Work Progress, Site Diary, Documents, Manpower, Materials, Vendors, Budgets,
  Expenses, KPIs, Reports, AI Copilot); `fm_*` (Facilities Management) tables exist with no API
  routes.

### 1.8 `module_gap_audit_lib.py` — the real module-boundary resolver
- `ai-os/scripts/module_gap_audit_lib.py` (compliance-tracker repo). Confirmed by direct read: for
  compliance-tracker, module boundaries come from the product's **own** `compliance.module_registry`
  Postgres table (seeded via `drizzle/0017_wave20_module_registry_and_product_branches.sql` onward,
  11 `INSERT` statements confirmed in that migration file directly), used at runtime by
  `src/lib/services/module-registry-service.ts` (confirmed present, 1,998 bytes) to gate which
  modules a product branch has enabled. For projexa (no `module_registry` table exists there,
  confirmed by the library's own header), it falls back to one-module-per-`src/app/api/<x>/`
  directory. File discovery is mechanical (`git ls-files` substring + `git grep -lI` content
  match), never hand-typed. **This is the real, authoritative module taxonomy** for
  compliance-tracker — anyone scoping ERP-priority (#3) work should query
  `compliance.module_registry` directly rather than inventing a module list.

### 1.9 `DATABASE_CATALOG.json` / `FUNCTION_CATALOG.json` — mechanically generated code catalogs
- `/opt/veridian/ai-os/DATABASE_CATALOG.json` — every table/column (name/type/nullability/
  default/PK/unique), generated 2026-07-20, claimed 444 tables.
- `/opt/veridian/ai-os/FUNCTION_CATALOG.json` — every named function in compliance-tracker's
  `src/`, generated 2026-07-20, claimed 5,019 functions.
- Parallel catalogs exist for projexa (11 tables/0 enums, 371 `src/` files), veda-advisors (62
  files/270 functions, no schema — Supabase client only), veridian-ui-kit (22 files/46 functions,
  no database).
- **Spot-checked against current live `schema.ts` this pass** — see §3. These are point-in-time
  snapshots (2026-07-20), not live-refreshed; expect small drift, verify counts before citing them
  as current in any priority-list report.

### 1.10 Server-wide search tooling — already exists, three real entrypoints
1. `python3 scripts/superboss-register.py query-knowledge "<term>" [--tag ...]` — machine-verified
   artifact search (§1.4).
2. `python3 scripts/superboss-register.py search "<term>"` / `check-duplicate` — fast
   existence-check across `system_index` (§1.6) — **this is the one to run before starting any
   new priority-list build**, per `MASTER_INDEX.yaml`'s own stated protocol.
3. FTS5 virtual tables exist for nearly every table in `superboss-register.sqlite`
   (`wiring_registry_fts`, `knowledge_engine_fts`, `instructions_fts`, `work_items_fts`,
   `system_index_fts`, `capability_registry_fts`, `umr_tasks_fts`, `actions_fts`, `log_index_fts`,
   `route_replay_fts` — confirmed via `sqlite_master`), i.e. full-text search is wired at the
   schema level across the whole registry, not just exact-match lookups.

---

## 2. Cross-reference against the master directive's priority list

Master directive priorities #2-#8 (this job's stated scope — #1, #9, #10 are the other sessions'
gates/milestones, not module-wiring questions):

| # | Priority | What the existing map already claims/shows | Confidence |
|---|---|---|---|
| 2 | Kernel consolidation (TWO_ENGINE_TASK Phase 3: Policy Engine, Metadata Engine bridge, AI Orchestrator<->Owner-ops) | `wiring_registry` has real `engine-05` (Policy) and (believed) `engine-14` (Metadata) rows; the Policy Engine's specific "shares_implementation_with" claim toward `gateway-G01` is **confirmed false** (§3) — do not trust that specific edge. The broader "zero routes hop through a gateway entity" finding (§1.3) is a real, still-relevant structural gap for this priority. | Mixed — one confirmed-bad edge, one confirmed-real structural gap |
| 3 | ERP module completion (CRM #46, PM #47, procurement, SAP reports #17) | `compliance.module_registry` (§1.8) is the real, authoritative module list — query it directly rather than re-deriving. `module_gap_audit_lib.py` already has the mechanical file-discovery machinery for any module-scoped gap audit. | High — real, live DB table and working library, spot-checked |
| 4 | Reports completion (Task #17, SAP-equivalent) | `ai-os/memory/sap_mapping.sqlite` (`sap_modules`/`sap_reports`/`ingest_log`) + 5 real task dirs, per `registries.sap_reports_projexa_completion_effort` — confirmed to exist on disk 2026-07-30 by that entry's own text. Per-report phase/completion status is explicitly **not** re-verified by that registry entry (existence-cataloguing only) — do not treat "exists" as "complete." | Medium — existence confirmed, completion status not |
| 5 | Prompt library completion | Registry entry `chatgpt_prompt_library` exists in `MASTER_INDEX.yaml`; the master directive's own prompt.txt explicitly says the "~70% built" figure needs re-verification, not trusting — this collation did not re-verify that figure (out of this pass's spot-check budget; flagged as open for whoever picks up priority #5). | Not verified this pass |
| 6 | UI/UX completion (incl. live browser click-through) | `system-tree` (§1.7) documents ~130 pages/~65 components as of its build, plus the real, already-known projexa sidebar-links-with-no-page gap. No live-browser click-through evidence exists in any registry — by the master directive's own text (priority #6), that verification is explicitly out of scope for a code/registry read and belongs to the already-dispatched UMR-20260802-030121-ae66 audit. | Structural map only — live-browser verification is a different job's scope |
| 7 | VERI Chat + VERI assistant completion | `registries.veri_chat` entry: real files confirmed to exist (`src/app/api/veri-chat`, `src/components/veri-chat/`, `veri-chat-service.ts`, `veri-chat-v2-enablement-service.ts`) — **and its own text already honestly states** "feature behavior/wiring to the Mother Router / AI roster not independently re-verified this pass." Spot-checked this pass (§3): no `mother-router`/`MotherRouter` reference found in `veri-chat-service.ts` — consistent with the registry's own hedge, not a contradiction of it. | Confirmed: files real; Mother Router wiring genuinely unverified (registry is honest about this, not overclaiming) |
| 8 | Multi-tenant / multi-brand (VAIOS Layer 1-4) | Not deep-dived this pass (budget prioritized Kernel/VERI-Chat/ERP as higher-stakes per this task's own instruction to prioritize load-bearing claims). Existing project memory (`country-config-architecture-state`, this session's own persistent memory, not re-verified here) notes the multi-country compliance-engine abstraction is wired for IN+AE but the registry has zero production callers as of 2026-07-20 — worth re-checking, not re-derived in this pass. | Not verified this pass — flagged for whoever picks up #8 |

---

## 3. Spot-verification results

7 claims spot-checked against real current source (prioritized: highest-stakes for Kernel/ERP/
VERI-Chat, per this task's own instruction not to exhaustively check a large map).

| # | Claim | Source | Result |
|---|---|---|---|
| 1 | This task's own SPEC premise: MASTER_INDEX.yaml is "the central **31**-registry entrypoint" | Task SPEC (not the registry itself) | **INACCURATE.** Direct count of `registries:` block = **104** entries as of `built_ts: 2026-07-30`. Flagged in §4. |
| 2 | `wiring_registry` entity-05 (Policy Engine) `shares_implementation_with` `gateway-G01`, evidence "both cite `/opt/veridian/ai-os/OWNER_DECISIONS_NEEDED_2026-07-23.yaml`" | `wiring_registry` row `engine-05` | **INACCURATE — re-confirmed this pass.** `grep -n "OWNER_DECISIONS_NEEDED" src/lib/policy-enforcement-engine.ts` = zero hits. The file does not cite what the registry claims it cites. Matches this session's earlier, independent Kernel/TWO_ENGINE finding — now double-confirmed. |
| 3 | `veri_chat` registry entry paths exist on disk | `src/app/api/veri-chat`, `src/components/veri-chat/`, both service files | **CONFIRMED.** All paths real, files present with real byte sizes. |
| 4 | `veri_chat` registry entry's own hedge — "wiring to Mother Router not independently re-verified" | `veri-chat-service.ts` | **CONFIRMED accurate hedge** — no `mother-router`/`MotherRouter` reference found in the file; the registry correctly represents its own uncertainty rather than overclaiming. |
| 5 | `module_gap_audit_lib.py`'s claim that `compliance.module_registry` is seeded via real migrations, not invented | `drizzle/0017_wave20_module_registry_and_product_branches.sql` | **CONFIRMED.** 11 real `INSERT`-pattern matches in that migration file. |
| 6 | `DATABASE_CATALOG.json` — 444 tables / 124 enums (generated 2026-07-20) | Live `src/lib/db/schema.ts` (11,412 lines, current HEAD) | **MOSTLY CURRENT, small drift.** Live count: **442** `complianceSchemaDB.table(` matches, **129** enum matches (regex-based, may include some non-table-defining matches — order-of-magnitude confirmation, not a byte-exact recount). Table count is 2 lower (plausibly consolidations since 07-20), enum count is 5 higher (plausibly new enums added). Not a red flag — expected drift for a 2-week-old snapshot on an actively-changing schema — but **do not cite 444/124 as "current" without re-running the catalog generator first.** |
| 7 | UTM tagging convention exists on "both the SQLite and Postgres sides" (this job's own SPEC premise) | `grep -r utm` across compliance-tracker `src/`/`drizzle/`; `sqlite_master` on `superboss-register.sqlite` | **PARTIALLY INACCURATE.** Confirmed real on the SQLite/host-level side (`utm_source/medium/campaign/content/term` columns on `knowledge_engine`, `capability_registry`, plus `instructions`/`work_items`/`actions` per `MASTER_INDEX.yaml`'s own text). **Zero hits** for `utm` anywhere in the compliance-tracker app repo (Postgres/Supabase side) — no UTM convention exists there today. Flagged in §4. |

**Score: 5 of 7 spot-checked claims held up fully; 2 did not (1 registry-data claim confirmed false,
1 task-SPEC-level premise about registry scale, 1 task-SPEC-level premise about UTM scope — see §4
for the full known-bad list, including the two that were already flagged by this session before
this pass started).**

---

## 4. Known-bad / stale claims (do not trust without re-verifying)

1. **`wiring_registry` row `engine-05` (Policy Engine), the `shares_implementation_with
   gateway-G01` relationship, evidence "both cite `OWNER_DECISIONS_NEEDED_2026-07-23.yaml`".**
   Confirmed false — `policy-enforcement-engine.ts` does not reference that file. Found originally
   by this session's Kernel/TWO_ENGINE Phase 3 investigation tonight; independently re-confirmed
   by this collation pass. **Do not use this edge to justify any Kernel Phase 3 "already bridged"
   claim.**
2. **This task's own SPEC premise, "MASTER_INDEX.yaml is the central 31-registry entrypoint,"
   is stale/inaccurate.** Real current count is 104 registries (as of the file's 2026-07-30
   build; live underlying tables have grown further since). If "31" was accurate at some earlier
   point in this initiative's history, it has since grown more than 3x — cite the live count, not
   31, in any future document.
3. **This task's own SPEC premise, "UTM tagging convention applied across both the SQLite and
   Postgres sides," overstates real coverage.** Confirmed real only on the host-level SQLite side
   (`superboss-register.sqlite`). Zero UTM columns/references exist in the compliance-tracker
   Postgres app schema. Do not assume a Postgres-side UTM query surface exists for
   priority-list work without building it first.
4. **`DATABASE_CATALOG.json` / `FUNCTION_CATALOG.json` (444 tables/124 enums, 5,019 functions)
   are a 2026-07-20 snapshot, not live.** Small confirmed drift as of this pass (§3, item 6) —
   re-run `generate_database_catalog`/`generate_function_catalog` equivalents before citing exact
   counts in any priority-list decision that depends on precision.
5. **`system-tree`'s own 377-table/106-enum figures (tree3) are self-documented as stale** by
   `MASTER_INDEX.yaml`'s `tree_lineage` block itself — not a new finding by this pass, just
   carried forward accurately: use `registries.database_catalog` instead, with the caveat in
   item 4 above.

---

## 5. Location & linkage

- **This file:** `ai-os/EXISTING_MODULE_ENGINE_WIRING_MAP_2026-08-02.md` (compliance-tracker repo,
  branch `worker/task-20260802-040131-parallel-job--collate-existing-module-en`).
- **Linked to master directive** `UMR-20260802-034545-3388` (+ amendment
  `UMR-20260802-034651-6b2c`) by direct reference in this file's own header, the same convention
  the traceability job (`UMR-20260802-035156-85d2`) uses for its own index — anyone reading either
  file can follow the reference to the other. This file is the module/engine/wiring answer; that
  file is the UMR/task/PR/CI traceability answer. Both are needed, neither duplicates the other.
- **Registered in `ai-os/boss/ACTIVE-CLAIMS.yaml`** under this session's own entry before this
  file was written (commit `bde27e44`).
- **Recommended read order for anyone picking up a priority-list item (#2-#8):** this file's §2
  (what the map already claims for your specific priority) -> §3/§4 (has this specific claim been
  verified, or is it known-bad) -> `system_index` `check-duplicate`/`search` (§1.6, live, for
  anything not already covered here) -> only then start building.

---

## 6. What this pass did NOT do (explicit, not silent)

- Did not spot-verify priority #5 (prompt library "~70% built") or priority #8 (multi-tenant/brand
  VAIOS Layer 1-4 coverage) — flagged in §2 as open for whoever picks up those items, not silently
  assumed accurate.
- Did not re-run `generate_database_catalog`/`generate_function_catalog`/
  `generate_wiring_registry.py` to refresh the underlying snapshots — this was a collation +
  spot-check pass per the task's own "do not touch code/logic" instruction, not a registry
  regeneration.
- Did not exhaustively spot-check all 7,918 `wiring_registry` rows or all 104 `MASTER_INDEX.yaml`
  registries — checked 7 claims prioritized by stakes to the master directive's priority list, per
  this task's own instruction ("not every single one exhaustively if the map is large").
