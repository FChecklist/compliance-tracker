// Wave 107 (VERI FM & CS AI OS) -- visitor check-in/check-out. Corporate
// Services scope for this wave is deliberately narrow: front-desk
// check-in only (canteen/transport/mailroom/meeting-room-booking are
// explicitly deferred). fmVisitors is kept separate from fmVisitorLogs so
// a repeat visitor (e.g. a recurring vendor technician) doesn't re-enter
// their details every visit -- front desk searches-and-selects an
// existing visitor, matching how a familiar, register-like flow should
// behave for reception staff.
import { fmVisitors, fmVisitorLogs } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, ilike, isNull, or } from "drizzle-orm"
import { requireFmEnabled } from "./fm-enablement-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"

export type FmVisitorContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

export async function searchVisitors(ctx: { orgId: string }, query: string) {
  await requireFmEnabled(ctx.orgId)
  if (!query?.trim()) return []
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.fmVisitors.findMany({
      where: and(eq(fmVisitors.orgId, ctx.orgId), or(ilike(fmVisitors.fullName, `%${query.trim()}%`), ilike(fmVisitors.phoneNumber, `%${query.trim()}%`))),
      limit: 10,
    })
  })
}

export type FmVisitorInput = {
  fullName: string
  phoneNumber?: string | null
  idType?: string | null
  idNumberLast4?: string | null
  companyOrOrg?: string | null
}

export type FmCheckInInput = {
  visitorId?: string // reuse an existing visitor row (searched via searchVisitors)
  newVisitor?: FmVisitorInput // or register a new one in the same call
  hostUserId: string
  purpose?: string | null
}

export async function checkInVisitor(ctx: FmVisitorContext, input: FmCheckInInput) {
  await requireFmEnabled(ctx.orgId)
  if (!input.visitorId && !input.newVisitor) throw new ServiceError("Either visitorId or newVisitor is required", 400)
  if (!input.hostUserId) throw new ServiceError("hostUserId is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    let visitorId = input.visitorId
    if (!visitorId && input.newVisitor) {
      if (!input.newVisitor.fullName?.trim()) throw new ServiceError("fullName is required for a new visitor", 400)
      const [visitor] = await db.insert(fmVisitors).values({
        orgId: ctx.orgId,
        fullName: input.newVisitor.fullName.trim(),
        phoneNumber: input.newVisitor.phoneNumber ?? null,
        idType: input.newVisitor.idType ?? null,
        idNumberLast4: input.newVisitor.idNumberLast4 ?? null,
        companyOrOrg: input.newVisitor.companyOrOrg ?? null,
      }).returning()
      visitorId = visitor.id
    }
    if (!visitorId) throw new ServiceError("Visitor could not be resolved", 500)

    const existingVisitor = await db.query.fmVisitors.findFirst({ where: and(eq(fmVisitors.id, visitorId), eq(fmVisitors.orgId, ctx.orgId)) })
    if (!existingVisitor) throw new ServiceError("Visitor not found", 404)

    const [log] = await db.insert(fmVisitorLogs).values({
      orgId: ctx.orgId,
      visitorId,
      hostUserId: input.hostUserId,
      purpose: input.purpose ?? null,
      loggedById: ctx.userId,
    }).returning()

    // Host notification: reuses whatever notification mechanism already
    // exists in this codebase (VERI Chat / the notifications table), not a
    // new channel -- best-effort, never blocks check-in on a notify failure.
    try {
      const { notifications } = await import("@/lib/db")
      await db.insert(notifications).values({
        userId: input.hostUserId,
        type: "system",
        title: "Visitor arrived",
        message: `${existingVisitor.fullName} has checked in at reception${input.purpose ? ` -- ${input.purpose}` : ""}.`,
      })
      await db.update(fmVisitorLogs).set({ hostNotifiedAt: new Date() }).where(eq(fmVisitorLogs.id, log.id))
    } catch (err) {
      console.error(`Host notification failed for visitor log ${log.id}:`, err)
    }

    return log
  })
}

export async function checkOutVisitor(ctx: FmVisitorContext, logId: string) {
  await requireFmEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const log = await db.query.fmVisitorLogs.findFirst({ where: and(eq(fmVisitorLogs.id, logId), eq(fmVisitorLogs.orgId, ctx.orgId)) })
    if (!log) throw new ServiceError("Visitor log not found", 404)
    if (log.status === "checked_out") throw new ServiceError("This visitor has already checked out", 409)

    const [updated] = await db.update(fmVisitorLogs).set({
      status: "checked_out", checkOutAt: new Date(),
    }).where(eq(fmVisitorLogs.id, logId)).returning()

    return updated
  })
}

export async function listActiveVisitorLogs(ctx: { orgId: string }) {
  await requireFmEnabled(ctx.orgId)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.fmVisitorLogs.findMany({
      where: and(eq(fmVisitorLogs.orgId, ctx.orgId), eq(fmVisitorLogs.status, "checked_in"), isNull(fmVisitorLogs.checkOutAt)),
      orderBy: (t, { desc }) => desc(t.checkInAt),
    })
  })
}
