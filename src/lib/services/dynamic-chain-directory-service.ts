// Wave 171 (tree4-unified/50-completion-plan area 1, U-D6): the Dynamic
// Chain Master Directory's "intelligent search/recommendation, missing-
// chain detection, version control" requirement (U-D6.B2.S1) -- confirmed
// absent before this wave (dynamic_chains only had a find-or-create
// resolver, task-service.ts's resolveDynamicChainId, reused here verbatim
// per that function's own established convention, never duplicated).
//
// Deterministic only, no LLM call -- matches this codebase's guardrail
// design discipline everywhere else (see ai-reply-gate.ts's header for why
// no LLM self-certification exists anywhere in this codebase).
import { after } from "next/server"
import { dynamicChains, entityRelationships, approvalRequests } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { eq, and } from "drizzle-orm"
import { indexCapability, buildCapabilityContent, findSimilarDynamicChains, type CapabilityMatch } from "./capability-registry-service"

export type ChainSearchResult = {
  id: string
  modePill: string
  pathLabels: unknown
  description: string | null
  score: number
}

/**
 * Keyword search across modePill/pathLabels/description -- a real but
 * intentionally simple relevance score (exact modePill match weighted
 * highest, then substring hits in path labels, then description),
 * consistent with this codebase's "deterministic first" bias rather than
 * reaching for embeddings for what a straightforward text match already
 * serves adequately.
 */
export async function searchChains(orgId: string, query: string, limit = 10): Promise<ChainSearchResult[]> {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return []
  return withTenantContext({ orgId }, async (db) => {
    const candidates = await db.query.dynamicChains.findMany({
      where: and(eq(dynamicChains.orgId, orgId), eq(dynamicChains.status, "approved")),
    })
    const scored = candidates
      .map((c) => {
        let score = 0
        if (c.modePill.toLowerCase() === normalized) score += 10
        else if (c.modePill.toLowerCase().includes(normalized)) score += 5
        const labels = Array.isArray(c.pathLabels) ? (c.pathLabels as unknown[]).map((l) => String(l).toLowerCase()) : []
        if (labels.some((l) => l.includes(normalized))) score += 4
        if (c.description?.toLowerCase().includes(normalized)) score += 2
        return { id: c.id, modePill: c.modePill, pathLabels: c.pathLabels, description: c.description, score }
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
    return scored.slice(0, limit)
  })
}

export type MissingChainCheckResult =
  | { exists: true; chainId: string }
  | { exists: false; nearMatches: ChainSearchResult[]; likelyMissing: boolean }

/**
 * Checks whether an exact (modePill, pathKeys) chain exists -- same
 * dedup key task-service.ts's resolveDynamicChainId uses. If not, looks
 * for near-matches (same modePill, any path-label overlap) to distinguish
 * "this chain genuinely doesn't exist yet" from "the caller is one step
 * off from an existing chain" -- likelyMissing is true only when there are
 * zero near-matches, i.e. this modePill has no chains resembling the
 * requested path at all.
 */
export async function detectMissingChain(orgId: string, modePill: string, pathKeys: unknown[]): Promise<MissingChainCheckResult> {
  return withTenantContext({ orgId }, async (db) => {
    const pathKeysJson = JSON.stringify(pathKeys)
    const exact = await db.query.dynamicChains.findFirst({
      where: and(
        eq(dynamicChains.orgId, orgId),
        eq(dynamicChains.modePill, modePill),
        eq(dynamicChains.status, "approved"),
      ),
    })
    if (exact && JSON.stringify(exact.pathKeys) === pathKeysJson) {
      return { exists: true as const, chainId: exact.id }
    }

    const sameModePill = await db.query.dynamicChains.findMany({
      where: and(eq(dynamicChains.orgId, orgId), eq(dynamicChains.modePill, modePill), eq(dynamicChains.status, "approved")),
    })
    const nearMatches: ChainSearchResult[] = sameModePill
      .map((c) => {
        const keys = Array.isArray(c.pathKeys) ? (c.pathKeys as unknown[]) : []
        const overlap = keys.filter((k) => pathKeys.includes(k)).length
        return { id: c.id, modePill: c.modePill, pathLabels: c.pathLabels, description: c.description, score: overlap }
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)

    return { exists: false as const, nearMatches, likelyMissing: nearMatches.length === 0 }
  })
}

export type CreateChainVersionResult =
  | { created: true; newChainId: string; version: number }
  | { created: false; reason: "not_found" }

/**
 * Creates a new version of an existing chain, linking previousVersionId
 * and marking the old row 'retired' (the existing status enum already has
 * this value -- reused, not extended). The new row inherits every field
 * from the previous version except the ones explicitly overridden.
 *
 * GAP-DCMD, 3rd real entity_relationships graph edge for chains (after
 * Priority 9's dynamic_chain -> approval_workflow_instance and Priority
 * 10's dynamic_chain -> worker_agent): dynamic_chain -> dynamic_chain,
 * relationshipType 'supersedes'. previousVersionId (Wave 171) already
 * carries this exact fact as a denormalized FK-shaped column, but this
 * is the only real chokepoint that ever writes it -- every version of
 * every chain is created here, never anywhere else (task-service.ts's
 * resolveDynamicChainId only find-or-creates version-1 rows) -- so it's
 * the same "genuine chokepoint already exercised by production code"
 * bar the first two edges used, not a contrived one. Non-blocking: a
 * failure here must never break chain versioning itself, same posture
 * as approval-workflow-service.ts/task-execution-engine.ts's own edge
 * writers.
 */
export async function createChainVersion(
  orgId: string,
  userId: string,
  existingChainId: string,
  updates: Partial<{
    description: string; moduleRef: string; linkedModuleRefs: unknown[]; businessRules: unknown; permissions: unknown; workflowRef: string; aiBehaviorRef: string; reportsKpisSlas: unknown
    // Fix (PR #329, follow-up to Priority 14's GAP-DCMD rich-schema slice,
    // which noticed but deliberately deferred this): these 4 pre-existing
    // dynamic_chains fields were missing from the copy-forward set above,
    // so every new chain version silently reset them to null/default
    // instead of carrying forward from the version being superseded.
    linkedApprovalWorkflowIds: unknown[]; governanceNotes: string; deprecationReason: string; monitoringRules: unknown
    // Priority 14 (GAP-DCMD rich schema slice): the 7 new dynamic_chains
    // columns added this pass are threaded through the same partial-update/
    // copy-forward shape as the pre-existing rich-metadata fields above, so
    // they survive a version bump instead of silently reverting to null
    // (see ai-os/DCMD-SCHEMA-DESIGN.md for the full per-field reasoning).
    classification: unknown; ownerDepartmentId: string; inputContract: unknown; outputContract: unknown; aiConfig: unknown; workflowStepsConfig: unknown; linkedKnowledgeBasePageIds: unknown[]
  }>
): Promise<CreateChainVersionResult> {
  return withTenantContext({ orgId, userId }, async (db) => {
    const existing = await db.query.dynamicChains.findFirst({ where: and(eq(dynamicChains.id, existingChainId), eq(dynamicChains.orgId, orgId)) })
    if (!existing) return { created: false as const, reason: "not_found" as const }

    const nextVersion = existing.version + 1
    const [created] = await db.insert(dynamicChains).values({
      orgId,
      modePill: existing.modePill,
      pathKeys: existing.pathKeys,
      pathLabels: existing.pathLabels,
      moduleRef: updates.moduleRef ?? existing.moduleRef,
      description: updates.description ?? existing.description,
      createdById: userId,
      status: "approved",
      linkedModuleRefs: updates.linkedModuleRefs ?? existing.linkedModuleRefs,
      businessRules: updates.businessRules ?? existing.businessRules,
      permissions: updates.permissions ?? existing.permissions,
      workflowRef: updates.workflowRef ?? existing.workflowRef,
      aiBehaviorRef: updates.aiBehaviorRef ?? existing.aiBehaviorRef,
      reportsKpisSlas: updates.reportsKpisSlas ?? existing.reportsKpisSlas,
      // Fix (PR #329, follow-up to Priority 14's GAP-DCMD rich-schema slice,
      // which noticed but deliberately deferred this): these 4 pre-existing
      // dynamic_chains fields were missing from the copy-forward set above,
      // so every new chain version silently reset them to null/default
      // instead of carrying forward from the version being superseded.
      linkedApprovalWorkflowIds: updates.linkedApprovalWorkflowIds ?? existing.linkedApprovalWorkflowIds,
      governanceNotes: updates.governanceNotes ?? existing.governanceNotes,
      deprecationReason: updates.deprecationReason ?? existing.deprecationReason,
      monitoringRules: updates.monitoringRules ?? existing.monitoringRules,
      // Priority 14 (GAP-DCMD rich schema slice) -- copy-forward for the 7
      // new columns, same ?? existing.<field> pattern as every field above.
      classification: updates.classification ?? existing.classification,
      ownerDepartmentId: updates.ownerDepartmentId ?? existing.ownerDepartmentId,
      inputContract: updates.inputContract ?? existing.inputContract,
      outputContract: updates.outputContract ?? existing.outputContract,
      aiConfig: updates.aiConfig ?? existing.aiConfig,
      workflowStepsConfig: updates.workflowStepsConfig ?? existing.workflowStepsConfig,
      linkedKnowledgeBasePageIds: updates.linkedKnowledgeBasePageIds ?? existing.linkedKnowledgeBasePageIds,
      version: nextVersion,
      previousVersionId: existing.id,
    }).returning()

    await db.update(dynamicChains).set({ status: "retired", updatedAt: new Date() }).where(eq(dynamicChains.id, existing.id))

    try {
      await db.insert(entityRelationships).values({
        orgId,
        sourceType: "dynamic_chain",
        sourceId: created!.id,
        targetType: "dynamic_chain",
        targetId: existing.id,
        relationshipType: "supersedes",
        metadata: { newVersion: nextVersion, previousVersion: existing.version },
      })
    } catch (err) {
      console.error(`[dynamic-chain-directory-service] Failed to record dynamic_chain->dynamic_chain graph edge for chain ${existingChainId} -> ${created!.id}:`, err)
    }

    return { created: true as const, newChainId: created!.id, version: nextVersion }
  })
}

/** Walks previousVersionId back to the first version, oldest first. */
export async function getChainVersionHistory(orgId: string, chainId: string) {
  return withTenantContext({ orgId }, async (db) => {
    const history: (typeof dynamicChains.$inferSelect)[] = []
    let currentId: string | null = chainId
    const seen = new Set<string>()
    while (currentId && !seen.has(currentId)) {
      seen.add(currentId)
      const row = await db.query.dynamicChains.findFirst({ where: and(eq(dynamicChains.id, currentId), eq(dynamicChains.orgId, orgId)) })
      if (!row) break
      history.unshift(row)
      currentId = row.previousVersionId
    }
    return history
  })
}

// DMP-04 gap closure (CONSTITUTION.yaml): "FDE proposes a single
// workerAgents row, not a full Dynamic Chain bundle (module/rules/
// permissions/workflow/KPIs)". fde-service.ts's submitFdeRequest() already
// drafts a new Worker Agent via proposeWorkerAgent() on a genuine no-match --
// this is the second half of that same proposal: a dynamicChains row that
// actually carries the module/rules/permissions/workflow/KPI scaffolding
// Wave 171/173 already added columns for (linkedModuleRefs/businessRules/
// permissions/workflowStepsConfig/reportsKpisSlas) but no real proposal path
// had ever populated. Pure builder, extracted the same way
// resolveDomainGroupKey()/validateChainDepth()/markDeterministic() are
// elsewhere in this codebase -- directly unit-testable without a DB.
export type DynamicChainProposalInput = {
  moduleRef?: string | null
  domain?: string | null
  businessRules?: string[]
  permissions?: string[]
  workflowSteps?: string[]
  kpis?: { label: string; target?: string }[]
  // Used only when the LLM/caller supplied no permissions at all -- a
  // proposed chain never ships with zero permission gate, it falls back to
  // the same tier-derived role fde-service.ts already computes for the
  // sibling worker-agent proposal (see proposeWorkerAgent's own
  // customer/client-requires-admin gating).
  fallbackPermissionRole: string
}

export type DynamicChainProposalFields = {
  linkedModuleRefs: string[]
  businessRules: { rules: string[] } | null
  permissions: { requiredRoles: string[] }
  workflowStepsConfig: { steps: string[] } | null
  reportsKpisSlas: { kpis: { label: string; target?: string }[] } | null
  classification: { domain: string | null }
}

export function buildDynamicChainProposalFields(input: DynamicChainProposalInput): DynamicChainProposalFields {
  const linkedModuleRefs = input.moduleRef?.trim() ? [input.moduleRef.trim()] : []
  const rules = (input.businessRules ?? []).map((r) => r.trim()).filter(Boolean)
  const roles = (input.permissions ?? []).map((r) => r.trim()).filter(Boolean)
  const steps = (input.workflowSteps ?? []).map((s) => s.trim()).filter(Boolean)
  const kpis = (input.kpis ?? []).filter((k) => k?.label?.trim())

  return {
    linkedModuleRefs,
    businessRules: rules.length ? { rules } : null,
    permissions: { requiredRoles: roles.length ? roles : [input.fallbackPermissionRole] },
    workflowStepsConfig: steps.length ? { steps } : null,
    reportsKpisSlas: kpis.length ? { kpis } : null,
    classification: { domain: input.domain?.trim() || null },
  }
}

// DMP-06 gap closure (CONSTITUTION.yaml): the same "is this actually the
// same thing" bar auditDuplicateCapabilities() already uses for its own
// admin-facing duplicate audit (0.92), reused here rather than inventing a
// third threshold value. Deliberately looser than fde-service.ts's
// HIGH_CONFIDENCE_THRESHOLD (0.95) -- that one gates a different, higher-
// stakes question (skip the LLM and auto-dispatch a worker agent), this one
// only gates "reuse an existing chain instead of proposing a new one".
const DYNAMIC_CHAIN_DUPLICATE_THRESHOLD = 0.92

/** Pure decision function, unit-testable without a DB: the top candidate if it clears the duplicate bar, else null. */
export function selectDuplicateChainMatch(candidates: CapabilityMatch[], threshold = DYNAMIC_CHAIN_DUPLICATE_THRESHOLD): CapabilityMatch | null {
  const top = candidates[0]
  return top && top.score >= threshold ? top : null
}

export type ChainModuleEdge = {
  orgId: string
  sourceType: "dynamic_chain"
  sourceId: string
  targetType: "module"
  targetId: string
  relationshipType: "requires_module"
}

/**
 * Pure builder, unit-testable without a DB: one dynamic_chain->module
 * entity_relationships row per distinct linkedModuleRefs entry. moduleRef/
 * linkedModuleRefs are "FK-shaped ref, unenforced" (same posture as
 * ownerDepartmentId) -- this writes the edge against whatever value is
 * already there, it does not validate the ref against module_registry
 * itself, matching every other best-effort edge writer in this file.
 */
export function buildChainModuleEdges(orgId: string, chainId: string, moduleRefs: string[]): ChainModuleEdge[] {
  const unique = Array.from(new Set(moduleRefs.map((ref) => ref?.trim()).filter((ref): ref is string => Boolean(ref))))
  return unique.map((moduleKey) => ({
    orgId,
    sourceType: "dynamic_chain" as const,
    sourceId: chainId,
    targetType: "module" as const,
    targetId: moduleKey,
    relationshipType: "requires_module" as const,
  }))
}

/**
 * Creates the proposed Dynamic Chain bundle for a VERI FDE no-match
 * request, alongside (never instead of) the existing proposeWorkerAgent()
 * proposal -- called from fde-service.ts's submitFdeRequest() with the
 * newly-created workerAgentId already in hand. Status is 'proposed', the
 * same non-'approved' state createChainVersion()/task-service.ts's
 * resolveDynamicChainId() reserve for rows that must not be
 * discoverable/dispatchable yet -- searchChains()/detectMissingChain() both
 * filter on status='approved', so this bundle stays invisible to normal
 * chain-selector traversal until a human approves it via the same
 * approvalRequests maker-checker gate worker_agent_proposal already uses
 * (see src/app/api/approvals/[id]/route.ts). This is additive scaffolding,
 * not a bypass of AUTH-02/HAB-01 -- nothing here ever sets status to
 * 'approved' itself.
 *
 * DMP-06 gap closure (CONSTITUTION.yaml, "Dynamic Chain Master Directory"):
 * BEFORE creating anything, checks findSimilarDynamicChains() for a
 * high-confidence near-duplicate -- the same zero-duplication question
 * findSimilarCapabilities() already answers for worker agents/modules/
 * automation rules, now asked for dynamic chains specifically. A duplicate
 * hit short-circuits with the existing chain's id and writes nothing new
 * (no chain, no approval request, no graph edges) -- there's nothing to
 * link, the caller should reuse what's already there.
 */
export type ProposeDynamicChainResult =
  | { created: true; id: string; status: string; approvalRequestId: string; createdAt: string; matchedExisting: false }
  | { created: false; id: string; status: string; matchedExisting: true; score: number }

export async function proposeDynamicChain(
  ctx: { orgId: string; userId: string },
  input: {
    workerAgentId: string
    name: string
    domain?: string | null
    description?: string | null
    moduleRef?: string | null
    businessRules?: string[]
    permissions?: string[]
    workflowSteps?: string[]
    kpis?: { label: string; target?: string }[]
    fallbackPermissionRole: string
  }
): Promise<ProposeDynamicChainResult> {
  const modePill = input.name
  const pathLabels = [input.domain, input.name].filter((v): v is string => Boolean(v?.trim()))
  const pathKeys = pathLabels.map((l) => l.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""))
  const domainLabel = pathLabels.join(" > ") || null
  const fields = buildDynamicChainProposalFields({
    moduleRef: input.moduleRef,
    domain: domainLabel,
    businessRules: input.businessRules,
    permissions: input.permissions,
    workflowSteps: input.workflowSteps,
    kpis: input.kpis,
    fallbackPermissionRole: input.fallbackPermissionRole,
  })

  const candidates = await findSimilarDynamicChains(ctx.orgId, input.description ?? modePill, domainLabel)
  const duplicate = selectDuplicateChainMatch(candidates)
  if (duplicate) {
    return { created: false as const, id: duplicate.entityId, status: "existing", matchedExisting: true as const, score: duplicate.score }
  }

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [chain] = await db.insert(dynamicChains).values({
      orgId: ctx.orgId,
      modePill,
      pathKeys,
      pathLabels,
      moduleRef: input.moduleRef?.trim() || null,
      description: input.description?.trim() || null,
      createdById: ctx.userId,
      status: "proposed",
      linkedModuleRefs: fields.linkedModuleRefs,
      businessRules: fields.businessRules,
      permissions: fields.permissions,
      workflowStepsConfig: fields.workflowStepsConfig,
      reportsKpisSlas: fields.reportsKpisSlas,
      classification: fields.classification,
    }).returning()

    // Indexed immediately (same fire-and-forget-via-after() posture as
    // proposeWorkerAgent()/resolveDynamicChainId()) so VERI FDE's own
    // dedup search sees this pending proposal and doesn't suggest a
    // duplicate of something already awaiting approval.
    after(() => indexCapability(
      "dynamic_chain", chain!.id,
      buildCapabilityContent({ name: modePill, domain: fields.classification.domain, description: input.description }),
      ctx.orgId
    ).catch((err) => console.error(`Failed to index proposed dynamic chain ${chain!.id}:`, err)))

    const [approval] = await db.insert(approvalRequests).values({
      requestType: "dynamic_chain_proposal",
      entityType: "dynamic_chains",
      entityId: chain!.id,
      description: `Propose full Dynamic Chain bundle for "${modePill}" (module + rules + permissions + workflow + KPIs)`,
      requestedById: ctx.userId,
      orgId: ctx.orgId,
    }).returning()

    // Best-effort graph edge linking this proposal back to its sibling
    // worker-agent proposal -- same non-blocking posture as
    // createChainVersion()'s own entity_relationships write below.
    try {
      await db.insert(entityRelationships).values({
        orgId: ctx.orgId,
        sourceType: "dynamic_chain",
        sourceId: chain!.id,
        targetType: "worker_agent",
        targetId: input.workerAgentId,
        relationshipType: "proposed_with",
        metadata: { approvalRequestId: approval!.id },
      })
    } catch (err) {
      console.error(`[dynamic-chain-directory-service] Failed to record dynamic_chain->worker_agent proposal edge for chain ${chain!.id} -> agent ${input.workerAgentId}:`, err)
    }

    // DMP-06 gap closure: the module half of the DCMD graph -- one
    // dynamic_chain->module edge per linkedModuleRefs entry, same
    // best-effort/non-blocking posture as the worker-agent edge above.
    // Permission-set edges are deliberately NOT written -- there is no
    // permission_sets entity anywhere in schema.ts to point at; this
    // chain's required roles live only in its own `permissions` jsonb
    // column, same posture as businessRules/workflowStepsConfig never
    // getting a graph edge either.
    const moduleEdges = buildChainModuleEdges(ctx.orgId, chain!.id, fields.linkedModuleRefs)
    if (moduleEdges.length > 0) {
      try {
        await db.insert(entityRelationships).values(moduleEdges)
      } catch (err) {
        console.error(`[dynamic-chain-directory-service] Failed to record dynamic_chain->module graph edge(s) for chain ${chain!.id}:`, err)
      }
    }

    return {
      created: true as const,
      id: chain!.id,
      status: chain!.status,
      approvalRequestId: approval!.id,
      createdAt: chain!.createdAt.toISOString(),
      matchedExisting: false as const,
    }
  })
}
