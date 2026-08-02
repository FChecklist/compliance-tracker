/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { isValidPasscodeFormat, hashPasscode, verifyPasscodeHash, PASSCODE_LENGTH } from "./passcode-login-service"

// Only the pure/DB-free helpers are unit-tested here, matching this
// codebase's existing convention (see org-join-code-service.test.ts,
// session-limit-service.test.ts) -- checkPasscodeRateLimit/setPasscode/
// removePasscode/verifyPasscodeLogin all touch the real db client and have
// no test-DB harness in this repo to run against.

describe("PASSCODE_LENGTH", () => {
  test("is 4, matching the Owner-decided 4-digit passcode design", () => {
    expect(PASSCODE_LENGTH).toBe(4)
  })
})

describe("isValidPasscodeFormat", () => {
  test("accepts exactly 4 digits", () => {
    expect(isValidPasscodeFormat("0000")).toBe(true)
    expect(isValidPasscodeFormat("1234")).toBe(true)
    expect(isValidPasscodeFormat("9999")).toBe(true)
  })

  test("rejects fewer than 4 digits", () => {
    expect(isValidPasscodeFormat("123")).toBe(false)
    expect(isValidPasscodeFormat("1")).toBe(false)
    expect(isValidPasscodeFormat("")).toBe(false)
  })

  test("rejects more than 4 digits", () => {
    expect(isValidPasscodeFormat("12345")).toBe(false)
    expect(isValidPasscodeFormat("123456")).toBe(false)
  })

  test("rejects non-digit characters", () => {
    expect(isValidPasscodeFormat("abcd")).toBe(false)
    expect(isValidPasscodeFormat("12a4")).toBe(false)
    expect(isValidPasscodeFormat("12.4")).toBe(false)
    expect(isValidPasscodeFormat("12-4")).toBe(false)
  })

  test("rejects leading/trailing whitespace -- callers must trim before calling", () => {
    expect(isValidPasscodeFormat(" 1234")).toBe(false)
    expect(isValidPasscodeFormat("1234 ")).toBe(false)
    expect(isValidPasscodeFormat(" 1234 ")).toBe(false)
  })

  test("rejects a decimal point mid-string even if the digit count matches", () => {
    expect(isValidPasscodeFormat("12.34")).toBe(false)
  })
})

describe("hashPasscode / verifyPasscodeHash", () => {
  test("a passcode verifies against its own hash", async () => {
    const hash = await hashPasscode("4821")
    expect(await verifyPasscodeHash("4821", hash)).toBe(true)
  })

  test("a wrong passcode does not verify against another passcode's hash", async () => {
    const hash = await hashPasscode("4821")
    expect(await verifyPasscodeHash("1234", hash)).toBe(false)
  })

  test("the stored hash is never the raw passcode itself", async () => {
    const hash = await hashPasscode("4821")
    expect(hash).not.toBe("4821")
    expect(hash.length).toBeGreaterThan(20) // real bcrypt hash length, not a passthrough
  })

  test("hashing the same passcode twice produces different hashes (bcrypt salts per call)", async () => {
    const hashA = await hashPasscode("4821")
    const hashB = await hashPasscode("4821")
    expect(hashA).not.toBe(hashB)
    // both still verify correctly despite differing
    expect(await verifyPasscodeHash("4821", hashA)).toBe(true)
    expect(await verifyPasscodeHash("4821", hashB)).toBe(true)
  })

  test("all-same-digit and sequential passcodes hash/verify like any other 4-digit value (no special-casing weak passcodes)", async () => {
    for (const weak of ["0000", "1111", "1234", "1004"]) {
      const hash = await hashPasscode(weak)
      expect(await verifyPasscodeHash(weak, hash)).toBe(true)
    }
  })
})
