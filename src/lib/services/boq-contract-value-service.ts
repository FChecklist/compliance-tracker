// R85 Addendum 3 v4, Phase 4 (E3, gates 4-06/4-07/4-08; owner rulings D87
// claude_log 366, D88 372, D91 375; supersession notice 379). The DB-touching
// half of Phase 4 -- boq-dual-view-service.ts owns every PURE money
// derivation (X-27, single producer); this file is the thin service layer
// that reads/writes real rows and hands their values to those pure
// functions, matching this codebase's existing split between a service file
// and a same-domain pure-computation module (e.g.
// construction-boq-service.ts's own diffLineItems/computeTotalVariation
// pure helpers vs its DB-touching createBoqRevision/approveBoq).
//
// 4-06 ("an approved variation adjusts contract_value; an unapproved one
// never does") is investigated, not reinvented, here: this codebase's BOQ
// revision chain (construction-boq-service.ts's createBoqRevision/submitBoq/
// approveBoq) already IS the variation-approval mechanism -- a "variation"
// is simply the next BOQ revision, and it only affects anything once
// approveBoq() moves its status to 'approved'. Confirmed while building this
// file that BOQ never adopted the polymorphic approval-workflow-service.ts
// engine (it only reuses that file's isSelfApproval() pure helper), so there
// is no second, parallel approval mechanism to reconcile against. This file
// adds NO new approve/reject verbs -- resolveApprovedBoq() below simply
// reads the SAME `status` column resolveCurrentBoq() already reads, gated
// more strictly (approved-only, no submitted/highest-version fallback) than
// that function's "what should Work Progress read" question needs, because
// the CONTRACT VALUE question ("has this variation actually been approved
// yet") is a stricter one.
import { constructionBoqs, constructionBoqLineItems } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import {
  rollUpRootLines,
  resolveEffectiveContractValue,
  NOT_SET,
  type EffectiveContractValue,
  type BoqLineForRollup,
} from "./boq-dual-view-service"

/**
 * 4-06's gate, made explicit and testable without a database: of a
 * project's whole BOQ revision chain, only the row genuinely carrying
 * status 'approved' can ever feed the contract value used by the Phase 4
 * gross/net stack. Unlike construction-boq-service.ts's own
 * resolveCurrentBoq() (which falls back to 'submitted', then highest
 * version, because Work Progress entry needs SOME current BOQ to record
 * against even before formal approval), this function returns null when
 * nothing is approved yet -- a draft or submitted variation, however
 * "current" for data-entry purposes, must NEVER move contract_value (X-11).
 * When more than one row is (illegally) 'approved' at once, the highest
 * version wins -- defensive only; createBoqRevision's own supersede step
 * already prevents this in practice.
 */
export function resolveApprovedBoq<T extends { status: string; version: number }>(boqs: T[]): T | null {
  const approved = boqs.filter((b) => b.status === "approved")
  if (approved.length === 0) return null
  return [...approved].sort((a, b) => b.version - a.version)[0]!
}

export type BoqOverrideRow = {
  id: string
  contractValueOverride: string | number | null
  overrideActorId: string | null
  overrideAt: Date | null
  overrideReason: string | null
  evidenceArtefactRef: string | null
}

/**
 * Reads a BOQ row's own override columns (drizzle/0594) and hands them,
 * together with the freshly-rolled-up computed total, to
 * resolveEffectiveContractValue() -- the one place (X-27) that decides which
 * figure is "in force" per 4-07. Pure/DB-free so it can be unit tested with
 * a plain object fixture; the DB-touching wiring below (
 * getEffectiveContractValueForProject) is the only caller that constructs
 * `boq` from a real row.
 */
export function resolveBoqEffectiveContractValue(
  computedTotal: ReturnType<typeof rollUpRootLines>["contractValue"],
  boq: BoqOverrideRow
): EffectiveContractValue {
  if (boq.contractValueOverride === null || boq.contractValueOverride === undefined) {
    return resolveEffectiveContractValue(computedTotal, null)
  }
  return resolveEffectiveContractValue(computedTotal, {
    value: boq.contractValueOverride,
    actorId: boq.overrideActorId ?? "",
    at: boq.overrideAt ?? "",
    reason: boq.overrideReason ?? "",
    evidenceArtefactRef: boq.evidenceArtefactRef ?? "",
  })
}

/**
 * 4-06 wired end to end: the project's CURRENT APPROVED BOQ revision (never
 * a draft/submitted one, per resolveApprovedBoq() above), its root-lines-
 * only rolled-up contract value (R-32/A7, computed via rollUpRootLines --
 * the SAME function every other rollup in this codebase already uses, never
 * a second implementation), and 4-07's override resolution over that total.
 * No project BOQ at all, or none yet approved, is a real and normal state
 * (a brand-new project, or a variation still in draft/submitted) -- returns
 * NOT_SET rather than throwing, matching this codebase's NOT_SET-for-
 * genuinely-absent convention (X-04) rather than treating "not confirmed
 * yet" as an error.
 */
export async function getEffectiveContractValueForProject(
  ctx: { orgId: string },
  projectId: string
): Promise<EffectiveContractValue & { boqId: string | null; boqVersion: number | null }> {
  return withTenantContext({ orgId: ctx.orgId }, async (db: TenantDb) => {
    const boqs = await db.query.constructionBoqs.findMany({
      where: and(eq(constructionBoqs.orgId, ctx.orgId), eq(constructionBoqs.projectId, projectId)),
    })
    const approved = resolveApprovedBoq(boqs)
    if (!approved) {
      return { value: NOT_SET, source: "computed" as const, computedTotal: NOT_SET, boqId: null, boqVersion: null }
    }

    const lineItems = await db.query.constructionBoqLineItems.findMany({
      where: eq(constructionBoqLineItems.boqId, approved.id),
    })
    const rollup = rollUpRootLines(lineItems as unknown as BoqLineForRollup[])
    const effective = resolveBoqEffectiveContractValue(rollup.contractValue, approved)
    return { ...effective, boqId: approved.id, boqVersion: approved.version }
  })
}

/**
 * 4-07/4-08: the ONLY writer of construction_boqs' five override columns.
 * `reason` AND `evidenceArtefactRef` are both required non-empty (D88: every
 * contract-side change requires a cited evidence artefact) -- matches
 * compliance-service.ts's ServiceError(message, 400) pattern used everywhere
 * else in this codebase for a rejected/invalid write. NEVER touches
 * quantity/rate/amount or any line item -- the computed BOQ total this
 * override sits alongside is untouched (X-12), which is also why this
 * function does no rollup math itself; it only records the override.
 */
export async function applyContractOverride(
  ctx: { orgId: string; userId: string },
  boqId: string,
  input: { value: number; reason: string; evidenceArtefactRef: string }
) {
  if (typeof input.value !== "number" || !Number.isFinite(input.value)) {
    throw new ServiceError("value must be a finite number", 400)
  }
  if (!input.reason || !input.reason.trim()) {
    throw new ServiceError("reason is required for a contract value override", 400)
  }
  if (!input.evidenceArtefactRef || !input.evidenceArtefactRef.trim()) {
    throw new ServiceError("evidenceArtefactRef is required for a contract value override (D88)", 400)
  }

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db: TenantDb) => {
    const boq = await db.query.constructionBoqs.findFirst({
      where: and(eq(constructionBoqs.id, boqId), eq(constructionBoqs.orgId, ctx.orgId)),
    })
    if (!boq) throw new ServiceError("BOQ not found", 404)

    const [updated] = await db
      .update(constructionBoqs)
      .set({
        contractValueOverride: String(input.value),
        overrideActorId: ctx.userId,
        overrideAt: new Date(),
        overrideReason: input.reason.trim(),
        evidenceArtefactRef: input.evidenceArtefactRef.trim(),
        updatedAt: new Date(),
      })
      .where(eq(constructionBoqs.id, boqId))
      .returning()
    return updated
  })
}
