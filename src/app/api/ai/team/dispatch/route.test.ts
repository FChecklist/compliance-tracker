/// <reference types="bun-types" />
// Audit round 2 (GLM-5.2, finding B5-NEW): round 1's own audit log entry
// CLAIMED a route-level integration test ("dispatch-level-ladder.test.ts")
// that was never actually added -- only the service-layer
// task-register-service.test.ts existed, which never exercises the ROUTE
// itself (contract registration, the retry loop, validateLevelDispatch,
// the capabilityCategory override, or the actual response shape). This
// file is the real fix: it dispatches through POST /api/ai/team/dispatch
// twice with the same taskId and asserts the merged, workflow-level
// Execution Report the route returns is correct end-to-end.
//
// High-level dependency modules are mocked (requireAuth, team-service,
// roster-overrides, mother-router, activity-log-service) -- deterministic
// stand-ins for auth/classification/execution/audit-logging, none of which
// this test is trying to prove. @/lib/db is mocked ONLY for the
// `taskRegister` table, so task-register-service.ts itself runs FOR REAL
// (unmocked) against an in-memory store -- this is the actual code path
// where the round 1 B1-B4 bugs lived, and where round 1's audit log
// falsely claimed route-level coverage already existed.
import { describe, expect, test, mock, afterEach } from "bun:test"

process.env.DATABASE_URL ??= "postgresql://postgres:placeholder@localhost:5432/postgres"
process.env.APP_RUNTIME_DATABASE_URL ??= "postgresql://app_runtime:placeholder@localhost:5432/postgres"

type TaskRegisterRow = { taskId: string; status: string; executionReport: unknown; instructionContract: unknown }

async function setupMocks() {
  const rows = new Map<string, TaskRegisterRow>()

  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuth: mock(async () => ({
      user: { id: "u1", email: "admin@test.com" },
      dbUser: { id: "u1", role: "veridian_admin" },
      orgId: "org-1",
      response: null,
    })),
  }))

  class RoleNotCallableError extends Error {
    constructor(roleKey: string, reason: string) {
      super(`Role '${roleKey}' cannot be called directly: ${reason}`)
      this.name = "RoleNotCallableError"
    }
  }

  mock.module("@/lib/ai-team/team-service", () => ({
    RoleNotCallableError,
    classifyTask: mock(async () => ({ role: "fullstack_developer", reasoning: "test", confidence: 1 })),
    getRole: mock((roleKey: string) => ({ roleKey, team: "ENGINEERING", title: "Full Stack Developer", model: "z-ai/glm-5.2", promptKey: "ai_team.fullstack_developer" })),
    runRole: mock(async (roleKey: string) => ({
      content: "Confident, complete response with no hedging.",
      usage: { promptTokens: 300, completionTokens: 200 },
      role: { roleKey, team: "ENGINEERING", title: "Full Stack Developer", model: "z-ai/glm-5.2", promptKey: "ai_team.fullstack_developer" },
    })),
    runGuardrailLevel: mock(async () => []),
  }))

  mock.module("@/lib/ai-team/roster-overrides", () => ({
    resolveEffectiveModel: mock(async () => "z-ai/glm-5.2"),
  }))

  mock.module("@/lib/ai-router/mother-router", () => ({
    resolveModel: mock(async () => ({ provider: "openrouter", model: "z-ai/glm-5.2", reason: "test stub" })),
  }))

  mock.module("@/lib/activity-log-service", () => ({
    recordActivity: mock(async () => ({ id: "activity-1" })),
  }))

  // Import the REAL db module via a path that bypasses this very mock
  // interception (mock.module matches the literal "@/lib/db" specifier
  // other files import; this relative path resolves to the same file
  // without re-entering the mock) -- so every OTHER table's real shape
  // object (needed by whichever file, transitively, does `import {
  // someOtherTable } from "@/lib/db"`) stays real and importable, and only
  // the `db` CLIENT itself is replaced with this in-memory stand-in. This
  // avoids having to hand-author a stub for every table name the full
  // dependency graph might reference.
  const real = await import("../../../../../lib/db/index")

  mock.module("@/lib/db", () => ({
    ...real,
    db: {
      query: {
        taskRegister: {
          findFirst: mock(async ({ where }: { where?: unknown } = {}) => {
            void where
            // The mock can't evaluate drizzle's `eq()` expression object, so
            // every test in this file uses a distinct taskId and we return
            // the (at most one) row currently stored -- good enough for
            // this file's single-row-at-a-time usage.
            const all = [...rows.values()]
            return all.length > 0 ? { ...all[all.length - 1] } : undefined
          }),
        },
      },
      insert: mock(() => ({
        values: mock((v: Record<string, unknown>) => {
          rows.set(v.taskId as string, { taskId: v.taskId as string, status: v.status as string, executionReport: null, instructionContract: v.instructionContract })
          return Promise.resolve()
        }),
      })),
      update: mock(() => ({
        set: mock((v: Record<string, unknown>) => ({
          where: mock(() => ({
            returning: mock(async () => {
              const existing = [...rows.values()][rows.size - 1]
              if (!existing) return []
              rows.set(existing.taskId, { ...existing, ...v } as TaskRegisterRow)
              return [{ id: existing.taskId }]
            }),
          })),
        })),
      })),
    },
  }))
}

afterEach(() => {
  mock.restore()
})

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/ai/team/dispatch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const BASE_BODY = {
  objective: "Implement the login API endpoint",
  scope: "src/app/api/login/route.ts only",
  successCriteria: "Route compiles and returns 200 on valid credentials",
  complexityTier: "mechanical",
  expectedOutput: "One API route file",
  softwareTeamLevel: "L1",
}

describe("POST /api/ai/team/dispatch -- softwareTeamLevel end-to-end (audit round 2, B5-NEW fix)", () => {
  test("rejects a level/tier mismatch before any model is called", async () => {
    await setupMocks()
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ ...BASE_BODY, taskId: "T-MISMATCH", softwareTeamLevel: "L4", complexityTier: "mechanical" }) as any)
    const body = await res.json()
    expect(res.status).toBe(422)
    expect(body.status).toBe("blocked")
  })

  test("single-step L1 dispatch: registers a contract, runs, returns a completed Execution Report", async () => {
    await setupMocks()
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ ...BASE_BODY, taskId: "T-SINGLE" }) as any)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.softwareTeamLevel).toBe("L1")
    expect(body.executionReport.task_id).toBe("T-SINGLE")
    expect(body.executionReport.steps.length).toBe(1)
    expect(body.taskRegisterStatus).toBe("completed") // expectedSteps defaults to 1
  })

  test("multi-step L2 workflow: reusing the same taskId across two dispatch calls accumulates a workflow-level Execution Report, not 'completed' after step 1", async () => {
    await setupMocks()
    const { POST } = await import("./route")

    const step1Body = { ...BASE_BODY, softwareTeamLevel: "L2", taskId: "T-MULTI", expectedSteps: 2, objective: "Step 1: create the schema migration" }
    const res1 = await POST(makeRequest(step1Body) as any)
    const body1 = await res1.json()
    expect(res1.status).toBe(200)
    expect(body1.taskRegisterStatus).toBe("in_progress") // 1 of 2 expected steps -- NOT completed (round 1's B1 regression)
    expect(body1.executionReport.steps.length).toBe(1)
    expect(body1.executionReport.objective).toBe("Step 1: create the schema migration")

    const step2Body = { ...BASE_BODY, softwareTeamLevel: "L2", taskId: "T-MULTI", objective: "Step 2: wire the API route" }
    const res2 = await POST(makeRequest(step2Body) as any)
    const body2 = await res2.json()
    expect(res2.status).toBe(200)
    expect(body2.taskRegisterStatus).toBe("completed") // 2 of 2 expected steps
    expect(body2.executionReport.steps.length).toBe(2)
    // B4: merged objective stays the FIRST step's, never the second step's narrower one
    expect(body2.executionReport.objective).toBe("Step 1: create the schema migration")
    // B2: execution_summary aggregates across both steps
    expect(body2.executionReport.execution_summary.tokens_used).toBe(1000) // 500 (step1) + 500 (step2)
  })
})
