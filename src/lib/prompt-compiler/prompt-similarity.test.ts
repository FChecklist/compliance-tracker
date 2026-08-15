/// <reference types="bun-types" />
// VERIDIAN_Architecture_v2.0 phase_2: engine-prompt-similarity -- only the
// pure clustering helper is unit tested here (findSemanticCacheHit/
// indexCompiledPromptVersion touch the live embeddings/pgvector DB, left
// untested from a .test.ts file, matching this repo's established
// convention -- see capability-registry-service.test.ts's own note).
import { describe, expect, test } from "bun:test"
import { clusterBySimilarity } from "./prompt-similarity"

describe("clusterBySimilarity", () => {
  test("groups two versions above threshold into one cluster", () => {
    const clusters = clusterBySimilarity([{ aId: "v1", bId: "v2", score: 0.95 }], 0.92)
    expect(clusters.length).toBe(1)
    expect(clusters[0].members).toEqual(["v1", "v2"])
  })

  test("does not cluster pairs below threshold", () => {
    const clusters = clusterBySimilarity([{ aId: "v1", bId: "v2", score: 0.5 }], 0.92)
    expect(clusters.length).toBe(0)
  })

  test("transitively merges a 3-way chain into a single cluster", () => {
    const clusters = clusterBySimilarity(
      [
        { aId: "v1", bId: "v2", score: 0.95 },
        { aId: "v2", bId: "v3", score: 0.93 },
      ],
      0.92
    )
    expect(clusters.length).toBe(1)
    expect(clusters[0].members).toEqual(["v1", "v2", "v3"])
  })

  test("keeps unrelated pairs in separate clusters", () => {
    const clusters = clusterBySimilarity(
      [
        { aId: "v1", bId: "v2", score: 0.95 },
        { aId: "v3", bId: "v4", score: 0.96 },
      ],
      0.92
    )
    expect(clusters.length).toBe(2)
  })
})
