/// <reference types="bun-types" />
// GAP-VERI-CHAT-NO-VISIBLE-DETERMINISTIC-VS-AI-SIGNAL: regression test for
// withSourceTypeLabel(), the pure helper that gives /home's real AI thread
// (rendered via the external, unmodifiable @fchecklist/veridian-ui-kit
// ThreadView) a visible way to distinguish a genuine AI-escalated reply
// from a deterministic/scripted one. Matches this repo's established
// pattern of testing the pure derivation function a component delegates to
// (see ChainSelector.test.ts) rather than rendering the component itself.
import { describe, expect, test } from "bun:test"
import { withSourceTypeLabel, type RawMessage } from "./HomeThreadSlot"

function rawMessage(overrides: Partial<RawMessage>): RawMessage {
  return { id: "m1", senderId: null, content: "hello", createdAt: "2026-08-03T00:00:00.000Z", confidenceLabel: null, ...overrides }
}

describe("withSourceTypeLabel", () => {
  test("a real AI-generated reply (non-null confidenceLabel) gets the AI marker prepended", () => {
    const msg = rawMessage({ content: "Sure thing, Boss.", confidenceLabel: "high" })
    expect(withSourceTypeLabel(msg)).toBe("✨ AI-generated reply\nSure thing, Boss.")
  })

  test("every real confidenceLabel value (high/medium/low) is treated as AI-generated", () => {
    for (const label of ["high", "medium", "low"] as const) {
      const msg = rawMessage({ content: "reply", confidenceLabel: label })
      expect(withSourceTypeLabel(msg)).toBe("✨ AI-generated reply\nreply")
    }
  })

  test("a deterministic/scripted reply (null confidenceLabel) is left unmarked", () => {
    const msg = rawMessage({ content: "No tasks yet", confidenceLabel: null })
    expect(withSourceTypeLabel(msg)).toBe("No tasks yet")
  })

  test("a real user message is never marked, even if confidenceLabel were somehow set", () => {
    const msg = rawMessage({ senderId: "user-1", content: "what's the status", confidenceLabel: "high" })
    expect(withSourceTypeLabel(msg)).toBe("what's the status")
  })
})
