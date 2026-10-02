// CSV / spreadsheet-formula injection in the partner exports (USE-CASES.md UC-K): organisation and partner names are free text
// (the sign-up RPC stores them verbatim -- verified live, 2026-10-02), and the statement and payout CSVs open in Excel/Sheets.
import { describe, expect, test } from "bun:test"
import { csv, csvCell } from "./partner"

describe("csvCell", () => {
  test("every formula starter is defused with a leading apostrophe", () => {
    for (const bad of ["=1+1", "+1+1", "-1+1", "@SUM(A1)", "=cmd|' /c calc'!A1", "\t=1", "\r=1", `=HYPERLINK("http://evil","x")`]) {
      const cell = csvCell(bad)
      expect(cell.replace(/^"/, "").startsWith("'"), JSON.stringify(bad)).toBe(true)
    }
  })
  test("real negative numbers and ordinary text are left alone", () => {
    expect(csvCell("-5")).toBe("-5")
    expect(csvCell(-12.5)).toBe("-12.5")
    expect(csvCell("Ravi Kumar")).toBe("Ravi Kumar")
    expect(csvCell("कंपनी 🚀")).toBe("कंपनी 🚀")
    expect(csvCell(null)).toBe("")
    expect(csvCell(undefined)).toBe("")
  })
  test("commas, quotes and line breaks are quoted and the quotes doubled, so one value stays one cell", () => {
    expect(csvCell('A, "B" & C')).toBe('"A, ""B"" & C"')
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"')
    const parsed = csv([["x", "=HYPERLINK(\"u\",\"v\")", "a,b"]])
    expect(parsed.trimEnd().split("\r\n")).toHaveLength(1)
  })
  test("an injected value that also contains a comma is defused AND quoted", () => {
    expect(csvCell("=A1,B1")).toBe(`"'=A1,B1"`)
  })
})
