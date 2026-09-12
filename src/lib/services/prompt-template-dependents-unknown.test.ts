// T2-01 (2026-09-12): proves getPromptTemplateDependents()'s "cannot
// determine dependents" (UNKNOWN) state is real and distinct from a
// confirmed empty array -- the whole point of this fix. This is a SEPARATE
// file from prompt-governance-service.test.ts (which imports
// getPromptTemplateDependents statically at the top of the file) because
// mock.module("@/lib/generated/prompt-template-dependents.generated", ...)
// only affects modules imported AFTER the mock is installed; a module
// already cached from a prior static import keeps its original binding.
// Same "mock.module then dynamic import" convention as
// prompt-governance-gates.test.ts.
/// <reference types="bun-types" />
import { describe, expect, test, mock, afterEach } from "bun:test"

afterEach(() => {
  mock.restore()
})

describe("getPromptTemplateDependents -- UNKNOWN state (never a bare empty array standing in for 'could not check')", () => {
  test("falsifiability (b): pointing the runtime read at a broken/empty generated map returns status 'unknown', NOT an empty array", async () => {
    await mock.module("@/lib/generated/prompt-template-dependents.generated", () => ({
      default: {},
      PROMPT_TEMPLATE_DEPENDENTS: {},
      GENERATED_AT: "1970-01-01T00:00:00.000Z",
      SOURCE_FILE_COUNT: 0,
    }))
    const { getPromptTemplateDependents } = await import("./prompt-governance-service")

    // Even for a templateKey that genuinely has a real dependent in the real
    // map (help.ai_assistant_system) -- with the map broken, the honest
    // answer is "unknown", not a silently-wrong "0 dependents".
    const result = getPromptTemplateDependents("help.ai_assistant_system")
    expect(result.status).toBe("unknown")
    expect(result.dependents).toEqual([])
    if (result.status === "unknown") {
      expect(result.reason).toMatch(/0 source file/i)
    }
  })

  test("a missing default export (map entirely absent) also surfaces as 'unknown', not an empty array", async () => {
    await mock.module("@/lib/generated/prompt-template-dependents.generated", () => ({
      default: undefined,
      GENERATED_AT: "1970-01-01T00:00:00.000Z",
      SOURCE_FILE_COUNT: 0,
    }))
    const { getPromptTemplateDependents } = await import("./prompt-governance-service")
    const result = getPromptTemplateDependents("help.ai_assistant_system")
    expect(result.status).toBe("unknown")
    expect(result.dependents).toEqual([])
  })

  test("falsifiability (c): restoring a real, plausibly-sized map returns status 'ok' and finds the known dependent again", async () => {
    await mock.module("@/lib/generated/prompt-template-dependents.generated", () => ({
      default: { "help.ai_assistant_system": ["src/app/api/help/ask/route.ts"] },
      GENERATED_AT: new Date().toISOString(),
      SOURCE_FILE_COUNT: 2645,
    }))
    const { getPromptTemplateDependents } = await import("./prompt-governance-service")
    const result = getPromptTemplateDependents("help.ai_assistant_system")
    expect(result.status).toBe("ok")
    if (result.status === "ok") {
      expect(result.dependents).toEqual([{ file: "src/app/api/help/ask/route.ts" }])
    }
  })
})
