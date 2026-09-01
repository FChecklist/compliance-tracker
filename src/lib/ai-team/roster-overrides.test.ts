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

// VERIDIAN Review Framework gap-closure (2026-08-15, "AI Model Lifecycle &
// Benchmarking: A/B or shadow-testing capability for a candidate model" --
// Critical). mockOverrideRow lets a test simulate an existing
// ai_team_role_overrides row (with or without an active rollout) --
// resolveDispatchModel/setRoleRollout/clearRoleRollout all read/write
// through db.query.aiTeamRoleOverrides.findFirst / db.update /db.insert,
// same mock surface roster-overrides.test.ts already established above.
function mockOverrideRow(row: { model: string; candidateModel?: string | null; rolloutPercentage?: number | null } | null, registryModels: Array<{ model: string; status?: string }>) {
  const updateSetSpy = mock(async () => undefined)
  const insertValuesSpy = mock(() => ({ onConflictDoUpdate: mock(async () => undefined) }))
  mock.module("@/lib/db", () => ({
    db: {
      query: {
        aiModelRegistry: { findMany: mock(async () => registryModels.filter((m) => (m.status ?? "active") === "active")) },
        aiTeamRoleOverrides: {
          findFirst: mock(async () => (row ? { ...row, candidateModel: row.candidateModel ?? null, rolloutPercentage: row.rolloutPercentage ?? null } : undefined)),
          findMany: mock(async () => []),
        },
      },
      insert: mock(() => ({ values: insertValuesSpy })),
      update: mock(() => ({ set: mock((vals: unknown) => { updateSetSpy(vals); return { where: mock(async () => undefined) } }) })),
    },
    aiModelRegistry: {}, aiTeamRoleOverrides: {},
  }))
  return { updateSetSpy, insertValuesSpy }
}

describe("resolveDispatchModel -- A/B / shadow-testing candidate resolver", () => {
  test("no override row at all -> primary is roster.ts's static model, no complexityTier needed", async () => {
    mockOverrideRow(null, [{ model: "z-ai/glm-5.2" }])
    const { resolveDispatchModel } = await import("./roster-overrides")
    const result = await resolveDispatchModel("ai_router")
    expect(result).toEqual({ model: "z-ai/glm-5.2", variant: "primary" })
  })

  test("override row with no candidateModel/rolloutPercentage set -> plain override behaves like resolveEffectiveModel", async () => {
    mockOverrideRow({ model: "openai/gpt-oss-120b" }, [{ model: "openai/gpt-oss-120b" }])
    const { resolveDispatchModel } = await import("./roster-overrides")
    const result = await resolveDispatchModel("ai_router", "mechanical")
    expect(result).toEqual({ model: "openai/gpt-oss-120b", variant: "primary" })
  })

  test("complexityTier omitted -> candidate NEVER selected even with rolloutPercentage 100 (fail-safe default)", async () => {
    mockOverrideRow({ model: "z-ai/glm-5.2", candidateModel: "deepseek/deepseek-v4-pro", rolloutPercentage: 100 }, [{ model: "z-ai/glm-5.2" }, { model: "deepseek/deepseek-v4-pro" }])
    const { resolveDispatchModel } = await import("./roster-overrides")
    const result = await resolveDispatchModel("ai_router", undefined, 0.01)
    expect(result).toEqual({ model: "z-ai/glm-5.2", variant: "primary" })
  })

  test("rolloutPercentage 100 + tier supplied + eligible candidate -> ALWAYS selects the candidate, any randomValue", async () => {
    mockOverrideRow({ model: "z-ai/glm-5.2", candidateModel: "z-ai/glm-5-turbo", rolloutPercentage: 100 }, [{ model: "z-ai/glm-5.2" }, { model: "z-ai/glm-5-turbo" }])
    const { resolveDispatchModel } = await import("./roster-overrides")
    expect(await resolveDispatchModel("ai_router", "integrative", 0)).toEqual({ model: "z-ai/glm-5-turbo", variant: "candidate" })
    expect(await resolveDispatchModel("ai_router", "integrative", 0.999)).toEqual({ model: "z-ai/glm-5-turbo", variant: "candidate" })
  })

  test("rolloutPercentage 0 -> candidate never selected regardless of randomValue", async () => {
    mockOverrideRow({ model: "z-ai/glm-5.2", candidateModel: "z-ai/glm-5-turbo", rolloutPercentage: 0 }, [{ model: "z-ai/glm-5.2" }, { model: "z-ai/glm-5-turbo" }])
    const { resolveDispatchModel } = await import("./roster-overrides")
    expect(await resolveDispatchModel("ai_router", "integrative", 0)).toEqual({ model: "z-ai/glm-5.2", variant: "primary" })
  })

  test("randomValue bucketing: below pct/100 -> candidate, at/above -> primary", async () => {
    mockOverrideRow({ model: "z-ai/glm-5.2", candidateModel: "z-ai/glm-5-turbo", rolloutPercentage: 30 }, [{ model: "z-ai/glm-5.2" }, { model: "z-ai/glm-5-turbo" }])
    const { resolveDispatchModel } = await import("./roster-overrides")
    expect((await resolveDispatchModel("ai_router", "integrative", 0.2))!.variant).toBe("candidate") // 0.2*100=20 < 30
    expect((await resolveDispatchModel("ai_router", "integrative", 0.3))!.variant).toBe("primary") // 0.3*100=30, not < 30
    expect((await resolveDispatchModel("ai_router", "integrative", 0.5))!.variant).toBe("primary") // 50 >= 30
  })

  test("tier-safety fallback: a candidate NOT eligible for the requested tier is never selected, even at rolloutPercentage 100 -- guards against a rollout config bypassing model-tier-eligibility.ts", async () => {
    // openai/gpt-oss-120b is mechanical-only (model-tier-eligibility.ts) -- not judgment-eligible.
    mockOverrideRow({ model: "z-ai/glm-5.2", candidateModel: "openai/gpt-oss-120b", rolloutPercentage: 100 }, [{ model: "z-ai/glm-5.2" }, { model: "openai/gpt-oss-120b" }])
    const { resolveDispatchModel } = await import("./roster-overrides")
    const result = await resolveDispatchModel("ai_router", "judgment", 0)
    expect(result).toEqual({ model: "z-ai/glm-5.2", variant: "primary" })
  })

  test("candidateModel that isn't a known/registered model is never selected", async () => {
    mockOverrideRow({ model: "z-ai/glm-5.2", candidateModel: "some/unregistered-model", rolloutPercentage: 100 }, [{ model: "z-ai/glm-5.2" }])
    const { resolveDispatchModel } = await import("./roster-overrides")
    const result = await resolveDispatchModel("ai_router", "mechanical", 0)
    expect(result).toEqual({ model: "z-ai/glm-5.2", variant: "primary" })
  })

  test("returns null for a human role (nothing to dispatch)", async () => {
    mockOverrideRow(null, [{ model: "z-ai/glm-5.2" }])
    const { resolveDispatchModel } = await import("./roster-overrides")
    expect(await resolveDispatchModel("founder_ceo")).toBeNull()
  })

  test("returns null for an unknown role_key", async () => {
    mockOverrideRow(null, [{ model: "z-ai/glm-5.2" }])
    const { resolveDispatchModel } = await import("./roster-overrides")
    expect(await resolveDispatchModel("not_a_real_role")).toBeNull()
  })

  test("fails OPEN to roster.ts's static model when the DB read throws", async () => {
    mock.module("@/lib/db", () => ({
      db: { query: { aiTeamRoleOverrides: { findFirst: mock(async () => { throw new Error("connection refused") }) } } },
      aiModelRegistry: {}, aiTeamRoleOverrides: {},
    }))
    const { resolveDispatchModel } = await import("./roster-overrides")
    const result = await resolveDispatchModel("ai_router", "judgment", 0)
    expect(result).toEqual({ model: "z-ai/glm-5.2", variant: "primary" })
  })
})

describe("setRoleRollout / clearRoleRollout validation", () => {
  test("rejects an unknown role_key", async () => {
    mockOverrideRow(null, [{ model: "z-ai/glm-5.2" }])
    const { setRoleRollout } = await import("./roster-overrides")
    await expect(setRoleRollout("not_a_real_role", "z-ai/glm-5.2", 50, "user-1")).rejects.toThrow(/Unknown role_key/)
  })

  test("rejects a human role (nothing to test a candidate against)", async () => {
    mockOverrideRow(null, [{ model: "z-ai/glm-5.2" }])
    const { setRoleRollout } = await import("./roster-overrides")
    await expect(setRoleRollout("founder_ceo", "z-ai/glm-5.2", 50, "user-1")).rejects.toThrow(/not LLM-backed/)
  })

  test("rejects a non-integer, negative, or >100 rolloutPercentage", async () => {
    mockOverrideRow(null, [{ model: "z-ai/glm-5.2" }])
    const { setRoleRollout } = await import("./roster-overrides")
    await expect(setRoleRollout("ai_router", "z-ai/glm-5.2", 50.5, "user-1")).rejects.toThrow(/integer between 0 and 100/)
    await expect(setRoleRollout("ai_router", "z-ai/glm-5.2", -1, "user-1")).rejects.toThrow(/integer between 0 and 100/)
    await expect(setRoleRollout("ai_router", "z-ai/glm-5.2", 101, "user-1")).rejects.toThrow(/integer between 0 and 100/)
  })

  test("rejects an unrecognized candidate model id", async () => {
    mockOverrideRow(null, [{ model: "z-ai/glm-5.2" }])
    const { setRoleRollout } = await import("./roster-overrides")
    await expect(setRoleRollout("ai_router", "some/made-up-model", 50, "user-1")).rejects.toThrow(/not a recognized model/)
  })

  test("a valid call writes through db.insert().values().onConflictDoUpdate(), preserving any existing plain model override as the row's base `model`", async () => {
    const { insertValuesSpy } = mockOverrideRow({ model: "openai/gpt-oss-120b" }, [{ model: "openai/gpt-oss-120b" }, { model: "z-ai/glm-5-turbo" }])
    const { setRoleRollout } = await import("./roster-overrides")
    await setRoleRollout("ai_router", "z-ai/glm-5-turbo", 25, "user-1", "trial")
    expect(insertValuesSpy).toHaveBeenCalledWith(expect.objectContaining({ roleKey: "ai_router", model: "openai/gpt-oss-120b", candidateModel: "z-ai/glm-5-turbo", rolloutPercentage: 25 }))
  })

  test("clearRoleRollout nulls candidateModel/rolloutPercentage via db.update().set(), never db.delete()", async () => {
    const { updateSetSpy } = mockOverrideRow({ model: "z-ai/glm-5.2", candidateModel: "z-ai/glm-5-turbo", rolloutPercentage: 50 }, [{ model: "z-ai/glm-5.2" }])
    const { clearRoleRollout } = await import("./roster-overrides")
    await clearRoleRollout("ai_router")
    expect(updateSetSpy).toHaveBeenCalledWith(expect.objectContaining({ candidateModel: null, rolloutPercentage: null }))
  })
})
