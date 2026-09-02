// R67 D-03 -- the server half of the Task Master error dictionary.
import { describe, expect, test } from "bun:test"
import {
  TASK_ERROR_CODES,
  classifyTaskErrorText,
  failureRecord,
  isTaskErrorCode,
  readFailureRecord,
  resolveTaskFailure,
} from "./task-error-codes"

describe("the code set stays closed", () => {
  test("it is exactly the five codes decision D-03 names", () => {
    expect([...TASK_ERROR_CODES].sort()).toEqual([
      "BACKEND_UNAVAILABLE",
      "BOQ_LINE_NOT_FOUND",
      "BOQ_LINE_REQUIRED",
      "PROJECT_REQUIRED",
      "VALUE_REQUIRED",
    ])
  })

  test("isTaskErrorCode rejects anything outside it", () => {
    expect(isTaskErrorCode("PROJECT_REQUIRED")).toBe(true)
    expect(isTaskErrorCode("SOMETHING_ELSE")).toBe(false)
    expect(isTaskErrorCode(null)).toBe(false)
  })
})

describe("the structured failure round-trips through pipeline_tasks.result", () => {
  test("what failureRecord writes, readFailureRecord reads back", () => {
    const record = failureRecord({ code: "BOQ_LINE_NOT_FOUND", context: { lineCode: "1.01", boqVersion: 2 } })
    expect(readFailureRecord(record)).toEqual({
      code: "BOQ_LINE_NOT_FOUND",
      context: { lineCode: "1.01", boqVersion: 2 },
    })
  })

  test("missing survives the round trip", () => {
    const record = failureRecord({ code: "PROJECT_REQUIRED", missing: ["projectId"] })
    expect(readFailureRecord(record)?.missing).toEqual(["projectId"])
  })

  test("no failure means no record at all -- a successful task's result is untouched", () => {
    expect(failureRecord(undefined)).toBeUndefined()
    expect(readFailureRecord({ entryId: "abc", percentComplete: 40 })).toBeNull()
    expect(readFailureRecord(null)).toBeNull()
  })

  test("a result whose failure carries an unknown code is not trusted", () => {
    expect(readFailureRecord({ failure: { code: "MADE_UP" } })).toBeNull()
  })
})

describe("classifyTaskErrorText -- rows written before the structured failure existed", () => {
  test("maps executor.ts's own sentences onto the closed set", () => {
    expect(classifyTaskErrorText("no project resolved for this task")).toEqual({
      code: "PROJECT_REQUIRED",
      missing: ["projectId"],
    })
    expect(classifyTaskErrorText("itemCode is required")).toEqual({
      code: "BOQ_LINE_REQUIRED",
      missing: ["itemCode"],
    })
    expect(classifyTaskErrorText("percent is required")).toEqual({
      code: "VALUE_REQUIRED",
      missing: ["percent"],
    })
  })

  test("keeps the BOQ line code out of the sentence and in the context", () => {
    expect(classifyTaskErrorText(`item code "1.01" not found in this project's BOQ`)).toEqual({
      code: "BOQ_LINE_NOT_FOUND",
      context: { lineCode: "1.01" },
    })
  })

  test("the executor's sanitised internal-error sentence becomes a retryable code", () => {
    expect(
      classifyTaskErrorText(
        "This couldn't be completed right now due to an internal error. Retry shortly, or contact support if it persists."
      )?.code
    ).toBe("BACKEND_UNAVAILABLE")
  })

  test("anything outside the closed set yields no code rather than a guessed one", () => {
    expect(classifyTaskErrorText(`no BOQ found for project "p-1"`)).toBeNull()
    expect(classifyTaskErrorText("")).toBeNull()
    expect(classifyTaskErrorText(null)).toBeNull()
  })
})

describe("resolveTaskFailure", () => {
  test("the persisted structured failure wins over the text", () => {
    const resolved = resolveTaskFailure(failureRecord({ code: "VALUE_REQUIRED", missing: ["percent"] }), "no project resolved for this task")
    expect(resolved?.code).toBe("VALUE_REQUIRED")
  })

  test("falls back to the text when there is no structured failure", () => {
    expect(resolveTaskFailure(null, "no project resolved for this task")?.code).toBe("PROJECT_REQUIRED")
  })

  test("returns null when neither says anything", () => {
    expect(resolveTaskFailure(null, null)).toBeNull()
  })
})
