/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { toSheetRow, runMemorySheetsProjectionJob, type UnsyncedMemoryRow } from "./memory-sheets-projection"

function row(overrides: Partial<UnsyncedMemoryRow> = {}): UnsyncedMemoryRow {
  return {
    id: "mem-1",
    scopeType: "ORGANIZATION",
    orgId: "org-1",
    memoryType: "FACT",
    content: "The org's fiscal year starts in April.",
    confidence: "0.9",
    provenanceType: "USER_CONFIRMED",
    lifecycleState: "ACTIVE",
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  }
}

describe("toSheetRow", () => {
  test("maps every field in the documented column order", () => {
    expect(toSheetRow(row())).toEqual([
      "mem-1",
      "ORGANIZATION",
      "org-1",
      "FACT",
      "The org's fiscal year starts in April.",
      "0.9",
      "USER_CONFIRMED",
      "ACTIVE",
      "2026-09-01T00:00:00.000Z",
    ])
  })

  test("null orgId (GLOBAL/INDUSTRY scope) becomes an empty string cell, not the literal 'null'", () => {
    expect(toSheetRow(row({ orgId: null }))[2]).toBe("")
  })

  test("null confidence becomes an empty string cell", () => {
    expect(toSheetRow(row({ confidence: null }))[5]).toBe("")
  })

  test("long content is truncated with an ellipsis rather than sent unbounded", () => {
    const longContent = "x".repeat(3000)
    const cell = toSheetRow(row({ content: longContent }))[4]
    expect(cell.length).toBeLessThan(2100)
    expect(cell.endsWith("…")).toBe(true)
  })

  test("short content passes through untouched", () => {
    expect(toSheetRow(row({ content: "short" }))[4]).toBe("short")
  })
})

describe("runMemorySheetsProjectionJob -- not configured", () => {
  test("skips cleanly (no throw, skipped:true) when Google Sheets env vars are unset -- the real state of this sandbox", async () => {
    const savedKey = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON
    const savedId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID
    delete process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON
    delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID
    try {
      const result = await runMemorySheetsProjectionJob()
      expect(result).toEqual({ skipped: true, reason: "not_configured" })
    } finally {
      if (savedKey !== undefined) process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON = savedKey
      if (savedId !== undefined) process.env.GOOGLE_SHEETS_SPREADSHEET_ID = savedId
    }
  })

  test("never touches the database when not configured -- the configuration check runs before any query", async () => {
    // If this reordered to query-then-check, an unset DATABASE_URL in some
    // environments would throw instead of returning skipped:true. Guard
    // the ordering directly in source, since exercising a real DB call
    // failure here would need a live Postgres connection this sandbox
    // does not have.
    const source = readFileSync(join(__dirname, "memory-sheets-projection.ts"), "utf8")
    const guardIdx = source.indexOf("isGoogleSheetsConfigured()")
    const firstDbCallIdx = source.indexOf("db.execute(")
    expect(guardIdx).toBeGreaterThan(-1)
    expect(firstDbCallIdx).toBeGreaterThan(-1)
    expect(guardIdx).toBeLessThan(firstDbCallIdx)
  })
})

describe("no write-back from Sheets into Supabase, in any form", () => {
  // Falsifiable structural test matching this wave's own discipline (see
  // google-sheets-client.test.ts's identical-purpose suite): the ONLY
  // Sheets-response field this job ever reads is `appendResult.updatedRange`
  // (consumed purely to compute row locators via expandRowRefs), and the
  // only compliance.memory_sources INSERT it issues carries that locator
  // plus IDs the job already had from ITS OWN prior SELECT -- never a
  // value read back from the Sheets API response body.
  const source = readFileSync(join(__dirname, "memory-sheets-projection.ts"), "utf8")

  test("never imports or calls any Sheets values-read function", () => {
    expect(source).not.toMatch(/values\.get|batchGet|readRows|getRows|fetchRows/i)
  })

  test("never issues an UPDATE or DELETE against compliance.memory_records", () => {
    expect(source).not.toMatch(/UPDATE\s+compliance\.memory_records/i)
    expect(source).not.toMatch(/DELETE\s+FROM\s+compliance\.memory_records/i)
  })

  test("the only write this job performs is an INSERT into compliance.memory_sources", () => {
    const writeStatements = source.match(/(INSERT|UPDATE|DELETE)\s+(INTO\s+)?compliance\.\w+/gi) ?? []
    for (const stmt of writeStatements) {
      expect(stmt).toMatch(/^INSERT INTO compliance\.memory_sources$/i)
    }
    expect(writeStatements.length).toBeGreaterThan(0)
  })

  test("the memory_sources INSERT's only Sheets-derived value is the row locator from expandRowRefs, never a raw appendResult field", () => {
    // appendResult is only ever destructured for updatedRange (consumed by
    // expandRowRefs) -- asserting the literal call site keeps this from
    // silently drifting to also thread e.g. appendResult.updates through.
    expect(source).toMatch(/expandRowRefs\(appendResult\.updatedRange, rows\.length\)/)
    expect(source).not.toMatch(/appendResult\.(?!updatedRange|updatedRows)\w+/)
  })
})
