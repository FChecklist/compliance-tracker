import { describe, expect, test } from "bun:test"
import { checkProblemRecordClosure, checkIncidentClosure } from "./rca-closure-gate"

describe("checkProblemRecordClosure -- ARTICLE-029/031 documented-RCA-before-closure gate", () => {
  test("allows a non-resolving status change with no root cause at all", () => {
    const result = checkProblemRecordClosure({ status: "investigating" }, null)
    expect(result.allowed).toBe(true)
  })

  test("blocks resolving with no root cause", () => {
    const result = checkProblemRecordClosure({ status: "resolved" }, null)
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.reason).toContain("root cause")
  })

  test("blocks resolving with a placeholder root cause", () => {
    const result = checkProblemRecordClosure({ status: "resolved" }, "TBD")
    expect(result.allowed).toBe(false)
  })

  test("blocks resolving with a too-short root cause", () => {
    const result = checkProblemRecordClosure({ status: "resolved" }, "bug")
    expect(result.allowed).toBe(false)
  })

  test("allows resolving with a real, documented root cause", () => {
    const result = checkProblemRecordClosure({ status: "resolved" }, "Connection pool exhaustion under concurrent report generation, fixed by capping pool size.")
    expect(result.allowed).toBe(true)
  })

  test("a status patch with no status field at all is never blocked", () => {
    const result = checkProblemRecordClosure({}, null)
    expect(result.allowed).toBe(true)
  })
})

describe("checkIncidentClosure -- ARTICLE-028/030 CAPA-owner-before-closure gate", () => {
  test("allows advancing to a non-terminal stage with no CAPA owner", () => {
    const result = checkIncidentClosure("investigating", null)
    expect(result.allowed).toBe(true)
  })

  test("blocks closing with no CAPA owner assigned", () => {
    const result = checkIncidentClosure("closed", null)
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.reason).toContain("CAPA")
  })

  test("blocks closing with an empty-string CAPA owner", () => {
    const result = checkIncidentClosure("closed", "   ")
    expect(result.allowed).toBe(false)
  })

  test("allows closing once a CAPA owner is assigned", () => {
    const result = checkIncidentClosure("closed", "user_abc123")
    expect(result.allowed).toBe(true)
  })
})
