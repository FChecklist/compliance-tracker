// Task #47 PM gap analysis (2026-07-31): pm-team-service.ts CRUD tests --
// same "mock withTenantContext, restore in afterEach" pattern as
// pms-time-service.test.ts.
/// <reference types="bun-types" />
import { describe, expect, test, mock, afterEach } from "bun:test"

const realTenantScoped = await import("@/lib/db/tenant-scoped")

function makeFakeDb(opts: { team?: Record<string, unknown> | null; membership?: Record<string, unknown> | null } = {}) {
  let team = opts.team ?? null
  let membership = opts.membership ?? null
  const inserted: Record<string, unknown>[] = []
  const updated: Record<string, unknown>[] = []
  const deleted: unknown[] = []

  const db = {
    query: {
      pmTeams: { findFirst: mock(async () => (team ? { ...team } : undefined)) },
      pmTeamMembers: {
        findFirst: mock(async () => (membership ? { ...membership } : undefined)),
        findMany: mock(async () => (membership ? [{ ...membership }] : [])),
      },
    },
    insert: (table: unknown) => ({
      // The insert side effect must happen here, in values(), not in
      // returning() -- createPmTeam() awaits the auto-added lead's
      // membership insert without ever calling .returning() on it (matches
      // real Drizzle: the insert query builder is itself awaitable), so a
      // fake db that only records the insert inside .returning() would
      // silently never record that row.
      values: (value: Record<string, unknown>) => {
        const row = { id: "new-id", ...value }
        inserted.push(row)
        if ("teamId" in value && "userId" in value) membership = row
        else team = row
        return { returning: async () => [row] }
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            if (patch.role !== undefined && membership) {
              membership = { ...membership, ...patch }
              updated.push(membership)
              return [membership]
            }
            team = { ...(team as Record<string, unknown>), ...patch }
            updated.push(team)
            return [team]
          },
        }),
      }),
    }),
    delete: () => ({
      where: () => {
        deleted.push(membership)
        membership = null
      },
    }),
  }

  return { db, inserted, updated, deleted, getTeam: () => team, getMembership: () => membership }
}

describe("createPmTeam", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  })

  test("creates a team and auto-adds the lead as a 'lead' member", async () => {
    const { db, inserted } = makeFakeDb()
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(db)) }))
    const { createPmTeam } = await import("./pm-team-service")
    const team = await createPmTeam({ orgId: "org1", userId: "user1" }, { name: "Platform Team", leadUserId: "user2" }) as { name: string }

    expect(team.name).toBe("Platform Team")
    const membershipRow = inserted.find((r) => "teamId" in r && "userId" in r)
    expect(membershipRow?.role).toBe("lead")
    expect(membershipRow?.userId).toBe("user2")
  })

  test("rejects an empty name", async () => {
    const { db } = makeFakeDb()
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(db)) }))
    const { createPmTeam } = await import("./pm-team-service")
    await expect(createPmTeam({ orgId: "org1" }, { name: "   " })).rejects.toThrow("name is required")
  })
})

describe("addTeamMember / removeTeamMember / updateTeamMemberRole", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  })

  test("adds a new member with the default 'member' role", async () => {
    const { db, inserted } = makeFakeDb({ team: { id: "team1", orgId: "org1", name: "Team" } })
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(db)) }))
    const { addTeamMember } = await import("./pm-team-service")
    const member = await addTeamMember({ orgId: "org1" }, "team1", { userId: "user3" }) as { role: string; userId: string }

    expect(member.role).toBe("member")
    expect(inserted).toHaveLength(1)
  })

  test("rejects adding a user who is already a member", async () => {
    const { db } = makeFakeDb({
      team: { id: "team1", orgId: "org1", name: "Team" },
      membership: { teamId: "team1", userId: "user3", role: "member" },
    })
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(db)) }))
    const { addTeamMember } = await import("./pm-team-service")
    await expect(addTeamMember({ orgId: "org1" }, "team1", { userId: "user3" })).rejects.toThrow("already a member")
  })

  test("throws 404 when the team does not exist", async () => {
    const { db } = makeFakeDb({ team: null })
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(db)) }))
    const { addTeamMember, ServiceError } = await import("./pm-team-service")
    try {
      await addTeamMember({ orgId: "org1" }, "missing-team", { userId: "user3" })
      throw new Error("expected to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceError)
      expect((error as InstanceType<typeof ServiceError>).status).toBe(404)
    }
  })

  test("updateTeamMemberRole promotes a member to lead", async () => {
    const { db } = makeFakeDb({
      team: { id: "team1", orgId: "org1", name: "Team" },
      membership: { teamId: "team1", userId: "user3", role: "member" },
    })
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(db)) }))
    const { updateTeamMemberRole } = await import("./pm-team-service")
    const updated = await updateTeamMemberRole({ orgId: "org1" }, "team1", "user3", "lead") as { role: string }
    expect(updated.role).toBe("lead")
  })

  test("removeTeamMember deletes the membership row", async () => {
    const { db, getMembership } = makeFakeDb({
      team: { id: "team1", orgId: "org1", name: "Team" },
      membership: { teamId: "team1", userId: "user3", role: "member" },
    })
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(db)) }))
    const { removeTeamMember } = await import("./pm-team-service")
    const result = await removeTeamMember({ orgId: "org1" }, "team1", "user3") as { removed: boolean }
    expect(result.removed).toBe(true)
    expect(getMembership()).toBeNull()
  })
})
