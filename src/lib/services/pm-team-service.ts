// Task #47 PM gap analysis (2026-07-31): generic PM Teams CRUD. See
// schema.ts's pmTeams/pmTeamMembers comment for why this is a genuinely
// new, decoupled table rather than an extension of the helpdesk-specific
// ticket_teams (ticket-service.ts's listTicketTeams/createTicketTeam/
// updateTicketTeam) -- this file mirrors that convention, not its table.
import { pmTeams, pmTeamMembers } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, desc } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type PmTeamContext = { orgId: string; userId?: string }

export async function listPmTeams(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.pmTeams.findMany({ where: eq(pmTeams.orgId, ctx.orgId), orderBy: desc(pmTeams.createdAt) })
  )
}

export async function getPmTeam(ctx: { orgId: string }, teamId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const team = await db.query.pmTeams.findFirst({ where: and(eq(pmTeams.id, teamId), eq(pmTeams.orgId, ctx.orgId)) })
    if (!team) throw new ServiceError("Team not found", 404)
    const members = await db.query.pmTeamMembers.findMany({ where: eq(pmTeamMembers.teamId, teamId) })
    return { ...team, members }
  })
}

export async function createPmTeam(
  ctx: PmTeamContext,
  input: { name: string; description?: string; leadUserId?: string; isDefault?: boolean }
) {
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    // Only one default team per org -- clear any existing default first,
    // same convention as ticket-service.ts's createTicketTeam().
    if (input.isDefault) await db.update(pmTeams).set({ isDefault: false }).where(eq(pmTeams.orgId, ctx.orgId))
    const [team] = await db.insert(pmTeams).values({
      orgId: ctx.orgId, name, description: input.description?.trim() || null,
      leadUserId: input.leadUserId || null, isDefault: input.isDefault ?? false,
    }).returning()
    // Team lead is automatically a member with the 'lead' role.
    if (input.leadUserId) {
      await db.insert(pmTeamMembers).values({ teamId: team.id, userId: input.leadUserId, role: "lead" })
    }
    return team
  })
}

export async function updatePmTeam(
  ctx: PmTeamContext,
  teamId: string,
  patch: Partial<{ name: string; description: string | null; leadUserId: string | null; isDefault: boolean }>
) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.pmTeams.findFirst({ where: and(eq(pmTeams.id, teamId), eq(pmTeams.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Team not found", 404)
    if (patch.isDefault) await db.update(pmTeams).set({ isDefault: false }).where(eq(pmTeams.orgId, ctx.orgId))
    const [updated] = await db.update(pmTeams).set({ ...patch, updatedAt: new Date() }).where(eq(pmTeams.id, teamId)).returning()
    return updated
  })
}

export async function listTeamMembers(ctx: { orgId: string }, teamId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const team = await db.query.pmTeams.findFirst({ where: and(eq(pmTeams.id, teamId), eq(pmTeams.orgId, ctx.orgId)) })
    if (!team) throw new ServiceError("Team not found", 404)
    return db.query.pmTeamMembers.findMany({ where: eq(pmTeamMembers.teamId, teamId) })
  })
}

export async function addTeamMember(
  ctx: { orgId: string },
  teamId: string,
  input: { userId: string; role?: "lead" | "member" }
) {
  if (!input.userId) throw new ServiceError("userId is required", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const team = await db.query.pmTeams.findFirst({ where: and(eq(pmTeams.id, teamId), eq(pmTeams.orgId, ctx.orgId)) })
    if (!team) throw new ServiceError("Team not found", 404)

    const existing = await db.query.pmTeamMembers.findFirst({
      where: and(eq(pmTeamMembers.teamId, teamId), eq(pmTeamMembers.userId, input.userId)),
    })
    if (existing) throw new ServiceError("User is already a member of this team", 409)

    const [member] = await db.insert(pmTeamMembers).values({
      teamId, userId: input.userId, role: input.role ?? "member",
    }).returning()
    return member
  })
}

export async function updateTeamMemberRole(ctx: { orgId: string }, teamId: string, userId: string, role: "lead" | "member") {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const team = await db.query.pmTeams.findFirst({ where: and(eq(pmTeams.id, teamId), eq(pmTeams.orgId, ctx.orgId)) })
    if (!team) throw new ServiceError("Team not found", 404)
    const existing = await db.query.pmTeamMembers.findFirst({
      where: and(eq(pmTeamMembers.teamId, teamId), eq(pmTeamMembers.userId, userId)),
    })
    if (!existing) throw new ServiceError("Membership not found", 404)
    const [updated] = await db.update(pmTeamMembers).set({ role })
      .where(and(eq(pmTeamMembers.teamId, teamId), eq(pmTeamMembers.userId, userId)))
      .returning()
    return updated
  })
}

export async function removeTeamMember(ctx: { orgId: string }, teamId: string, userId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const team = await db.query.pmTeams.findFirst({ where: and(eq(pmTeams.id, teamId), eq(pmTeams.orgId, ctx.orgId)) })
    if (!team) throw new ServiceError("Team not found", 404)
    const existing = await db.query.pmTeamMembers.findFirst({
      where: and(eq(pmTeamMembers.teamId, teamId), eq(pmTeamMembers.userId, userId)),
    })
    if (!existing) throw new ServiceError("Membership not found", 404)
    await db.delete(pmTeamMembers).where(and(eq(pmTeamMembers.teamId, teamId), eq(pmTeamMembers.userId, userId)))
    return { removed: true }
  })
}
