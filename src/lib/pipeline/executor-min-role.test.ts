/// <reference types="bun-types" />
// Audit 37 point 12: the per-function minimum role declared in function-registry.ts is enforced centrally by executeTask().
// Run for falsifiability: delete the `minRole` block in executeTask() and the member-refused tests here fail.
// Run: bun test --isolate src/lib/pipeline/executor-min-role.test.ts
import { describe, expect, test } from "bun:test"
import { executeTask, hasExecutor, type ExecutableTask } from "./executor"
import { ALL_FUNCTION_SPECS, MANAGER_MIN_ROLE_FUNCTION_IDS, functionSpec } from "./function-registry"

const task = (functionId: string, role: string | null): ExecutableTask =>
  ({ functionId, role, orgId: "org-1", userId: "u-1", actorUserId: "person-1", projectId: "p-1", params: {} }) as unknown as ExecutableTask

/** An executor stand-in that records that it ran. */
function rig() {
  const ran: string[] = []
  const executors = new Proxy({} as Record<string, (t: ExecutableTask) => Promise<{ success: true; result: unknown }>>, {
    get: (_t, id: string) => async () => {
      ran.push(id)
      return { success: true as const, result: {} }
    },
  })
  return { ran, executors: executors as never }
}

describe("a function that declares minRole manager", () => {
  test("a member is refused NOT_PERMITTED before the executor runs; a manager and an admin pass", async () => {
    const r = rig()
    const refused = await executeTask(task("approve_timesheet", "member"), r.executors)
    expect(refused.success).toBe(false)
    expect(JSON.stringify(refused)).toContain("NOT_PERMITTED")
    expect(JSON.stringify(refused)).toContain("manager_rank_required")
    expect(r.ran).toEqual([])
    expect((await executeTask(task("approve_timesheet", "manager"), r.executors)).success).toBe(true)
    expect((await executeTask(task("approve_timesheet", "admin"), r.executors)).success).toBe(true)
    expect(r.ran).toEqual(["approve_timesheet", "approve_timesheet"])
  })

  test("an absent or unknown role fails closed, for every declared function", async () => {
    for (const id of MANAGER_MIN_ROLE_FUNCTION_IDS) {
      const r = rig()
      for (const role of [null, "", "intruder", "viewer", "member"]) {
        const out = await executeTask(task(id, role), r.executors)
        expect(out.success).toBe(false)
      }
      expect(r.ran).toEqual([])
      expect((await executeTask(task(id, "manager"), r.executors)).success).toBe(true)
    }
  })
})

describe("a function that declares nothing is unchanged", () => {
  test("a member still reaches the executor of a member-level function", async () => {
    const r = rig()
    expect(functionSpec("record_work_progress")?.minRole).toBeUndefined()
    expect((await executeTask(task("record_work_progress", "member"), r.executors)).success).toBe(true)
    expect(r.ran).toEqual(["record_work_progress"])
  })
})

describe("the declared table", () => {
  test("every id is a registered function with an executor, and its spec carries minRole manager", () => {
    for (const id of MANAGER_MIN_ROLE_FUNCTION_IDS) {
      expect(functionSpec(id)?.minRole).toBe("manager")
      expect(hasExecutor(id)).toBe(true)
    }
    const declared = ALL_FUNCTION_SPECS.filter((s) => s.minRole).map((s) => s.functionId).sort()
    expect(declared).toEqual([...MANAGER_MIN_ROLE_FUNCTION_IDS].sort())
  })
})
