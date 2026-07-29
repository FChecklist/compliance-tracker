/// <reference types="bun-types" />
// VERIDIAN_CONSOLIDATED_COMPLETION Stage 12: dispatch-memory-service.ts
// mocks @/lib/db entirely, same established convention as
// roster-overrides.test.ts / orchestra-model-resolver.test.ts -- never
// touching a live DB (or, per this stage's explicit scope, any real AI
// provider -- this module makes no LLM calls at all) from a .test.ts file.
// All "prior dispatch" records below are fake/fixture data constructed
// in-process, not real dispatch history.
import { describe, expect, test, mock, afterEach } from "bun:test"

type FakeOutcomeRow = {
  id: string
  roleKey?: string
  objectiveHash?: string
  objective_summary: string
  status: string
  created_at: Date
}

function mockDb(opts: {
  findFirstResult?: FakeOutcomeRow | undefined
  executeResult?: Array<{ id: string; objective_summary: string; status: string; created_at: Date; score: number }>
  captureInsert?: (values: unknown) => void
}) {
  mock.module("@/lib/db", () => ({
    db: {
      query: {
        dispatchOutcomes: {
          findFirst: mock(async () => opts.findFirstResult),
        },
      },
      execute: mock(async () => opts.executeResult ?? []),
      insert: mock(() => ({
        values: mock(async (values: unknown) => {
          opts.captureInsert?.(values)
          return undefined
        }),
      })),
    },
    dispatchOutcomes: { roleKey: "role_key", objectiveHash: "objective_hash" },
  }))
}

afterEach(() => {
  mock.restore()
})

describe("hashObjective / normalizeObjective", () => {
  test("two objectives differing only in case/whitespace hash identically", async () => {
    const { hashObjective } = await import("./dispatch-memory-service")
    const a = hashObjective("Build the invoice PDF export  feature")
    const b = hashObjective("  build the invoice pdf export feature ")
    expect(a).toBe(b)
  })

  test("genuinely different objectives hash differently", async () => {
    const { hashObjective } = await import("./dispatch-memory-service")
    const a = hashObjective("Build the invoice PDF export feature")
    const b = hashObjective("Build the payroll CSV export feature")
    expect(a).not.toBe(b)
  })
})

describe("recordDispatchOutcome", () => {
  test("(a) a new dispatch outcome is correctly recorded", async () => {
    let captured: Record<string, unknown> | undefined
    mockDb({ captureInsert: (v) => { captured = v as Record<string, unknown> } })
    const { recordDispatchOutcome, hashObjective } = await import("./dispatch-memory-service")

    await recordDispatchOutcome({
      roleKey: "senior_backend_engineer",
      objective: "Build the invoice PDF export feature",
      status: "completed",
      model: "z-ai/glm-5.2",
      dispatchSurface: "team_service_run_role",
    })

    expect(captured).toBeDefined()
    expect(captured!.roleKey).toBe("senior_backend_engineer")
    expect(captured!.status).toBe("completed")
    expect(captured!.model).toBe("z-ai/glm-5.2")
    expect(captured!.dispatchSurface).toBe("team_service_run_role")
    expect(captured!.objectiveSummary).toBe("Build the invoice PDF export feature")
    expect(captured!.objectiveHash).toBe(hashObjective("Build the invoice PDF export feature"))
  })

  test("never throws even if the DB write fails (fire-and-forget safe, same convention as logTokenUsage)", async () => {
    mock.module("@/lib/db", () => ({
      db: {
        query: { dispatchOutcomes: { findFirst: mock(async () => undefined) } },
        execute: mock(async () => []),
        insert: mock(() => ({
          values: mock(async () => { throw new Error("simulated DB outage") }),
        })),
      },
      dispatchOutcomes: { roleKey: "role_key", objectiveHash: "objective_hash" },
    }))
    const { recordDispatchOutcome } = await import("./dispatch-memory-service")
    await expect(
      recordDispatchOutcome({
        roleKey: "senior_backend_engineer",
        objective: "Build the invoice PDF export feature",
        status: "completed",
        dispatchSurface: "team_service_run_role",
      })
    ).resolves.toBeUndefined()
  })
})

describe("checkPriorDispatch", () => {
  test("(b) correctly identifies an EXACT prior dispatch when one exists in the test data", async () => {
    const fakeRow: FakeOutcomeRow = {
      id: "fake-outcome-1",
      objective_summary: "Build the invoice PDF export feature",
      status: "completed",
      created_at: new Date("2026-07-20T10:00:00Z"),
    }
    mockDb({ findFirstResult: fakeRow })
    const { checkPriorDispatch } = await import("./dispatch-memory-service")

    const match = await checkPriorDispatch("senior_backend_engineer", "Build the invoice PDF export feature")

    expect(match).not.toBeNull()
    expect(match!.matchType).toBe("exact")
    expect(match!.id).toBe("fake-outcome-1")
    expect(match!.status).toBe("completed")
  })

  test("(b) falls back to a SIMILAR match (pg_trgm) when no exact hash match exists", async () => {
    mockDb({
      findFirstResult: undefined,
      executeResult: [
        {
          id: "fake-outcome-2",
          objective_summary: "Build the invoice PDF export capability",
          status: "completed",
          created_at: new Date("2026-07-18T09:00:00Z"),
          score: 0.82,
        },
      ],
    })
    const { checkPriorDispatch } = await import("./dispatch-memory-service")

    const match = await checkPriorDispatch("senior_backend_engineer", "Build the invoice PDF export feature")

    expect(match).not.toBeNull()
    expect(match!.matchType).toBe("similar")
    expect(match!.id).toBe("fake-outcome-2")
    expect(match!.score).toBe(0.82)
  })

  test("(b) correctly returns 'no match' when nothing similar exists in the test data", async () => {
    mockDb({ findFirstResult: undefined, executeResult: [] })
    const { checkPriorDispatch } = await import("./dispatch-memory-service")

    const match = await checkPriorDispatch("senior_backend_engineer", "A completely unrelated brand-new objective")

    expect(match).toBeNull()
  })

  // (c) "if tenant-scoped, a cross-tenant record is correctly NOT visible":
  // deliberately N/A here, not skipped by omission. dispatchOutcomes is a
  // platform-wide table (see schema.ts's comment on the table and this
  // module's file header) -- team-service.ts's own header states the AI
  // Dev Team "builds VERIDIAN, it doesn't run inside" a customer org, so
  // every real row this table ever holds is platform-internal with no
  // org_id at all. checkPriorDispatch() takes no org/tenant parameter and
  // withTenantContext is not used, by design, matching the same posture as
  // platform.ai_team_role_overrides (roster-overrides.ts) and the
  // platform-internal rows of token_usage_ledger. There is no tenant
  // dimension for a cross-tenant-visibility test to exercise.
  test("(c) N/A -- dispatchOutcomes is platform-wide by design, not tenant-scoped (see comment above)", () => {
    expect(true).toBe(true)
  })
})
