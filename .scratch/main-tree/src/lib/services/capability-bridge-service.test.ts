/// <reference types="bun-types" />
// Priority 12 (OPEN-07 point 1): unit tests for capability-bridge-service.ts's
// one pure function, buildBridgeSearchQuery(). The two DB-touching lookups
// (findFdeMatchesForCapability, findTaskCapabilityForDynamicChainMatch) are
// not tested here, matching this codebase's established convention of not
// exercising a live DB from a .test.ts file (see capability-registry-service.
// test.ts's and capability-learning-service.test.ts's own stated precedent).
import { describe, test, expect } from "bun:test"
import { buildBridgeSearchQuery } from "./capability-bridge-service"

describe("buildBridgeSearchQuery", () => {
  test("joins capabilityKey, modePill, and dot-joined pathKeys", () => {
    const query = buildBridgeSearchQuery({ capabilityKey: "accounts.gst.file", modePill: "Accounts", pathKeys: ["GST", "File"] })
    expect(query).toBe("accounts.gst.file | Accounts | GST > File")
  })

  test("omits description when pathKeys is empty or not an array", () => {
    expect(buildBridgeSearchQuery({ capabilityKey: "x", modePill: "Accounts", pathKeys: [] })).toBe("x | Accounts")
    expect(buildBridgeSearchQuery({ capabilityKey: "x", modePill: "Accounts", pathKeys: null })).toBe("x | Accounts")
  })

  test("omits domain when modePill is null/undefined", () => {
    expect(buildBridgeSearchQuery({ capabilityKey: "x", modePill: null, pathKeys: ["A"] })).toBe("x | A")
    expect(buildBridgeSearchQuery({ capabilityKey: "x", pathKeys: ["A"] })).toBe("x | A")
  })

  test("falls back to just the capabilityKey when nothing else is present", () => {
    expect(buildBridgeSearchQuery({ capabilityKey: "solo" })).toBe("solo")
  })
})
