// Wave 143 (PROJEXA gap analysis): visual design authoring -- 2D floor
// plan editor + 3D walkthrough. Rooms are closed polygons (jsonb points,
// cm); walls are derived from polygon edges at render/scene-build time,
// not stored as separate entities. Furniture placement reuses Wave 142's
// interiorFfeItems (a placement is the same FF&E line item, now with
// x/y/rotation) instead of duplicating item data.
import {
  interiorFloorPlans, interiorFloorPlanRooms, interiorFurniturePlacements,
  interiorMaterials, interiorFfeItems,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, inArray } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type Point = { x: number; y: number }

// ---------------- Floor Plans ----------------

export async function createFloorPlan(ctx: { orgId: string; userId: string }, input: { projectId: string; name: string; floorLevel?: string }) {
  if (!input.name?.trim()) throw new ServiceError("name is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [row] = await db.insert(interiorFloorPlans).values({
      orgId: ctx.orgId, projectId: input.projectId, name: input.name.trim(),
      floorLevel: input.floorLevel ?? null, createdById: ctx.userId,
    }).returning()
    return row
  })
}

export async function listFloorPlans(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.interiorFloorPlans.findMany({
      where: and(eq(interiorFloorPlans.orgId, ctx.orgId), eq(interiorFloorPlans.projectId, projectId)),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
  )
}

export async function updateFloorPlanStatus(ctx: { orgId: string }, floorPlanId: string, status: string) {
  const VALID = ["draft", "final"]
  if (!VALID.includes(status)) throw new ServiceError(`status must be one of: ${VALID.join(", ")}`, 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [row] = await db.update(interiorFloorPlans).set({ status })
      .where(and(eq(interiorFloorPlans.id, floorPlanId), eq(interiorFloorPlans.orgId, ctx.orgId))).returning()
    if (!row) throw new ServiceError("Floor plan not found", 404)
    return row
  })
}

async function requireOwnedFloorPlan(db: TenantDb, orgId: string, floorPlanId: string) {
  const plan = await db.query.interiorFloorPlans.findFirst({ where: and(eq(interiorFloorPlans.id, floorPlanId), eq(interiorFloorPlans.orgId, orgId)) })
  if (!plan) throw new ServiceError("Floor plan not found", 404)
  return plan
}

// Full editable graph for the 2D editor and the raw material for the 3D
// scene builder: floor plan + rooms + placements (each placement resolved
// against its FF&E item's category/dimensions, since the 3D scene needs
// footprint geometry, not just a foreign key).
export async function getFloorPlan(ctx: { orgId: string }, floorPlanId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const plan = await requireOwnedFloorPlan(db, ctx.orgId, floorPlanId)
    const rooms = await db.query.interiorFloorPlanRooms.findMany({
      where: eq(interiorFloorPlanRooms.floorPlanId, floorPlanId), orderBy: (t, { asc }) => asc(t.sortOrder),
    })
    const placements = await db.query.interiorFurniturePlacements.findMany({ where: eq(interiorFurniturePlacements.floorPlanId, floorPlanId) })
    const itemIds = placements.map((p) => p.ffeItemId)
    const items = itemIds.length > 0
      ? await db.query.interiorFfeItems.findMany({ where: inArray(interiorFfeItems.id, itemIds) })
      : []
    const itemsById = new Map(items.map((i) => [i.id, i]))

    const materialIds = rooms.flatMap((r) => [r.floorMaterialId, r.wallMaterialId, r.ceilingMaterialId]).filter((id): id is string => !!id)
    const materials = materialIds.length > 0
      ? await db.query.interiorMaterials.findMany({ where: inArray(interiorMaterials.id, [...new Set(materialIds)]) })
      : []
    const materialsById = new Map(materials.map((m) => [m.id, m]))

    return {
      ...plan,
      rooms: rooms.map((r) => ({
        ...r,
        floorMaterial: r.floorMaterialId ? materialsById.get(r.floorMaterialId) ?? null : null,
        wallMaterial: r.wallMaterialId ? materialsById.get(r.wallMaterialId) ?? null : null,
        ceilingMaterial: r.ceilingMaterialId ? materialsById.get(r.ceilingMaterialId) ?? null : null,
      })),
      placements: placements.map((p) => ({ ...p, item: itemsById.get(p.ffeItemId) ?? null })),
    }
  })
}

// ---------------- Rooms ----------------

function validatePolygon(polygon: unknown): Point[] {
  if (!Array.isArray(polygon) || polygon.length < 3) throw new ServiceError("polygon must have at least 3 points", 400)
  return polygon.map((p) => {
    if (typeof p?.x !== "number" || typeof p?.y !== "number") throw new ServiceError("each polygon point must have numeric x, y", 400)
    return { x: p.x, y: p.y }
  })
}

export async function addRoom(ctx: { orgId: string }, floorPlanId: string, input: { name: string; polygon: unknown; ceilingHeightCm?: number; floorMaterialId?: string; wallMaterialId?: string; ceilingMaterialId?: string }) {
  if (!input.name?.trim()) throw new ServiceError("name is required", 400)
  const polygon = validatePolygon(input.polygon)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    await requireOwnedFloorPlan(db, ctx.orgId, floorPlanId)
    const existing = await db.query.interiorFloorPlanRooms.findMany({ where: eq(interiorFloorPlanRooms.floorPlanId, floorPlanId) })
    const [row] = await db.insert(interiorFloorPlanRooms).values({
      floorPlanId, name: input.name.trim(), polygon,
      ceilingHeightCm: String(input.ceilingHeightCm ?? 270),
      floorMaterialId: input.floorMaterialId ?? null, wallMaterialId: input.wallMaterialId ?? null, ceilingMaterialId: input.ceilingMaterialId ?? null,
      sortOrder: existing.length,
    }).returning()
    return row
  })
}

export async function updateRoom(ctx: { orgId: string }, floorPlanId: string, roomId: string, input: { name?: string; polygon?: unknown; ceilingHeightCm?: number; floorMaterialId?: string | null; wallMaterialId?: string | null; ceilingMaterialId?: string | null }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    await requireOwnedFloorPlan(db, ctx.orgId, floorPlanId)
    const [row] = await db.update(interiorFloorPlanRooms).set({
      name: input.name?.trim() || undefined,
      polygon: input.polygon !== undefined ? validatePolygon(input.polygon) : undefined,
      ceilingHeightCm: input.ceilingHeightCm != null ? String(input.ceilingHeightCm) : undefined,
      floorMaterialId: input.floorMaterialId,
      wallMaterialId: input.wallMaterialId,
      ceilingMaterialId: input.ceilingMaterialId,
    }).where(and(eq(interiorFloorPlanRooms.id, roomId), eq(interiorFloorPlanRooms.floorPlanId, floorPlanId))).returning()
    if (!row) throw new ServiceError("Room not found", 404)
    return row
  })
}

export async function removeRoom(ctx: { orgId: string }, floorPlanId: string, roomId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    await requireOwnedFloorPlan(db, ctx.orgId, floorPlanId)
    await db.delete(interiorFloorPlanRooms).where(and(eq(interiorFloorPlanRooms.id, roomId), eq(interiorFloorPlanRooms.floorPlanId, floorPlanId)))
    return { ok: true }
  })
}

// ---------------- Furniture Placements ----------------

export async function placeFurniture(ctx: { orgId: string }, floorPlanId: string, input: { ffeItemId: string; roomId?: string; x?: number; y?: number; rotationDeg?: number }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    await requireOwnedFloorPlan(db, ctx.orgId, floorPlanId)
    const item = await db.query.interiorFfeItems.findFirst({ where: and(eq(interiorFfeItems.id, input.ffeItemId), eq(interiorFfeItems.orgId, ctx.orgId)) })
    if (!item) throw new ServiceError("FF&E item not found", 404)
    const [row] = await db.insert(interiorFurniturePlacements).values({
      floorPlanId, roomId: input.roomId ?? null, ffeItemId: input.ffeItemId,
      x: String(input.x ?? 0), y: String(input.y ?? 0), rotationDeg: String(input.rotationDeg ?? 0),
    }).returning()
    return row
  })
}

export async function updatePlacement(ctx: { orgId: string }, floorPlanId: string, placementId: string, input: { roomId?: string | null; x?: number; y?: number; rotationDeg?: number }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    await requireOwnedFloorPlan(db, ctx.orgId, floorPlanId)
    const [row] = await db.update(interiorFurniturePlacements).set({
      roomId: input.roomId,
      x: input.x != null ? String(input.x) : undefined,
      y: input.y != null ? String(input.y) : undefined,
      rotationDeg: input.rotationDeg != null ? String(input.rotationDeg) : undefined,
    }).where(and(eq(interiorFurniturePlacements.id, placementId), eq(interiorFurniturePlacements.floorPlanId, floorPlanId))).returning()
    if (!row) throw new ServiceError("Placement not found", 404)
    return row
  })
}

export async function removePlacement(ctx: { orgId: string }, floorPlanId: string, placementId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    await requireOwnedFloorPlan(db, ctx.orgId, floorPlanId)
    await db.delete(interiorFurniturePlacements).where(and(eq(interiorFurniturePlacements.id, placementId), eq(interiorFurniturePlacements.floorPlanId, floorPlanId)))
    return { ok: true }
  })
}

// ---------------- Materials ----------------

export async function createMaterial(ctx: { orgId: string }, input: { name: string; category: string; colorHex?: string; textureDocumentId?: string; roughness?: number; metalness?: number }) {
  if (!input.name?.trim()) throw new ServiceError("name is required", 400)
  const VALID_CATEGORIES = ["flooring", "wall", "ceiling"]
  if (!VALID_CATEGORIES.includes(input.category)) throw new ServiceError(`category must be one of: ${VALID_CATEGORIES.join(", ")}`, 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [row] = await db.insert(interiorMaterials).values({
      orgId: ctx.orgId, name: input.name.trim(), category: input.category as typeof interiorMaterials.$inferInsert.category,
      colorHex: input.colorHex ?? "#cccccc", textureDocumentId: input.textureDocumentId ?? null,
      roughness: String(input.roughness ?? 0.8), metalness: String(input.metalness ?? 0),
    }).returning()
    return row
  })
}

export async function listMaterials(ctx: { orgId: string }, category?: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) => {
    const conditions = [eq(interiorMaterials.orgId, ctx.orgId)]
    if (category) conditions.push(eq(interiorMaterials.category, category as typeof interiorMaterials.$inferSelect.category))
    return db.query.interiorMaterials.findMany({ where: and(...conditions), orderBy: (t, { desc }) => desc(t.createdAt) })
  })
}

// ---------------- 3D Scene ----------------

// Purpose-built shape for the react-three-fiber walkthrough: rooms as
// extruded polygons (walls derived from edges, not stored) with resolved
// material props, and placements as footprint boxes. Keeps all
// geometry-derivation logic server-side so the client only renders.
export async function getFloorPlanScene(ctx: { orgId: string }, floorPlanId: string) {
  const plan = await getFloorPlan(ctx, floorPlanId)
  return {
    id: plan.id, name: plan.name,
    rooms: plan.rooms.map((r) => ({
      id: r.id, name: r.name,
      polygon: r.polygon as Point[],
      ceilingHeightCm: Number(r.ceilingHeightCm),
      floorMaterial: toSceneMaterial(r.floorMaterial),
      wallMaterial: toSceneMaterial(r.wallMaterial),
      ceilingMaterial: toSceneMaterial(r.ceilingMaterial),
    })),
    placements: plan.placements
      .filter((p) => p.item)
      .map((p) => ({
        id: p.id, roomId: p.roomId, x: Number(p.x), y: Number(p.y), rotationDeg: Number(p.rotationDeg),
        itemName: p.item!.itemName, category: p.item!.category,
        widthCm: p.item!.widthCm != null ? Number(p.item!.widthCm) : 60,
        depthCm: p.item!.depthCm != null ? Number(p.item!.depthCm) : 60,
        heightCm: p.item!.heightCm != null ? Number(p.item!.heightCm) : 80,
      })),
  }
}

function toSceneMaterial(m: { colorHex: string; roughness: string | number; metalness: string | number } | null) {
  if (!m) return { colorHex: "#cccccc", roughness: 0.8, metalness: 0 }
  return { colorHex: m.colorHex, roughness: Number(m.roughness), metalness: Number(m.metalness) }
}
