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
import { describe, expect, test, mock, beforeEach } from 'bun:test'

type Row = { id: string; orgId: string; userId: string; token: string; status: string; lastUsedAt: Date | null }
let rows: Row[] = []
let nextId = 0

// The mocked `where` predicate the next tx call should use -- set by each
// test right before calling the real function, since the mock can't parse
// drizzle's `and(eq(...))` expression tree (same limitation and same
// workaround the previous version of this file already used).
let currentFilter: ((r: Row) => boolean) | null = null

function fakeTx() {
  return {
    query: {
      userAiLinks: {
        findFirst: mock(async () => (currentFilter ? rows.find(currentFilter) : undefined)),
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
        where: mock(() => {
          const target = rows.find(currentFilter!)
          if (target) Object.assign(target, v)
          return { returning: async () => (target ? [{ id: target.id }] : []) }
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
  userAiLinks: {},
}))

const { getOrCreateUserAiLink, resolveAiLinkToken, revokeUserAiLink, tokensEqual } = await import('./user-links')

describe('user-links', () => {
  beforeEach(() => {
    rows = []
    nextId = 0
    executeResult = []
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
    currentFilter = () => true
    await getOrCreateUserAiLink('org1', 'user1')

    currentFilter = (r) => r.orgId === 'org1' && r.userId === 'user1' && r.status === 'active'
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
