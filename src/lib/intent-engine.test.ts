/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { classifyIntent } from "./intent-engine"

describe("classifyIntent", () => {
  test("classifies a create_task request", () => {
    const result = classifyIntent("Please create a task for onboarding")
    expect(result.intent).toBe("create_task")
    expect(result.confidence).toBe("high")
  })

  test("classifies a check_status request", () => {
    expect(classifyIntent("What's the status of the GST filing?").intent).toBe("check_status")
  })

  test("classifies a create_contact request", () => {
    expect(classifyIntent("Add a customer named Acme Corp").intent).toBe("create_contact")
  })

  test("classifies a generate_report request", () => {
    expect(classifyIntent("Can you generate a report for this month").intent).toBe("generate_report")
  })

  test("returns unknown for unrelated text", () => {
    const result = classifyIntent("The weather is nice today")
    expect(result.intent).toBe("unknown")
    expect(result.confidence).toBeNull()
  })

  test("returns unknown for empty input", () => {
    expect(classifyIntent("   ").intent).toBe("unknown")
  })

  test("is case-insensitive", () => {
    expect(classifyIntent("CREATE A TASK for payroll").intent).toBe("create_task")
  })

  test("matches on word boundaries, not substrings", () => {
    // "status" appears inside "statuses" -- word-boundary regex should
    // still match the phrase "status of" correctly without false-firing on
    // unrelated words that merely contain "status" as a substring.
    expect(classifyIntent("statuses are unrelated to this sentence").intent).toBe("unknown")
  })

  test("reports the matched phrase", () => {
    const result = classifyIntent("remind me to call the vendor")
    expect(result.matchedPhrase).toBe("remind me to")
  })

  // Wave 149 audit fix (AUDIT_wave149_claude_items.md, z.ai CONCERN): the
  // original "how is" trigger fired on completely unrelated everyday
  // phrasing. Narrowed to "how is the status" / "how is it going" -- these
  // regression cases pin the fix.
  test("does not false-positive on ordinary 'how is' phrasing unrelated to status", () => {
    expect(classifyIntent("How is your day going?").intent).toBe("unknown")
    expect(classifyIntent("How is the weather there?").intent).toBe("unknown")
    expect(classifyIntent("How is she feeling now?").intent).toBe("unknown")
  })

  test("still classifies the narrowed 'how is' status phrasing", () => {
    expect(classifyIntent("How is the status of my GST filing?").intent).toBe("check_status")
    expect(classifyIntent("How is it going with the onboarding task?").intent).toBe("check_status")
  })
})
