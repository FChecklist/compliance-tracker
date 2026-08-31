/// <reference types="bun-types" />
// R63 (owner directive, 2026-08-29): proves the two closed-ended contracts
// resolvePipelineModel() must satisfy -- (1) an active override row wins,
// (2) absence of one falls back to the caller's documented default, never
// null and never a throw. @/lib/db mocked as an in-memory row (same
// pattern task-register-service.test.ts already established for this
// codebase's DB dependencies).
import { describe, expect, test, mock, afterEach, beforeEach } from "bun:test";

let activeRow: { model: string } | null = null;

mock.module("@/lib/db", () => ({
  db: {
    query: {
      pipelineLevelModels: {
        findFirst: mock(async () => (activeRow ? { ...activeRow } : undefined)),
      },
    },
  },
  pipelineLevelModels: { level: "level", status: "status", updatedAt: "updated_at" },
}));

const { resolvePipelineModel, invalidatePipelineModelCache } = await import("./level-model-registry");

describe("resolvePipelineModel", () => {
  beforeEach(() => {
    activeRow = null;
    invalidatePipelineModelCache();
  });
  afterEach(() => {
    invalidatePipelineModelCache();
  });

  test("no active override row -> returns the caller's fallback, never null/throws", async () => {
    const result = await resolvePipelineModel("pipeline_l1", "deepseek/deepseek-chat");
    expect(result).toBe("deepseek/deepseek-chat");
  });

  test("an active override row -> returns the registry's model, not the fallback", async () => {
    activeRow = { model: "z-ai/glm-5.2" };
    const result = await resolvePipelineModel("pipeline_l1", "deepseek/deepseek-chat");
    expect(result).toBe("z-ai/glm-5.2");
  });

  test("cached result is reused within the TTL window without a second DB read", async () => {
    activeRow = { model: "z-ai/glm-5.2" };
    const first = await resolvePipelineModel("pipeline_l2", "fallback-model");
    activeRow = { model: "a-different-model" }; // simulates a row change the cache should not see yet
    const second = await resolvePipelineModel("pipeline_l2", "fallback-model");
    expect(first).toBe("z-ai/glm-5.2");
    expect(second).toBe("z-ai/glm-5.2"); // still cached, not the "different" row
  });

  test("invalidatePipelineModelCache() forces a fresh read", async () => {
    activeRow = { model: "z-ai/glm-5.2" };
    await resolvePipelineModel("pipeline_l1", "fallback-model");
    activeRow = { model: "updated-model" };
    invalidatePipelineModelCache("pipeline_l1");
    const result = await resolvePipelineModel("pipeline_l1", "fallback-model");
    expect(result).toBe("updated-model");
  });

  test("pipeline_l1 and pipeline_l2 are cached independently", async () => {
    activeRow = { model: "l1-model" };
    const l1 = await resolvePipelineModel("pipeline_l1", "fallback");
    activeRow = { model: "l2-model" };
    const l2 = await resolvePipelineModel("pipeline_l2", "fallback");
    expect(l1).toBe("l1-model");
    expect(l2).toBe("l2-model");
  });
});
