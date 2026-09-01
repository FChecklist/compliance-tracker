/// <reference types="bun-types" />
// UMR-03 gap closure. Tests the pure part of instruction-execution-cache-
// service.ts -- isHighConfidenceExecutionMatch()'s threshold decision --
// rather than findPriorExecutionPath()/recordExecutionPath() themselves,
// which touch a live database and are deliberately left untested here,
// matching this repo's established pattern (see capability-registry-
// service.test.ts's and task-service.test.ts's own notes on this).
//
// Point 140's TIER 1 (exact content_hash lookup, tried before the embedding
// tier) is the one exception: its own gate explicitly requires asserting
// that generateEmbedding was NOT called on an exact hit, which is only
// observable through a mock -- so this one function IS exercised below,
// with `db` (a parameter of findPriorExecutionPath, not an internal import)
// swapped for a queue-based fake and `generateEmbedding` swapped via
// mock.module, same convention org-branding-service.test.ts's `db` swap and
// pms-time-service.test.ts's "mock the DB layer only" precedent both use.
// The fake stands in for "an execution path was already recorded" rather
// than calling the real recordExecutionPath() first, so this test doesn't
// couple two functions' behavior together.
import { describe, expect, test, mock } from "bun:test"
import { isHighConfidenceExecutionMatch } from "./instruction-execution-cache-service"

describe("isHighConfidenceExecutionMatch -- UMR-03 no-re-derivation gate", () => {
  test("a near-identical instruction (score >= 0.95) is confident enough to reuse", () => {
    expect(isHighConfidenceExecutionMatch(0.95)).toBe(true)
    expect(isHighConfidenceExecutionMatch(0.99)).toBe(true)
    expect(isHighConfidenceExecutionMatch(1)).toBe(true)
  })

  test("a merely similar instruction (score < 0.95) is not confident enough -- falls through to full resolution", () => {
    expect(isHighConfidenceExecutionMatch(0.94)).toBe(false)
    expect(isHighConfidenceExecutionMatch(0.5)).toBe(false)
    expect(isHighConfidenceExecutionMatch(0)).toBe(false)
  })
})

function makeQueueDb(responses: unknown[][], opts: { throwFirst?: boolean } = {}) {
  let i = 0
  const execute = mock(async () => {
    if (opts.throwFirst && i === 0) {
      i += 1
      throw new Error("simulated hash-tier query failure")
    }
    const r = responses[i] ?? []
    i += 1
    return r
  })
  return { execute } as unknown as import("@/lib/db/tenant-scoped").TenantDb
}

const matchRow = {
  id: "row-1",
  resolved_capability_type: "capability",
  resolved_capability_id: "cap-1",
  resolved_label: "Some Label",
  resolved_params_shape: null,
}

describe("findPriorExecutionPath -- point 140: TIER 1 exact-hash lookup precedes the embedding tier", () => {
  test("identical text (already recorded) resolves via the hash tier with score 1.0 and never calls generateEmbedding", async () => {
    const generateEmbedding = mock(async () => [0.1, 0.2, 0.3])
    mock.module("@/lib/embeddings", () => ({ generateEmbedding }))
    const { findPriorExecutionPath } = await import("./instruction-execution-cache-service")

    // responses[0] = hash-tier SELECT hit; responses[1] = fire-and-forget success_count UPDATE.
    const db = makeQueueDb([[matchRow], []])
    const result = await findPriorExecutionPath(db, "org-1", "deploy the staging branch")

    expect(result).not.toBeNull()
    expect(result?.score).toBe(1.0)
    expect(result?.resolvedCapabilityId).toBe("cap-1")
    expect(generateEmbedding).not.toHaveBeenCalled()
  })

  test("similar-but-different text misses the hash tier and still resolves via the embedding tier", async () => {
    const generateEmbedding = mock(async () => [0.1, 0.2, 0.3])
    mock.module("@/lib/embeddings", () => ({ generateEmbedding }))
    const { findPriorExecutionPath } = await import("./instruction-execution-cache-service")

    // responses[0] = hash-tier SELECT miss; responses[1] = embedding-tier SELECT hit; responses[2] = fire-and-forget UPDATE.
    const db = makeQueueDb([[], [{ ...matchRow, id: "row-2", score: 0.97 }], []])
    const result = await findPriorExecutionPath(db, "org-1", "deploy the staging environment please")

    expect(result).not.toBeNull()
    expect(result?.score).toBe(0.97)
    expect(generateEmbedding).toHaveBeenCalledTimes(1)
  })

  test("text that was never recorded returns null, not a throw", async () => {
    const generateEmbedding = mock(async () => [0.1, 0.2, 0.3])
    mock.module("@/lib/embeddings", () => ({ generateEmbedding }))
    const { findPriorExecutionPath } = await import("./instruction-execution-cache-service")

    // Both tiers miss.
    const db = makeQueueDb([[], []])
    const result = await findPriorExecutionPath(db, "org-1", "an instruction nobody has ever resolved")

    expect(result).toBeNull()
  })

  test("a hash-tier query error is swallowed and falls through to the embedding tier, never propagating", async () => {
    const generateEmbedding = mock(async () => [0.1, 0.2, 0.3])
    mock.module("@/lib/embeddings", () => ({ generateEmbedding }))
    const { findPriorExecutionPath } = await import("./instruction-execution-cache-service")

    // First execute() call throws (hash tier); embedding-tier SELECT then misses too.
    const db = makeQueueDb([[]], { throwFirst: true })
    const result = await findPriorExecutionPath(db, "org-1", "some instruction")

    expect(result).toBeNull()
    expect(generateEmbedding).toHaveBeenCalledTimes(1)
  })
})
