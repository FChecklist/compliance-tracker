/// <reference types="bun-types" />
// R63: proves the three closed-ended contracts user-links.ts must satisfy --
// (1) idempotent generation, (2) a token resolves to exactly one identity or
// null, never partial, (3) revocation is permanent. @/lib/db mocked as an
// in-memory row list (same pattern task-register-service.test.ts already
// established for this codebase's DB dependencies).
import { describe, expect, test, mock, beforeEach } from 'bun:test'

type Row = { id: string; orgId: string; userId: string; token: string; status: string; lastUsedAt: Date | null }
let rows: Row[] = []
let nextId = 0

mock.module('@/lib/db', () => ({
  db: {
    query: {
      userAiLinks: {
        findFirst: mock(async (opts: { where: unknown }) => {
          // The mock doesn't re-implement drizzle's `and(eq(...))` -- tests
          // call the module's own functions, which pass predictable args;
          // we match by re-deriving intent from call order via a shared
          // filter closure set per-test instead of parsing the AST.
          return currentFilter ? rows.find(currentFilter) : undefined
        }),
      },
    },
    insert: mock(() => ({
      values: mock(async (v: Partial<Row>) => {
        const row: Row = { id: `row_${nextId++}`, status: 'active', lastUsedAt: null, ...v } as Row
        rows.push(row)
      }),
    })),
    update: mock(() => ({
      set: mock((v: Partial<Row>) => ({
        // Real drizzle's .where() on an UPDATE is itself awaitable (a
        // "QueryPromise") AND separately supports a chained .returning() --
        // mirrored here as a real Promise with a .returning method attached,
        // so both call styles in user-links.ts (fire-and-forget .catch(),
        // and awaited .returning()) work against the same mock.
        where: mock(() => {
          const target = rows.find(currentFilter!)
          if (target) Object.assign(target, v)
          const p = Promise.resolve(undefined) as Promise<unknown> & { returning: () => Promise<Array<{ id: string }>> }
          p.returning = async () => (target ? [{ id: target.id }] : [])
          return p
        }),
      })),
    })),
  },
  userAiLinks: {},
}))

// The mocked `where` predicate the next db call should use -- set by each
// test right before calling the real function, since the mock above can't
// parse drizzle's `and(eq(...))` expression tree.
let currentFilter: ((r: Row) => boolean) | null = null

const { getOrCreateUserAiLink, resolveAiLinkToken, revokeUserAiLink, tokensEqual } = await import('./user-links')

describe('user-links', () => {
  beforeEach(() => {
    rows = []
    nextId = 0
  })

  test('getOrCreateUserAiLink mints a new token when none exists', async () => {
    currentFilter = (r) => r.orgId === 'org1' && r.userId === 'user1' && r.status === 'active'
    const result = await getOrCreateUserAiLink('org1', 'user1')
    expect(result.createdNow).toBe(true)
    expect(result.token.length).toBeGreaterThan(32)
    expect(rows.length).toBe(1)
  })

  test('getOrCreateUserAiLink is idempotent -- a second call returns the SAME token, never mints a second one', async () => {
    currentFilter = (r) => r.orgId === 'org1' && r.userId === 'user1' && r.status === 'active'
    const first = await getOrCreateUserAiLink('org1', 'user1')
    const second = await getOrCreateUserAiLink('org1', 'user1')
    expect(second.createdNow).toBe(false)
    expect(second.token).toBe(first.token)
    expect(rows.length).toBe(1)
  })

  test('resolveAiLinkToken returns the correct identity for an active token', async () => {
    currentFilter = () => true // only 1 row will exist in this test
    await getOrCreateUserAiLink('org1', 'user1')
    const token = rows[0].token
    currentFilter = (r) => r.token === token && r.status === 'active'
    const identity = await resolveAiLinkToken(token)
    expect(identity).toEqual({ orgId: 'org1', userId: 'user1' })
  })

  test('resolveAiLinkToken returns null for an unknown token, never throws', async () => {
    currentFilter = () => false
    const identity = await resolveAiLinkToken('a'.repeat(43))
    expect(identity).toBeNull()
  })

  test('resolveAiLinkToken rejects an obviously-malformed token before any DB call', async () => {
    currentFilter = () => true // would incorrectly match if the DB were queried
    const identity = await resolveAiLinkToken('too-short')
    expect(identity).toBeNull()
  })

  test('revokeUserAiLink marks the row revoked; the token never resolves again', async () => {
    currentFilter = () => true
    await getOrCreateUserAiLink('org1', 'user1')
    const token = rows[0].token

    currentFilter = (r) => r.orgId === 'org1' && r.userId === 'user1' && r.status === 'active'
    const revoked = await revokeUserAiLink('org1', 'user1')
    expect(revoked).toBe(true)
    expect(rows[0].status).toBe('revoked')

    currentFilter = (r) => r.token === token && r.status === 'active'
    const identity = await resolveAiLinkToken(token)
    expect(identity).toBeNull() // revoked, not found -- same outcome as never-issued
  })

  test('tokensEqual: equal strings true, unequal false, different lengths false', () => {
    expect(tokensEqual('abc123', 'abc123')).toBe(true)
    expect(tokensEqual('abc123', 'abc124')).toBe(false)
    expect(tokensEqual('short', 'muchlonger')).toBe(false)
  })
})
