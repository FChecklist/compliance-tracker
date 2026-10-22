// Sumeet UI audit 2026-10-20 (defect 1): createSiteInstruction's project check and its SI-number count are independent, so they
// are issued together (one round trip, not two in sequence), and an unknown project still writes nothing.
/// <reference types="bun-types" />
import { describe, expect, test, mock, beforeEach } from "bun:test"

const events: string[] = []
let projectFound = true
let release: (() => void) | null = null
const gate = () => new Promise<void>((r) => { release = r })

const fakeDb = {
  query: {
    projects: {
      findFirst: async () => {
        events.push("project:start")
        await gate()
        events.push("project:end")
        return projectFound ? { id: "p1" } : undefined
      },
    },
  },
  select: () => ({
    from: () => ({
      where: async () => {
        events.push("count:start")
        // the project check is still pending here: they overlap
        release?.()
        events.push("count:end")
        return [{ value: 2 }]
      },
    }),
  }),
  insert: () => ({
    values: (v: Record<string, unknown>) => ({
      returning: async () => {
        events.push("insert")
        return [{ id: "si1", ...v }]
      },
    }),
  }),
}

mock.module("@/lib/db/tenant-scoped", () => ({
  withTenantContext: async (_ctx: unknown, fn: (db: unknown) => unknown) => fn(fakeDb),
}))

const { createSiteInstruction } = await import("./construction-site-instruction-service")
const input = { projectId: "p1", issueDate: "2026-10-20", toContractor: "Apex", description: "Move the wall" }

beforeEach(() => { events.length = 0; projectFound = true; release = null })

describe("createSiteInstruction round trips", () => {
  test("the project check and the SI-number count are in flight together, and the insert waits for both", async () => {
    const row = await createSiteInstruction({ orgId: "o", userId: "u" }, input)
    expect(events.indexOf("count:start")).toBeLessThan(events.indexOf("project:end"))
    expect(events.indexOf("insert")).toBeGreaterThan(events.indexOf("project:end"))
    expect(row.siNumber).toBe(3)
  })

  test("an unknown project is a 404 and nothing is inserted", async () => {
    projectFound = false
    await expect(createSiteInstruction({ orgId: "o", userId: "u" }, input)).rejects.toThrow("Project not found")
    expect(events).not.toContain("insert")
  })
})
