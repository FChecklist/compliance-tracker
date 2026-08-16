/// <reference types="bun-types" />
// Area 14 (Common functionalities): unit-tests the one pure predicate inside
// search-service.ts -- escapeLikePattern(). searchAll() itself goes through
// withTenantContext/a live DB, so per this repo's established convention
// (see task-service.test.ts's own note) it isn't exercised here.
import { describe, expect, test } from "bun:test"
import { escapeLikePattern } from "./search-service"

describe("escapeLikePattern -- area 14 global search wildcard-injection guard", () => {
  test("leaves an ordinary term untouched", () => {
    expect(escapeLikePattern("gst filing")).toBe("gst filing")
  })

  test("escapes a literal percent sign so it isn't read as a wildcard", () => {
    expect(escapeLikePattern("50%")).toBe("50\\%")
  })

  test("escapes a literal underscore so it isn't read as a single-char wildcard", () => {
    expect(escapeLikePattern("invoice_2026")).toBe("invoice\\_2026")
  })

  test("escapes a literal backslash before escaping the metacharacters after it", () => {
    expect(escapeLikePattern("a\\b%c_d")).toBe("a\\\\b\\%c\\_d")
  })

  test("empty string round-trips to empty string", () => {
    expect(escapeLikePattern("")).toBe("")
  })
})
