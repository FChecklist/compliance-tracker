/// <reference types="bun-types" />
// AI Model Lifecycle & Benchmarking gap-closure (2026-08-15) -- see this
// module's own header for the full investigation (why this is not a
// duplicate of ai_model_registry.status, roster-overrides.ts's
// setRoleOverride/clearRoleOverride, or mother-router.ts's
// rollbackPolicy()). @/lib/db is mock.module()'d here, matching this
// codebase's established pattern for this kind of dependency (never
// touching a live DB from a .test.ts file).
//
// mock.module() replaces what "@/lib/db" resolves to for the rest of the
// bun test PROCESS, not just this file (confirmed empirically: running
// this file before orchestra-model-resolver.test.ts in one `bun test`
// invocation broke ~30 of its tests with "Export named 'X' not found in
// module .../db.ts" -- this file's last, intentionally thin mock (only
// aiModelEmergencyRevertLog) was still in effect when that file's own
// top-level `import { db, orchestraLayers, ... } from "@/lib/db"`
// evaluated). Capturing the real module up front and restoring it in
// afterAll is what actually fixes that -- `mock.restore()` alone does not
// un-mock a mock.module() call.
import { describe, expect, test, mock, afterEach, afterAll } from "bun:test"

const realDbModule = await import("@/lib/db")

function mockLog(latest: { action: string; triggeredByUserId?: string | null; reason?: string | null; createdAt?: Date } | undefined) {
  const inserted: Array<{ action: string; triggeredByUserId?: string; reason?: string | null }> = []
  mock.module("@/lib/db", () => ({
    db: {
      query: {
        aiModelEmergencyRevertLog: { findFirst: mock(async () => latest) },
      },
      insert: mock(() => ({
        values: mock((v: { action: string; triggeredByUserId?: string; reason?: string | null }) => {
          inserted.push(v)
          return Promise.resolve()
        }),
      })),
    },
    aiModelEmergencyRevertLog: {},
  }))
  return inserted
}

afterEach(async () => {
  const { invalidateEmergencyRevertCache } = await import("./ai-model-emergency-revert")
  invalidateEmergencyRevertCache()
  mock.restore()
})

// See the file-header comment -- mock.restore() does not undo a
// mock.module() call, so without this, this file's last thin "@/lib/db"
// mock would leak into every test file that runs after it in the same
// `bun test` invocation.
afterAll(() => {
  mock.module("@/lib/db", () => realDbModule)
})

describe("isEmergencyRevertActive", () => {
  test("true when the most recent event is 'activated'", async () => {
    mockLog({ action: "activated", createdAt: new Date() })
    const { isEmergencyRevertActive } = await import("./ai-model-emergency-revert")
    expect(await isEmergencyRevertActive()).toBe(true)
  })

  test("false when the most recent event is 'deactivated'", async () => {
    mockLog({ action: "deactivated", createdAt: new Date() })
    const { isEmergencyRevertActive } = await import("./ai-model-emergency-revert")
    expect(await isEmergencyRevertActive()).toBe(false)
  })

  test("false when no event has ever been recorded", async () => {
    mockLog(undefined)
    const { isEmergencyRevertActive } = await import("./ai-model-emergency-revert")
    expect(await isEmergencyRevertActive()).toBe(false)
  })

  test("fails CLOSED (false) on a DB error -- a hiccup must never mass-downgrade every model resolution", async () => {
    mock.module("@/lib/db", () => ({
      db: {
        query: {
          aiModelEmergencyRevertLog: { findFirst: mock(async () => { throw new Error("connection refused") }) },
        },
      },
      aiModelEmergencyRevertLog: {},
    }))
    const { isEmergencyRevertActive } = await import("./ai-model-emergency-revert")
    expect(await isEmergencyRevertActive()).toBe(false)
  })
})

describe("activateEmergencyRevert / deactivateEmergencyRevert", () => {
  test("activate records an 'activated' event with the triggering user and reason", async () => {
    const inserted = mockLog(undefined)
    const { activateEmergencyRevert } = await import("./ai-model-emergency-revert")
    await activateEmergencyRevert("admin-1", "bad promoted model causing 5xx spikes")
    expect(inserted).toEqual([{ action: "activated", triggeredByUserId: "admin-1", reason: "bad promoted model causing 5xx spikes" }])
  })

  test("deactivate records a 'deactivated' event", async () => {
    const inserted = mockLog(undefined)
    const { deactivateEmergencyRevert } = await import("./ai-model-emergency-revert")
    await deactivateEmergencyRevert("admin-1")
    expect(inserted).toEqual([{ action: "deactivated", triggeredByUserId: "admin-1", reason: null }])
  })

  test("activate immediately flips isEmergencyRevertActive() for the same process (cache invalidated, not just TTL-expired)", async () => {
    let latest: { action: string; createdAt: Date } | undefined = undefined
    mock.module("@/lib/db", () => ({
      db: {
        query: {
          aiModelEmergencyRevertLog: { findFirst: mock(async () => latest) },
        },
        insert: mock(() => ({
          values: mock((v: { action: string }) => {
            latest = { action: v.action, createdAt: new Date() }
            return Promise.resolve()
          }),
        })),
      },
      aiModelEmergencyRevertLog: {},
    }))
    const { isEmergencyRevertActive, activateEmergencyRevert, invalidateEmergencyRevertCache } = await import("./ai-model-emergency-revert")
    invalidateEmergencyRevertCache()
    expect(await isEmergencyRevertActive()).toBe(false)
    await activateEmergencyRevert("admin-1", "test")
    expect(await isEmergencyRevertActive()).toBe(true) // no manual invalidate needed -- activateEmergencyRevert does it itself
  })
})

describe("getEmergencyRevertStatus", () => {
  test("returns active + the last event when one exists", async () => {
    const when = new Date("2026-08-15T07:00:00Z")
    mockLog({ action: "activated", triggeredByUserId: "admin-1", reason: "incident-42", createdAt: when })
    const { getEmergencyRevertStatus } = await import("./ai-model-emergency-revert")
    const status = await getEmergencyRevertStatus()
    expect(status).toEqual({
      active: true,
      lastEvent: { action: "activated", triggeredByUserId: "admin-1", reason: "incident-42", createdAt: when },
    })
  })

  test("returns inactive + null lastEvent when nothing has ever been recorded", async () => {
    mockLog(undefined)
    const { getEmergencyRevertStatus } = await import("./ai-model-emergency-revert")
    expect(await getEmergencyRevertStatus()).toEqual({ active: false, lastEvent: null })
  })
})
