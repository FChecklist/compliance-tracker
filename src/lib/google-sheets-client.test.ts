/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expandRowRefs, isGoogleSheetsConfigured } from "./google-sheets-client"

describe("isGoogleSheetsConfigured", () => {
  test("false when neither env var is set (the real state of this sandbox)", () => {
    const savedKey = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON
    const savedId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID
    delete process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON
    delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID
    try {
      expect(isGoogleSheetsConfigured()).toBe(false)
    } finally {
      if (savedKey !== undefined) process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON = savedKey
      if (savedId !== undefined) process.env.GOOGLE_SHEETS_SPREADSHEET_ID = savedId
    }
  })

  test("false when the JSON is present but malformed (no silent partial-config)", () => {
    const savedKey = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON
    const savedId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON = "not valid json"
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "sheet-123"
    try {
      expect(isGoogleSheetsConfigured()).toBe(false)
    } finally {
      if (savedKey === undefined) delete process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON
      else process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON = savedKey
      if (savedId === undefined) delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID
      else process.env.GOOGLE_SHEETS_SPREADSHEET_ID = savedId
    }
  })

  test("false when JSON is well-formed but missing client_email/private_key", () => {
    const savedKey = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON
    const savedId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON = JSON.stringify({ foo: "bar" })
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "sheet-123"
    try {
      expect(isGoogleSheetsConfigured()).toBe(false)
    } finally {
      if (savedKey === undefined) delete process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON
      else process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON = savedKey
      if (savedId === undefined) delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID
      else process.env.GOOGLE_SHEETS_SPREADSHEET_ID = savedId
    }
  })

  test("true only when both a well-formed key and a spreadsheet id are set", () => {
    const savedKey = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON
    const savedId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: "svc@example.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
    })
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "sheet-123"
    try {
      expect(isGoogleSheetsConfigured()).toBe(true)
    } finally {
      if (savedKey === undefined) delete process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON
      else process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON = savedKey
      if (savedId === undefined) delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID
      else process.env.GOOGLE_SHEETS_SPREADSHEET_ID = savedId
    }
  })
})

describe("expandRowRefs", () => {
  test("single appended row -> one ref", () => {
    expect(expandRowRefs("MemoryRecords!A12:I12", 1)).toEqual(["MemoryRecords!A12"])
  })

  test("multiple appended rows -> one ref per row, in order", () => {
    expect(expandRowRefs("MemoryRecords!A12:I14", 3)).toEqual([
      "MemoryRecords!A12",
      "MemoryRecords!A13",
      "MemoryRecords!A14",
    ])
  })

  test("unparseable range -> empty (caller must not guess locators)", () => {
    expect(expandRowRefs("", 3)).toEqual([])
    expect(expandRowRefs("garbage", 3)).toEqual([])
  })

  test("count caps the number of refs returned even if the range implies more", () => {
    expect(expandRowRefs("MemoryRecords!A12:I20", 2)).toEqual(["MemoryRecords!A12", "MemoryRecords!A13"])
  })
})

describe("no write-back path exists, architecturally", () => {
  // R68 Phase 7 owner ruling: Sheets is one-way, write-through, no
  // write-back in any form -- not even a disabled/future-flagged code
  // path. This asserts that guarantee at the module-surface level: the
  // client this job depends on exposes no function capable of reading
  // Sheets *values* back (spreadsheets.values.get / batchGet), so nothing
  // in memory-sheets-projection.ts could read Sheets content back into
  // Supabase even if it tried -- the capability simply isn't exported.
  test("google-sheets-client.ts exports no values-read function", async () => {
    const mod = (await import("./google-sheets-client")) as Record<string, unknown>
    const exportNames = Object.keys(mod)
    const readLike = exportNames.filter((n) => /readRows|getRows|fetchValues|batchGet|getValues|readValues/i.test(n))
    expect(readLike).toEqual([])
  })

  test("the client's source never calls a Sheets values.get/batchGet endpoint", () => {
    const source = readFileSync(join(__dirname, "google-sheets-client.ts"), "utf8")
    expect(source).not.toMatch(/values\/[^:]*:batchGet/)
    expect(source.match(/GET/g) ?? []).toEqual([]) // only POST calls exist (token exchange + append)
  })
})
