// parseDbTimestamp (src/lib/db-time.ts): the billing RPCs return `timestamp` columns with no zone ("2026-10-29T08:38:15.972585",
// verified against the live dpdp_my_billing payload on 2026-10-02). Read as UTC, whatever zone the viewer's browser is in.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parseDbTimestamp } from "./db-time"

const APP = join(import.meta.dir, "..", "..")
const read = (rel: string) => readFileSync(join(APP, rel), "utf8")

describe("parseDbTimestamp", () => {
  test("a zone-less database timestamp is UTC, with or without fractional seconds", () => {
    expect(parseDbTimestamp("2026-10-29T08:38:15.972585").toISOString()).toBe("2026-10-29T08:38:15.972Z")
    expect(parseDbTimestamp("2027-03-31T23:30:00").toISOString()).toBe("2027-03-31T23:30:00.000Z")
    expect(parseDbTimestamp("2027-03-31 23:30:00").getTime()).toBe(Date.UTC(2027, 2, 31, 23, 30, 0))
  })
  test("a value that already carries Z or an offset is read exactly as given (nothing is shifted twice)", () => {
    expect(parseDbTimestamp("2026-10-29T08:38:15Z").toISOString()).toBe("2026-10-29T08:38:15.000Z")
    expect(parseDbTimestamp("2026-10-29T14:08:15+05:30").toISOString()).toBe("2026-10-29T08:38:15.000Z")
    expect(parseDbTimestamp("2026-10-29T03:38:15-05:00").toISOString()).toBe("2026-10-29T08:38:15.000Z")
  })
  test("a bare date is UTC midnight; garbage is an Invalid Date, never a throw", () => {
    expect(parseDbTimestamp("2028-02-29").toISOString()).toBe("2028-02-29T00:00:00.000Z")
    expect(Number.isNaN(parseDbTimestamp("not a date").getTime())).toBe(true)
    expect(Number.isNaN(parseDbTimestamp("").getTime())).toBe(true)
  })
  test("the answer does not depend on the viewer's time zone (IST, UTC, New York, Auckland)", () => {
    for (const tz of ["Asia/Kolkata", "UTC", "America/New_York", "Pacific/Auckland"]) {
      const r = Bun.spawnSync(["bun", "-e", `import { parseDbTimestamp } from ${JSON.stringify(join(APP, "src/lib/db-time.ts"))}; console.log(parseDbTimestamp("2027-03-31T23:30:00").toISOString())`], { env: { ...process.env, TZ: tz } })
      expect(r.stdout.toString().trim(), tz).toBe("2027-03-31T23:30:00.000Z")
    }
  })
})

describe("the billing screens use it (a plain new Date() on these fields reads them as local time)", () => {
  test("BillingPanel and OwnerPaymentAdmin never call new Date() on a billing timestamp field", () => {
    const panel = read("src/components/BillingPanel.tsx")
    const admin = read("src/components/OwnerPaymentAdmin.tsx")
    expect(panel).toContain('from "@/lib/db-time"')
    expect(admin).toContain('from "@/lib/db-time"')
    for (const src of [panel, admin]) expect(src).not.toMatch(/new Date\((iso|lastConfirmedAt|billing\.lastConfirmedAt|billing\.trialEndsAt|c\.declaredAt)\)/)
  })
})
