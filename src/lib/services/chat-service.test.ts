/// <reference types="bun-types" />
// Priority 5 (10-priority5-software-orchestrator-tracker.yaml, dispatch 4,
// item E1 -- "Close the deferred Dynamic Chain gate for VERI conversations").
// Only shouldResolveDynamicChain() is tested here: it's the pure predicate
// createConversation()/createWorkflowThread() delegate to for "did this
// caller send enough to actually resolve a chain" -- everything else in
// this file goes through withTenantContext/a live DB, matching this repo's
// established pattern of not exercising that from a .test.ts file (see
// task-service.test.ts's own comment on the same convention).
import { describe, expect, test } from "bun:test"
import { shouldResolveDynamicChain } from "./chat-service"

describe("shouldResolveDynamicChain -- Priority 5 item E1", () => {
  test("false when both modePill and pathKeys are absent (every existing caller today)", () => {
    expect(shouldResolveDynamicChain(undefined, undefined)).toBe(false)
  })

  test("false when modePill is present but pathKeys is absent", () => {
    expect(shouldResolveDynamicChain("compliance_item", undefined)).toBe(false)
  })

  test("false when pathKeys is present but modePill is absent", () => {
    expect(shouldResolveDynamicChain(undefined, ["compliance_item", "mark_completed"])).toBe(false)
  })

  test("false when modePill is an empty/whitespace-only string", () => {
    expect(shouldResolveDynamicChain("   ", ["compliance_item", "mark_completed"])).toBe(false)
  })

  test("false when pathKeys is an empty array", () => {
    expect(shouldResolveDynamicChain("compliance_item", [])).toBe(false)
  })

  test("true when both a real modePill and a non-empty pathKeys are given", () => {
    expect(shouldResolveDynamicChain("compliance_item", ["compliance_item", "mark_completed"])).toBe(true)
  })

  test("true for a single-level pathKeys -- this predicate only checks presence, not depth (no 2-level gate is imposed on conversations, unlike task creation's validateChainDepth)", () => {
    expect(shouldResolveDynamicChain("compliance_item", ["compliance_item"])).toBe(true)
  })
})
