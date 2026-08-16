// Priority 12 (OPEN-07 point 1, GAP-FDE-CHAIN-INTAKE-SPLIT): VERI FDE
// (capability-registry-service.ts -- an embeddings-vector index over
// worker_agent/automation_rule/module/prompt_pattern/dynamic_chain entities)
// and Dynamic-Chain/Chat (capability-learning-service.ts -- task_capabilities'
// capabilityKey + rolling FULL_SOFTWARE/PACKAGE_AVAILABLE/NOVEL counters)
// were built in adjacent priorities (Wave 42/43 vs. Priority 5) and never
// talked to each other, even though both catalogs exist to answer the exact
// same question: "has the platform already learned how to handle this?"
// Deliberately NOT a rebuild or merge of either catalog (Owner's own
// "don't duplicate, don't recreate" instruction, restated throughout this
// tracker) -- this file is the narrowest real link between them.
//
// Why a lookup function, not a shared table/column: both catalogs already
// dedup a Dynamic Chain on the exact same (modePill, pathKeys) pair, just
// into two different tables --
//   - dynamicChains rows get indexed into embeddings under entityType
//     "dynamic_chain" (task-service.ts's resolveDynamicChainId), which is
//     what makes them findable via capability-registry-service.ts's
//     findSimilarCapabilities().
//   - taskCapabilities.capabilityKey = deriveCapabilityKey(modePill,
//     pathKeys) (capability-learning-service.ts's findOrCreateCapability()).
// That shared derivation IS the join key -- looking a dynamicChains row's
// modePill/pathKeys back up through deriveCapabilityKey() finds the exact
// taskCapabilities row that chain would resolve to, with zero new schema.
//
// Kept in its own file, not merged into either service, specifically to
// avoid a circular import: capability-registry-service.ts and
// capability-learning-service.ts do not import each other today, and
// putting bridge logic inside either one would force it to import from the
// other. This file imports from both; neither imports from this file --
// callers on either side (fde-service.ts, task-execution-engine.ts) import
// this file directly instead.
import { db, dynamicChains } from "@/lib/db"
import { eq } from "drizzle-orm"
import { findSimilarCapabilities, buildCapabilityContent, type CapabilityMatch, type CapabilityEntityType } from "./capability-registry-service"
import { deriveCapabilityKey, findCapabilityByKey, type TaskCapability } from "./capability-learning-service"

// ─── Pure helper (unit tested) ──────────────────────────────────────────────

// Builds the same "name | domain | description" shape buildCapabilityContent()
// already defines, from a taskCapabilities-shaped input -- pathKeys becomes
// the description (joined with " > ", mirroring dynamicChains' own
// pathLabels display convention) so the embedding search has real signal
// beyond the bare capabilityKey slug.
export function buildBridgeSearchQuery(capability: { capabilityKey: string; modePill?: string | null; pathKeys?: unknown }): string {
  const pathKeys = Array.isArray(capability.pathKeys) ? (capability.pathKeys as string[]) : []
  return buildCapabilityContent({
    name: capability.capabilityKey,
    domain: capability.modePill ?? null,
    description: pathKeys.length > 0 ? pathKeys.join(" > ") : null,
  })
}

// ─── DB-touching lookups ────────────────────────────────────────────────────

/**
 * Dynamic-Chain/Chat -> FDE direction: before treating a request as genuinely
 * novel, check whether VERI FDE's own capability index already has a
 * semantically similar worker agent, automation rule, module, or prompt
 * pattern registered. Never throws -- returns [] on any failure, matching
 * this codebase's established "a cross-catalog lookup degrades gracefully,
 * it never blocks the primary flow" posture (see capability-audit-service.ts's
 * findExistingUmrCandidate()). Callers decide what "similar enough" means for
 * their own flow, same as findSimilarCapabilities() itself.
 */
export async function findFdeMatchesForCapability(
  capability: Pick<TaskCapability, "capabilityKey" | "modePill" | "pathKeys">,
  orgId: string,
  limit = 5
): Promise<CapabilityMatch[]> {
  try {
    const query = buildBridgeSearchQuery(capability)
    return await findSimilarCapabilities(query, orgId, limit)
  } catch (err) {
    console.error(`[capability-bridge] FDE lookup failed for capabilityKey "${capability.capabilityKey}" -- continuing without cross-catalog matches:`, err)
    return []
  }
}

/**
 * FDE -> Dynamic-Chain/Chat direction: given an embeddings match whose
 * entityType is "dynamic_chain" (entityId = dynamicChains.id), find the
 * taskCapabilities row -- with its real occurrenceCount/fullSoftwareCount/
 * packageAvailableCount/novelCount learning history -- that the SAME
 * (modePill, pathKeys) pair would resolve to via findOrCreateCapability().
 * Returns null (never throws) when the match isn't a dynamic_chain, the
 * dynamicChains row no longer exists, or no task_capabilities row was ever
 * derived from it (a chain that was created/indexed but never actually run
 * through the Dynamic-Chain/Chat execution path).
 */
export async function findTaskCapabilityForDynamicChainMatch(
  match: Pick<CapabilityMatch, "entityType" | "entityId">
): Promise<TaskCapability | null> {
  if ((match.entityType as CapabilityEntityType) !== "dynamic_chain") return null
  try {
    const chain = await db.query.dynamicChains.findFirst({
      where: eq(dynamicChains.id, match.entityId),
      columns: { modePill: true, pathKeys: true },
    })
    if (!chain?.modePill || !Array.isArray(chain.pathKeys) || chain.pathKeys.length === 0) return null

    const capabilityKey = deriveCapabilityKey(chain.modePill, chain.pathKeys as string[])
    return await findCapabilityByKey(capabilityKey)
  } catch (err) {
    console.error(`[capability-bridge] Dynamic-Chain/Chat lookup failed for dynamic_chain ${match.entityId} -- continuing without a linked capability:`, err)
    return null
  }
}
