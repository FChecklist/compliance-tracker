/// <reference types="bun-types" />
// Real automated test for the reviewer != author identity guard
// (UMR-20260805-091629-d8e3). Proves the check genuinely blocks a real synthetic
// self-approval and genuinely allows every other real shape (different-account
// approval, no approved reviews at all, a same-account non-approval review) --
// against the same pure evaluate() function the real CI workflow calls, no mocked
// internals.
import { describe, test, expect } from "bun:test"
import { evaluate } from "./check-reviewer-not-author.mjs"

describe("REGRESSION: same-account APPROVED review is BLOCKED", () => {
  test("author approves their own PR -- blocked", () => {
    const result = evaluate({
      prAuthorLogin: "fchecklist-bot",
      reviews: [{ authorLogin: "fchecklist-bot", state: "APPROVED" }],
    })
    expect(result.blocked).toBe(true)
    expect(result.reason).toContain("BLOCKED")
    expect(result.reason).toContain("fchecklist-bot")
  })

  test("case-insensitive match -- GitHub logins are case-insensitive", () => {
    const result = evaluate({
      prAuthorLogin: "FChecklist",
      reviews: [{ authorLogin: "fchecklist", state: "APPROVED" }],
    })
    expect(result.blocked).toBe(true)
  })

  test("blocks even when mixed in with other, non-colliding reviews", () => {
    const result = evaluate({
      prAuthorLogin: "author-account",
      reviews: [
        { authorLogin: "some-other-reviewer", state: "COMMENTED" },
        { authorLogin: "author-account", state: "APPROVED" },
        { authorLogin: "yet-another-reviewer", state: "CHANGES_REQUESTED" },
      ],
    })
    expect(result.blocked).toBe(true)
  })
})

describe("REGRESSION: different-account APPROVED review is ALLOWED", () => {
  test("a genuinely different reviewer approves -- allowed", () => {
    const result = evaluate({
      prAuthorLogin: "author-account",
      reviews: [{ authorLogin: "reviewer-account", state: "APPROVED" }],
    })
    expect(result.blocked).toBe(false)
    expect(result.reason).toContain("passed")
  })
})

describe("no approved reviews at all is ALLOWED (this check's job is identity-mismatch only, not presence)", () => {
  test("zero reviews -- allowed", () => {
    const result = evaluate({ prAuthorLogin: "author-account", reviews: [] })
    expect(result.blocked).toBe(false)
  })

  test("reviews exist but none are APPROVED -- allowed, even one from the author themself", () => {
    const result = evaluate({
      prAuthorLogin: "author-account",
      reviews: [
        { authorLogin: "author-account", state: "COMMENTED" },
        { authorLogin: "reviewer-account", state: "CHANGES_REQUESTED" },
      ],
    })
    expect(result.blocked).toBe(false)
  })
})

describe("a same-account COMMENTED or CHANGES_REQUESTED review does NOT block", () => {
  test("COMMENTED from the author on their own PR -- allowed (self-approval is already impossible per GitHub's own API; this guards the APPROVED case specifically)", () => {
    const result = evaluate({
      prAuthorLogin: "author-account",
      reviews: [{ authorLogin: "author-account", state: "COMMENTED" }],
    })
    expect(result.blocked).toBe(false)
  })

  test("CHANGES_REQUESTED from the author on their own PR -- allowed", () => {
    const result = evaluate({
      prAuthorLogin: "author-account",
      reviews: [{ authorLogin: "author-account", state: "CHANGES_REQUESTED" }],
    })
    expect(result.blocked).toBe(false)
  })
})

describe("edge cases", () => {
  test("empty/missing PR author login never falsely matches an empty reviewer login", () => {
    const result = evaluate({
      prAuthorLogin: "",
      reviews: [{ authorLogin: "", state: "APPROVED" }],
    })
    expect(result.blocked).toBe(false)
  })
})
