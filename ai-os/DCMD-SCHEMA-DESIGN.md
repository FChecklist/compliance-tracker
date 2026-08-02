# DCMD Rich Schema Design (Priority 14, GAP-DCMD)

> **Status:** design + additive migration for this pass. See
> `ai-os/MASTER-TRACKER.yaml`'s GAP-DCMD entry for the full closure history
> this builds on (Priorities 9/10/14 already shipped 3 real
> `entity_relationships` graph edges + `linkedApprovalWorkflowIds` /
> `governanceNotes` / `deprecationReason` columns).

## What this covers

The source doc (`VERIDIAN_DMP_DCF_CONSTITUTION.md`, echoed in
`ai-os/audit-tree/archive/GAPS.yaml` G-016) names a "full 10-sub-object
chain definition" with 9 explicitly named axes: **business,
classification, inputs, outputs, software, AI, workflow, governance,
knowledge**. `governance` already has a real (if thin) start via
`governanceNotes` (Priority 9) -- out of scope for this pass. This
document designs the remaining 8.

**Correction to the brief this task started from:** `businessRules`,
`workflowRef`, `aiBehaviorRef`, `permissions`, and `linkedModuleRefs`
already exist as columns on `dynamic_chains` (Wave 171) and are thin,
honest prior starts on `business`, `workflow`, `AI`, and `software`
respectively -- not nothing, but not the source doc's "rich" schema
either. Confirmed live in code (grepped every write site): every one of
them is writable ONLY through `POST /api/dynamic-chains/[id]/versions`
request body (an admin manually typing a value in) -- zero automatic
derivation, zero chokepoint, same class of "schema exists, nothing
populates it automatically" as `governanceNotes` before this pass. This
document is honest about that rather than silently treating them as
already-closed.

## Decision principle (per the source doc's own preference, and MASTER-TRACKER's note)

A sub-field becomes a **graph edge** in `entity_relationships` when (a) it
points at another already-modeled, independently-queryable entity table,
AND (b) a real, already-exercised code chokepoint exists (or is being
built this pass) that naturally knows both sides of the edge at write
time -- mirroring the 3 existing DCMD edges (`approval_workflow_instance`,
`worker_agent`, `dynamic_chain`), all of which ride an execution or
versioning chokepoint that already runs today.

A sub-field stays a **column** (text/jsonb) when it is either (a) purely
descriptive metadata of the chain itself with no other entity to point
at, or (b) a reference to another entity but with no real multi-valued
graph-shaped access pattern and no chokepoint that writes it automatically
yet -- same category `moduleRef`/`workflowRef`/`aiBehaviorRef` already
established as acceptable in Wave 171/173, and the same zero rows,
forward-only, do-not-fabricate-a-write discipline used throughout
GAP-DCMD's prior closures.

## Per-sub-field decisions

### 1. classification -- COLUMN, partially wired this pass

New nullable `classification` jsonb column: domain, chainType, riskTier,
dataSensitivity, complianceDomain (all optional keys). Purely descriptive
taxonomy metadata -- no other entity table models "chain classification"
as a first-class row, so a graph edge would have nothing real to point
at.

**Real wiring, not schema-only**: `task-service.ts`'s
`resolveDynamicChainId()` -- the sole chain-creation chokepoint -- already
computes a `domain` string (`pathLabels.join(" > ")`) at chain-creation
time to feed `capability-registry-service.ts`'s `buildCapabilityContent()`
for embedding indexing (Wave 173, GAP-DYNAMIC-CHAIN-DEDUP). This pass
reuses that exact, already-computed value to populate
`classification.domain` on the same insert -- genuine reuse of a value
the chokepoint already derives, not a new fabricated computation. The
other four sub-keys (chainType, riskTier, dataSensitivity,
complianceDomain) have no natural automatic derivation found this pass
-- left null, settable via the existing versions API, same honest
schema-only status as the pre-existing thin fields.

### 2. business -- COLUMN, schema-only

New nullable `ownerDepartmentId` text column, FK-shaped (not a DB FK
constraint, matching this codebase's established convention of unenforced
text refs -- e.g. `moduleRef`) against the real, pre-existing
`departments` table. A graph edge was considered (dynamic_chain to
department, relationshipType owned_by) since `departments` is a real
first-class entity -- but investigated and found no real chokepoint:
nothing in this codebase currently assigns a department to a chain at any
point (no Chain Selector step, no admin flow, no task-creation-time
inference). A graph edge with nothing to write it would be exactly the
invent-a-fake-chokepoint anti-pattern the task brief warns against, so
this stays a single nullable column, schema-only, settable via the
existing versions API -- same status as `businessRules` today.

### 3. inputs -- COLUMN, schema-only

New nullable `inputContract` jsonb column (expected shape: optional
requiredFields string array plus an optional sourceHint string --
deliberately unopinionated; no real consumer to derive a stricter shape
from yet). Considered deriving this from a resolved CapabilityNode leaf's
fixedInputs at `resolveDynamicChainId()`, but that value isn't available
at this chokepoint's call sites (`task-service.ts` createTask /
`chat-service.ts` resolve modePill/pathKeys/pathLabels only, not the
leaf's fixedInputs) -- threading it through would mean touching call
sites well beyond this pass's scope for a field nothing reads yet.
Schema-only, honest.

### 4. outputs -- COLUMN, schema-only

New nullable `outputContract` jsonb column. Deliberately distinct from
the pre-existing `reportsKpisSlas` column (which is about downstream
reporting cadence and KPI targets, not the raw output data shape a chain
produces). Same reasoning as inputs above -- no real chokepoint currently
knows a chain's output shape at any write time. Schema-only.

### 5. software -- NO NEW COLUMN, existing field re-scoped

`linkedModuleRefs` (Wave 171, jsonb string array of module_registry.id
refs) already IS this sub-field's column -- `module_registry` is exactly
"software" (VERIDIAN's own module/tool catalog, the toolType axis already
distinguishes data_access/calculation/validation/reporting/
orchestration). Adding a second, differently-named column for the same
concept would be pure duplication. This document formally designates
`linkedModuleRefs` as the software sub-field's home and does not touch
its schema. Status unchanged from Wave 171: schema-only, no automatic
chokepoint (confirmed live -- only written via the versions API body,
never derived). A real chokepoint was investigated this pass
(task_execution_plan / task_agent_executions, the tables backing the
existing worker_agent graph edge) -- neither carries an engineKey or
module reference, so there's nothing to read at that chokepoint either.
Left honestly schema-only, not forced.

### 6. AI -- COLUMN, schema-only, generalizes existing field

New nullable `aiConfig` jsonb column: optional modelTier,
requiresHumanApproval boolean, confidenceThreshold number. Generalizes
the pre-existing single-value `aiBehaviorRef` text column the same way
Wave 171's `linkedModuleRefs` generalized `moduleRef` (`moduleRef` kept
for backward compat, `linkedModuleRefs` added for the many-value case) --
`aiBehaviorRef` is kept unchanged, `aiConfig` is additive. No chokepoint
currently reads or writes either field automatically; schema-only, same
status as its sibling.

### 7. workflow -- COLUMN, schema-only, generalizes existing field

New nullable `workflowStepsConfig` jsonb column (step sequence, SLA,
escalation shape). A graph edge to `approval_workflow_definitions` was
considered (a real entity table exists) but investigated and ruled out:
`approval-workflow-service.ts`'s `startApprovalWorkflow()` resolves a
workflow definition by org plus entityType tasks, org-wide, not
per-chain -- there is no chokepoint that selects a specific workflow
definition for a specific chain, so a dynamic_chain to
approval_workflow_definition edge would have no real writer. Stays a
column generalizing `workflowRef` (kept, backward compat), schema-only.

### 8. knowledge -- COLUMN, schema-only

New nullable `linkedKnowledgeBasePageIds` jsonb column (string array of
knowledge_base_pages.id), same denormalized-index shape as
`linkedApprovalWorkflowIds`. `knowledge_base_pages` is a real, independent
entity table (SOPs and docs), but no chokepoint anywhere in this codebase
currently associates a specific KB page with a specific chain (no
attach-documentation step exists in the Chain Selector or chain-creation
flow) -- investigated and confirmed absent, not assumed. Schema-only,
honestly documented, same zero-rows-nothing-to-backfill posture as every
other forward-only DCMD field.

## Summary table

| Sub-field | Storage | This pass | Real chokepoint? |
|---|---|---|---|
| business | column (ownerDepartmentId) | new | no -- schema-only |
| classification | column (classification jsonb) | new | yes -- domain populated at chain-creation from an already-computed value |
| inputs | column (inputContract jsonb) | new | no -- schema-only |
| outputs | column (outputContract jsonb) | new | no -- schema-only |
| software | column (linkedModuleRefs, pre-existing) | re-scoped, not new | no -- schema-only (unchanged) |
| AI | column (aiConfig jsonb) | new | no -- schema-only |
| workflow | column (workflowStepsConfig jsonb) | new | no -- schema-only |
| governance | column (governanceNotes, pre-existing) | out of scope this pass | n/a (Priority 9) |
| knowledge | column (linkedKnowledgeBasePageIds jsonb) | new | no -- schema-only |

No new `entity_relationships` edge types are added this pass -- every
candidate graph edge investigated (dynamic_chain to department,
dynamic_chain to approval_workflow_definition, dynamic_chain to
knowledge_base_page) was ruled out for the same reason: no real,
already-exercised chokepoint exists to write it, and inventing one to
have "something to wire" would be exactly the anti-pattern this whole
GAP-DCMD closure history has deliberately avoided (see MASTER-TRACKER's
own dynamic_chain-to-conversation and worker_agent-to-capability
rule-outs). All six genuinely new columns plus classification are added
to `createChainVersion()`'s copy-forward logic (the one real chokepoint
that clones dynamic_chains fields across a version bump) so they survive
chain versioning the same way the six pre-existing rich-metadata fields
already do.

## Known pre-existing gap noticed in passing (not fixed this pass)

`createChainVersion()`'s insert does not copy forward
linkedApprovalWorkflowIds, governanceNotes, deprecationReason, or
monitoringRules from the previous version -- confirmed by direct code
read of `dynamic-chain-directory-service.ts`. This predates this pass
(Wave 173/Priority 9) and is a real, narrow bug (a new chain version
silently loses these four fields), but is out of scope for this GAP-DCMD
rich-schema slice -- flagged separately, not silently fixed as a
drive-by inside an unrelated PR.
