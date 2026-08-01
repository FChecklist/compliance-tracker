// Task #47 PM gap analysis (2026-07-31): project-group-service.ts CRUD
// tests -- same "mock withTenantContext, restore in afterEach" pattern as
// pms-time-service.test.ts.
/// <reference types="bun-types" />
import { describe, expect, test, mock, afterEach } from "bun:test"

const realTenantScoped = await import("@/lib/db/tenant-scoped")

function makeFakeDb(opts: {
  group?: Record<string, unknown> | null
  project?: Record<string, unknown> | null
  link?: Record<string, unknown> | null
} = {}) {
  const group = opts.group ?? null
  const project = opts.project ?? null
  let link = opts.link ?? null
  const inserted: Record<string, unknown>[] = []

  const db = {
    query: {
      projectGroups: { findFirst: mock(async () => (group ? { ...group } : undefined)) },
      projects: {
        findFirst: mock(async () => (project ? { ...project } : undefined)),
        findMany: mock(async () => (project ? [{ ...project }] : [])),
      },
      projectGroupProjects: {
        findFirst: mock(async () => (link ? { ...link } : undefined)),
        findMany: mock(async () => (link ? [{ ...link }] : [])),
      },
    },
    insert: () => ({
      values: (value: Record<string, unknown>) => ({
        returning: async () => {
          const row = { id: "link-1", ...value }
          inserted.push(row)
          link = row
          return [row]
        },
      }),
    }),
    delete: () => ({ where: () => { link = null } }),
  }

  return { db, inserted, getLink: () => link }
}

describe("addProjectToGroup / removeProjectFromGroup", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  })

  test("adds a project to a group", async () => {
    const { db, getLink } = makeFakeDb({
      group: { id: "group1", orgId: "org1", name: "Q3 Rollouts" },
      project: { id: "proj1", orgId: "org1", name: "Acme" },
    })
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(db)) }))
    const { addProjectToGroup } = await import("./project-group-service")
    const link = await addProjectToGroup({ orgId: "org1" }, "group1", "proj1") as { groupId: string; projectId: string }

    expect(link.groupId).toBe("group1")
    expect(link.projectId).toBe("proj1")
    expect(getLink()).not.toBeNull()
  })

  test("rejects adding the same project to the same group twice", async () => {
    const { db } = makeFakeDb({
      group: { id: "group1", orgId: "org1", name: "Q3 Rollouts" },
      project: { id: "proj1", orgId: "org1", name: "Acme" },
      link: { groupId: "group1", projectId: "proj1" },
    })
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(db)) }))
    const { addProjectToGroup } = await import("./project-group-service")
    await expect(addProjectToGroup({ orgId: "org1" }, "group1", "proj1")).rejects.toThrow("already in this group")
  })

  test("throws 404 when the group does not exist", async () => {
    const { db } = makeFakeDb({ group: null })
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(db)) }))
    const { addProjectToGroup, ServiceError } = await import("./project-group-service")
    try {
      await addProjectToGroup({ orgId: "org1" }, "missing", "proj1")
      throw new Error("expected to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceError)
      expect((error as InstanceType<typeof ServiceError>).status).toBe(404)
    }
  })

  test("removeProjectFromGroup deletes the link", async () => {
    const { db, getLink } = makeFakeDb({
      group: { id: "group1", orgId: "org1", name: "Q3 Rollouts" },
      link: { groupId: "group1", projectId: "proj1" },
    })
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(db)) }))
    const { removeProjectFromGroup } = await import("./project-group-service")
    const result = await removeProjectFromGroup({ orgId: "org1" }, "group1", "proj1") as { removed: boolean }
    expect(result.removed).toBe(true)
    expect(getLink()).toBeNull()
  })
})

describe("createProjectGroup", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  })

  test("rejects an empty name", async () => {
    const { db } = makeFakeDb()
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(db)) }))
    const { createProjectGroup } = await import("./project-group-service")
    await expect(createProjectGroup({ orgId: "org1" }, { name: "" })).rejects.toThrow("name is required")
  })

  test("creates a group with the given name/description/color", async () => {
    const { db, inserted } = makeFakeDb()
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(db)) }))
    const { createProjectGroup } = await import("./project-group-service")
    const group = await createProjectGroup({ orgId: "org1" }, { name: "Q3 Rollouts", color: "#F5820A" }) as { name: string; color: string }
    expect(group.name).toBe("Q3 Rollouts")
    expect(group.color).toBe("#F5820A")
    expect(inserted).toHaveLength(1)
  })
})
