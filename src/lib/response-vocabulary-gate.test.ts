/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  RESPONSE_VOCABULARY, checkResponseVocabulary, checkVocabularyDispatchEligibility,
} from "./response-vocabulary-gate"

describe("checkResponseVocabulary -- exact-match, no coercion", () => {
  test("accepts an exact-case match", () => {
    const result = checkResponseVocabulary("yes_no_check", "Yes")
    expect(result.allowed).toBe(true)
    if (result.allowed) expect(result.matchedLabel).toBe("Yes")
  })

  test("accepts a case-insensitive match", () => {
    const result = checkResponseVocabulary("yes_no_check", "yes")
    expect(result.allowed).toBe(true)
    if (result.allowed) expect(result.matchedLabel).toBe("Yes")
  })

  test("accepts a match with surrounding whitespace and trailing punctuation", () => {
    const result = checkResponseVocabulary("status_check", "  Pending.  ")
    expect(result.allowed).toBe(true)
    if (result.allowed) expect(result.matchedLabel).toBe("Pending")
  })

  test("accepts every label declared for approval_decision", () => {
    for (const label of RESPONSE_VOCABULARY.approval_decision) {
      const result = checkResponseVocabulary("approval_decision", label)
      expect(result.allowed).toBe(true)
    }
  })

  test("rejects an empty reply, honestly, not silently", () => {
    const result = checkResponseVocabulary("yes_no_check", "   ")
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.reason).toBe("empty_reply")
  })

  test("rejects a reply that isn't in the declared vocabulary at all", () => {
    const result = checkResponseVocabulary("yes_no_check", "Maybe")
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.reason).toBe("reply_not_in_vocabulary")
  })

  test("rejects a near-synonym rather than fuzzy-matching it -- 'Yep' is not coerced into 'Yes'", () => {
    const result = checkResponseVocabulary("yes_no_check", "Yep")
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.reason).toBe("reply_not_in_vocabulary")
  })

  test("rejects a reply that mentions an allowed word but rambles past the max word count", () => {
    const result = checkResponseVocabulary("status_check", "Well, I think the status here is probably Pending")
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.reason).toBe("reply_exceeds_vocabulary_length")
  })

  test("rejects a label from the WRONG dispatch type's vocabulary -- 'Approved' is not a status_check label", () => {
    const result = checkResponseVocabulary("status_check", "Approved")
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.reason).toBe("reply_not_in_vocabulary")
  })

  test("a rejected reply's guidance always says to escalate, never to auto-correct or discard", () => {
    const result = checkResponseVocabulary("approval_decision", "I approve this")
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.guidance).toContain("escalate")
      expect(result.guidance).toContain("never silently coerced or discarded")
      expect(result.rawReply).toBe("I approve this")
    }
  })

  test("covers every dispatch type's own full vocabulary without cross-contamination", () => {
    for (const [dispatchType, labels] of Object.entries(RESPONSE_VOCABULARY) as [keyof typeof RESPONSE_VOCABULARY, readonly string[]][]) {
      for (const label of labels) {
        const result = checkResponseVocabulary(dispatchType, label)
        expect(result.allowed).toBe(true)
      }
    }
  })
})

describe("checkVocabularyDispatchEligibility -- mechanical-tier only, fail closed", () => {
  test("no responseVocabulary declared is always eligible, at any tier", () => {
    expect(checkVocabularyDispatchEligibility("mechanical", undefined).eligible).toBe(true)
    expect(checkVocabularyDispatchEligibility("integrative", undefined).eligible).toBe(true)
    expect(checkVocabularyDispatchEligibility("judgment", undefined).eligible).toBe(true)
  })

  test("responseVocabulary declared on a mechanical-tier dispatch is eligible", () => {
    expect(checkVocabularyDispatchEligibility("mechanical", "yes_no_check").eligible).toBe(true)
  })

  test("responseVocabulary declared on an integrative-tier dispatch is rejected, not silently downgraded", () => {
    const result = checkVocabularyDispatchEligibility("integrative", "status_check")
    expect(result.eligible).toBe(false)
    if (!result.eligible) {
      expect(result.reason).toContain("integrative")
      expect(result.guidance).toContain("mechanical")
    }
  })

  test("responseVocabulary declared on a judgment-tier dispatch is rejected", () => {
    const result = checkVocabularyDispatchEligibility("judgment", "approval_decision")
    expect(result.eligible).toBe(false)
  })
})
