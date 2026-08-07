# VERIDIAN Continuous Platform Evolution Runtime v1.0

**UMR:** this document's own directive, parented to `UMR-20260803-042003-5e92` (the real OCID-034
directive, "VERIDIAN Universal Context and Predictive Runtime" — dispatched as
`task-20260803-055118-ocid-034-veridian-universal-context-and`, `in_progress`, no document yet at the
time this document was written), citing the full chain `UMR-20260803-040844-4a33` (OCID-022) through
`UMR-20260803-041851-085a` (OCID-033), `UMR-20260802-173631-ca85` (the ERP Functional Completeness
Master Program), `UMR-20260802-165606-4413` (OCID-020), `UMR-20260802-164659-9a31` (server artifact
traceability audit), `UMR-20260802-165034-5747` (the gatekeeper rule), and `UMR-20260802-165434-cd91`
(the unified project memory). Documentation only — no code, no schema, no new architecture.

**Real numbering note, checked directly rather than assumed:** this document's own dispatched task
(`task-20260803-055122-ocid-035-veridian-continuous-platform-ev`) and its own `prompt.txt` self-identify
as **OCID-035**, parented to OCID-034. A separate, earlier document —
`ai-os/VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md` — labels this same "Continuous Platform
Evolution Runtime" mission text as **OCID-034** in its own section-1 table. That snapshot document has
already twice self-corrected other off-by-one row mislabels for this same OCID cluster (see its own
§1a for the OCID-036/037 correction and PR #776 for the OCID-026/027/028/029/030 correction) — the
demonstrated, repeated root cause is the snapshot's own dispatch-order-to-number mapping, not the real
dispatched tasks. Per the pattern PR #776 established (trust each task's own real `task.yaml`/
`prompt.txt`/branch label over the snapshot table when the two disagree), this document treats its own
task's self-identification — **OCID-035** — as authoritative, and flags the snapshot row for a future
correction pass rather than silently renumbering itself. Nothing in this document's actual content
depends on which integer it carries.

---

## 0. What this document is, and is not

This is a **documentation-only** artifact. It defines how VERIDIAN evolves — how an enhancement request
becomes a shipped, certified, non-duplicated change to an existing function, report, analysis, prompt,
business rule, workflow, UI, or UX surface — without writing any code, creating any database object, or
introducing any new architecture. It does not implement anything named in it. It does not certify
platform freeze. It does not unlock implementation: per `SEC-07` (`ai-os/CONSTITUTION.yaml`), real
implementation/gap-closure/production-change/completion-certification work under the ERP Functional
Completeness Master Program stays locked until OCID-020 (`UMR-20260802-165606-4413`) is independently
verified complete. This document is explicitly compatible with that lock — it defines *how future
implementation must behave once unlocked*, it does not perform any.

**Search-before-write, done for real, not asserted:** before drafting this, this session read (not
assumed) `ai-os/OS.yaml`, `ai-os/MASTER_INDEX.yaml`, `ai-os/MASTER-TRACKER.yaml`,
`ai-os/CONSTITUTION.yaml`, `ai-os/boss/ACTIVE-CLAIMS.yaml`, `ai-os/system-tree/` (Tree 3, the real
grep-derived inventory), `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`, and the real, current PR list
(`gh pr list`) — including the open, unmerged `ai-os/VERIDIAN_GLOBAL_KNOWLEDGE_DISCOVERY_AND_REUSE_
RUNTIME_2026-08-03.md` (OCID-027, PR #771). Zero duplicate mechanism for "continuous evolution
governance" was found anywhere in this repo under any name.

**Explicit scoping against the real, adjacent OCID-027 document (cluster overlap check, per the real PM
decision `UMR-20260803-045159-ec55` requiring this before any 029/030/032/034/035/036-cluster worker
starts):** OCID-027's "Global Knowledge Discovery and Reuse Runtime" (PR #771, open/unmerged) already
defines *how something that already exists gets found* — global search order, per-artifact-type
discovery (function/report/analysis/prompt/workflow/business-rule/screen/module/database-object/UI/UX/
canonical-artifact/UMR discovery), search performance, reuse/enhancement/standardization/certification
criteria, and the zero-duplication model. This document does **not** redefine any of that. Where this
document's own mandated §4 ("Search before change") would otherwise restate OCID-027's search
taxonomy, it instead cross-references OCID-027's document as the authority and defines only the one
thing OCID-027 does not cover: **what happens after something is found** — the enhancement,
propagation, validation, certification, and release lifecycle of an actual change to an existing
artifact. This document also checked OCID-029/030 (Universal Organization Runtime / Universal Decision
Engine, PRs #773/#772, open/unmerged) for overlap — both are separate functional domains (org-structure
modeling and decision-branching logic, respectively), not process/lifecycle governance, so no overlap
was found there. OCID-032, OCID-034, and OCID-036 had not started (no document, no PR) at the time this
document was written, so no further merged/open content existed to check against.

---

## 1. Platform evolution principles

VERIDIAN is not a greenfield product. Every function, report, analysis, prompt, business rule,
workflow, UI surface, and UX pattern named in the OCID-022 through OCID-033 chain, in
`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`, and in `ai-os/system-tree/` already exists in some form.
Continuous evolution means:

1. **Every change starts from discovery, not invention.** No enhancement, no matter how small, is
   designed before the existing implementation is located and read.
2. **Enhance before create.** A new request is satisfied by extending an existing function, report,
   prompt, business rule, workflow, UI component, or UX pattern wherever one already covers the same
   ground — even partially. A net-new artifact is the last resort, not the default.
3. **One canonical artifact per concern.** The existing canonical artifact for a concern (the document,
   schema, catalog, or registry that is the source of truth for it) is updated in place. A second,
   parallel artifact covering the same concern is never created.
4. **The UMR chain is append-only and singular.** Evolution work amends the existing UMR chain
   (`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` and the `superboss-register.sqlite` `umr_tasks` table
   it documents) — it never starts a second, competing chain.
5. **Every change benefits all applicable brands and tenants**, not just the requester's own context,
   unless the change is genuinely brand- or tenant-specific by design (see §13–14).
6. **Every change is backward compatible, traceable, and auditable** by default; breaking changes are
   the explicit exception, called out and justified, never the silent default.
7. **No architectural drift.** A change that would require a new architectural pattern where an
   existing one already solves the problem is redirected to the existing pattern, not allowed through
   because it is "simpler to just add something new."

These are restatements-in-force of principles already asserted piecemeal across this repo — Rule 9 of
`AGENTS.md` (no guardrail weakened without sign-off + manifest update), the zero-duplication model in
OCID-027 §28, and the "reuse existing, enhance existing" framing repeated in every OCID-022-through-035
directive itself. This section does not invent a new principle; it is the one place all of them are
collected for the specific lens of *ongoing, continuous* evolution rather than a one-time build.

---

## 2. Request capture

An evolution request (a bug, an enhancement idea, a new business need mapped onto an existing capability)
enters the platform through the same channels already wired for any other work item, not a new intake
mechanism:

- **`ai-os/MASTER-TRACKER.yaml`** — the existing, single open-items register (per its own header,
  consolidating 17 prior trackers). A new evolution request is captured here as a new `open_items` entry
  with a real owner/blocker, exactly like any other gap — not a separate "evolution backlog."
- **UMR dispatch** (`superboss-register.py`, the existing PM-directive mechanism used for every OCID in
  this chain) — for Owner-directed evolution work, the same dispatch path already used for OCID-022
  through OCID-040.
- **`ai-os/boss/ACTIVE-CLAIMS.yaml`** — the existing real-time claim registry (Rule 11, added 2026-07-14)
  is where a session records that it has picked up a captured request, before starting work on it — this
  prevents two sessions from independently capturing and then separately building the same request.

No new intake form, ticketing schema, or request-capture table is created by this document. Request
capture is the same act as gap registration; evolution does not get a parallel front door.

---

## 3. Request classification

Every captured request is classified along two existing axes before any search or design work begins,
reusing mechanisms already live in this repo rather than inventing a new taxonomy:

- **Complexity tier** — `mechanical` / `integrative` / `judgment`, per `src/lib/model-tier-eligibility.ts`
  and AGENTS.md Rule 10. An evolution request that changes business logic or user-facing behavior is
  `judgment`-tier by default; a pure refactor or config change may be `mechanical`/`integrative`. This
  governs which model/role may be dispatched to it — it is not a new classification, it is the existing
  one applied to evolution work specifically.
- **Change class** — reusing the existing status vocabulary in `ai-os/MASTER-TRACKER.yaml`'s own header
  (`open`, `owner_blocked`, `needs_verification`, `ratified`, `deferred_large`) plus one lens specific to
  evolution: whether the request is an **enhancement** (extends an existing artifact's behavior),
  a **fix** (corrects existing behavior against its own intended spec), or a **propagation** (brings an
  already-approved change in one brand/tenant/module to another that lacks it — see §13–14). This
  three-way lens determines which of §5–12's enhancement patterns applies and whether §13–14's
  propagation step is required.

Classification output is recorded on the `MASTER-TRACKER.yaml` entry itself (or the UMR record for
Owner-dispatched work) — not in a new classification table.

---

## 4. Search before change

Before any enhancement design begins, the request is searched against everything that already exists.
**This document does not redefine search mechanics** — OCID-027's "Global Knowledge Discovery and Reuse
Runtime" (`ai-os/VERIDIAN_GLOBAL_KNOWLEDGE_DISCOVERY_AND_REUSE_RUNTIME_2026-08-03.md`, once merged) is
the canonical authority for global search order, per-artifact-type discovery, search performance, and
reuse/enhancement criteria. Continuous evolution's obligation is procedural: **no design work starts
until that search has actually been run and its result recorded**, using the mechanisms already proven
live in this repo:

- `ai-os/MASTER_INDEX.yaml` — query before building any new script/table/register, across all four
  FChecklist repositories (compliance-tracker, projexa, veda-advisors, claude-control).
- `ai-os/system-tree/` (Tree 3) — the real, grep-derived inventory of what is actually built, not what
  documentation claims is built.
- `superboss-register.py check-duplicate` — the real, working duplicate-detection mechanism already in
  production use by the credit-accountant gate (real precedent: `task-20260802-231514`'s auto-fix retry
  was rejected because this exact lookup found `quality-gate.sh`'s own documented behavior already
  covered it — logged in `ai-os/boss/ACTIVE-CLAIMS.yaml`). Evolution requests reuse this same lookup
  before any new function, script, or mechanism is proposed.
- `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` — the point-in-time evidence-based matrix of what the 12
  top-level deliverables actually contain, cross-checked before assuming a gap exists.

A request that this search shows is **already fully satisfied** is closed with the citation to the
existing mechanism (the same disposition `superboss-register.py check-duplicate` already produces in
production) — not silently dropped, not re-implemented.

---

## 5. Function enhancement

An enhancement to existing business logic modifies the existing function in place (e.g., the relevant
handler under `src/app/api/**` or helper under `src/lib/**`) rather than adding a parallel function with
a similar name. Concretely: the existing function's signature and call sites are read first
(`ai-os/system-tree/11-compliance-tracker-api.yaml` and the auto-generated function catalog cited in
`ai-os/OS.yaml` — "catalog of every top-level function/arrow-const/class-method... ground truth from
live code" — are the real, already-existing tools for this), the enhancement is added as new logic
inside or alongside the existing function (new parameter, new branch, new optional behavior), and every
existing caller is checked for compatibility (§21). A new function is only created when the existing
one's responsibility is genuinely different from what is being asked for — not merely because adding a
parameter feels riskier than adding a file.

## 6. Report enhancement

An enhancement to an existing report (dashboard card, compliance chart, data table view, or exportable
report) extends the existing report's query, columns, or filters in place. The existing report's
existing data source (Drizzle query, `src/components/ComplianceChart`/`DataTable` usage) is read first;
new columns/metrics/filters are additive and backward compatible with existing consumers of that report
(export jobs, saved views, scheduled deliveries) unless the request explicitly requires a breaking
change, which is then called out per §19.

## 7. Analysis enhancement

An enhancement to an existing analysis (gap analysis, reconciliation report, or computed metric) extends
the existing analysis's method and inputs rather than standing up a parallel analysis of the same
subject. The precedent this repo has already set for this is direct: `ai-os/PROCUREMENT_ERP_GAP_
ANALYSIS_2026-07-31.md` explicitly cross-references the 10 procurement reference docs and the live
`erp_*` tables rather than re-deriving them; `ai-os/VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md`
explicitly states it supersedes rather than duplicates the separately-requested OCID-039 analysis
(§1, row OCID-039). Analysis enhancement follows the same rule: extend or amend the existing analysis
document, do not draft a second one covering the same question.

## 8. Prompt enhancement

An enhancement to an existing AI prompt extends the existing prompt version in
`compliance.prompt_versions` (the existing versioned-prompt table, whose metadata shape is defined by
the already-existing `ai-os/PROMPT_METADATA_SCHEMA_2026-07-25.schema.json`) as a new version of that
same prompt — not a new, differently-named prompt covering the same task. The existing prompt-versioning
mechanism already provides traceability (which version served which request) and rollback (revert to
the prior version) for free; evolution work reuses that mechanism rather than building a parallel one.

## 9. Business rule enhancement

An enhancement to an existing business rule (a compliance deadline calculation, a penalty formula, an
approval-routing rule) modifies the existing rule's definition in place and is cross-checked against
`ai-os/RULES_ARTICLES_198.json` (the existing 198-rule extraction) and `ai-os/CONSTITUTION.yaml` where
the rule in question is governance-relevant, so the change is reconciled against the same canonical
source every other rule change in this repo is checked against, not evaluated in isolation.

## 10. Workflow enhancement

An enhancement to an existing operational workflow (task lifecycle, approval chain, dispatch sequence)
extends the existing workflow definition — the same class of artifact OCID-027 §8 catalogs under
"workflow discovery" — in place. Where the workflow crosses the dispatch surfaces named in AGENTS.md
Rule 10 (`/api/ai/team/dispatch`, `dispatch-repo.ts`, `ai-workforce-agent.mjs`), the enhancement is
applied at all real dispatch surfaces consistently, per that rule's own requirement, not at just the
one surface the requester happened to touch first.

## 11. UI enhancement

An enhancement to an existing UI surface (a page under `src/app/(app)/`, a shared component under
`src/components/`) extends the existing component in place, using the existing design tokens (Navy
#1C2B3A, Saffron #F5820A, Teal #0E7C6E, Cream #FFFDF9; DM Serif Display + Inter) rather than introducing
new ad hoc styling. Shared components (`AppSidebar`, `AppTopbar`, `DashboardCard`, `ComplianceChart`,
`DataTable`, `StatusBadge`, `SearchCommand`) are extended for all their existing call sites, not forked
per-page.

## 12. UX enhancement

An enhancement to an existing UX pattern (a workflow's step sequence, an interaction pattern, an
empty/error/loading state) extends the existing pattern consistently across every screen that already
uses it, reusing the existing UX-discovery mechanism OCID-027 §14 defines ("reading the relevant
domain's `workflow` narrative and the relevant screen's real DOM/component tree") rather than redesigning
the pattern locally for one screen and leaving the rest inconsistent.

---

## 13. Multi brand propagation

VERIDIAN AI and PROJEXA are the two live brands sharing this backend (per the already-documented,
already-resolved domain/brand-ownership state — `projexa-ai.com` intentionally serves
`veridian-compliance-ai`'s backend post Wave-10 domain revert, `UMR-20260802-134939-145d`). An
enhancement approved for one brand is evaluated for propagation to the other **before** it is considered
complete: if the underlying capability (function, report, business rule, workflow) is brand-agnostic,
the enhancement is applied once, behind the existing brand-routing/theming layer, so both brands benefit
without duplicated logic. If the enhancement is genuinely brand-specific (a PROJEXA-only report, a
VERIDIAN-only compliance rule), that scoping is explicit and recorded, not accidental.

## 14. Multi tenant propagation

Every enhancement to shared logic is validated against the existing multi-tenant isolation mechanism
(`withTenantContext`/RLS, independently re-confirmed live and working as recently as OCID-020's own
continuation sweep — PR #747, two real orgs, tenant-scoped `GET /api/departments` isolation confirmed)
before it ships. Propagation here means: an enhancement built and tested against one tenant's data
automatically benefits every tenant once merged, because it lives in the shared schema/logic layer, not
copied per-tenant — and the enhancement must not weaken or bypass tenant scoping to achieve that
(per AGENTS.md Rule 9's guardrail-protection requirement, this is a named guardrail, not a preference).

---

## 15. Generic component extraction

When the same enhancement is independently requested against two or more similar surfaces (two reports
needing the same new filter, two workflows needing the same new approval step), the *second* occurrence
is the trigger to extract a shared, generic component rather than duplicating the first occurrence's
one-off implementation a second time. This is the concrete mechanism by which "no parallel
implementation... is ever created" (this OCID's own prohibition) is enforced in practice: the rule is
not merely "don't duplicate," it is "the second real request for the same shape of change is the signal
to generalize the first."

## 16. Industry specific configuration

Where an enhancement is genuinely industry- or jurisdiction-specific (a country-specific statutory
field, a sector-specific compliance rule), it is implemented as configuration on top of the existing
generic mechanism, following the precedent already shipped for the IN+AE multi-country compliance-engine
abstraction (`V2-1`, PR #492) — a registry-driven abstraction, not a forked copy of the engine per
country. Industry-specific need is satisfied by adding configuration to the existing registry, not by
building a parallel engine instance.

---

## 17. Canonical artifact update

Every enhancement that changes a governance-relevant fact updates the existing canonical artifact for
that fact in place:

| Concern | Existing canonical artifact |
|---|---|
| Constitutional rules/guardrails | `ai-os/CONSTITUTION.yaml` |
| Open gaps / work items | `ai-os/MASTER-TRACKER.yaml` |
| Closed work log | `ai-os/boss/COMPLETED.yaml` |
| Active session claims | `ai-os/boss/ACTIVE-CLAIMS.yaml` |
| Governance-doc index | `ai-os/OS.yaml` |
| Cross-repo query-first index | `ai-os/MASTER_INDEX.yaml` |
| Real-code inventory | `ai-os/system-tree/` (Tree 3) |
| Evidence-based deliverable matrix / UMR chain | `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` |
| 198 extracted rules | `ai-os/RULES_ARTICLES_198.json` |
| Prompt metadata shape | `ai-os/PROMPT_METADATA_SCHEMA_2026-07-25.schema.json` |

A second, parallel artifact for any row in this table is never created; this table is itself sourced
directly from the real entries already present in `ai-os/OS.yaml`, not invented for this document.

## 18. UMR chain update

Every evolution request dispatched as a real Owner directive is registered in the existing UMR chain —
`superboss-register.sqlite`'s `umr_tasks` table, with `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` as the
existing human-readable amendment log for it (the same pattern this document itself follows, per §21a
below). No second UMR chain, ledger, or numbering scheme is created. Where a request's own citation
turns out to reference a UMR that cannot be independently verified (the honest, real precedent: OCID-040's
own document flagged `UMR-20260802-223152-0b6a` as unverifiable rather than assuming it), that
uncertainty is recorded rather than silently resolved either way.

---

## 19. Regression prevention

Regression prevention is not a new mechanism this document invents — it is the existing CI gate applied
without exception:

- **Branch protection + required PR/CI** (AGENTS.md Rule 6) — no direct push to `main`, Lint/Type
  Check/Build/Unit Tests must pass.
- **`quality-gate.sh`** — the existing quality gate, including its documented timeout-as-failed-gate
  behavior (real precedent: RCA `task-20260727-043407`), which already treats an inconclusive gate as a
  failure rather than a pass.
- **Guardrail Presence Check** (`scripts/check-guardrail-presence.mjs`) — fails the build if a named
  guardrail marker disappears; every enhancement touching a named guardrail is checked against this
  before merge.
- **Mandatory audit gate** (`.github/workflows/mandatory-audit-check.yml`, AGENTS.md Rule 10) — for any
  non-judgment-tier-trusted model's dispatch branch, an independent `AUDIT: PASS`/`FAIL` comment is
  required before merge; the implementer never self-certifies.

An enhancement is not considered regression-safe until it has passed through all of the above that apply
to it — this document does not lower or duplicate any of these gates, it requires evolution work to go
through the same ones every other change already must.

## 20. Duplication prevention

Duplication prevention is the direct output of §4's search-before-change step, made enforceable the same
way it already is in production: `superboss-register.py check-duplicate`'s `system_index` match is the
real, working mechanism (not a proposal — it has already rejected at least one real auto-fix attempt on
exactly this basis). An evolution request whose search (§4) finds an existing mechanism that already
covers it is closed with that citation, not built again. Where a duplicate has *already* been built
(the real, documented case: the OCID-026/027/028/029/030 numbering-confusion PRs each independently
existed on separate branches before the mislabeling was caught) the reconciliation step is: keep the one
with the real, correct citation; correct or retire the other's label — never let two artifacts both claim
to be canonical for the same concern.

## 21. Compatibility validation

Before an enhancement to an existing function, report, prompt, business rule, or workflow ships, every
existing caller/consumer of the artifact being changed is enumerated and checked: existing API consumers
(other routes, the AI Dev Team roster, scheduled jobs), existing UI consumers (pages/components that
render a report or call a function), and existing downstream data consumers (exports, other tenants'
saved views). A change that would break an existing caller is either made additive (new optional
parameter/field, old behavior preserved as default) or is explicitly flagged as a breaking change with
every known caller's remediation identified before merge — it is never shipped as a silent break.

## 22. End user impact analysis

Every enhancement is evaluated for real end-user impact before it ships, reusing the same lens
OCID-020's own live certification work already applies in practice: does the change alter a screen a
real user sees (per the real, documented UI/UX click-through findings already on record — e.g. the
Compliance Register crash, the CRM/ERP 403-without-explanation gap), does it change a report a real
user relies on, does it change wording/timing a real user would notice. This is not a new UX-research
function — it is the discipline of asking the question every enhancement, of applying the same honest,
evidence-based standard OCID-020's real click-through audits already hold implementation work to.

## 23. Performance validation

An enhancement to an existing function, report, or analysis is checked against the existing performance
expectations for that artifact class (the same performance-target framing OCID-027 §31–32 defines for
search/discovery) before it ships — a report enhancement that adds an expensive join is validated for
real query latency, not shipped on the assumption that "it's just one more column."

## 24. Background certification

Background certification means an enhancement's regression/duplication/compatibility/performance checks
(§19–23) run and pass **before** the enhancement is presented as done — using the CI/gate mechanisms
already named in §19, not a separate manual certification step invented for evolution work. "Background"
here describes when the checks run (automatically, as part of the existing PR/CI pipeline), not a
weaker or optional form of certification.

## 25. Release readiness

An enhancement is release-ready when: it has merged through the existing PR/CI gate (§19); its canonical
artifact (§17) and UMR chain (§18) are updated; multi-brand/tenant propagation (§13–14) has been
evaluated (not necessarily always applied, but always evaluated and the decision recorded); and, if it
touches implementation rather than documentation, the OCID-020 unlock condition (`SEC-07`) has been
independently verified satisfied. This document's own release readiness is documentation-only and is
not gated by SEC-07, per that gate's own explicit scope (implementation/gap-closure/production-change/
completion-certification work, not documentation).

## 26. Global library update

Where an enhancement produces a genuinely reusable pattern (per §15's generic-component-extraction
trigger), it is added to the existing global library/index layer — `ai-os/MASTER_INDEX.yaml` for
cross-repo query-before-building, the auto-generated function catalog (`ai-os/OS.yaml`'s own citation)
for function-level reuse — so the next request that would otherwise re-invent it finds it first via the
existing search mechanism (§4), instead of a new, separate "library" being stood up per enhancement.

## 27. Knowledge reuse

Knowledge reuse is the same discipline OCID-027 defines for discovery, applied continuously: every
enhancement's design should cite what it read and reused (an existing function, an existing prior
analysis, an existing UMR) rather than presenting a decision as if made from nothing. This document's
own §0 "search-before-write, done for real" section is itself an instance of this principle, not a
one-off courtesy.

## 28. Long term maintainability

Long-term maintainability is served directly by §1's "enhance before create" and §15's generic-extraction
trigger: a platform where the second similar request is generalized rather than duplicated accumulates
fewer, more general components over time rather than more, narrower ones. No separate maintainability
metric or process is introduced beyond consistently applying those two rules.

## 29. Technical debt reduction

Technical debt reduction is not a separate initiative under this runtime — it is the natural output of
never allowing a duplicate to persist once found (§20) and of extracting a generic component on the
second similar request (§15) instead of a third or fourth. Where an enhancement request's search (§4)
surfaces an existing duplicate or drift (the real, demonstrated pattern: PR #776's OCID-numbering
correction, or WAVE-198's "6 duplicate drizzle migration number prefixes renumbered"), resolving that
drift is treated as in-scope for the enhancement, not deferred to a separate cleanup task, when the fix
is small; when it is large, it is registered in `ai-os/MASTER-TRACKER.yaml` as its own `open_items`
entry (per that file's own existing `deferred_large` status) rather than silently left unaddressed.

## 30. Platform health

Platform health is measured using the mechanisms already live for it: CI status (Lint/Type Check/Build/
Unit Tests, per Rule 6), the Guardrail Presence Check (Rule 9), the mandatory audit gate (Rule 10), and
`ai-os/MASTER-TRACKER.yaml`'s own open-item count and age. No new health-scoring system is introduced;
continuous evolution work is expected to leave these existing signals the same or better after each
change, never worse.

## 31. Platform governance

Platform governance for evolution work is `ai-os/CONSTITUTION.yaml` (supreme, per its own
`amendment_rule`) plus `AGENTS.md`'s eleven Operating Rules, applied to evolution requests exactly as
they already apply to every other kind of change in this repo: Rule 6 (PR/CI gate), Rule 7 (independent
doer/auditor split for Study-derived implementation work), Rule 9 (guardrail protection), Rule 10
(complexity-tier dispatch gating + mandatory audit), and Rule 11 (ACTIVE-CLAIMS registration before
starting). This document adds no new governance body, committee, or approval layer.

## 32. Evolution metrics

Evolution work is measured using data already produced by existing mechanisms, not a new metrics
pipeline: count and age of `open_items` in `ai-os/MASTER-TRACKER.yaml` (backlog health); count of
entries moved to `ai-os/boss/COMPLETED.yaml` per period (throughput); count of `AUDIT: FAIL` vs.
`AUDIT: PASS` verdicts under Rule 10's mandatory-audit gate (quality); count of real, confirmed
duplicates caught by `superboss-register.py check-duplicate` before being built (duplication-prevention
effectiveness, §20). These are read off existing files/logs, not collected via a new instrumentation
layer.

---

## 33. Zero duplication certification

This document certifies, for itself only: it performed the real search described in §0 and §4, found no
existing "continuous platform evolution governance" document or mechanism under any name in this repo,
and explicitly scoped its own content against the one real adjacent document found (OCID-027, PR #771)
rather than restating it. It does **not** certify zero duplication for the platform as a whole — that
is an ongoing property maintained by consistently applying §4/§20 to every future request, not a
one-time state this document can declare true forever.

## 34. Zero regression certification

This document is documentation-only and therefore has no runtime behavior to regress. It does **not**
certify that the platform as a whole is regression-free — that certification is explicitly deferred,
per `SEC-07`, to OCID-039 (real production certification) after OCID-020 and OCID-038 complete, in that
order. This document defines the regression-prevention *mechanism* future evolution work must use
(§19); it does not itself perform that certification for any implementation.

## 35. Readiness for OCID-036

This document is ready to hand off to whichever real content OCID-036 turns out to carry. Per the
already-recorded, real correction in `ai-os/VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md` §1
(row OCID-20260803-036), that document's own original row mislabeled OCID-036's content — the real
distinct mission text for OCID-036 was not re-derived there, to avoid compounding the numbering error
with a second guess, and the same caution applies here: this document does not assume what OCID-036
covers. It does establish, as the one input OCID-036 can safely build on regardless of its own real
content: the canonical-artifact table (§17), the UMR-chain-update rule (§18), and the search-before-
change discipline (§4, deferring to OCID-027) that any next document in this chain should reuse rather
than re-derive.

---

## 36. Executive summary

VERIDIAN already has every piece this document names: a working PR/CI gate, a working guardrail-presence
check, a working mandatory-audit gate, a working duplicate-detection mechanism
(`superboss-register.py check-duplicate`), a working multi-tenant isolation layer, a working cross-repo
query-first index (`MASTER_INDEX.yaml`), a working real-code inventory (`system-tree/`), and a single
evidence-based deliverable matrix / UMR chain (`IMPLEMENTATION_MATRIX_2026-08-02.md`). Continuous
platform evolution is not a new system built on top of these — it is the discipline of routing every
future enhancement request through them, in this order: capture (§2) → classify (§3) → search (§4,
deferring to OCID-027 for mechanics) → enhance the existing artifact in place (§5–12) → evaluate
brand/tenant propagation and generic extraction (§13–15) → update the one canonical artifact and the one
UMR chain (§17–18) → pass the existing regression/duplication/compatibility/performance gates (§19–24)
→ confirm release readiness (§25). Zero new architecture, zero new database objects, zero parallel
implementation are introduced by this document, consistent with its own prohibition and with the real,
still-open OCID-020 implementation lock (`SEC-07`) that continues to permit exactly this kind of
discovery-and-documentation work while gating all real implementation behind OCID-020's independent
verification.

**Canonical artifact created:** this file,
`ai-os/VERIDIAN_CONTINUOUS_PLATFORM_EVOLUTION_RUNTIME_2026-08-03.md`.

**UMR chain updated (not a new one):** `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`, via the amendment
appended immediately below this document's own commit — see that file's own "Amendment (2026-08-03):
OCID-035" section.

**Ready for hand-off to OCID-036:** yes, per §35 above.
