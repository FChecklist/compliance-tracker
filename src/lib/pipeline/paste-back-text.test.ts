/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-47a (BR-424): the local text rules of a pasted proposal block. Swap for the shared
// ai-link-text module (BR-583) once that unit has merged; this file's cases are the behaviour to keep or change on purpose.
// Run: bun test --isolate src/lib/pipeline/paste-back-text.test.ts
import { describe, expect, test } from "bun:test"
import { cleanPastedText, PARAMS_MAX_DEPTH, sanitisePastedNote, sanitisePastedParams, TEXT_MAX_LENGTH } from "./paste-back-text"

describe("cleanPastedText", () => {
  test("removes C0, DEL and C1 control characters and keeps tab, line feed and carriage return", () => {
    expect(cleanPastedText("a\u0000b\u0007c\u001bd\u007fe\u0085f\u009fg")).toBe("abcdefg")
    expect(cleanPastedText("a\tb\nc\r\nd")).toBe("a\tb\nc\r\nd")
  })

  test("replaces a run of three or more backticks with two single quotes, and leaves one or two alone", () => {
    expect(cleanPastedText("x ``` y")).toBe("x '' y")
    expect(cleanPastedText("x ````` y")).toBe("x '' y")
    expect(cleanPastedText("a `b` ``c``")).toBe("a `b` ``c``")
  })

  test("a run of backticks split by a control character is one run once the character is removed", () => {
    expect(cleanPastedText("``\u0007`")).toBe("''")
  })
})

describe("sanitisePastedParams", () => {
  test("cleans every string at any depth and leaves numbers, booleans, null and the shape as they were", () => {
    const input = { title: "T\u0007", n: 3, flag: false, none: null, lineItems: [{ description: "d\u0000e", quantity: 2 }, "``` x"] }
    const out = sanitisePastedParams(input)
    expect(out).toEqual({ ok: true, params: { title: "T", n: 3, flag: false, none: null, lineItems: [{ description: "de", quantity: 2 }, "'' x"] } })
    // The input is not changed.
    expect(input.title).toBe("T\u0007")
  })

  test("keeps exactly 2,000 characters and refuses 2,001 with the path and the length, cutting nothing", () => {
    expect(sanitisePastedParams({ a: "x".repeat(TEXT_MAX_LENGTH) }).ok).toBe(true)
    const out = sanitisePastedParams({ lineItems: [{ description: "ok" }, { description: "x".repeat(TEXT_MAX_LENGTH + 1) }] })
    expect(out).toEqual({
      ok: false,
      reason: "text_too_long",
      path: "lineItems[1].description",
      detail: "lineItems[1].description is 2001 characters; the limit is 2000",
    })
  })

  test("counts the length after control characters are removed", () => {
    expect(sanitisePastedParams({ a: `${"x".repeat(TEXT_MAX_LENGTH)}\u0007\u0007` }).ok).toBe(true)
  })

  test("refuses params nested deeper than the limit and accepts the limit itself", () => {
    const nest = (levels: number): Record<string, unknown> => {
      let value: Record<string, unknown> = { leaf: "x" }
      for (let i = 0; i < levels; i++) value = { a: value }
      return value
    }
    expect(sanitisePastedParams(nest(PARAMS_MAX_DEPTH - 1)).ok).toBe(true)
    const out = sanitisePastedParams(nest(PARAMS_MAX_DEPTH + 5))
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toBe("params_too_deep")
  })
})

describe("sanitisePastedNote", () => {
  test("cleans, trims and cuts to the length it is given; a note that is empty or not a string is null", () => {
    expect(sanitisePastedNote("  hi\u0007 there  ", 500)).toBe("hi there")
    expect(sanitisePastedNote("abcdef", 3)).toBe("abc")
    expect(sanitisePastedNote("   \u0007 ", 500)).toBeNull()
    expect(sanitisePastedNote(5, 500)).toBeNull()
    expect(sanitisePastedNote(undefined, 500)).toBeNull()
  })
})
