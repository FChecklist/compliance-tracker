/// <reference types="bun-types" />
// R67 lane D22 (item D-58, rec R-187). First sibling test this service has
// ever had -- added in the same commit that widened createVeriMeeting()'s DTO
// to carry live minutes and the action items agreed in the room, per this
// repo's "New Test Coverage Check" gate.
//
// Scope is deliberately the PURE half (normalizeMeetingActionItems): the rest
// of this service is one withTenantContext transaction per function against a
// real Postgres, which this repo tests through its integration surface, not by
// mocking drizzle. The normalisation is where the create screen's real
// behaviour lives -- a repeating action-item row list always carries a
// trailing blank row, and that blank row must never become a task.
import { describe, expect, test } from "bun:test"
import { normalizeMeetingActionItems } from "./veri-meeting-service"

describe("normalizeMeetingActionItems", () => {
  test("drops the create screen's trailing empty row instead of failing the save", () => {
    const result = normalizeMeetingActionItems([
      { title: "Close RFI-12", assigneeUserId: "usr_1", dueDate: "2026-09-10" },
      { title: "   ", assigneeUserId: "", dueDate: "" },
    ])
    expect(result).toHaveLength(1)
    expect(result[0]!.title).toBe("Close RFI-12")
  })

  test("trims the description and normalises blank owner/due to null, never empty string", () => {
    const [item] = normalizeMeetingActionItems([{ title: "  Order rebar  ", assigneeUserId: "  ", dueDate: "  " }])
    expect(item).toEqual({ title: "Order rebar", assigneeUserId: null, dueDate: null })
  })

  test("keeps a real owner and due date exactly as given", () => {
    const [item] = normalizeMeetingActionItems([{ title: "Sign off pour", assigneeUserId: " usr_abc ", dueDate: " 2026-09-30 " }])
    expect(item).toEqual({ title: "Sign off pour", assigneeUserId: "usr_abc", dueDate: "2026-09-30" })
  })

  test("an omitted or non-array action-item list is an empty list, not a crash", () => {
    expect(normalizeMeetingActionItems(undefined)).toEqual([])
    expect(normalizeMeetingActionItems([])).toEqual([])
  })
})
