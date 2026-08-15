/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { AI_RESPONSE_LANGUAGES, isKnownAiResponseLocale, languageDirectiveFor } from "./ai-response-locale"

describe("isKnownAiResponseLocale", () => {
  test("recognizes every key in AI_RESPONSE_LANGUAGES", () => {
    for (const locale of Object.keys(AI_RESPONSE_LANGUAGES)) {
      expect(isKnownAiResponseLocale(locale)).toBe(true)
    }
  })

  test("rejects unknown, undefined, and null values", () => {
    expect(isKnownAiResponseLocale("xx")).toBe(false)
    expect(isKnownAiResponseLocale(undefined)).toBe(false)
    expect(isKnownAiResponseLocale(null)).toBe(false)
    expect(isKnownAiResponseLocale("")).toBe(false)
  })
})

describe("languageDirectiveFor", () => {
  test("names the target language and preserves output-format instructions", () => {
    const directive = languageDirectiveFor("hi")
    expect(directive).toContain("Hindi")
    expect(directive).toContain("respond in that language instead")
    expect(directive).toContain("never changes a required output format")
  })

  test("produces a distinct directive per locale", () => {
    expect(languageDirectiveFor("fr")).toContain("French")
    expect(languageDirectiveFor("ta")).toContain("Tamil")
    expect(languageDirectiveFor("fr")).not.toBe(languageDirectiveFor("ta"))
  })
})
