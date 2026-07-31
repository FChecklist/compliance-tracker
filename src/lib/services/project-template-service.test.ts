// Task #47 PM gap analysis (2026-07-31): proves createProjectFromTemplate()
// actually produces the real cloned structure (phases + tasks linked to the
// right phases + default team assignment), plus pure unit tests for the
// index-resolution logic that makes that linkage work -- same "pure
// function tested directly, service function tested with only
// withTenantContext mocked" split as pms-time-service.test.ts.
/// <reference types="bun-types" />
import { describe, expect, test, mock, afterEach } from "bun:test"
import { buildClonedPhaseRows, buildClonedTaskRows } from "./project-template-service"

describe("buildClonedPhaseRows -- pure", () => {
  test("maps template phase defs to insert rows, defaulting position to array index", () => {
    const rows = buildClonedPhaseRows(
      [{ name: "Discovery" }, { name: "Build", description: "Implementation phase" }],
      "org1", "proj1"
    )
    expect(rows).toEqual([
      { orgId: "org1", projectId: "proj1", name: "Discovery", description: null, position: 0 },
      { orgId: "org1", projectId: "proj1", name: "Build", description: "Implementation phase", position: 1 },
    ])
  })

  test("respects an explicit position when provided", () => {
    const rows = buildClonedPhaseRows([{ name: "Wrap-up", position: 5 }], "org1", "proj1")
    expect(rows[0].position).toBe(5)
  })
})

describe("buildClonedTaskRows -- pure", () => {
  test("resolves phaseIndex to the real created phase id via phaseIdByIndex", () => {
    const phaseIdByIndex = new Map([[0, "phase-a"], [1, "phase-b"]])
    const rows = buildClonedTaskRows(
      [
        { title: "Kickoff call", phaseIndex: 0 },
        { title: "Write spec", phaseIndex: 1 },
      ],
      "org1", "proj1", phaseIdByIndex
    )
    expect(rows[0]).toEqual({ orgId: "org1", projectId: "proj1", phaseId: "phase-a", title: "Kickoff call", description: null, position: 0 })
    expect(rows[1].phaseId).toBe("phase-b")
  })

  test("a null/undefined phaseIndex maps to a null phaseId (task has no phase)", () => {
    const rows = buildClonedTaskRows([{ title: "Unphased task" }], "org1", "proj1", new Map())
    expect(rows[0].phaseId).toBeNull()
  })

  test("an out-of-range phaseIndex maps to null rather than throwing", () => {
    const rows = buildClonedTaskRows([{ title: "Orphaned", phaseIndex: 99 }], "org1", "proj1", new Map([[0, "phase-a"]]))
    expect(rows[0].phaseId).toBeNull()
  })
})

const realTenantScoped = await import("@/lib/db/tenant-scoped")

/**
 * Fake db supporting exactly the calls createProjectFromTemplate() makes:
 * one findFirst (the template), a products lookup+insert (General product
 * auto-resolve, mirrors product-service.ts), a projects insert, N sequential
 * projectPhases inserts, one bulk projectTasks insert, and an optional
 * projectTeamAssignments insert. Records everything inserted so the test can
 * assert on the real, final shape -- not just that functions were called.
 */
function makeFakeDb(template: Record<string, unknown>) {
  const insertedPhases: Record<string, unknown>[] = []
  let insertedTasks: Record<string, unknown>[] = []
  let insertedTeamAssignment: Record<string, unknown> | null = null
  let phaseCounter = 0

  const db = {
    query: {
      projectTemplates: { findFirst: mock(async () => ({ ...template })) },
      products: { findFirst: mock(async () => ({ id: "product-general", orgId: "org1", slug: "general", name: "General" })) },
    },
    insert: (table: unknown) => ({
      values: (value: Record<string, unknown> | Record<string, unknown>[]) => ({
        returning: async () => {
          if (Array.isArray(value)) {
            // projectTasks bulk insert
            insertedTasks = value.map((v, i) => ({ id: `task-${i}`, ...v }))
            return insertedTasks
          }
          if ("productId" in value) {
            return [{ id: "proj-new", ...value }]
          }
          if ("teamId" in value) {
            insertedTeamAssignment = { id: "assignment-1", ...value }
            return [insertedTeamAssignment]
          }
          // projectPhases single insert
          const row = { id: `phase-${phaseCounter++}`, ...value }
          insertedPhases.push(row)
          return [row]
        },
      }),
    }),
  }

  return { db, insertedPhases, getInsertedTasks: () => insertedTasks, getInsertedTeamAssignment: () => insertedTeamAssignment }
}

describe("createProjectFromTemplate -- proves the real cloned structure", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  })

  test("clones phases + tasks (linked to their real cloned phase) + default team into the new project", async () => {
    const template = {
      id: "tmpl-1", orgId: "org1", name: "Standard Onboarding", defaultTeamId: "team-1",
      phases: [{ name: "Discovery", position: 0 }, { name: "Build", position: 1 }],
      tasks: [
        { title: "Kickoff call", phaseIndex: 0, position: 0 },
        { title: "Requirements doc", phaseIndex: 0, position: 1 },
        { title: "Implement feature", phaseIndex: 1, position: 0 },
        { title: "Unphased followup" },
      ],
    }
    const { db, insertedPhases, getInsertedTasks, getInsertedTeamAssignment } = makeFakeDb(template)
    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScoped,
      withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(db)),
    }))

    const { createProjectFromTemplate } = await import("./project-template-service")
    const result = await createProjectFromTemplate({ orgId: "org1", userId: "user1" }, "tmpl-1", { name: "Acme Rollout" }) as {
      project: { id: string; name: string }
      phases: { id: string; name: string }[]
      tasks: { id: string; phaseId: string | null; title: string }[]
      teamAssignment: { teamId: string; projectId: string; isPrimary: boolean } | null
    }

    expect(result.project.name).toBe("Acme Rollout")
    expect(insertedPhases.map((p) => p.name)).toEqual(["Discovery", "Build"])
    expect(result.phases).toHaveLength(2)

    const discoveryPhaseId = result.phases[0].id
    const buildPhaseId = result.phases[1].id
    expect(discoveryPhaseId).not.toBe(buildPhaseId)

    const tasks = getInsertedTasks()
    expect(tasks).toHaveLength(4)
    expect(tasks.find((t) => t.title === "Kickoff call")?.phaseId).toBe(discoveryPhaseId)
    expect(tasks.find((t) => t.title === "Requirements doc")?.phaseId).toBe(discoveryPhaseId)
    expect(tasks.find((t) => t.title === "Implement feature")?.phaseId).toBe(buildPhaseId)
    expect(tasks.find((t) => t.title === "Unphased followup")?.phaseId).toBeNull()

    const teamAssignment = getInsertedTeamAssignment()
    expect(teamAssignment?.teamId).toBe("team-1")
    expect(teamAssignment?.projectId).toBe(result.project.id)
    expect(teamAssignment?.isPrimary).toBe(true)
  })

  test("a template with no default team clones structure without creating a team assignment", async () => {
    const template = {
      id: "tmpl-2", orgId: "org1", name: "No Team Template", defaultTeamId: null,
      phases: [{ name: "Solo phase", position: 0 }],
      tasks: [{ title: "Solo task", phaseIndex: 0, position: 0 }],
    }
    const { db, getInsertedTeamAssignment } = makeFakeDb(template)
    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScoped,
      withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(db)),
    }))

    const { createProjectFromTemplate } = await import("./project-template-service")
    const result = await createProjectFromTemplate({ orgId: "org1", userId: "user1" }, "tmpl-2", { name: "Solo Project" }) as {
      teamAssignment: unknown
    }

    expect(result.teamAssignment).toBeNull()
    expect(getInsertedTeamAssignment()).toBeNull()
  })

  test("throws a 404 ServiceError when the template does not exist", async () => {
    const { db } = makeFakeDb({})
    db.query.projectTemplates.findFirst = mock(async () => undefined) as never
    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScoped,
      withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(db)),
    }))

    const { createProjectFromTemplate, ServiceError } = await import("./project-template-service")
    await expect(createProjectFromTemplate({ orgId: "org1", userId: "user1" }, "missing", { name: "X" }))
      .rejects.toThrow("Project template not found")
    try {
      await createProjectFromTemplate({ orgId: "org1", userId: "user1" }, "missing", { name: "X" })
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceError)
      expect((error as InstanceType<typeof ServiceError>).status).toBe(404)
    }
  })
})
