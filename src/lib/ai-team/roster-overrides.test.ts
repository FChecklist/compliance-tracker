/// <reference types="bun-types" />
// VERIDIAN Review Framework remediation (Multi-AI Provider Support gap,
// 2026-07-18) + AI Router registry-backed model resolution follow-up
// (2026-07-19): isKnownModel/knownModels now source from
// platform.ai_model_registry (async, DB-backed) instead of roster.ts's own
// static AI_TEAM_ROSTER -- so introducing a genuinely new model is a DB
// insert, not a code change. @/lib/db is mock.module()'d here, matching
// orchestra-model-resolver.test.ts's own established pattern for this kind
// of dependency (never touching a live DB from a .test.ts file).
// setRoleOverride's role-validation branches (unknown role_key, human/
// code-only role) still throw before ever reaching isKnownModel or any DB
// write, so those remain directly testable without a registry mock.
import { describe, expect, test, mock, afterEach } from "bun:test"

function mockRegistry(models: Array<{ model: string; status?: string }>) {
  mock.module("@/lib/db", () => ({
    db: {
      query: {
        aiModelRegistry: {
          findMany: mock(async ({ where }: { where?: unknown } = {}) => {
            void where // the real query already filters status='active' server-side; the mock pre-filters below to match
            return models.filter((m) => (m.status ?? "active") === "active")
          }),
        },
        aiTeamRoleOverrides: { findFirst: mock(async () => undefined), findMany: mock(async () => []) },
      },
      insert: mock(() => ({ values: mock(() => ({ onConflictDoUpdate: mock(async () => undefined) })) })),
    },
    aiModelRegistry: {}, aiTeamRoleOverrides: {},
  }))
}

afterEach(() => {
  mock.restore()
})

describe("isKnownModel / knownModels (registry-backed)", () => {
  test("a model with an active ai_model_registry row is known", async () => {
    mockRegistry([{ model: "z-ai/glm-5.2" }, { model: "openai/gpt-oss-120b" }])
    const { isKnownModel } = await import("./roster-overrides")
    expect(await isKnownModel("z-ai/glm-5.2")).toBe(true)
    expect(await isKnownModel("openai/gpt-oss-120b")).toBe(true)
  })

  test("a model with no registry row (or only a disabled/deprecated one) is not known", async () => {
    mockRegistry([{ model: "z-ai/glm-5.2" }, { model: "some/retired-model", status: "deprecated" }])
    const { isKnownModel } = await import("./roster-overrides")
    expect(await isKnownModel("gpt-4-turbo-preview")).toBe(false)
    expect(await isKnownModel("z-ai/glm-5.2-typo")).toBe(false)
    expect(await isKnownModel("")).toBe(false)
    expect(await isKnownModel("some/retired-model")).toBe(false)
  })

  test("a genuinely NEW model becomes known purely by existing in the registry -- no roster.ts change needed", async () => {
    mockRegistry([{ model: "openai/gpt-oss-20b" }])
    const { isKnownModel } = await import("./roster-overrides")
    expect(await isKnownModel("openai/gpt-oss-20b")).toBe(true)
  })

  test("knownModels() returns a de-duplicated, sorted list sourced from the registry", async () => {
    mockRegistry([{ model: "z-ai/glm-5.2" }, { model: "openai/gpt-oss-120b" }, { model: "z-ai/glm-5.2" }])
    const { knownModels } = await import("./roster-overrides")
    const models = await knownModels()
    expect(models).toEqual(["openai/gpt-oss-120b", "z-ai/glm-5.2"])
  })

  test("fails OPEN to roster.ts's static models when the registry read throws", async () => {
    mock.module("@/lib/db", () => ({
      db: {
        query: {
          aiModelRegistry: { findMany: mock(async () => { throw new Error("connection refused") }) },
        },
      },
      aiModelRegistry: {}, aiTeamRoleOverrides: {},
    }))
    const { isKnownModel, knownModels } = await import("./roster-overrides")
    expect(await isKnownModel("z-ai/glm-5.2")).toBe(true) // still known via the static roster.ts fallback
    const models = await knownModels()
    expect(models.length).toBeGreaterThan(0)
    expect(models).toContain("z-ai/glm-5.2")
  })
})

describe("setRoleOverride validation (fails before any DB write)", () => {
  test("rejects an unknown role_key", async () => {
    mockRegistry([{ model: "z-ai/glm-5.2" }])
    const { setRoleOverride } = await import("./roster-overrides")
    await expect(setRoleOverride("not_a_real_role", "z-ai/glm-5.2", "user-1")).rejects.toThrow(/Unknown role_key/)
  })

  test("rejects a human role (nothing to override)", async () => {
    mockRegistry([{ model: "z-ai/glm-5.2" }])
    const { setRoleOverride } = await import("./roster-overrides")
    await expect(setRoleOverride("founder_ceo", "z-ai/glm-5.2", "user-1")).rejects.toThrow(/not LLM-backed/)
  })

  test("rejects a code-only role (nothing to override)", async () => {
    mockRegistry([{ model: "z-ai/glm-5.2" }])
    const { setRoleOverride } = await import("./roster-overrides")
    await expect(setRoleOverride("cost_policy_engine", "z-ai/glm-5.2", "user-1")).rejects.toThrow(/not LLM-backed/)
  })

  test("rejects an unrecognized model id, even for a real LLM-backed role", async () => {
    mockRegistry([{ model: "z-ai/glm-5.2" }])
    const { setRoleOverride } = await import("./roster-overrides")
    await expect(setRoleOverride("ai_router", "some/made-up-model", "user-1")).rejects.toThrow(/not a recognized model/)
  })
})
