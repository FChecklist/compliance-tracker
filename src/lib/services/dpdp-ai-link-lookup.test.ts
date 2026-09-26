/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-44 (register row BR-587, spec AWL-S09): the public DPDP
// AI link snapshot (/api/dpdp/ai/[token]) finds its link by token hash only,
// and a link issued on this Next.js path stores only the hash.
//
// Only the database is faked. The fake compiles the REAL drizzle `where`
// expression that dpdp-ai-link-service.ts builds (PgDialect.sqlToQuery, the
// same compiler the driver uses) and evaluates it against the fake rows, the
// pattern of src/lib/ai-links/user-links.test.ts. So if the lookup goes back
// to the plaintext `token` column, the row below whose plaintext matches but
// whose hash was tampered with becomes visible and the tests fail.
import { beforeEach, describe, expect, mock, test } from "bun:test"
import { createHash } from "node:crypto"
import type { SQL } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"

type Row = {
  id: string
  orgId: string
  identityId: string
  membershipId: string | null
  token: string | null
  tokenHash: string | null
  expiresAt: Date
  revokedAt: Date | null
}

let rows: Row[] = []
let reads: Array<Record<string, unknown>> = []
let inserted: Array<Record<string, unknown>> = []
let lastLookupSql = ""

const dialect = new PgDialect()
const COLUMN_TO_KEY: Record<string, keyof Row> = {
  id: "id",
  org_id: "orgId",
  identity_id: "identityId",
  membership_id: "membershipId",
  token: "token",
  token_hash: "tokenHash",
  expires_at: "expiresAt",
  revoked_at: "revokedAt",
}
const COL = '"dpdp"\\."ai_link"\\."(\\w+)"'

function keyOf(column: string): keyof Row {
  const key = COLUMN_TO_KEY[column]
  if (!key) throw new Error(`fake db: unknown column ${column}`)
  return key
}

// A conjunction of `col = $n`, `col is null` and `col > $n` on dpdp.ai_link
// is understood; anything else throws, so the fake never matches silently.
function predicateFrom(where: SQL | undefined): (r: Row) => boolean {
  if (!where) throw new Error("fake db: query without a where clause")
  const { sql, params } = dialect.sqlToQuery(where)
  lastLookupSql = sql
  const body = sql.startsWith("(") && sql.endsWith(")") ? sql.slice(1, -1) : sql
  const checks = body.split(" and ").map((term) => {
    let m = new RegExp(`^${COL} = \\$(\\d+)$`).exec(term)
    if (m) {
      const key = keyOf(m[1])
      const value = params[Number(m[2]) - 1]
      return (r: Row) => r[key] === value
    }
    m = new RegExp(`^${COL} is null$`).exec(term)
    if (m) {
      const key = keyOf(m[1])
      return (r: Row) => r[key] === null || r[key] === undefined
    }
    m = new RegExp(`^${COL} > \\$(\\d+)$`).exec(term)
    if (m) {
      const key = keyOf(m[1])
      const bound = new Date(String(params[Number(m[2]) - 1])).getTime()
      return (r: Row) => (r[key] as Date).getTime() > bound
    }
    throw new Error(`fake db cannot evaluate: ${sql}`)
  })
  return (r) => checks.every((c) => c(r))
}

const findFirst = async ({ where }: { where?: SQL }) => {
  const match = predicateFrom(where)
  return rows.find(match)
}

const fakeDb = {
  query: { dpdpAiLink: { findFirst } },
  insert: () => ({
    values: async (v: Record<string, unknown>) => {
      reads.push(v)
    },
  }),
  execute: async () => [{ projection: "SNAPSHOT" }],
}

const fakeTx = {
  query: { dpdpAiLink: { findFirst } },
  insert: () => ({
    values: async (v: Record<string, unknown>) => {
      inserted.push(v)
    },
  }),
}

const realDb = await import("@/lib/db")
mock.module("@/lib/db", () => ({ ...realDb, db: fakeDb }))
const realTenant = await import("@/lib/db/tenant-scoped")
mock.module("@/lib/db/tenant-scoped", () => ({
  ...realTenant,
  withDpdpContext: async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx),
}))

const { aiLinkTokenHash, resolveAiLinkSnapshot, getOrCreateAiLink } = await import("./dpdp-ai-link-service")

const sha256hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")
const FUTURE = new Date(Date.now() + 7 * 86400_000)
const TOKEN = ["Zm9vYmFy", "YmF6cXV1", "eDEyMzQ1Ng"].join("") // a made-up test value, built in parts so no secret scanner mistakes it for a key

function row(over: Partial<Row>): Row {
  return {
    id: "link-1",
    orgId: "org-1",
    identityId: "identity-1",
    membershipId: null,
    token: null,
    tokenHash: sha256hex(TOKEN),
    expiresAt: FUTURE,
    revokedAt: null,
    ...over,
  }
}

beforeEach(() => {
  rows = []
  reads = []
  inserted = []
  lastLookupSql = ""
})

describe("aiLinkTokenHash", () => {
  test("is the sha256 hex digest the SQL side stores", () => {
    expect(aiLinkTokenHash("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  })

  test("hashes only the first 256 characters, as left(token, 256) does", () => {
    const long = "a".repeat(256)
    expect(aiLinkTokenHash(long + "tail")).toBe(sha256hex(long))
  })
})

describe("resolveAiLinkSnapshot looks a link up by its hash only", () => {
  test("a link whose stored hash is the hash of the presented token resolves, and the read is logged", async () => {
    rows = [row({})]
    expect(await resolveAiLinkSnapshot(TOKEN, "ChatGPT-User/1.0", "103.21.244.17")).toBe("SNAPSHOT")
    expect(reads).toEqual([{ linkId: "link-1", userAgentFamily: "ChatGPT", ipPrefix: "103.21.244.x" }])
  })

  test("the right plaintext with a tampered hash does not resolve, and nothing is logged", async () => {
    rows = [row({ token: TOKEN, tokenHash: sha256hex(TOKEN + "x") })]
    expect(await resolveAiLinkSnapshot(TOKEN)).toBeNull()
    expect(reads).toEqual([])
  })

  test("the lookup never compares the plaintext token column", async () => {
    rows = [row({})]
    await resolveAiLinkSnapshot(TOKEN)
    expect(lastLookupSql).toContain('"dpdp"."ai_link"."token_hash" = $')
    expect(lastLookupSql).not.toContain('"dpdp"."ai_link"."token" =')
  })

  test("a Supabase-path link (membership set) does not resolve on this route, even with the right hash", async () => {
    rows = [row({ membershipId: "membership-1" })]
    expect(await resolveAiLinkSnapshot(TOKEN)).toBeNull()
    expect(reads).toEqual([])
  })

  test("a revoked or expired link does not resolve", async () => {
    rows = [row({ revokedAt: new Date() }), row({ id: "link-2", expiresAt: new Date(Date.now() - 1000) })]
    expect(await resolveAiLinkSnapshot(TOKEN)).toBeNull()
  })
})

describe("a new link on this path stores only the hash", () => {
  test("the insert carries the token hash and no plaintext token, and the returned token resolves", async () => {
    const issued = await getOrCreateAiLink("org-1", "identity-1")
    expect(issued.isNew).toBe(true)
    expect(typeof issued.token).toBe("string")
    expect(inserted).toHaveLength(1)
    expect(inserted[0].token).toBeUndefined()
    expect(inserted[0].tokenHash).toBe(sha256hex(issued.token as string))

    rows = [row({ tokenHash: inserted[0].tokenHash as string })]
    expect(await resolveAiLinkSnapshot(issued.token as string)).toBe("SNAPSHOT")
  })
})
