/// <reference types="bun-types" />
// Wave 173 (GAP-DYNAMIC-CHAIN-DEDUP): tests the pure parts of
// capability-registry-service.ts -- CAPABILITY_ENTITY_TYPES' shape and
// buildCapabilityContent() -- rather than findSimilarCapabilities()/
// auditDuplicateCapabilities() themselves, which touch the DB and are
// deliberately left untested here, matching this repo's established
// pattern of not exercising a live DB from a .test.ts file (see
// task-service.test.ts's and approval-workflow-service.test.ts's own notes
// on this).
import { describe, expect, test } from "bun:test"
import { CAPABILITY_ENTITY_TYPES, buildCapabilityContent } from "./capability-registry-service"

describe("CAPABILITY_ENTITY_TYPES -- GAP-DYNAMIC-CHAIN-DEDUP", () => {
  test("dynamic_chain is a 5th type, alongside the original 4", () => {
    expect(CAPABILITY_ENTITY_TYPES).toEqual(["worker_agent", "automation_rule", "module", "prompt_pattern", "dynamic_chain"])
  })
})

describe("buildCapabilityContent -- shared by all 5 CapabilityEntityTypes, incl. dynamic_chain", () => {
  test("joins name/domain/description, omitting a null description", () => {
    expect(buildCapabilityContent({ name: "GST Filing", domain: "compliance_item > gst_filing", description: null }))
      .toBe("GST Filing | compliance_item > gst_filing")
  })

  test("a dynamic chain with no path labels falls back to the mode pill name alone", () => {
    expect(buildCapabilityContent({ name: "some_pill", domain: null })).toBe("some_pill")
  })

  test("includes input/output schema when non-empty (worker_agent/automation_rule contracts)", () => {
    const content = buildCapabilityContent({ name: "x", inputSchema: { a: 1 }, outputSchema: { b: 2 } })
    expect(content).toContain("Input:")
    expect(content).toContain("Output:")
  })

  test("omits empty input/output schema objects rather than emitting 'Input: {}'", () => {
    const content = buildCapabilityContent({ name: "x", inputSchema: {}, outputSchema: {} })
    expect(content).toBe("x")
  })
})
