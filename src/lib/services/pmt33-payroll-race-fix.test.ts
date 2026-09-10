/// <reference types="bun-types" />
// PM-T33 / DOD-F3 verification, real DB, real concurrency -- reruns the
// exact 8-trial pattern from the original DOD-F4 declared-scope test
// (instb-f4-f5-declared-scope.test.ts) against the FIXED createPayrollRun,
// to prove the raw-unhandled-Postgres-error outcome no longer happens, not
// just that the code looks right. Same probe-and-skip pattern as this
// program's other real-DB tests.
import { describe, expect, test, setDefaultTimeout } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

setDefaultTimeout(120_000)

const REPO_ROOT = join(import.meta.dir, "..", "..", "..")

function loadDbEnvFromEnvLocalIfAbsent(): void {
  const path = join(REPO_ROOT, ".env.local")
  if (!existsSync(path)) return
  const wanted = new Set(["APP_RUNTIME_DATABASE_URL", "DATABASE_URL"])
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    const key = match[1]
    if (!wanted.has(key) || process.env[key]) continue
    let value = match[2].trim()
    const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
    if (quoted) value = value.slice(1, -1)
    if (value.length > 0) process.env[key] = value
  }
}
loadDbEnvFromEnvLocalIfAbsent()

const ORG_ID = process.env.R81_F25_TEST_ORG_ID ?? "4ecc472f-4152-4310-ae8d-cf8b7c52ab6d"

async function probeDatabase(): Promise<string | null> {
  const url = process.env.APP_RUNTIME_DATABASE_URL
  if (!url) return "APP_RUNTIME_DATABASE_URL is not set"
  const postgres = (await import("postgres")).default
  let lastError = "unknown error"
  for (let attempt = 1; attempt <= 3; attempt++) {
    const probe = postgres(url, { prepare: false, ssl: { rejectUnauthorized: false }, max: 1, connect_timeout: 20, idle_timeout: 1 })
    try {
      await probe`select 1`
      await probe.end({ timeout: 5 })
      return null
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code
      const message = error instanceof Error ? error.message : String(error)
      lastError = [code, message].filter((p) => p !== undefined && p !== "").join(" ") || "unknown error"
      try { await probe.end({ timeout: 5 }) } catch {}
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000))
    }
  }
  return `no reachable database after 3 attempts (${lastError})`
}

let skipReason = await probeDatabase()
const payroll = skipReason ? null : await import("./erp-payroll-service")
const tenantScoped = skipReason ? null : await import("@/lib/db/tenant-scoped")
const dbSchema = skipReason ? null : await import("@/lib/db")
const orm = skipReason ? null : await import("drizzle-orm")
const enablement = skipReason ? null : await import("./erp-enablement-service")

if (!skipReason && enablement && !(await enablement.isErpEnabledForOrg(ORG_ID))) {
  skipReason = `the 'erp' product branch is not enabled for org ${ORG_ID}`
}

const F4_TEST_MONTH = 7
const F4_TEST_YEAR_BASE = 2097 // distinct range from the original DOD-F4 test's 2099-i, avoids any cross-test collision

describe.skipIf(skipReason !== null)(`PM-T33/DOD-F3: createPayrollRun no longer surfaces a raw error under real concurrency${skipReason ? ` (SKIPPED: ${skipReason})` : ""}`, () => {
  test("8 repeated real-concurrency trials: 0 duplicates AND 0 raw errors -- every loser gets the clean 409", async () => {
    const { withTenantContext } = tenantScoped!
    const { erpPayrollRuns } = dbSchema!
    const { and, eq } = orm!
    const { createPayrollRun } = payroll!

    const user = await withTenantContext({ orgId: ORG_ID }, (db) =>
      db.query.users.findFirst({ where: and(eq(dbSchema!.users.orgId, ORG_ID), eq(dbSchema!.users.isActive, true)) })
    )
    if (!user) throw new Error(`org ${ORG_ID} has no active user -- cannot run this test`)
    const ctx = { orgId: ORG_ID, userId: user.id, dbUser: user }

    const TRIALS = 8
    let duplicateDataEver = 0
    let cleanCount = 0
    let rawCount = 0
    const rawSamples: string[] = []

    for (let i = 0; i < TRIALS; i++) {
      const year = F4_TEST_YEAR_BASE - i
      try {
        const attempts = await Promise.allSettled([
          createPayrollRun(ctx, { month: F4_TEST_MONTH, year }),
          createPayrollRun(ctx, { month: F4_TEST_MONTH, year }),
        ])
        const rejected = attempts.filter((a) => a.status === "rejected") as PromiseRejectedResult[]
        const rows = await withTenantContext({ orgId: ORG_ID }, (db) =>
          db.query.erpPayrollRuns.findMany({ where: and(eq(erpPayrollRuns.orgId, ORG_ID), eq(erpPayrollRuns.month, F4_TEST_MONTH), eq(erpPayrollRuns.year, year)) })
        )
        if (rows.length > 1) duplicateDataEver++
        const reasonTexts = rejected.map((r) => String(r.reason?.stack ?? r.reason?.message ?? r.reason))
        const cleanMsg = reasonTexts.find((m) => /already exists for this month\/year/i.test(m))
        if (cleanMsg) cleanCount++
        else if (rejected.length > 0) {
          rawCount++
          if (rawSamples.length < 2) rawSamples.push(reasonTexts[0]?.slice(0, 300) ?? "(no message)")
        }
      } finally {
        await withTenantContext({ orgId: ORG_ID }, (db) =>
          db.delete(erpPayrollRuns).where(and(eq(erpPayrollRuns.orgId, ORG_ID), eq(erpPayrollRuns.month, F4_TEST_MONTH), eq(erpPayrollRuns.year, year)))
        )
      }
    }

    console.log(`PM-T33/DOD-F3 result: ${TRIALS} trials, ${duplicateDataEver} duplicated data, ${cleanCount} clean 409, ${rawCount} raw error`)
    if (rawSamples.length) console.log("raw samples:", rawSamples)

    expect(duplicateDataEver).toBe(0) // DOD-F4 property, still must hold
    expect(rawCount).toBe(0) // DOD-F3 fix: this is the number that was 7/8 before the fix
    expect(cleanCount).toBe(TRIALS) // every single trial's loser now gets the clean message
  })
})
