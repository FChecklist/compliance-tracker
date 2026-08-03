# VERIDIAN Global Knowledge Discovery and Reuse Runtime v1.0

**UMR:** parented to `UMR-20260803-041122-b22d`, citing `UMR-20260803-041047-03ee` (OCID-025),
`UMR-20260803-041000-70ae` (OCID-024), `UMR-20260803-040929-9713` (OCID-023),
`UMR-20260803-040844-4a33` (OCID-022), `UMR-20260802-173631-ca85` (ERP Functional Completeness Master
Program), `UMR-20260802-165606-4413` (OCID-020), `UMR-20260802-164659-9a31` (server artifact
traceability audit), `UMR-20260802-165034-5747` (the gatekeeper rule), `UMR-20260802-165434-cd91`
(the unified project memory model), `UMR-20260802-165541-c27d` (the recovery framework).

Real, Owner-directed, tier 1 directive. **Documentation only — no implementation, no code, no database
objects, tables, APIs, new modules, or new workflows were created by this document or its own
production.** Consistent with the real OCID-020 implementation lock (`SEC-07`,
`ai-os/CONSTITUTION.yaml`), which explicitly permits discovery and matrix-building work to continue
while implementation stays locked.

**Real numbering discrepancy, found here and resolved by a real PM decision:** this task's own
directory and branch were labeled `ocid-027`, and that label was correct all along. At the time this
document was originally drafted, `ai-os/VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md`'s status
table mislabeled this exact content ("VERIDIAN Global Knowledge Discovery and Reuse Runtime") as row
`OCID-20260803-026`. Real PM decision `UMR-20260803-052107-71fa` (citing `UMR-20260803-041211-b7b7`)
independently verified this document's real content is OCID-027, and the status snapshot's table has
been corrected accordingly. This is the same class of dispatch-labeling error already found and
corrected once in this exact chain (`OCID-036`/`OCID-037`, resolved under `UMR-20260803-045159-ec55`).
This document is titled and scoped to match its own real mission text (Global Knowledge Discovery and
Reuse Runtime); "VERIDIAN Unified Synchronization Runtime" is the real, separate OCID-028 (PR #774).

---

## 0. What this document is, and is not

This is a **discovery-and-reuse operating model**, not a new discovery mechanism. VERIDIAN AI OS
already has a real, working set of discovery infrastructure — a mechanically-generated database
catalog, a mechanically-generated function catalog, an engine registry, an AI role catalog, a
SQLite-backed existence-check layer, a call-graph layer, and a browsable narrative index — all built
and merged before this document existed (mostly 2026-07-20 through 2026-07-30). This document's job
is to state, in one place, **the order in which those real mechanisms are searched**, **what counts as
a valid match**, **when reuse/enhancement is mandatory vs. when a new artifact is actually allowed**,
and **how a verified improvement propagates to every VERIDIAN brand** — grounded in file paths that
exist on disk today, not in a new registry this document invents. Where a real gap exists (an
unpopulated registry, a hand-maintained catalog instead of a mechanical one), it is named as a gap,
not silently papered over.

---

## 1. Global discovery principles

1. **VERIDIAN is not a greenfield project.** The global function library, report surfaces, analysis
   engines, prompt registry, workflow engines, business-rule engines, UI, and UX named in this OCID's
   own mission statement are real and already exist in `compliance-tracker`, `projexa`,
   `veda-advisors`, and `veridian-ui-kit` — not aspirational. Discovery precedes creation, always.
2. **Search before build is not a suggestion; it is `MASTER_INDEX.yaml`'s own literal, load-bearing
   protocol field**, already live and already binding on every AI/software actor per that file's
   `audience: ai_and_software_only` declaration: *"Before any grep/find/read across this server...,
   before writing any new script/table/register, query this file for an existing match. If a match
   exists, use it or extend it — do not create a parallel mechanism."* This document adopts that
   protocol as-is for the specific artifact classes named in this OCID's mission (functions, reports,
   analysis, prompts, workflows, business rules, screens, modules, database objects, UI, UX) rather
   than writing a second, competing protocol.
3. **An existing component that can be enhanced is never replaced.** Every verified enhancement is
   applied *in place*, in the same file, under the same UMR chain — the `## Amendment (date): ...`
   pattern already used dozens of times in `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`,
   `ai-os/MASTER_INDEX.yaml`, and `ai-os/CONSTITUTION.yaml`'s own `amendment_log` is the real,
   pre-existing global-library update mechanism (§23), not a new one.
4. **No parallel implementation.** Where two real mechanisms already exist for the same purpose (e.g.
   `ai-os/boss/BOARD.yaml` vs. `ai-os/boss/COMPLETED.yaml`), the stale one is marked stale and the live
   one is cited going forward — not both maintained, not a third one built.
5. **Zero duplication is verified, not assumed.** "I checked and didn't find one" is not sufficient;
   the check itself must name which of the real discovery layers (§2) was queried and with what term.

---

## 2. Global search order

Four real, complementary layers already exist (`ai-os/MASTER_INDEX.yaml`,
`registries.search_layers_relationship`, added 2026-07-30). This document adopts them verbatim as the
global search order for every artifact class this OCID covers:

1. **`ai-os/MASTER_INDEX.yaml`** — the browsable, hand-maintained narrative index. Read first for
   "where is X" / "does a system for X already exist" in plain language, across all four core repos
   (`compliance-tracker`, `projexa`, `veda-advisors`, `veridian-ui-kit`).
2. **`system_index`** (`ai-os/memory/superboss-register.sqlite#system_index`) — the fast
   existence-check layer. Query: `python3 scripts/superboss-register.py check-duplicate "<query>"
   [--category <cat>]`. This is the literal check-before-build gate named in `MASTER_INDEX.yaml`'s own
   protocol field, and the same mechanism the credit-accountant gate already uses in production
   (confirmed live in this chain's own record: a rejected auto-fix retry was correctly matched against
   `quality-gate.sh` via this exact command).
3. **`knowledge_engine`** (`ai-os/memory/superboss-register.sqlite#knowledge_engine`) — the searchable,
   machine-authoritative layer for drift-detection. Query: `python3 scripts/superboss-register.py
   query-knowledge <term>`. Use this to check whether a specific artifact's documented facts are still
   fresh against current source, not just whether it exists.
4. **`wiring_registry`** (`ai-os/memory/superboss-register.sqlite#wiring_registry`) — the code-level
   entity-relationship graph (engine/gateway/table/function/route/file/script/cron_job/ai_role),
   mechanically generated from 8 live sources. Use this for "what calls / is called by what" —
   the one question neither of the layers above answers.

**This document's own addition, not a fifth competing layer:** for the specific artifact classes named
in this OCID's mission (functions, database objects, reports/screens, prompts, engines/business
rules), §§4–14 below name the *real, already-generated, mechanical catalogs* that sit underneath
layers 1–4 and should be queried directly once the search is narrowed to one of those classes —
because grepping source by hand for "does a function like X exist" is strictly worse than querying
`FUNCTION_CATALOG.json`, which already exists for exactly that purpose.

---

## 3. Search performance

`MASTER_INDEX.yaml`'s own `root_cause_confirmed` entry (2026-07-30) already diagnosed and fixed the
real performance failure mode for ad-hoc search on this server: an unscoped `find`/`grep` traverses
`node_modules` (multi-GB per repo) and every per-task git-worktree copy under
`ai-os/tasks/*/workspace/` — both contain files with basenames identical to canonical files.
**Measured, real numbers**: an unscoped `find /opt/veridian -iname CONSTITUTION.yaml` returned 200+
hits (~198 uninformative worktree copies); the same search with `-prune` on the excluded paths
returned the single canonical hit in under 2 seconds. This document adopts that fix as the standing
search-performance rule for every artifact class here: **always prune, never just exclude** —
`-not -path` still descends into and stats the excluded subtree; only `-prune` skips it. The exact
correct pattern is already published in `MASTER_INDEX.yaml`'s `exclusion_rules.correct_find_pattern`
and is not restated as a new one here.

---

## 4. Function discovery

**Real artifact: `ai-os/FUNCTION_CATALOG.json`** — exhaustive, mechanically generated (TypeScript
compiler AST parse, not regex/AI-written) catalog of every named function in `compliance-tracker`'s
`src/` tree: **5,019 total** (top-level declarations, const-assigned arrow/function-expression
exports, class methods, constructors, get/set accessors), each with file path, line number, kind,
exported/async flags, full parameter list, and JSDoc summary where present. Generator:
`ai-os/scripts/extract-function-catalog.mjs <absolute-repo-root> <absolute-output-path>` — reusable
across repos (repo root/output path are `argv`, not hardcoded), completes in under 2 seconds even for
1,600+ files. Regenerate any time `src/` changes; safe, read-only, no build step required.

Query pattern: `jq '.functions[] | select(.name=="runRole")' ai-os/FUNCTION_CATALOG.json`.

The same generator, parameterized by repo path, already produced sibling catalogs for `projexa` (992
functions), `veda-advisors` (270 functions), and `veridian-ui-kit` (46 functions) — see §24
(multi-brand reuse). Function discovery for any of the four core repos means querying that repo's own
`FUNCTION_CATALOG.json` first, not re-parsing source.

---

## 5. Report discovery

Real report surfaces are UI-layer, not a separate catalog artifact today — `/reports` (charts +
`DataTable` + export + `CustomReportsSection`), plus module-specific report tables already present in
`DATABASE_CATALOG.json` (e.g. `gst_ai_review_reports`, `posh_annual_reports`, `saved_reports`). Report
discovery today means: (a) `FUNCTION_CATALOG.json` filtered to files under `src/app/**/reports/**` or
`*-report*`/`*Report*` names, (b) `DATABASE_CATALOG.json` filtered to `*report*` table names, (c) the
narrative `system-tree/13-compliance-tracker-ui.yaml` UI-02 domain entry, which already documents
`/reports` as sitting over shared calculation engines (`income-tax-engine.ts`, `tds-engine.ts`,
`gst-engine.ts` under GOV-07) rather than a separate implementation. **Real, honest gap**: there is no
single mechanically-generated "report catalog" the way there is a function or database catalog — a
future OCID could extend `extract-function-catalog.mjs`'s pattern with a `--filter` for report-shaped
files rather than building a new generator, per §1's "extend, don't parallel-build" rule.

---

## 6. Analysis discovery

Two real, distinct classes exist and should not be confused:
- **Governance/gap analysis** — `ai-os/audit-tree/` (Tree 1), `ai-os/system-tree/` (Tree 3),
  `ai-os/tree4-unified/` (Tree 4), each with their own `AUDIT-ROUND-*.md` / `SYSTEM-AUDIT-ROUND-*.md` /
  `TREE4-AUDIT-ROUND-*.md` records, plus `ai-os/scripts/audit198/` (the re-runnable 198-item
  guardrail-compliance audit engine, `run-audit.mjs`, verdict vocabulary reused directly in §21).
- **In-product analysis engines** — the 247-entry VCEL deterministic-computation engine registry
  (`ai-os/engines/ENGINES.yaml`, 41 already implemented) covering tax/penalty calculators
  (`income-tax-engine.ts`, `tds-engine.ts`, `gst-engine.ts`), and the risk-based audit-planning surface
  (`/audit-engagements`, CAPA-owned findings).

Analysis discovery means checking `ENGINES.yaml` for a matching deterministic engine before writing a
new calculation, and checking the three tree directories' own index files (`00-INDEX.md` in each)
before commissioning a new gap-analysis pass.

---

## 7. Prompt discovery

**Real artifact: the prompt registry** — `compliance.promptVersions` table
(`src/lib/db/schema.ts`, `drizzle/0262_prompt_registry_version_lifecycle.sql`),
`src/lib/services/prompt-os-service.ts` (`transitionPromptLifecycle` / `diffPromptVersions` /
`rollbackPromptVersion`), and `ai-os/PROMPT_METADATA_SCHEMA_2026-07-25.schema.json` for the metadata
contract. This is a real, already-versioned, already-lifecycle-managed prompt library — not a
directory of loose prompt strings. Discovery means querying `promptVersions` (by role/purpose/tag) via
`prompt-os-service.ts`'s own read paths before authoring a new prompt, and using
`transitionPromptLifecycle`/`diffPromptVersions` to enhance an existing prompt version rather than
creating a parallel one. The separate `/opt/veridian/chatgpt-prompt-library/` directory on the server
(Entities/Variables/Keywords/Modules/Reports/Routes/Coverage/Duplicates subdirectories) is a distinct,
older, human-curated prompt corpus outside this repo's own registry — real, on disk, but not
reconciled into `promptVersions` as part of this document; noted as a real open item for a future
pass rather than silently merged or silently ignored.

---

## 8. Workflow discovery

Real, shared workflow engines already exist and are reused across modules, not reimplemented per
module: the **shared Approval Workflow Engine** (cited in `MASTER_INDEX.yaml` as already backing both
Fixed Assets disposal approval and Construction Change Orders' `draft → pending_approval →
approved/rejected` transition, with the e-signature auto-transition sharing `esignature-service.ts`'s
`submitSignature`/`declineSignature` logic rather than a second bespoke workflow); the **dynamic
chain/capability engine** (`dynamic_chains` table + `capability-tree-service.ts`, surfaced as the Mode
Pills / Chain Selector, mounted globally in `AppShell.tsx`); and the **Mother Router dispatch
pipeline** (`src/lib/ai-router/mother-router.ts`) plus the Software Team L0–L5 execution ladder
(`ai-os/SOFTWARE_TEAM.md`) for AI-task workflow dispatch specifically. Workflow discovery means
checking these three before building a new state machine for an approval/dispatch/routing need.

---

## 9. Business rule discovery

Business-rule enforcement is split across three real, distinct mechanisms — discovery must check the
right one for the right question, not assume a single rule engine:
- **Calculation/validation rules** — the VCEL engine registry (§6), e.g. depreciation-schedule
  validation with mid-period proration/true-up/salvage floor, already shared by the Fixed Assets
  module rather than reimplemented.
- **Guardrail/policy rules** — the Policy Enforcement Engine (`ai-os/CONSTITUTION.yaml` §13, sourced
  from the former `VERIDIAN_AI_CONSTITUTION.md` §22) plus `scripts/ddl_authorization_check.py` (tier-2
  DDL policy) and the 198-item guardrail ruleset (`ai-os/RULES_ARTICLES_198.json`).
- **Data-integrity rules** — `asset-registry-coverage.yaml`, CI-enforced via
  `scripts/check-asset-registry-coverage.mjs`, requiring every `schema.ts` table to be registered or
  explicitly exempted.

Before adding a new business rule of any of these three kinds, check the corresponding real registry
above; do not add a fourth parallel rule-storage mechanism.

---

## 10. Screen discovery

**Real artifact: `ai-os/system-tree/13-compliance-tracker-ui.yaml`** — a hand-maintained, real
inventory of `src/app/(app)/**` (~130 route modules) and `src/components/**` (~65 non-shadcn files),
grouped into domains (UI-01 Assistant/Home, UI-02 Compliance core, etc.), each with its real routes,
inputs, outputs, rules, and workflow narrative. **Real, honest gap, named not hidden**: unlike
`FUNCTION_CATALOG.json`/`DATABASE_CATALOG.json`, this screen inventory is hand-maintained narrative,
not mechanically regenerated from `src/app/`'s live route tree — it can go stale the same way
`tree3_system_tree`'s table/enum counts already went stale once (377→444 tables) before
`DATABASE_CATALOG.json` fixed that for the database layer. Screen discovery today means reading this
file first, then spot-verifying the specific route still exists before treating it as ground truth.

---

## 11. Module discovery

Two real, complementary sources: **`ai-os/file-ownership.yaml`** (the deterministic module-ownership
map, cross-checked — not blindly trusted — against AI-declared module labels by
`master-decompose.py`), and **`ai-os/engines/ENGINES.yaml`** (the 247-entry VCEL engine/module
registry). `ai-os/MASTER-TRACKER.yaml`'s `module_pilot_queues` section additionally tracks in-flight
module-level pilot work. Module discovery means checking ownership first (who/what already owns this
area) before checking whether the module itself already exists.

---

## 12. Database object discovery

**Real artifact: `ai-os/DATABASE_CATALOG.json`** — exhaustive, mechanically generated (via
`drizzle-orm`'s own `is(PgTable)` + `getTableConfig()` introspection, not text-parsing) catalog of
every table (**444**), every column (name/type/nullability/default/PK/unique/enum values), every
foreign key, every index, and every enum (**124**, full value lists). 100% complete by construction,
cross-verified 3 ways. Generator: `ai-os/scripts/extract-db-schema-catalog.mjs
<absolute-path-to-schema.ts>` — reusable across repos, already run for `projexa` (11 local tables, 0
enums) as its own sibling catalog. Query pattern: `jq '.tables[] | select(.table_name=="organisations")'
ai-os/DATABASE_CATALOG.json`. Row-level registration into `asset-registry-coverage.yaml`'s coverage
tracking is a **live Postgres trigger** — genuinely automatic, zero human/AI touch per row; only
*table-level* onboarding (a brand-new table) needs a one-time migration + registry entry before the
trigger covers it. Database object discovery means querying this catalog, never re-reading
`schema.ts` by eye to check whether a table/column/enum already exists.

---

## 13. UI discovery

Covered structurally by §10 (screen discovery — the route/page inventory) and, for shared visual
primitives specifically, by **`veridian-ui-kit`'s own `FUNCTION_CATALOG.json`** (`@fchecklist/veridian-ui-kit`,
0 runtime deps, 22 `src/` files, 46 functions) — the real, single shared component package consumed by
both `compliance-tracker` and `projexa`. UI discovery for a new visual primitive means checking this
package's catalog before building a component locally in either product repo.

---

## 14. UX discovery

UX patterns (not visual components, but interaction flows) are documented narratively per domain
inside `system-tree/13-compliance-tracker-ui.yaml`'s own `workflow` fields (e.g. "Item created/imported
→ tracked through `/compliance/[id]`'s tabs → reported on via `/reports` → penalties calculated when
overdue → everything auditable via `/audit`"), plus the dedicated cross-reference document
`ai-os/REVIEW_FRAMEWORK_V2-8_MOBILE_UX_CROSSREF_2026-07-20.md` for mobile-specific UX findings already
on record (responsive scaling, offline resilience, touch-target sizing, mobile perf — CSV
#106/#1792/#1793/#1794). UX discovery means reading the relevant domain's `workflow` narrative and the
mobile UX cross-reference before proposing a new interaction pattern, so a genuinely new UX problem
isn't solved twice under two different names.

---

## 15. Canonical artifact discovery

"Canonical artifact" in this chain has a specific, consistent meaning already established across
every OCID-022 through OCID-040 document: the one real file each OCID's own `## Amendment` names as
*"Canonical artifact created/updated: ..."* at the end of its own section in
`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`. Discovery means reading that file's own amendment history
top to bottom (or `ai-os/OS.yaml`'s index, which cross-references the same set) rather than assuming a
document is canonical just because it exists on disk — a draft sitting in an unmerged PR (§2's layer 1
already flags this distinction for OCID-022/024/025/026 in `VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md`)
is not yet canonical until it merges.

---

## 16. UMR discovery

Every UMR in this chain is a real, PM-dispatched directive citation, not a database row you query by
ID — the closest thing to a structured UMR registry is `superboss-register.sqlite`'s `umr_tasks`
table (named canonical by `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`'s own amendment for
`UMR-20260802-165434-cd91`, the unified project memory model). UMR discovery means: (1) grep the
citing document's own UMR string across `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`,
`ai-os/boss/ACTIVE-CLAIMS.yaml`, and `ai-os/boss/COMPLETED.yaml` for prior mentions before assuming a
UMR is unregistered; (2) treat a UMR that resolves to real completed work (a merged PR, a real
`completed_steps` record) as load-bearing evidence, and a UMR that only appears as a citation in
another directive's prose as unverified until independently checked — exactly the standard this
chain's own §2/§16 note in `VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md` already applied to
itself, not a new one invented here.

---

## 17. Search priority model

Applying §2's four-layer order to a concrete artifact request, in priority:

1. Narrow the request to one of the classes in §§4–14 (function, report, database object, screen,
   prompt, workflow, business rule, module, UI, UX, analysis).
2. Query that class's own real mechanical catalog first if one exists (`FUNCTION_CATALOG.json`,
   `DATABASE_CATALOG.json`, `ENGINES.yaml`, `promptVersions`) — these are ground truth by construction.
3. If no mechanical catalog exists for that class (reports, screens, UX — see the honest gaps named in
   §§5/10/14), fall back to the hand-maintained narrative layer (`system-tree/`, `MASTER_INDEX.yaml`)
   and spot-verify against current source before trusting it.
4. Run `system_index check-duplicate` regardless of steps 2–3's outcome — it is the one gate every
   real prior gatekeeper-rule directive (`UMR-20260802-165034-5747`) made mandatory before writing
   anything new, independent of which narrative/mechanical layer was already checked.
5. Only after 1–4 return no match does §22 (when a new artifact is allowed) apply.

---

## 18. Search result validation

A search "hit" is not automatically a valid reuse target. Validate before reusing:
- **Freshness** — query `knowledge_engine` (§2, layer 3) for machine-verified drift status, not the
  hit's own last-edited date alone. This chain has two real, on-record examples of a stale-but-not-wrong
  number (`tree3_system_tree`'s 377-table claim, `roster.ts`'s "~30-role" header comment) that looked
  authoritative but had silently drifted from live source.
- **Canonical vs. draft** — apply §15: a hit sitting on an unmerged PR branch is real but not yet
  canonical; cite it as in-progress, don't reuse it as if merged.
- **Scope match, not name match** — a same-named table/function/engine across `compliance-tracker` vs.
  `projexa` vs. `veda-advisors` may be a genuinely separate, correctly-scoped artifact (each has its
  own catalog, §24) rather than a duplicate to merge.

---

## 19. Reuse criteria

An existing artifact **shall be reused** when all of: (a) it is verified to exist via §17's search
priority model, (b) its scope genuinely covers the new need (not merely a similar name), (c) it is
either canonical (§15) or the requester is explicitly building on the same in-flight branch, and
(d) reusing it does not require weakening a named guardrail (AGENTS.md Rule 9) without the owner
sign-off that rule requires. When all four hold, building a new artifact instead is a zero-duplication
violation, not a valid engineering choice.

---

## 20. Enhancement criteria

An existing artifact **shall be enhanced, never replaced**, when a real capability is missing from it
but its core scope/shape is still correct. Enhancement means: extend the same generator script (§4's
`extract-function-catalog.mjs`/`extract-db-schema-catalog.mjs` pattern — already extended once, from
compliance-tracker-only to a `<repo-root>`-parameterized reusable tool, rather than forked), add a
category checker to `audit198/category-checkers.mjs` (§21) rather than building a second scoring
script, or append a `## Amendment` to the owning document (§23) rather than starting a new file.
Replacement (deleting and rebuilding from scratch) is reserved for artifacts confirmed dead —
e.g. `ai-os/boss/BOARD.yaml`, self-declared stale since 2026-06-29 and explicitly superseded by
`COMPLETED.yaml` — not for artifacts that are merely incomplete.

---

## 21. Standardization criteria

Where more than one real mechanism already exists for adjacent purposes, standardize on the one with
the strongest verification story rather than maintaining both: `DATABASE_CATALOG.json`/
`FUNCTION_CATALOG.json` (mechanical, 100%-complete-by-construction) are the standard over
hand-maintained tree narratives for column/function-level fact-finding; `audit198_framework`'s existing
verdict vocabulary — **ENFORCED / PARTIALLY_ENFORCED / POLICY_ONLY / NOT_APPLICABLE_YET /
NOT_YET_BUILT / NEEDS_HUMAN_JUDGMENT / EVIDENCE_UNAVAILABLE** — is adopted here as the standard
certification vocabulary for knowledge-artifact readiness (§21 reuses it directly rather than
inventing a competing scale) wherever a future OCID needs to grade a knowledge asset's real
completeness.

## 21a. Certification criteria

A knowledge artifact (document, catalog entry, prompt version, engine) is **certified reusable** only
when: (1) it carries real evidence (file:line, commit hash, or a re-runnable query), not an assertion;
(2) for any artifact touching a guardrail or produced by a non-judgment-tier model, the mandatory
audit gate already enforced by CI (`.github/workflows/mandatory-audit-check.yml`, a comment starting
`AUDIT: PASS`/`AUDIT: FAIL`, Rule 10) has run, with the doer and auditor being different agents per
Rule 7(c) — no self-certification; (3) it has been checked against `knowledge_engine` for freshness
(§18) within the current session, not assumed current from an old read.

---

## 22. When a new artifact is allowed

A new artifact (script, table, register, document, prompt, workflow, business rule, screen, module) is
allowed **only** when §17's full search priority model has been run and returns no match at every
layer — `MASTER_INDEX.yaml` protocol, `system_index check-duplicate`, `knowledge_engine
query-knowledge`, the relevant mechanical catalog if one exists — **and** that negative result is
recorded (per `MASTER_INDEX.yaml`'s own instruction: *"if check-duplicate and this file both show no
match, proceed, then register the new thing in `system_index` (index-add) AND in this file's relevant
list"*). A new artifact created without recording that check is itself a governance gap, not a valid
exception.

---

## 23. Global library update process

The real, already-live update mechanism for every registry named in this document is the
**in-place `## Amendment (date): ...` pattern**, used dozens of times already in
`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`, `ai-os/CONSTITUTION.yaml`'s `amendment_log`, and
`ai-os/MASTER_INDEX.yaml`'s own registry entries: append a new dated section to the *same* file,
cite the real UMR/PR/commit that produced the change, and state explicitly what was *not* rewritten
or duplicated. This document's own final section (§35) follows that same pattern for
`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`. No separate "library update workflow" is introduced —
doing so would itself violate this document's own zero-duplication principle (§28).

---

## 24. Multi brand reuse

Real, already-working multi-brand reuse exists at two levels: **(a) shared codebase reuse** —
`veridian-ui-kit` (0 runtime deps) is consumed by both `compliance-tracker` and `projexa`; `projexa`
itself is described in `MASTER_INDEX.yaml` as "governed through compliance-tracker's modules" via
`veridian-client.ts` + `/api/v1/projexa/*`, not a separately-implemented product. **(b) shared
discovery tooling reuse** — the exact same generator scripts
(`extract-db-schema-catalog.mjs`/`extract-function-catalog.mjs`) that catalog `compliance-tracker`
were reused unmodified (parameterized by repo path) to produce `projexa`'s and `veda-advisors`'s own
catalogs, regression-tested against `compliance-tracker`'s known-good 444/124/5,019 numbers before
trusting the reused tool on a second repo. Per AGENTS.md's operating rules, any verified improvement
becomes available to all VERIDIAN brands — this document's own §19–20 (reuse/enhancement criteria)
apply identically regardless of which brand's repo a search hit came from.

---

## 25. Multi tenant reuse

Multi-tenant isolation is enforced once, centrally, and reused by every module rather than
re-implemented per module: `withTenantContext`/RLS-scoped queries (already independently verified live
— a second org's `GET /api/departments` correctly returned only its own rows, per the OCID-020
continuation record), and `asset-registry-coverage.yaml`'s row-level auto-registration via a live
Postgres trigger, which applies uniformly across tenants with zero per-tenant configuration. Discovery
for a new tenant-scoped feature means confirming it sits on the existing `withTenantContext` path
before writing bespoke tenant-filtering logic.

---

## 26. Role based reuse

Two real, distinct role systems exist and are each reused rather than re-derived per feature:
**AI roles** — `ai-os/AI_ROSTER_CATALOG.json` (195 roles, generated from `src/lib/ai-team/roster.ts`),
with `team-service.ts`'s own helper functions (`allGuardrailRoles`, `allAuditOrganizationRoles`,
`operationalRoles`) as the queryable reuse surface, plus `model-tier-eligibility.ts`'s
mechanical/integrative/judgment trust tiers gating what any given role may be dispatched to do (Rule
10). **Human roles** — the `user_role` enum already present in `DATABASE_CATALOG.json`, queryable via
`jq '.enums[] | select(.pg_name=="user_role")'`. Role-based reuse means checking whether an existing
role (AI or human) already covers the needed capability before defining a new one.

---

## 27. Industry specific configuration

Real, existing industry/jurisdiction configuration is reused via two mechanisms rather than forked per
industry: the **Controls & Framework Library** (`/frameworks` — ISO 27001, SOC 2, COSO, NIST CSF,
India Statutory, DPDP, PCI/HIPAA), a shared framework catalog consumed by whichever compliance
workflow needs it, not duplicated per framework; and the **multi-country compliance-engine
abstraction** (V2-1, wired for India and UAE), a shared engine with country-specific configuration
data rather than a separate engine per country. A new jurisdiction or industry vertical should extend
one of these two configuration surfaces first — confirmed via the same generator/registry pattern used
throughout this document — before a bespoke implementation is considered.

---

## 28. The zero duplication model

Zero duplication in this system is enforced by four real, independent mechanisms working together,
not by any single one on its own:
1. **Prevention** — `MASTER_INDEX.yaml`'s protocol field + `system_index check-duplicate`, run *before*
   building (§2, §22).
2. **Detection** — `knowledge_engine`'s drift-detection queries, catching artifacts that silently
   became duplicative or stale *after* being built (§18).
3. **CI enforcement** — `scripts/check-asset-registry-coverage.mjs`, `scripts/check-guardrail-presence.mjs`,
   `scripts/check-doc-quarantine-banner.mjs` — mechanical, reviewable-diff gates that fail a PR outright
   rather than relying on a human/AI remembering to check.
4. **Cooperative registration** — `ai-os/boss/ACTIVE-CLAIMS.yaml`, preventing two concurrent sessions
   from independently building the same gap at once (this document's own §-0 registered a claim there
   before this file was written).

**Honest limitation, same class named throughout this chain**: none of the four is a runtime-
unbypassable lock. Each is a reviewable-diff or cooperative-discipline guarantee — the same honest
disclosure `check-guardrail-presence.mjs`'s own header and Rule 9/11 already make for their respective
mechanisms. This document does not claim otherwise for knowledge-discovery duplication either.

---

## 29. Knowledge traceability

**Real artifact: the server-wide artifact traceability register** (`UMR-20260802-164659-9a31`),
already run across four tranches (running total 1,008 files as of tranche 4, PR #749), mapping real
UMR-to-artifact and artifact-to-UMR relationships and flagging orphans/duplicates directly rather than
asserting a clean state. Knowledge traceability for any artifact this document covers means it should
be findable in that register (or explicitly flagged as a gap if it is not) — not a second, parallel
traceability list maintained by this document.

---

## 30. Knowledge governance

Governance is layered, not flat: `ai-os/CONSTITUTION.yaml` is supreme (never bypassed without the
owner's explicit written instruction, per its own `amendment_rule`); `AGENTS.md` Rule 9 protects every
guardrail named in `check-guardrail-presence.mjs`'s manifest from being weakened without sign-off +
manifest update; Rule 10 gates which AI roles may touch judgment-tier work and mandates independent
audit (Rule 7c) before merge; `ai-os/file-ownership.yaml` deterministically maps module ownership.
Knowledge-artifact governance specifically inherits all of the above — a change to `FUNCTION_CATALOG.json`'s
generator, `promptVersions`' lifecycle logic, or this very document is subject to the same PR/CI gate
(Rule 6) as any other source change, with no exemption for `ai-os/`.

---

## 31. Performance targets

No formal numeric SLA existed for knowledge-search latency before this document. Rather than invent
untested targets, this document adopts the real, already-measured numbers from this chain's own
mechanisms as the standing target going forward: **catalog regeneration** (`FUNCTION_CATALOG.json`,
1,600+ files) completes in **under 2 seconds**; **pruned filesystem search** (§3's fix) completes in
**under 2 seconds** against a corpus where the unpruned equivalent took long enough to return 200+
irrelevant hits. A future artifact class whose discovery mechanism cannot meet a comparable order of
magnitude should be flagged as a real gap (as §5/§10/§14 already do for reports/screens/UX lacking a
mechanical catalog) rather than silently accepted as "search is just slow here."

---

## 32. Search performance

Covered in full in §3 — restated here only to satisfy this OCID's own explicit section list, not
duplicated as separate content. See §3 for the real root cause, the measured before/after numbers, and
the standing prune rule.

---

## 33. Cache utilization

The real cache-equivalent pattern already in production for knowledge discovery is **pre-computed
extraction, not a query-result cache**: `DATABASE_CATALOG.json` and `FUNCTION_CATALOG.json` are
themselves a cached snapshot of live source (regenerated on demand, "safe, read-only, no DB connection
required" per their own `regenerate` field), avoiding the cost of re-parsing `schema.ts`/`src/` on
every query. `system_index`/`knowledge_engine`/`wiring_registry` being SQLite tables (not flat-file
scans) is itself the caching layer for the existence-check and drift-detection queries — no additional
in-memory or edge cache exists or is proposed here; at current scale (444 tables, 5,019 functions,
28-row `system_index`) a SQLite read and a `jq` filter over a pre-generated JSON file are already
sub-second, so adding a further cache layer would be solving a problem that does not yet exist,
contrary to this OCID's own build-vs-buy discipline (`ai-os/AI_ENGINEERING_POLICY.yaml`).

---

## 34. Knowledge lifecycle

A knowledge artifact in this system moves through real, observable states: **draft** (open PR, not yet
canonical — §15) → **canonical** (merged to `main`, cited as the canonical artifact in
`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`) → **amended in place** (§23's `## Amendment` pattern,
repeatable indefinitely) → **stale** (flagged the moment `knowledge_engine` or a spot-check finds real
drift — the `tree3_system_tree`/`roster.ts` precedents in §18) → **archived** (moved to `docs/archive/`
or a `tree4-unified` archive directory with the `ARCHIVED`/`STALE` banner enforced by
`scripts/check-doc-quarantine-banner.mjs`). Prompt artifacts specifically have a formalized version of
this same lifecycle already built (`transitionPromptLifecycle`/`rollbackPromptVersion` in
`prompt-os-service.ts`) — the general lifecycle above is this document's generalization of that
already-shipped pattern to every other artifact class, not a competing one.

---

## 35. Global reuse summary

Of the artifact classes named in this OCID's mission, **mechanical, ground-truth catalogs already
exist today** for database objects (444 tables, 124 enums) and functions (5,019 entries, extended
across 4 repos), plus a 247-entry engine registry and a 195-role AI catalog. **Hand-maintained
narrative catalogs, real but not mechanically regenerated,** cover screens/UI (`system-tree/13-*.yaml`)
and UX workflow narratives. **A real, versioned, lifecycle-managed registry** exists for prompts
(`promptVersions`). **A real gap, named honestly, not hidden**: no dedicated mechanical catalog exists
yet for reports or business rules as a distinct class (§5, §9) — each is currently discoverable only
by filtering the function/database/engine catalogs already in place, which is workable today but is a
real candidate for a future, additive extension of the existing generator pattern rather than a new
generator. The zero-duplication model (§28) is enforced by four real, independent, already-live
mechanisms, none of them a runtime-unbypassable lock — a cooperative-discipline guarantee, disclosed
as such rather than oversold.

---

## 36. Readiness for OCID-028

This document does not perform, and explicitly does not certify, any implementation, database change,
API, module, or workflow. It defines discovery and reuse only, per its own mission's prohibition.
**Real state as of this document**: OCID-020 (`UMR-20260802-165606-4413`) remains open and
unverified-complete; the `SEC-07` implementation lock therefore still applies to anything downstream of
OCID-038/039/040. This document's own content — a discovery/reuse operating model — has no
implementation dependency on that lock.

**Real correction (independent-review finding, this same PR):** an earlier draft of this section named
OCID-028 as "VERIDIAN Universal Organization Runtime v1.0," contradicting this document's own §0
("`VERIDIAN Unified Synchronization Runtime` is the real, separate OCID-028"). OCID-028's real content
is `VERIDIAN Unified Synchronization Runtime v1.0` (`compliance-tracker` PR #774, citing
`UMR-20260803-041257-e9c3`) — and, per the real, current
`ai-os/VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md` on `origin/main`, that PR is already
**MERGED**, so there is nothing left to hand off here. "Universal Organization Runtime" is the status
snapshot's own honestly-flagged, not-independently-confirmed inference for OCID-029, not a settled fact
for any row — whoever picks up real OCID-029 should verify it directly against the real dispatch chain
rather than trust this document or the snapshot's inference.

**OCID-028 already real, complete, and merged as of this document's own correction.**

---

Canonical artifact created: this file
(`ai-os/VERIDIAN_GLOBAL_KNOWLEDGE_DISCOVERY_AND_REUSE_RUNTIME_2026-08-03.md`). Updates the existing UMR
chain (`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`) — does not start a new one. No implementation, no
code, no database objects, tables, APIs, new modules, or new workflows were created.
