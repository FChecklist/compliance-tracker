/// <reference types="bun-types" />
// VERIDIAN Review Framework remediation (Multi-AI Provider Support gap,
// 2026-07-18). isKnownModel/knownModels are pure (derived entirely from
// roster.ts's own AI_TEAM_ROSTER, no DB touch). setRoleOverride's
// validation-before-any-DB-write branches are also directly testable
// without a DB mock -- they throw before ever reaching db.insert.
import { describe, expect, test } from "bun:test"
import { isKnownModel, knownModels, setRoleOverride } from "./roster-overrides"

describe("isKnownModel / knownModels", () => {
  test("every model actually assigned to a role in roster.ts is known", () => {
    // z-ai/glm-5.2 is roster.ts's own primary-lifting model, assigned to
    // dozens of roles -- if this isn't known, the whole allowlist is broken.
    expect(isKnownModel("z-ai/glm-5.2")).toBe(true)
    expect(isKnownModel("openai/gpt-oss-120b")).toBe(true)
    expect(isKnownModel("deepseek/deepseek-v4-pro")).toBe(true)
  })

  test("an unrecognized/typo'd model id is not known", () => {
    expect(isKnownModel("gpt-4-turbo-preview")).toBe(false)
    expect(isKnownModel("z-ai/glm-5.2-typo")).toBe(false)
    expect(isKnownModel("")).toBe(false)
  })

  test("knownModels() returns a de-duplicated, sorted list with no nulls", () => {
    const models = knownModels()
    expect(models.length).toBeGreaterThan(0)
    expect(new Set(models).size).toBe(models.length) // no duplicates
    expect(models).toEqual([...models].sort()) // sorted
    expect(models.every((m) => typeof m === "string" && m.length > 0)).toBe(true)
  })
})

describe("setRoleOverride validation (fails before any DB write)", () => {
  test("rejects an unknown role_key", async () => {
    await expect(setRoleOverride("not_a_real_role", "z-ai/glm-5.2", "user-1")).rejects.toThrow(/Unknown role_key/)
  })

  test("rejects a human role (nothing to override)", async () => {
    await expect(setRoleOverride("founder_ceo", "z-ai/glm-5.2", "user-1")).rejects.toThrow(/not LLM-backed/)
  })

  test("rejects a code-only role (nothing to override)", async () => {
    await expect(setRoleOverride("cost_policy_engine", "z-ai/glm-5.2", "user-1")).rejects.toThrow(/not LLM-backed/)
  })

  test("rejects an unrecognized model id, even for a real LLM-backed role", async () => {
    await expect(setRoleOverride("ai_router", "some/made-up-model", "user-1")).rejects.toThrow(/not a recognized model/)
  })
})
