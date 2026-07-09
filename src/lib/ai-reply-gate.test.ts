/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { passesReplyGate, detectFalseActionClaim } from "./ai-reply-gate"

describe("passesReplyGate", () => {
  test("passes an ordinary informational reply", () => {
    expect(passesReplyGate("Your payment of Rs.5,000 was recorded on the 3rd.")).toEqual({ passed: true })
  })

  test("passes a reply that offers to help without claiming completion", () => {
    expect(passesReplyGate("I can help you approve this once you confirm.")).toEqual({ passed: true })
  })

  test("rejects an empty reply", () => {
    expect(passesReplyGate("   ")).toEqual({ passed: false, reason: "empty_reply" })
  })

  test("rejects a reply over the length cap", () => {
    const result = passesReplyGate("a".repeat(8001))
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("reply_too_long")
  })

  test("rejects a false claim of having deleted something", () => {
    const result = passesReplyGate("I've deleted the record you asked about.")
    expect(result.passed).toBe(false)
    if (!result.passed) {
      expect(result.reason).toBe("false_action_claim")
      expect(result.matchedPhrase).toBe("i've deleted")
    }
  })

  test("rejects a false claim of having made a payment", () => {
    const result = passesReplyGate("I have made the payment for you.")
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("false_action_claim")
  })

  test("is case-insensitive", () => {
    const result = passesReplyGate("I HAVE APPROVED your request.")
    expect(result.passed).toBe(false)
  })
})

describe("detectFalseActionClaim", () => {
  test("does not flag mentions of the word 'approved' without first-person past tense", () => {
    expect(detectFalseActionClaim("This request was approved by your manager.")).toEqual({ detected: false })
  })

  test("does not flag future-tense offers", () => {
    expect(detectFalseActionClaim("I will delete this once you confirm.")).toEqual({ detected: false })
  })

  test("flags first-person past-tense claims", () => {
    expect(detectFalseActionClaim("I've revoked access for that user.").detected).toBe(true)
  })
})
