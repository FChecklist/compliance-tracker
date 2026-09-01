/// <reference types="bun-types" />
// R63: proves the one real safety gate -- a provider with no confirmed
// deep link never renders a "click to connect" button, only instructions.
import { describe, expect, test, mock } from 'bun:test'

type Row = { providerKey: string; displayName: string; supportLevel: string; deepLinkTemplate: string | null; instructionsMd: string; requiresPlan: string | null; sortOrder: number; status: string }
let rows: Row[] = []

mock.module('@/lib/db', () => ({
  db: {
    query: {
      aiConnectorProviders: {
        findMany: mock(async () => rows.filter((r) => r.status === 'active').sort((a, b) => a.sortOrder - b.sortOrder)),
        findFirst: mock(async () => rows.find((r) => r.status === 'active')),
      },
    },
  },
  aiConnectorProviders: {},
}))

const { listActiveConnectorProviders, hasOneClickLink } = await import('./connector-providers')

describe('connector-providers', () => {
  test('hasOneClickLink is true only when deepLinkTemplate is a real, non-empty string', () => {
    expect(hasOneClickLink({ providerKey: 'claude', displayName: 'Claude', supportLevel: 'native_one_click', deepLinkTemplate: 'https://claude.ai/settings/connectors', instructionsMd: '', requiresPlan: null })).toBe(true)
    expect(hasOneClickLink({ providerKey: 'zai', displayName: 'Z.ai', supportLevel: 'developer_only', deepLinkTemplate: null, instructionsMd: '', requiresPlan: null })).toBe(false)
    expect(hasOneClickLink({ providerKey: 'x', displayName: 'X', supportLevel: 'developer_only', deepLinkTemplate: '', instructionsMd: '', requiresPlan: null })).toBe(false)
  })

  test('listActiveConnectorProviders returns [] safely when the table is empty, never throws', async () => {
    rows = []
    const result = await listActiveConnectorProviders()
    expect(result).toEqual([])
  })

  test('listActiveConnectorProviders excludes inactive rows and respects sort order', async () => {
    rows = [
      { providerKey: 'b', displayName: 'B', supportLevel: 'native_one_click', deepLinkTemplate: 'https://b', instructionsMd: '', requiresPlan: null, sortOrder: 20, status: 'active' },
      { providerKey: 'hidden', displayName: 'Hidden', supportLevel: 'native_one_click', deepLinkTemplate: 'https://h', instructionsMd: '', requiresPlan: null, sortOrder: 5, status: 'inactive' },
      { providerKey: 'a', displayName: 'A', supportLevel: 'native_one_click', deepLinkTemplate: 'https://a', instructionsMd: '', requiresPlan: null, sortOrder: 10, status: 'active' },
    ]
    const result = await listActiveConnectorProviders()
    expect(result.map((r) => r.providerKey)).toEqual(['a', 'b'])
  })
})
