// Wave 174 (PROJEXA Owner resource-management spec, item 8: Material) --
// catalog (spec/cost/qty) + inbound receiving + cost report. qtyOnHand is
// maintained by the service layer at inbound-write time (matches
// construction-labour-service.ts's dailyCost precedent), never a DB
// generated column. The cost report is computed live from the inbound log
// (sum of totalCost per material), not denormalized -- matches this
// codebase's live-aggregation convention (construction-boq-service.ts's
// compareBoq, kpi-hub-service.ts).
import { constructionMaterials, constructionMaterialInbound, projects } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type MaterialInput = { projectId: string; spec: string; unit: string; unitCost: number }

export async function listMaterials(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.constructionMaterials.findMany({
      where: and(eq(constructionMaterials.orgId, ctx.orgId), eq(constructionMaterials.projectId, projectId)),
    })
  )
}

export async function createMaterial(ctx: { orgId: string }, input: MaterialInput) {
  const spec = input.spec?.trim()
  if (!spec) throw new ServiceError("spec is required", 400)
  if (!input.unit?.trim()) throw new ServiceError("unit is required", 400)
  if (!input.projectId) throw new ServiceError("projectId is required", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, input.projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)

    const [row] = await db.insert(constructionMaterials).values({
      orgId: ctx.orgId, projectId: input.projectId, spec,
      unit: input.unit.trim(), unitCost: String(input.unitCost ?? 0),
    }).returning()
    return row
  })
}

export type InboundInput = {
  projectId: string
  materialId: string
  receivedDate: string
  quantityReceived: number
  unitCost: number
  vendorName?: string
  recordedById: string
}

export async function recordInbound(ctx: { orgId: string }, input: InboundInput) {
  if (!input.materialId) throw new ServiceError("materialId is required", 400)
  if (!input.receivedDate) throw new ServiceError("receivedDate is required", 400)
  if (!input.quantityReceived || input.quantityReceived <= 0) throw new ServiceError("quantityReceived must be greater than 0", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const material = await db.query.constructionMaterials.findFirst({
      where: and(eq(constructionMaterials.id, input.materialId), eq(constructionMaterials.orgId, ctx.orgId)),
    })
    if (!material) throw new ServiceError("Material not found", 404)

    const totalCost = input.quantityReceived * input.unitCost

    const [row] = await db.insert(constructionMaterialInbound).values({
      orgId: ctx.orgId, projectId: input.projectId, materialId: input.materialId,
      receivedDate: input.receivedDate, quantityReceived: String(input.quantityReceived),
      unitCost: String(input.unitCost), totalCost: String(totalCost),
      vendorName: input.vendorName || null, recordedById: input.recordedById,
    }).returning()

    await db.update(constructionMaterials)
      .set({ qtyOnHand: String(Number(material.qtyOnHand) + input.quantityReceived), unitCost: String(input.unitCost) })
      .where(eq(constructionMaterials.id, input.materialId))

    return row
  })
}

export async function listInbound(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.constructionMaterialInbound.findMany({
      where: and(eq(constructionMaterialInbound.orgId, ctx.orgId), eq(constructionMaterialInbound.projectId, projectId)),
      orderBy: (t, { desc }) => desc(t.receivedDate),
    })
  )
}

export type MaterialCostReportRow = {
  materialId: string
  spec: string
  unit: string
  totalQuantityReceived: number
  totalCost: number
  averageUnitCost: number
}

/** Pure aggregation, exported for direct testing (no DB) -- one row per material, summed across every inbound entry for that material. */
export function aggregateMaterialCostReport(
  materials: { id: string; spec: string; unit: string }[],
  inbound: { materialId: string; quantityReceived: string | number; totalCost: string | number }[]
): MaterialCostReportRow[] {
  const byMaterial = new Map<string, { qty: number; cost: number }>()
  for (const entry of inbound) {
    const acc = byMaterial.get(entry.materialId) ?? { qty: 0, cost: 0 }
    acc.qty += Number(entry.quantityReceived)
    acc.cost += Number(entry.totalCost)
    byMaterial.set(entry.materialId, acc)
  }

  return materials
    .filter((m) => byMaterial.has(m.id))
    .map((m) => {
      const acc = byMaterial.get(m.id)!
      return {
        materialId: m.id, spec: m.spec, unit: m.unit,
        totalQuantityReceived: acc.qty, totalCost: acc.cost,
        averageUnitCost: acc.qty > 0 ? acc.cost / acc.qty : 0,
      }
    })
}

export async function getMaterialCostReport(ctx: { orgId: string }, projectId: string): Promise<MaterialCostReportRow[]> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [materials, inbound] = await Promise.all([
      db.query.constructionMaterials.findMany({ where: and(eq(constructionMaterials.orgId, ctx.orgId), eq(constructionMaterials.projectId, projectId)) }),
      db.query.constructionMaterialInbound.findMany({ where: and(eq(constructionMaterialInbound.orgId, ctx.orgId), eq(constructionMaterialInbound.projectId, projectId)) }),
    ])
    return aggregateMaterialCostReport(materials, inbound)
  })
}
