/// <reference types="bun-types" />
// Priority 14 Wave 2 (GAP-MOM-VOICE-TICKETS). Only normalizeSuggestedActionItems
// is unit-tested directly -- it is the one pure, DB-free function in this
// service file. Every other exported function (createVoiceMemo,
// transcribeAndExtractVoiceMemo, addVoiceMemoTicket, ...) goes through
// withTenantContext against a real Postgres connection, the same shape as
// veri-meeting-service.ts's own functions, none of which have a test file
// either -- there is no DB-free test convention anywhere in this codebase
// to extend for that layer (confirmed: llm-client.test.ts and composio-
// connectors.test.ts both mock fetch one layer under a DB-free function,
// not a DB-touching service). normalizeSuggestedActionItems is exactly the
// kind of function that convention DOES cover: it is what stands between
// callLLMJson's raw parsed JSON and what gets persisted, so getting its
// tolerance-of-a-malformed-model-response behavior right is the real
// correctness surface of the extraction step, independent of the DB.
import { describe, expect, test } from "bun:test"
import { normalizeSuggestedActionItems } from "./voice-ticket-service"

describe("normalizeSuggestedActionItems", () => {
  test("passes through a well-formed array", () => {
    const input = [
      { title: "Follow up with the vendor", assignee: "Priya", dueDateHint: "next Friday" },
      { title: "Send the revised quote", assignee: null, dueDateHint: null },
    ]
    expect(normalizeSuggestedActionItems(input)).toEqual(input)
  })

  test("returns an empty array for non-array input (e.g. a model that returned an object or omitted the field)", () => {
    expect(normalizeSuggestedActionItems(undefined)).toEqual([])
    expect(normalizeSuggestedActionItems(null)).toEqual([])
    expect(normalizeSuggestedActionItems({ title: "not an array" })).toEqual([])
    expect(normalizeSuggestedActionItems("also not an array")).toEqual([])
  })

  test("drops entries with a missing or blank title instead of throwing away the whole extraction", () => {
    const input = [
      { title: "Real item", assignee: null, dueDateHint: null },
      { title: "", assignee: "Someone", dueDateHint: null },
      { title: "   ", assignee: null, dueDateHint: null },
      { assignee: "No title field at all" },
    ]
    const result = normalizeSuggestedActionItems(input)
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe("Real item")
  })

  test("trims whitespace on title/assignee/dueDateHint", () => {
    const input = [{ title: "  Padded title  ", assignee: "  Padded name  ", dueDateHint: "  tomorrow  " }]
    const result = normalizeSuggestedActionItems(input)
    expect(result[0]).toEqual({ title: "Padded title", assignee: "Padded name", dueDateHint: "tomorrow" })
  })

  test("coerces a wrong-typed assignee/dueDateHint (e.g. a number) to null instead of persisting garbage", () => {
    const input = [{ title: "Valid title", assignee: 42, dueDateHint: true }]
    const result = normalizeSuggestedActionItems(input)
    expect(result[0].assignee).toBeNull()
    expect(result[0].dueDateHint).toBeNull()
  })

  test("normalizes an empty-string assignee/dueDateHint to null, not an empty string", () => {
    const input = [{ title: "Valid title", assignee: "", dueDateHint: "" }]
    const result = normalizeSuggestedActionItems(input)
    expect(result[0].assignee).toBeNull()
    expect(result[0].dueDateHint).toBeNull()
  })

  test("filters out non-object array entries (e.g. a model that returned an array of strings)", () => {
    const input = ["just a string", 42, null, { title: "The one real item" }]
    const result = normalizeSuggestedActionItems(input)
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe("The one real item")
  })
})
