/// <reference types="bun-types" />
// This asserts the DRAFT list's shape only -- it is explicitly NOT B6 (see
// this file's own header comment). A future PR replacing DRAFT_TEMPLATES
// with the real 40-item, lawyer-reviewed library should update or delete
// this test, not treat it as a spec to preserve.
import { describe, expect, test } from "bun:test"
import { DRAFT_LIBRARY_VERSION } from "./dpdp-obligation-library"

describe("DRAFT_LIBRARY_VERSION", () => {
  test("is explicitly marked draft, never a bare version number that could pass as final", () => {
    expect(DRAFT_LIBRARY_VERSION).toContain("draft")
  })
})
