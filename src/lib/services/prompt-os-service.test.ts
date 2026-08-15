// VERIDIAN_Architecture_v2.0 phase_1 (2026-07-25): tests the pure helpers
// extracted from prompt-os-service.ts's lifecycle/version/rollback API --
// isLegalLifecycleTransition, nextSemanticVersion, diffContentLines -- the
// same "no live DB from a .test.ts file" pattern esignature-service.test.ts
// and erp-fixed-assets-service.test.ts already establish for this repo.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  isLegalLifecycleTransition,
  nextSemanticVersion,
  diffContentLines,
  ALLOWED_LIFECYCLE_TRANSITIONS,
  type PromptLifecycleState,
} from "./prompt-os-service"

describe("isLegalLifecycleTransition -- bare Draft/Review/Staging/Production/Deprecated state machine", () => {
  test("forward path Draft -> Review -> Staging -> Production -> Deprecated is all legal", () => {
    expect(isLegalLifecycleTransition("Draft", "Review")).toBe(true)
    expect(isLegalLifecycleTransition("Review", "Staging")).toBe(true)
    expect(isLegalLifecycleTransition("Staging", "Production")).toBe(true)
    expect(isLegalLifecycleTransition("Production", "Deprecated")).toBe(true)
  })

  test("Review and Staging can each step back one stage (Review->Draft, Staging->Review)", () => {
    expect(isLegalLifecycleTransition("Review", "Draft")).toBe(true)
    expect(isLegalLifecycleTransition("Staging", "Review")).toBe(true)
  })

  test("Deprecated is terminal -- no legal transition out of it", () => {
    const states: PromptLifecycleState[] = ["Draft", "Review", "Staging", "Production", "Deprecated"]
    for (const to of states) expect(isLegalLifecycleTransition("Deprecated", to)).toBe(false)
  })

  test("no skipping stages -- Draft cannot jump straight to Production or Staging", () => {
    expect(isLegalLifecycleTransition("Draft", "Production")).toBe(false)
    expect(isLegalLifecycleTransition("Draft", "Staging")).toBe(false)
  })

  test("no skipping backwards either -- Production cannot drop straight to Draft", () => {
    expect(isLegalLifecycleTransition("Production", "Draft")).toBe(false)
  })

  test("every state has an explicit (possibly empty) edge list -- no state silently falls through to allow-all", () => {
    const states: PromptLifecycleState[] = ["Draft", "Review", "Staging", "Production", "Deprecated"]
    for (const s of states) expect(Array.isArray(ALLOWED_LIFECYCLE_TRANSITIONS[s])).toBe(true)
  })
})

describe("nextSemanticVersion -- MAJOR.MINOR.PATCH bump semantics", () => {
  test("a template's first-ever version is always 1.0.0, regardless of requested bump", () => {
    expect(nextSemanticVersion(undefined, "major")).toEqual({ major: 1, minor: 0, patch: 0 })
    expect(nextSemanticVersion(undefined, "minor")).toEqual({ major: 1, minor: 0, patch: 0 })
    expect(nextSemanticVersion(undefined, "patch")).toEqual({ major: 1, minor: 0, patch: 0 })
  })

  test("patch bump only increments patch", () => {
    expect(nextSemanticVersion({ major: 2, minor: 3, patch: 4 }, "patch")).toEqual({ major: 2, minor: 3, patch: 5 })
  })

  test("minor bump increments minor and resets patch to 0", () => {
    expect(nextSemanticVersion({ major: 2, minor: 3, patch: 4 }, "minor")).toEqual({ major: 2, minor: 4, patch: 0 })
  })

  test("major bump increments major and resets minor+patch to 0", () => {
    expect(nextSemanticVersion({ major: 2, minor: 3, patch: 4 }, "major")).toEqual({ major: 3, minor: 0, patch: 0 })
  })
})

describe("diffContentLines -- line-level diff between two prompt version contents", () => {
  test("identical content produces only context lines", () => {
    const result = diffContentLines("a\nb\nc", "a\nb\nc")
    expect(result).toEqual([
      { type: "context", value: "a" },
      { type: "context", value: "b" },
      { type: "context", value: "c" },
    ])
  })

  test("a single changed line shows as a removed+added pair, unrelated lines stay context", () => {
    const result = diffContentLines("a\nb\nc", "a\nX\nc")
    expect(result).toEqual([
      { type: "context", value: "a" },
      { type: "removed", value: "b" },
      { type: "added", value: "X" },
      { type: "context", value: "c" },
    ])
  })

  test("an appended line at the end shows as a trailing added line", () => {
    const result = diffContentLines("a\nb", "a\nb\nc")
    expect(result).toEqual([
      { type: "context", value: "a" },
      { type: "context", value: "b" },
      { type: "added", value: "c" },
    ])
  })

  test("an entirely removed line from the middle shows as a lone removed line", () => {
    const result = diffContentLines("a\nb\nc", "a\nc")
    expect(result).toEqual([
      { type: "context", value: "a" },
      { type: "removed", value: "b" },
      { type: "context", value: "c" },
    ])
  })
})
