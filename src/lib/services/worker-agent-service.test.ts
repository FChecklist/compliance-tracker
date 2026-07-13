/// <reference types="bun-types" />
// Agent Hierarchy Registry (AHR), real version -- tests resolveDomainGroupKey()
// directly, the pure function proposeWorkerAgent() delegates to for setting
// workerAgents.domainGroupId on every new row, rather than exercising
// proposeWorkerAgent()/withTenantContext end-to-end, matching this repo's
// established pattern of not touching a live DB from a .test.ts file (see
// task-service.test.ts's own note on this).
//
// Cases below are drawn from the REAL domain values found live in
// compliance.worker_agents (verified via a one-off script against
// APP_RUNTIME_DATABASE_URL, 2026-07-13) -- not invented strings -- so this
// test doubles as evidence the resolver classifies real data correctly, the
// same classification the drizzle/0173 backfill migration used.
import { describe, expect, test } from "bun:test"
import { resolveDomainGroupKey } from "./worker-agent-service"

describe("resolveDomainGroupKey -- Agent Hierarchy Registry write path", () => {
  test("classifies the 4 real top-level domain categories found in live worker_agents rows", () => {
    expect(resolveDomainGroupKey("Construction > Project Intelligence")).toBe("construction")
    expect(resolveDomainGroupKey("Cross-Cutting > Data Access")).toBe("cross_cutting")
    expect(resolveDomainGroupKey("Cross-Cutting > Reporting")).toBe("cross_cutting")
    expect(resolveDomainGroupKey("Finance > GST Reconciliation")).toBe("finance")
    expect(resolveDomainGroupKey("India Compliance > Penalty Calculation")).toBe("india_compliance")
  })

  test("falls back to 'general' for a real but unrecognized live domain value (never crashes, never guesses a new category)", () => {
    // 'accounting' and 'compliance' are real single-word domain values seen
    // live on worker_agents rows that predate the Category > Subcategory
    // convention -- exactly the case the fallback exists for.
    expect(resolveDomainGroupKey("accounting")).toBe("general")
    expect(resolveDomainGroupKey("compliance")).toBe("general")
  })

  test("falls back to 'general' for null, undefined, and empty-string domains", () => {
    expect(resolveDomainGroupKey(null)).toBe("general")
    expect(resolveDomainGroupKey(undefined)).toBe("general")
    expect(resolveDomainGroupKey("")).toBe("general")
  })

  test("matches by prefix, not exact equality -- a longer real domain string under a known category still resolves", () => {
    expect(resolveDomainGroupKey("Finance > Accounts Payable > Vendor Bills")).toBe("finance")
  })

  test("is case-sensitive and does not fuzzy-match a near-miss category (documents the exact boundary, not a guess)", () => {
    expect(resolveDomainGroupKey("construction")).toBe("general")
    expect(resolveDomainGroupKey("Finance")).toBe("finance")
    expect(resolveDomainGroupKey("Financial Reporting")).toBe("general")
  })
})
