/// <reference types="bun-types" />
// See dispatch-mathematical-engines.test.ts's header for why these dispatch-
// routing tests exist and what they deliberately don't cover.
import { describe, test, expect } from "bun:test"
import { dispatchDataQualityEngines } from "./dispatch-data-quality-engines"
import { NOT_HANDLED } from "./dispatch-helpers"

describe("dispatchDataQualityEngines", () => {
  test("returns NOT_HANDLED for a key outside this category", async () => {
    expect(await dispatchDataQualityEngines("straight_line_depreciation_engine", {})).toBe(NOT_HANDLED)
  })

  test("email_validation_engine dispatches a real valid/invalid check", async () => {
    expect(await dispatchDataQualityEngines("email_validation_engine", { email: "a@b.com" })).toEqual({ valid: true })
    expect(await dispatchDataQualityEngines("email_validation_engine", { email: "not-an-email" })).toEqual({ valid: false })
  })

  test("gstin_validation_engine returns both a format and a checksum flag (two distinct functions)", async () => {
    const result = await dispatchDataQualityEngines("gstin_validation_engine", { gstin: "bogus" }) as { validFormat: boolean; validChecksum: boolean }
    expect(result).toHaveProperty("validFormat")
    expect(result).toHaveProperty("validChecksum")
  })

  test("phone_validation_engine passes the optional defaultCountry through only when provided", async () => {
    const result = await dispatchDataQualityEngines("phone_validation_engine", { phone: "9876543210", defaultCountry: "IN" })
    expect(result).toBeTruthy()
  })

  test("pan_validation_engine_dq is a distinct engineKey from tds's pan_validation_engine but dispatches the same underlying check", async () => {
    expect(await dispatchDataQualityEngines("pan_validation_engine_dq", { pan: "ABCDE1234F" })).toEqual({ valid: true })
  })
})
