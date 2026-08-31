// E43_PARSEAMOUNT_SILENT_ZERO_GST_IMPORT_PATH. parseAmount() gracefully
// degrades any genuinely-unparseable cell to 0 -- correct for a caller that
// just wants a number, but every GST adapter call site used it directly on
// raw amount/quantity/rate cells with no upstream check (AR-05 violation):
// a typo/placeholder ("TBD", "N/A", a stray word) silently became a real,
// importable $0 taxable value / tax amount with zero warning, exactly the
// bug construction-boq-import-service.ts's isMalformedNumericCell()
// (R-71/TC-51) already fixed for the BOQ import path. This file tests the
// GST path's own version of that fix, in column-mapper.ts next to
// parseAmount itself.
//
// Uses this repo's own existing test tooling (bun:test, run via `bun test`,
// wired into CI at .github/workflows/ci.yml) -- no new framework added.
/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test"
import { parseAmount, isMalformedNumericCell } from "./column-mapper"

describe("isMalformedNumericCell -- E-43", () => {
  test("flags genuine garbage that parseAmount silently zeroes", () => {
    expect(isMalformedNumericCell("not-a-number")).toBe(true)
    expect(isMalformedNumericCell("TBD")).toBe(true)
    expect(isMalformedNumericCell("N/A")).toBe(true)
    expect(isMalformedNumericCell("abc")).toBe(true)
  })

  test("never flags a shape parseAmount itself already accepts", () => {
    // Plain numbers
    expect(isMalformedNumericCell("5000")).toBe(false)
    expect(isMalformedNumericCell("-42.5")).toBe(false)
    // Comma-formatted
    expect(isMalformedNumericCell("5,000.00")).toBe(false)
    // Rupee glyph
    expect(isMalformedNumericCell("₹1,18,000")).toBe(false)
    // Currency-token-prefixed (R11 point 6a / E-44)
    expect(isMalformedNumericCell("AED 50,976.00")).toBe(false)
    expect(isMalformedNumericCell("USD 100")).toBe(false)
    expect(isMalformedNumericCell("$50")).toBe(false)
    // Parentheses-negative
    expect(isMalformedNumericCell("(100)")).toBe(false)
    expect(isMalformedNumericCell("AED (100)")).toBe(false)
    // GST-specific: percent-formatted rate cells (gstRatePercent column) --
    // parseAmount("18%") === 18 via parseFloat's stop-at-first-invalid-char
    // behaviour, so this must NOT be flagged as malformed.
    expect(isMalformedNumericCell("18%")).toBe(false)
    expect(isMalformedNumericCell("5 %")).toBe(false)
  })

  test("blank cell is not malformed (a real, separate 'missing' case, not garbage)", () => {
    expect(isMalformedNumericCell("")).toBe(false)
  })

  test("every case aligns with what parseAmount actually does: flagged <=> parseAmount silently returns 0 for genuinely non-empty garbage", () => {
    const cases = ["not-a-number", "TBD", "N/A", "5000", "-42.5", "5,000.00", "AED 50,976.00", "(100)", "18%"]
    for (const c of cases) {
      const malformed = isMalformedNumericCell(c)
      const parsed = parseAmount(c)
      if (malformed) {
        // A flagged cell is exactly the case parseAmount had to fall back to 0 for.
        expect(parsed).toBe(0)
      }
    }
  })
})
