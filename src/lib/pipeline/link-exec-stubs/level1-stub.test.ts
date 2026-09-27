/// <reference types="bun-types" />
// The ai-work-link-exec bundle replaces level1.ts with a stub (link-exec-stubs/level1.ts). level1RefusalCode is pure and IS reached by a link write:
// runDirectTask writes a link submission's telemetry columns through level1Columns(), which calls it. As a thrower in the stub it made that update
// fail after the write (live log, 2026-09-27: "NOT_AVAILABLE_ON_EXEC: level1 level1RefusalCode is not part of the ai-work-link-exec bundle"), so
// model_calls and level1_outcome stayed NULL. This holds the stub equal to the real function for every input the closed vocabulary admits.
import { describe, expect, test } from "bun:test"
import { level1RefusalCode as real, level1OffRunner as realOff } from "../level1"
import { level1RefusalCode as stub, level1OffRunner as stubOff } from "./level1"

describe("link-exec level1 stub", () => {
  test("level1RefusalCode answers exactly what the real one answers, for every outcome, kind and reason", () => {
    const outcomes = ["resolved", "refused", "not_needed", "error"] as const
    const kinds = [null, undefined, "actor_unresolved", "provider_not_allowed"] as const
    const reasons = [null, "", "fetch failed", "Timeout", "ECONNREFUSED", "something else"]
    let checked = 0
    for (const outcome of outcomes) for (const kind of kinds) for (const reason of reasons) {
      expect(stub(outcome, kind as never, reason)).toBe(real(outcome, kind as never, reason))
      checked++
    }
    expect(checked).toBe(96)
  })

  test("the telemetry a link write records (not_needed, no refusal) is a null code, not a throw", () => {
    expect(stub("not_needed", null, null)).toBeNull()
  })

  test("level1OffRunner keeps its real behaviour", async () => {
    expect(await stubOff()(["a", "b"])).toEqual(await realOff()(["a", "b"]))
  })
})
