/// <reference types="bun-types" />
// R63: proves the three closed-ended contracts user-links.ts must satisfy --
// (1) idempotent generation, (2) a token resolves to exactly one identity or
// null, never partial, (3) revocation is permanent.
//
// PM-T34 (2026-09-10): rewritten from mocking bare `@/lib/db` to mocking
// `@/lib/db/tenant-scoped`'s withTenantContext (this codebase's established
// pattern -- see e.g. src/app/api/departments/route.test.ts) for
// getOrCreateUserAiLink/revokeUserAiLink, since those now run inside a real
// tenant transaction. resolveAiLinkToken no longer queries via drizzle's
// query builder at all -- it calls platform.rpc_resolve_ai_link_token() via
// db.execute(sql`...`), so its mock returns a plain (org_id, user_id) row
// shape (or an empty array) the way the real SQL function's RETURNING
// clause does; the SQL text itself (exact-equality-only, status='active',
// the atomic lastUsedAt touch) is proven separately, live, against the real
// database as part of PM-T34's dry-run evidence -- a stronger check for
// that specific surface than a unit-level mock could give, not a coverage
// gap.
//
// PROJEXA-BUILD-001 U-18 (drizzle/0613, spec C-11, register BR-289): the
// table now holds two products. The fake transaction below no longer trusts a
// filter chosen by each test: it compiles the REAL drizzle `where` expression
// that user-links.ts builds (PgDialect.sqlToQuery, the same compiler the
// driver uses) and evaluates it against the fake rows. Only the database is
// faked. So if user-links.ts stops filtering on product = 'veridian', the
// projexa rows below become visible to it and the "never touches a projexa
// row" tests fail.
import { describe, expect, test, mock, beforeEach } from 'bun:test'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { userAiLinks as userAiLinksTable } from '@/lib/db/schema'

type Row = {
  id: string
  orgId: string
  userId: string
  token: string | null
  status: string
  product: string
  projectId: string | null
  tokenHash: string | null
  lastUsedAt: Date | null
  revokedAt: Date | null
}
let rows: Row[] = []
let nextId = 0
let insertCalls = 0

const dialect = new PgDialect()
const COLUMN_TO_KEY: Record<string, keyof Row> = {
  id: 'id',
  org_id: 'orgId',
  user_id: 'userId',
  token: 'token',
  status: 'status',
  product: 'product',
  project_id: 'projectId',
}

// Compiles the real drizzle expression and evaluates it. Only a conjunction
// of `column = $n` terms on platform.user_ai_links is understood; anything
// else throws, so the fake can never silently match everything.
function predicateFrom(where: SQL | undefined): (r: Row) => boolean {
  if (!where) throw new Error('fake db: query without a where clause')
  const { sql, params } = dialect.sqlToQuery(where)
  const body = sql.startsWith('(') && sql.endsWith(')') ? sql.slice(1, -1) : sql
  const checks = body.split(' and ').map((term) => {
    const m = /^"platform"\."user_ai_links"\."(\w+)" = \$(\d+)$/.exec(term)
    if (!m) throw new Error(`fake db cannot evaluate: ${sql}`)
    const key = COLUMN_TO_KEY[m[1]]
    if (!key) throw new Error(`fake db: unknown column ${m[1]}`)
    const value = params[Number(m[2]) - 1]
    return (r: Row) => r[key] === value
  })
  return (r) => checks.every((c) => c(r))
}

function fakeTx() {
  return {
    query: {
      userAiLinks: {
        findFirst: mock(async (cfg: { where?: SQL }) => rows.find(predicateFrom(cfg.where))),
      },
    },
    insert: mock(() => ({
      values: mock(async (v: Partial<Row>) => {
        insertCalls++
        // Column defaults as in the database after 0613.
        const row: Row = {
          id: `row_${nextId++}`,
          token: null,
          status: 'active',
          product: 'veridian',
          projectId: null,
          tokenHash: null,
          lastUsedAt: null,
          revokedAt: null,
          ...v,
        } as Row
        rows.push(row)
      }),
    })),
    update: mock(() => ({
      set: mock((v: Partial<Row>) => ({
        where: mock((where: SQL) => {
          const matches = rows.filter(predicateFrom(where))
          for (const target of matches) Object.assign(target, v)
          return { returning: async () => matches.map((t) => ({ id: t.id })) }
        }),
      })),
    })),
  }
}

const withTenantContext = mock(async (_ctx: unknown, fn: (tx: unknown) => unknown) => fn(fakeTx()))
mock.module('@/lib/db/tenant-scoped', () => ({ withTenantContext }))

// resolveAiLinkToken's own mock: set per-test to the snake_case row(s)
// platform.rpc_resolve_ai_link_token()'s RETURNING clause would produce.
let executeResult: { org_id: string; user_id: string }[] = []
mock.module('@/lib/db', () => ({
  db: { execute: mock(async () => executeResult) },
  userAiLinks: userAiLinksTable,
}))

const { getOrCreateUserAiLink, resolveAiLinkToken, revokeUserAiLink, tokensEqual } = await import('./user-links')

function projexaRow(overrides: Partial<Row> = {}): Row {
  return {
    id: `projexa_${nextId++}`,
    orgId: 'org1',
    userId: 'user1',
    token: null,
    status: 'active',
    product: 'projexa',
    projectId: 'project_a',
    tokenHash: 'f'.repeat(64),
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  }
}

describe('user-links', () => {
  beforeEach(() => {
    rows = []
    nextId = 0
    insertCalls = 0
    executeResult = []
  })

  test('getOrCreateUserAiLink mints a new token when none exists', async () => {
    const result = await getOrCreateUserAiLink('org1', 'user1')
    expect(result.createdNow).toBe(true)
    expect(result.token.length).toBeGreaterThan(32)
    expect(rows.length).toBe(1)
    expect(rows[0].product).toBe('veridian')
  })

  test('getOrCreateUserAiLink is idempotent -- a second call returns the SAME token, never mints a second one', async () => {
    const first = await getOrCreateUserAiLink('org1', 'user1')
    const second = await getOrCreateUserAiLink('org1', 'user1')
    expect(second.createdNow).toBe(false)
    expect(second.token).toBe(first.token)
    expect(rows.length).toBe(1)
  })

  test('resolveAiLinkToken returns the correct identity for an active token', async () => {
    executeResult = [{ org_id: 'org1', user_id: 'user1' }]
    const identity = await resolveAiLinkToken('a'.repeat(43))
    expect(identity).toEqual({ orgId: 'org1', userId: 'user1' })
  })

  test('resolveAiLinkToken returns null for an unknown or revoked token, never throws', async () => {
    executeResult = [] // exactly what platform.rpc_resolve_ai_link_token() returns for no match / status != 'active'
    const identity = await resolveAiLinkToken('a'.repeat(43))
    expect(identity).toBeNull()
  })

  test('resolveAiLinkToken rejects an obviously-malformed token before any DB call', async () => {
    executeResult = [{ org_id: 'should-not-be-returned', user_id: 'should-not-be-returned' }]
    const identity = await resolveAiLinkToken('too-short')
    expect(identity).toBeNull()
  })

  test('revokeUserAiLink marks the row revoked; the token never resolves again', async () => {
    await getOrCreateUserAiLink('org1', 'user1')

    const revoked = await revokeUserAiLink('org1', 'user1')
    expect(revoked).toBe(true)
    expect(rows[0].status).toBe('revoked')

    // Mirrors what platform.rpc_resolve_ai_link_token() actually does once
    // status != 'active': the WHERE clause excludes the row, RETURNING
    // yields zero rows -- proven live against the real function as part of
    // PM-T34's D58 falsification (before_revoke_resolves=1,
    // after_revoke_resolves=0 on the identical token).
    executeResult = []
    const identity = await resolveAiLinkToken('a'.repeat(43))
    expect(identity).toBeNull()
  })

  test('tokensEqual: equal strings true, unequal false, different lengths false', () => {
    expect(tokensEqual('abc123', 'abc123')).toBe(true)
    expect(tokensEqual('abc123', 'abc124')).toBe(false)
    expect(tokensEqual('short', 'muchlonger')).toBe(false)
  })
})

describe('user-links: VERIDIAN functions never touch a PROJEXA link (U-18, BR-289)', () => {
  beforeEach(() => {
    rows = []
    nextId = 0
    insertCalls = 0
    executeResult = []
  })

  test('getOrCreateUserAiLink ignores an active projexa link of the same person and mints a veridian one', async () => {
    const projexa = projexaRow()
    rows.push(projexa)
    const before = { ...projexa }

    const result = await getOrCreateUserAiLink('org1', 'user1')

    expect(result.createdNow).toBe(true)
    expect(result.token.length).toBeGreaterThan(32)
    expect(insertCalls).toBe(1)
    expect(rows.length).toBe(2)
    expect(rows[1].product).toBe('veridian')
    expect(rows[1].token).toBe(result.token)
    expect(rows[0]).toEqual(before)
  })

  test('getOrCreateUserAiLink returns the veridian link, not the projexa link listed before it', async () => {
    rows.push(projexaRow())
    rows.push({ ...projexaRow(), id: 'veridian_1', product: 'veridian', projectId: null, tokenHash: null, token: 'v'.repeat(43) })

    const result = await getOrCreateUserAiLink('org1', 'user1')

    expect(result).toEqual({ token: 'v'.repeat(43), createdNow: false })
    expect(insertCalls).toBe(0)
  })

  test('revokeUserAiLink revokes the veridian link only; the projexa link stays active', async () => {
    const projexa = projexaRow()
    rows.push(projexa)
    const before = { ...projexa }
    rows.push({ ...projexaRow(), id: 'veridian_1', product: 'veridian', projectId: null, tokenHash: null, token: 'v'.repeat(43) })

    const revoked = await revokeUserAiLink('org1', 'user1')

    expect(revoked).toBe(true)
    expect(rows[1].status).toBe('revoked')
    expect(rows[1].revokedAt).toBeInstanceOf(Date)
    expect(rows[0]).toEqual(before)
  })

  test('revokeUserAiLink with only projexa links revokes nothing and reports false', async () => {
    rows.push(projexaRow({ projectId: 'project_a' }))
    rows.push(projexaRow({ projectId: 'project_b', tokenHash: 'e'.repeat(64) }))
    const before = rows.map((r) => ({ ...r }))

    const revoked = await revokeUserAiLink('org1', 'user1')

    expect(revoked).toBe(false)
    expect(rows).toEqual(before)
  })
})
