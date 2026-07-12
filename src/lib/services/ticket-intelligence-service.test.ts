// Priority 2 item 4 follow-up (D21.B1.S1 tickets gap): buildTicketTranscript
// is the pure, DB-free classification-prep logic this service adds beyond
// what email-intelligence-service.ts already has (email has no multi-
// message transcript to assemble/bound -- its body is already one string).
// sanitizeSuggestedWorkItems is reused directly from
// email-intelligence-service.ts (not reimplemented here) and already has
// its own full test coverage in email-intelligence-service.test.ts, so it
// isn't re-tested here. Matches this repo's established pattern of not
// touching withTenantContext/a live DB from a .test.ts file (see
// task-service.test.ts / handover-protocol.test.ts's own notes on this).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { buildTicketTranscript } from "./ticket-intelligence-service"

describe("buildTicketTranscript", () => {
  test("returns a placeholder for an empty conversation", () => {
    expect(buildTicketTranscript([])).toBe("(no messages yet)")
  })

  test("labels a human/guest sender as Participant and a null sender as VERIDIAN AI", () => {
    const result = buildTicketTranscript([
      { senderId: "user_1", content: "My invoice looks wrong" },
      { senderId: null, content: "Let me look into that for you" },
    ])
    expect(result).toBe("Participant: My invoice looks wrong\nVERIDIAN AI: Let me look into that for you")
  })

  test("trims each message's content", () => {
    const result = buildTicketTranscript([{ senderId: "user_1", content: "  needs a refund  " }])
    expect(result).toBe("Participant: needs a refund")
  })

  test("preserves chronological (oldest-first) order as given", () => {
    const result = buildTicketTranscript([
      { senderId: "user_1", content: "first" },
      { senderId: "user_1", content: "second" },
      { senderId: "user_1", content: "third" },
    ])
    expect(result.split("\n")).toEqual([
      "Participant: first",
      "Participant: second",
      "Participant: third",
    ])
  })

  test("keeps only the most recent 50 messages, dropping the oldest first", () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ senderId: "user_1", content: `msg-${i}` }))
    const result = buildTicketTranscript(rows)
    const lines = result.split("\n")
    expect(lines).toHaveLength(50)
    expect(lines[0]).toBe("Participant: msg-10")
    expect(lines[49]).toBe("Participant: msg-59")
  })

  test("hard-caps total transcript length, keeping the most recent (tail) content", () => {
    const longMessage = "x".repeat(7000)
    const rows = [
      { senderId: "user_1", content: longMessage },
      { senderId: "user_1", content: "final short message" },
    ]
    const result = buildTicketTranscript(rows)
    expect(result.startsWith("...(earlier messages truncated)...")).toBe(true)
    expect(result.endsWith("final short message")).toBe(true)
    // Bounded, not unbounded -- the truncation marker plus the capped tail.
    expect(result.length).toBeLessThan(longMessage.length)
  })

  test("does not truncate when the transcript is under the character cap", () => {
    const result = buildTicketTranscript([{ senderId: "user_1", content: "short and simple" }])
    expect(result.includes("truncated")).toBe(false)
  })
})
