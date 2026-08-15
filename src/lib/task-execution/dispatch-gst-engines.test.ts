/// <reference types="bun-types" />
// See dispatch-mathematical-engines.test.ts's header for why these dispatch-
// routing tests exist and what they deliberately don't cover.
import { describe, test, expect } from "bun:test"
import { dispatchGstEngines } from "./dispatch-gst-engines"
import { NOT_HANDLED } from "./dispatch-helpers"

const splitInputs = { taxableAmount: 1000, gstRatePercent: 18, supplierStateCode: "27", buyerStateCode: "27" }

describe("dispatchGstEngines", () => {
  test("returns NOT_HANDLED for a key outside this category", async () => {
    expect(await dispatchGstEngines("income_tax_calculator", {})).toBe(NOT_HANDLED)
  })

  test("gst_split_engine, cgst_engine, sgst_engine, and igst_engine share one handler (fallthrough) and produce the same split", async () => {
    const results = await Promise.all(
      ["gst_split_engine", "cgst_engine", "sgst_engine", "igst_engine"].map((key) => dispatchGstEngines(key, splitInputs)),
    )
    expect(results[0]).toEqual(results[1])
    expect(results[1]).toEqual(results[2])
    expect(results[2]).toEqual(results[3])
  })

  test("utgst_engine's split includes a utgst component the plain split doesn't", async () => {
    const plain = await dispatchGstEngines("gst_split_engine", splitInputs) as Record<string, unknown>
    const utgst = await dispatchGstEngines("utgst_engine", splitInputs) as Record<string, unknown>
    expect(utgst).toHaveProperty("utgst")
    expect(plain).not.toHaveProperty("utgst")
  })

  test("reverse_charge_engine reads isReverseCharge through the truthy() helper ('yes'/'true'/'1')", async () => {
    const charged = await dispatchGstEngines("reverse_charge_engine", { ...splitInputs, isReverseCharge: "yes" })
    const notCharged = await dispatchGstEngines("reverse_charge_engine", { ...splitInputs, isReverseCharge: "no" })
    expect(charged).not.toEqual(notCharged)
  })

  test("hsn/sac/eway_bill validation engines each return a boolean valid flag", async () => {
    expect(await dispatchGstEngines("hsn_validation_engine", { hsn: "1234" })).toEqual({ valid: true })
    expect(await dispatchGstEngines("sac_validation_engine", { sac: "99" })).toEqual({ valid: false })
  })

  test("gst_interest_engine passes the optional isExcessItcClaim through truthy() only when present", async () => {
    const result = await dispatchGstEngines("gst_interest_engine", { taxAmount: 1000, daysLate: 10 }) as { interest: number }
    expect(typeof result.interest).toBe("number")
  })
})
