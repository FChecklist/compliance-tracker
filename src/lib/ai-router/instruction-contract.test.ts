/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  validateInstructionContract,
  validateExecutionReport,
  taskTypeForStepCount,
  type InstructionContract,
  type ExecutionReport,
} from "./instruction-contract"

function validContract(overrides: Partial<InstructionContract> = {}): InstructionContract {
  return {
    taskId: "TASK-001",
    level: "L1",
    roleKey: "fullstack_developer",
    objective: "Generate User Login API",
    preconditions: ["schema already exists"],
    input: "POST /api/login spec",
    process: ["write the route handler", "wire requireAuth"],
    expectedOutputFormat: "one API route file",
    validationCriteria: "compiles + passes lint",
    successCriteria: "route returns 200 on valid credentials",
    failureCriteria: "route throws or returns wrong status",
    retryPolicy: "1 retry",
    escalationRule: "escalate if confidence <95%",
    documentationRequirements: "inline comments only where non-obvious",
    evidenceRequired: "the diff + test run output",
    handoverRequirements: "Execution Report handed to L4",
    expectedSteps: 1,
    ...overrides,
  }
}

describe("validateInstructionContract", () => {
  test("a fully-specified contract is valid", () => {
    expect(validateInstructionContract(validContract())).toEqual({ valid: true })
  })

  test("missing objective is rejected with guidance, not silently accepted", () => {
    const result = validateInstructionContract(validContract({ objective: "" }))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain("objective")
  })

  test("empty preconditions array is rejected -- 'none' must be explicit, never omitted", () => {
    const result = validateInstructionContract(validContract({ preconditions: [] }))
    expect(result.valid).toBe(false)
  })

  test("empty process array is rejected -- the agent must not invent its own process", () => {
    const result = validateInstructionContract(validContract({ process: [] }))
    expect(result.valid).toBe(false)
  })

  test("placeholder-length field (below MIN_FIELD_LENGTH) is rejected", () => {
    const result = validateInstructionContract(validContract({ retryPolicy: "ok" }))
    expect(result.valid).toBe(false)
  })

  // Audit round 1 (GLM-5.2, m4): level was only truthiness-checked before.
  test("an unrecognized level value ('L9') is rejected, not just checked for truthiness", () => {
    const result = validateInstructionContract(validContract({ level: "L9" as unknown as InstructionContract["level"] }))
    expect(result.valid).toBe(false)
  })

  // Audit round 2 (GLM-5.2, m9): L0/L5 are real SoftwareTeamLevel values
  // but never dispatchable -- a contract naming either must be rejected
  // too, not just genuinely-unrecognized strings.
  test("L0 (no AI) and L5 (the router itself) are rejected -- neither is ever a dispatchable contract recipient", () => {
    expect(validateInstructionContract(validContract({ level: "L0" })).valid).toBe(false)
    expect(validateInstructionContract(validContract({ level: "L5" })).valid).toBe(false)
  })

  // Audit round 1 (GLM-5.2, B1): expectedSteps backs the "don't mark a
  // multi-step workflow completed after step 1" fix -- must itself be a
  // real positive integer, never omitted/invented.
  test("expectedSteps=0 or non-integer is rejected", () => {
    expect(validateInstructionContract(validContract({ expectedSteps: 0 })).valid).toBe(false)
    expect(validateInstructionContract(validContract({ expectedSteps: 1.5 })).valid).toBe(false)
  })
})

describe("taskTypeForStepCount -- Owner's literal step-count naming", () => {
  test("1 step -> Single Step", () => expect(taskTypeForStepCount(1)).toBe("Single Step"))
  test("2 steps -> Two Step", () => expect(taskTypeForStepCount(2)).toBe("Two Step"))
  test("3 steps -> Three Step", () => expect(taskTypeForStepCount(3)).toBe("Three Step"))
  test("4+ steps -> Multi Step", () => {
    expect(taskTypeForStepCount(4)).toBe("Multi Step")
    expect(taskTypeForStepCount(8)).toBe("Multi Step")
  })
})

// Owner's own 4 worked examples, used verbatim as regression fixtures --
// these MUST validate as structurally correct, since they ARE the schema.
describe("validateExecutionReport -- Owner's literal worked examples", () => {
  test("Single Step example (TASK-001) validates", () => {
    const report: ExecutionReport = {
      task_id: "TASK-001", task_type: "Single Step", objective: "Generate User Login API",
      status: "PASS", overall_confidence: 99,
      completion: { completed: 1, expected: 1, percentage: 100 },
      steps: [{ step_no: 1, name: "Generate API", status: "PASS", confidence: 99, retry_count: 0, validation: "PASS" }],
      missing: [], warnings: [], errors: [],
      escalation: { required: false, reason: "" },
      execution_summary: { duration_seconds: 8, tokens_used: 812, files_created: 1 },
    }
    expect(validateExecutionReport(report)).toEqual({ valid: true })
  })

  test("Multi Step example (TASK-004, 8 steps) validates", () => {
    const report: ExecutionReport = {
      task_id: "TASK-004", task_type: "Multi Step", objective: "Implement Complete User Management Module",
      status: "PASS", overall_confidence: 97,
      completion: { completed: 8, expected: 8, percentage: 100 },
      steps: Array.from({ length: 8 }, (_, i) => ({ step_no: i + 1, name: `Step ${i + 1}`, status: "PASS" as const, confidence: 97, retry_count: i === 3 ? 1 : 0, validation: "PASS" as const })),
      missing: [], warnings: ["Frontend required one retry before validation passed."], errors: [],
      escalation: { required: false, reason: "" },
      execution_summary: { duration_seconds: 124, tokens_used: 11480, files_created: 18, files_modified: 9, tests_passed: 42, tests_failed: 0 },
    }
    expect(validateExecutionReport(report)).toEqual({ valid: true })
  })

  test("completion.percentage inconsistent with completed/expected is rejected -- the agent must not invent a mismatched percentage", () => {
    const report: ExecutionReport = {
      task_id: "TASK-X", task_type: "Two Step", objective: "x", status: "PARTIAL", overall_confidence: 80,
      completion: { completed: 1, expected: 2, percentage: 100 }, // should be 50
      steps: [{ step_no: 1, name: "a", status: "PASS", confidence: 80, retry_count: 0, validation: "PASS" }],
      missing: [], warnings: [], errors: [],
      escalation: { required: false, reason: "" },
      execution_summary: { duration_seconds: 1, tokens_used: 1 },
    }
    const result = validateExecutionReport(report)
    expect(result.valid).toBe(false)
  })

  test("escalation.required=true with an empty reason is rejected -- never a silent/unexplained escalation flag", () => {
    const report: ExecutionReport = {
      task_id: "TASK-X", task_type: "Single Step", objective: "x", status: "FAIL", overall_confidence: 40,
      completion: { completed: 0, expected: 1, percentage: 0 },
      steps: [{ step_no: 1, name: "a", status: "FAIL", confidence: 40, retry_count: 1, validation: "FAIL" }],
      missing: [], warnings: [], errors: ["it broke"],
      escalation: { required: true, reason: "" },
      execution_summary: { duration_seconds: 1, tokens_used: 1 },
    }
    const result = validateExecutionReport(report)
    expect(result.valid).toBe(false)
  })

  test("empty steps array is rejected -- the agent must never silently omit what it actually did", () => {
    const report = {
      task_id: "TASK-X", task_type: "Single Step" as const, objective: "x", status: "PASS" as const, overall_confidence: 90,
      completion: { completed: 0, expected: 0, percentage: 0 },
      steps: [],
      missing: [], warnings: [], errors: [],
      escalation: { required: false, reason: "" },
      execution_summary: { duration_seconds: 1, tokens_used: 1 },
    }
    expect(validateExecutionReport(report).valid).toBe(false)
  })
})
