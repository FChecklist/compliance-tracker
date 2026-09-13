/// <reference types="bun-types" />
// R-C17 (platform.sumeet_requirements, "Platform: Email Engine"). Same
// direct-module-mocking convention as this repo's own
// auth-failure-service.test.ts / passcode-login-service.recordAttempt.test.ts
// ("no test-DB harness in this repo for the DB-touching functions -- direct
// module mocking is the same shape already used by this repo's route.test.ts
// files"): mock.module("@/lib/db", ...) BEFORE importing the service under
// test, reset controllable state in beforeEach.
import { describe, expect, test, mock, beforeEach } from "bun:test"

// Same precedent as vercel-deployment/route.test.ts and boq-baseline-
// service.test.ts: import the REAL "@/lib/db" module first and spread its
// exports, overriding only `db` itself -- "@/lib/db" (src/lib/db.ts)
// re-exports every table in schema.ts, and several other modules this
// service's own import chain touches (e.g. compliance-service.ts, for
// ServiceError) import tables from it too. Replacing the whole module
// (rather than spreading the real one) breaks those unrelated imports with
// a confusing "export not found" error instead of this file's own mocks.
import * as realDb from "@/lib/db"

type AliasRow = { id: string; orgId: string; userId: string; localPart: string; domain: string; isActive: boolean; createdAt: Date }
type UserRow = { id: string; name: string; email: string }

let existingAliasResult: AliasRow | null = null
let userLookupResult: UserRow | null = null
let aliasLookupResult: AliasRow | null = null
// Queue of outcomes for successive db.insert(...).values(...).returning()
// calls -- either a real inserted row, or a simulated Postgres unique-
// violation error shaped exactly like the one erp-payroll-service.ts's own
// isPayrollRunUniqueViolation() (this file's own precedent) checks for.
let insertOutcomes: Array<{ row: AliasRow } | { error: { code: string; constraint_name: string } }> = []
let insertCalls: Array<Record<string, unknown>> = []
let findFirstCalls: Array<{ table: "userEmailAddresses" | "users" }> = []

mock.module("@/lib/db", () => ({
  ...realDb,
  db: {
    query: {
      userEmailAddresses: {
        findFirst: async () => {
          findFirstCalls.push({ table: "userEmailAddresses" })
          // getOrCreateUserEmailAlias's own existing-alias check and
          // resolveEmailAlias's lookup are both exercised in different
          // describe blocks below, never in the same test -- so a single
          // shared return value is unambiguous per test.
          return existingAliasResult ?? aliasLookupResult
        },
      },
      users: {
        findFirst: async () => {
          findFirstCalls.push({ table: "users" })
          return userLookupResult
        },
      },
    },
    insert: (_table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          insertCalls.push(values)
          const outcome = insertOutcomes.shift()
          if (!outcome) throw new Error("test setup error: no more insertOutcomes queued")
          if ("error" in outcome) throw outcome.error
          return [outcome.row]
        },
      }),
    }),
  },
}))

const {
  slugifyLocalPart,
  parseRecipientAddress,
  getOrCreateUserEmailAlias,
  resolveEmailAlias,
  ALLOWED_ALIAS_DOMAINS,
  DEFAULT_ALIAS_DOMAIN,
} = await import("./email-alias-service")
const { ServiceError } = await import("./compliance-service")

beforeEach(() => {
  existingAliasResult = null
  userLookupResult = null
  aliasLookupResult = null
  insertOutcomes = []
  insertCalls = []
  findFirstCalls = []
})

function makeAliasRow(overrides: Partial<AliasRow> = {}): AliasRow {
  return {
    id: "alias-1",
    orgId: "org-1",
    userId: "user-1",
    localPart: "raajat.agarwal",
    domain: DEFAULT_ALIAS_DOMAIN,
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  }
}

describe("slugifyLocalPart", () => {
  test("lowercases and joins words with '.'", () => {
    expect(slugifyLocalPart("Raajat Agarwal")).toBe("raajat.agarwal")
  })
  test("strips diacritics", () => {
    expect(slugifyLocalPart("Renée Zellweger")).toBe("renee.zellweger")
  })
  test("collapses repeated separators and trims leading/trailing ones", () => {
    expect(slugifyLocalPart("  --Raajat!!  ")).toBe("raajat")
  })
  test("falls back to 'user' for input with no usable ASCII characters", () => {
    expect(slugifyLocalPart("日本語")).toBe("user")
    expect(slugifyLocalPart("")).toBe("user")
  })
})

describe("parseRecipientAddress", () => {
  test("splits and lower-cases local-part and domain", () => {
    expect(parseRecipientAddress("Raajat.Agarwal@Veridian-AIOS.com")).toEqual({
      localPart: "raajat.agarwal",
      domain: "veridian-aios.com",
    })
  })
  test.each([["no-at-sign"], ["@leading-at.com"], ["trailing-at@"], [""]])("rejects malformed address %p", (bad) => {
    expect(parseRecipientAddress(bad)).toBeNull()
  })
})

describe("getOrCreateUserEmailAlias", () => {
  test("returns the existing active alias without inserting", async () => {
    existingAliasResult = makeAliasRow()
    const result = await getOrCreateUserEmailAlias({ orgId: "org-1", userId: "user-1" })
    expect(result).toEqual(existingAliasResult)
    expect(insertCalls.length).toBe(0)
  })

  test("provisions a new alias derived from the user's name on first use", async () => {
    userLookupResult = { id: "user-2", name: "Priya Sharma", email: "priya@example.com" }
    insertOutcomes = [{ row: makeAliasRow({ id: "alias-2", userId: "user-2", localPart: "priya.sharma" }) }]

    const result = await getOrCreateUserEmailAlias({ orgId: "org-1", userId: "user-2" })

    expect(insertCalls.length).toBe(1)
    expect(insertCalls[0]).toMatchObject({ orgId: "org-1", userId: "user-2", localPart: "priya.sharma", domain: DEFAULT_ALIAS_DOMAIN, isActive: true })
    expect(result.localPart).toBe("priya.sharma")
  })

  test("falls back to the account email's local-part when the name slugifies to nothing usable", async () => {
    userLookupResult = { id: "user-3", name: "日本語", email: "fallback.name@example.com" }
    insertOutcomes = [{ row: makeAliasRow({ id: "alias-3", userId: "user-3", localPart: "fallback.name" }) }]

    await getOrCreateUserEmailAlias({ orgId: "org-1", userId: "user-3" })

    expect(insertCalls[0]).toMatchObject({ localPart: "fallback.name" })
  })

  test("a local-part collision retries with a numeric suffix, and only the winning insert is kept", async () => {
    userLookupResult = { id: "user-4", name: "Raajat Agarwal", email: "raajat@example.com" }
    insertOutcomes = [
      { error: { code: "23505", constraint_name: "user_email_addresses_local_part_domain_unique" } },
      { row: makeAliasRow({ id: "alias-4", userId: "user-4", localPart: "raajat.agarwal-2" }) },
    ]

    const result = await getOrCreateUserEmailAlias({ orgId: "org-1", userId: "user-4" })

    expect(insertCalls.length).toBe(2)
    expect(insertCalls[0]).toMatchObject({ localPart: "raajat.agarwal" })
    expect(insertCalls[1]).toMatchObject({ localPart: "raajat.agarwal-2" })
    expect(result.localPart).toBe("raajat.agarwal-2")
  })

  test("an unrelated insert error is NOT treated as a collision -- it propagates", async () => {
    userLookupResult = { id: "user-5", name: "Someone Else", email: "someone@example.com" }
    insertOutcomes = [{ error: { code: "23503", constraint_name: "user_email_addresses_user_id_fkey" } }]

    let thrown: unknown
    try {
      await getOrCreateUserEmailAlias({ orgId: "org-1", userId: "user-5" })
    } catch (err) {
      thrown = err
    }
    expect((thrown as { code?: string })?.code).toBe("23503")
    expect(insertCalls.length).toBe(1) // did not retry a non-collision error
  })

  test("throws a 400 ServiceError for a domain outside ALLOWED_ALIAS_DOMAINS", async () => {
    let thrown: unknown
    try {
      await getOrCreateUserEmailAlias({ orgId: "org-1", userId: "user-1" }, "not-allowed.example.com" as never)
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(ServiceError)
    expect((thrown as InstanceType<typeof ServiceError>).status).toBe(400)
    expect(insertCalls.length).toBe(0)
  })

  test("throws a 404 ServiceError when the user does not exist", async () => {
    userLookupResult = null
    let thrown: unknown
    try {
      await getOrCreateUserEmailAlias({ orgId: "org-1", userId: "ghost-user" })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(ServiceError)
    expect((thrown as InstanceType<typeof ServiceError>).status).toBe(404)
    expect(insertCalls.length).toBe(0)
  })

  test("ALLOWED_ALIAS_DOMAINS is exactly ['veridian-aios.com'] today", () => {
    expect(ALLOWED_ALIAS_DOMAINS).toEqual(["veridian-aios.com"])
  })
})

describe("resolveEmailAlias", () => {
  test("resolves a known, active alias to its (orgId, userId)", async () => {
    aliasLookupResult = makeAliasRow({ id: "alias-9", orgId: "org-9", userId: "user-9" })
    const result = await resolveEmailAlias("raajat.agarwal@veridian-aios.com")
    expect(result).toEqual({ orgId: "org-9", userId: "user-9", aliasId: "alias-9" })
  })

  test("returns null when no alias matches", async () => {
    aliasLookupResult = null
    const result = await resolveEmailAlias("nobody@veridian-aios.com")
    expect(result).toBeNull()
  })

  test("returns null for an unparseable address without querying the DB", async () => {
    const result = await resolveEmailAlias("not-an-email")
    expect(result).toBeNull()
    expect(findFirstCalls.length).toBe(0)
  })
})
