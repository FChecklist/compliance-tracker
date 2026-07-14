import { describe, expect, test } from "bun:test"
import { compileStaticPrefix } from "./compiler"
import { computeFingerprint } from "./fingerprint"

describe("compileStaticPrefix", () => {
  test("returns the input unchanged as staticPrefix", () => {
    const prompt = "You are VERI, an enterprise compliance assistant."
    expect(compileStaticPrefix(prompt).staticPrefix).toBe(prompt)
  })

  test("fingerprint matches computeFingerprint of the same string", () => {
    const prompt = "You are VERI, an enterprise compliance assistant."
    expect(compileStaticPrefix(prompt).fingerprint).toBe(computeFingerprint(prompt))
  })
})
