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
import { shouldResolveDynamicChain, detectVeriMention, detectClarificationRequest } from "./chat-service"

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

// Priority 6 item 3 (VERI_CHAT_GOVERNANCE.md sections 2/3, "VERI-as-
// participant in multi-party VERI Chat"). detectVeriMention() is the pure
// gate sendMessage() checks before ever calling generateVeriGroupReply() --
// the whole "never auto-act, only when explicitly addressed" guarantee
// lives in this one function, so it's tested exhaustively here rather than
// through an end-to-end DB-backed sendMessage() call, matching this file's
// established pattern for shouldResolveDynamicChain() above.
describe("detectVeriMention -- Priority 6 item 3 explicit-trigger gate", () => {
  test("false for an ordinary message with no mention of VERI at all", () => {
    expect(detectVeriMention("Can someone review the Q3 numbers before EOD?")).toBe(false)
  })

  test("false for a message that merely mentions VERI/VERIDIAN by name in passing (not an @-mention or explicit ask)", () => {
    expect(detectVeriMention("I was chatting with VERI earlier about this")).toBe(false)
    expect(detectVeriMention("VERIDIAN's dashboard looks great")).toBe(false)
  })

  test("true for an @veri mention", () => {
    expect(detectVeriMention("@veri can you summarize this thread?")).toBe(true)
  })

  test("true for an @veri mention mid-sentence", () => {
    expect(detectVeriMention("hey @veri, what did we decide on the vendor?")).toBe(true)
  })

  test("@-mention match is case-insensitive", () => {
    expect(detectVeriMention("@VERI please help")).toBe(true)
    expect(detectVeriMention("@Veri please help")).toBe(true)
  })

  test("true for the explicit phrase 'ask veri'", () => {
    expect(detectVeriMention("let's ask veri what the deadline is")).toBe(true)
  })

  test("'ask veri' phrase match is case-insensitive", () => {
    expect(detectVeriMention("Ask VERI to summarize")).toBe(true)
  })

  test("false for '@veribank' or another word that merely starts with veri -- word boundary is enforced", () => {
    expect(detectVeriMention("email @veribank_support about the statement")).toBe(false)
  })

  test("false for an empty string", () => {
    expect(detectVeriMention("")).toBe(false)
  })
})

// REVIEW-FRAMEWORK-WAVE4 (AI Interaction Efficiency, "AI Clarification
// Minimization"). generateAiReply()/generateVeriGroupReply() increment
// conversations.clarificationRoundTrips whenever this fires -- tested here
// as a pure predicate, matching this file's own established pattern.
describe("detectClarificationRequest -- REVIEW-FRAMEWORK-WAVE4 clarification metric", () => {
  test("false for an ordinary, direct answer", () => {
    expect(detectClarificationRequest("Your GST filing for this quarter is due on the 20th.")).toBe(false)
  })

  test("true when VERI asks the user to clarify", () => {
    expect(detectClarificationRequest("Could you clarify which invoice you mean?")).toBe(true)
  })

  test("true for 'can you specify'", () => {
    expect(detectClarificationRequest("Can you specify which department this is for?")).toBe(true)
  })

  test("does not false-positive on an ordinary confirmatory question", () => {
    expect(detectClarificationRequest("Should I go ahead and approve this?")).toBe(false)
  })

  test("empty reply does not fire", () => {
    expect(detectClarificationRequest("")).toBe(false)
  })
})
