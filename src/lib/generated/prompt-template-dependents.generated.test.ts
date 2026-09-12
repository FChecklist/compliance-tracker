// STANDING PROOF (T2-01, 2026-09-12), same spirit as this codebase's other
// drift guards (authz-gap-inventory.test.ts, vercel-lockdown.test.ts): the
// whole point of moving getPromptTemplateDependents() from a request-time fs
// walk to a build-time generated map is defeated if the generated map can
// silently go empty/stale again without anyone noticing. This test fails
// CI the moment that happens -- it does NOT assert the exact templateKey
// count (that will grow as the product does), only that the map is
// present, non-trivially sized, and was produced by a real scan (not a
// hand-edited stub or an empty-tree artifact).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import PROMPT_TEMPLATE_DEPENDENTS, {
  GENERATED_AT,
  SOURCE_FILE_COUNT,
} from "./prompt-template-dependents.generated"

describe("prompt-template-dependents.generated.ts -- standing proof the build-time map exists and is non-empty", () => {
  test("SOURCE_FILE_COUNT is well above the plausibility floor getPromptTemplateDependents() itself enforces (50)", () => {
    // Regression guard for the exact defect this map replaces: a walk
    // against a missing/empty src/ tree produces a near-zero count. This
    // repo has thousands of real .ts/.tsx files under src/ -- 500 is a
    // generous floor that would already catch a badly wrong root.
    expect(SOURCE_FILE_COUNT).toBeGreaterThan(500)
  })

  test("GENERATED_AT is a real, parseable ISO timestamp", () => {
    expect(Number.isNaN(Date.parse(GENERATED_AT))).toBe(false)
  })

  test("the map has at least one real templateKey -> dependent-file entry", () => {
    const keys = Object.keys(PROMPT_TEMPLATE_DEPENDENTS)
    expect(keys.length).toBeGreaterThan(0)
    const totalEdges = Object.values(PROMPT_TEMPLATE_DEPENDENTS).reduce((sum, files) => sum + files.length, 0)
    expect(totalEdges).toBeGreaterThan(0)
  })

  test("falsifiability (a): the map contains the known, deliberately-planted 'help.ai_assistant_system' -> app/api/help/ask/route.ts edge", () => {
    // This is a REAL, pre-existing call site (not a fixture invented for
    // this test) -- src/app/api/help/ask/route.ts genuinely calls
    // resolvePromptTemplate("help.ai_assistant_system"). Kept as the
    // standing "known planted dependent" the generator must always find,
    // exactly as prompt-governance-service.test.ts's own dependency-engine
    // test already relies on.
    expect(PROMPT_TEMPLATE_DEPENDENTS["help.ai_assistant_system"]).toBeDefined()
    expect(PROMPT_TEMPLATE_DEPENDENTS["help.ai_assistant_system"]).toContain("src/app/api/help/ask/route.ts")
  })

  test("every dependent file path is forward-slash-normalized and repo-relative (no OS-native backslashes, no absolute paths)", () => {
    for (const files of Object.values(PROMPT_TEMPLATE_DEPENDENTS)) {
      for (const file of files) {
        expect(file).not.toContain("\\")
        expect(file.startsWith("src/")).toBe(true)
      }
    }
  })
})
