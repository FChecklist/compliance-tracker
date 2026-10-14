// The daily payment-proof file job (supabase/functions/dpdp-retention-files/handler.ts) against fakes. The database half (which objects are past their period, that the
// shipped setting has NO period, that billing data is never deleted) is proven on real Postgres in dpdp-retention-more.pglite.test.ts.
// Run: bun test --isolate src/lib/services/dpdp-retention-files.test.ts
import { describe, expect, test } from 'bun:test'
import { runRetentionFiles, type Deps } from '../../../supabase/functions/dpdp-retention-files/handler'

type Call = { fn: string; args: Record<string, unknown> }
function harness(plan: unknown, opts: { planError?: boolean; removeFails?: boolean; removeOnly?: (n: string) => boolean; doneError?: boolean } = {}) {
  const calls: Call[] = []
  const removeCalls: string[][] = []
  const deps: Deps = {
    rpc: async (fn, args) => {
      calls.push({ fn, args })
      if (fn === 'dpdp_retention_proof_plan') return opts.planError ? { data: null, error: { message: 'down' } } : { data: plan, error: null }
      if (fn === 'dpdp_retention_proof_done') return opts.doneError ? { data: null, error: { message: 'down' } } : { data: {}, error: null }
      return { data: null, error: { message: 'unexpected' } }
    },
    removeFiles: async (names) => {
      removeCalls.push(names)
      if (opts.removeFails) throw new Error('storage down')
      return { removed: names.filter(opts.removeOnly ?? (() => true)) }
    },
  }
  return { deps, calls, removeCalls }
}

describe('shipped setting: no period, nothing removed', () => {
  test('an empty plan removes nothing and still writes the book', async () => {
    const h = harness({ live: true, days: null, count: 0, names: [] })
    const r = await runRetentionFiles(h.deps)
    expect(r).toMatchObject({ live: true, removed: 0, failed: 0, pastPeriod: 0 })
    expect(h.removeCalls).toEqual([])
    expect(h.calls.map((c) => c.fn)).toEqual(['dpdp_retention_proof_plan', 'dpdp_retention_proof_done'])
  })
})

describe('dry run', () => {
  test('not live: the count is recorded, no file is touched, even if names were somehow listed', async () => {
    const h = harness({ live: false, days: 180, count: 4, names: ['u/a.png'] })
    const r = await runRetentionFiles(h.deps)
    expect(r).toMatchObject({ live: false, pastPeriod: 4, removed: 0 })
    expect(h.removeCalls).toEqual([])
    expect(h.calls[1].args).toEqual({ p_removed: [], p_live: false, p_would_remove: 4 })
  })
  test('asked for a dry run while live: the plan is requested as a dry run and nothing is removed', async () => {
    const h = harness({ live: true, days: 180, count: 2, names: ['u/a.png'] })
    const r = await runRetentionFiles(h.deps, { dryRun: true })
    expect(h.calls[0].args).toEqual({ p_force_dry_run: true })
    expect(r.live).toBe(false)
    expect(h.removeCalls).toEqual([])
  })
})

describe('live with a period set', () => {
  test('removes the listed files in batches and reports exactly what the Storage API confirmed', async () => {
    const names = Array.from({ length: 230 }, (_, i) => `u/f${i}.png`)
    const h = harness({ live: true, days: 180, count: 230, names })
    const r = await runRetentionFiles(h.deps)
    expect(h.removeCalls.map((b) => b.length)).toEqual([100, 100, 30])
    expect(r).toMatchObject({ live: true, removed: 230, failed: 0 })
    expect((h.calls[1].args.p_removed as string[]).length).toBe(230)
  })
  test('a file the Storage API did not remove keeps its path: it is not reported as removed', async () => {
    const h = harness({ live: true, days: 180, count: 3, names: ['u/a.png', 'u/b.png', 'u/c.png'] }, { removeOnly: (n) => n !== 'u/b.png' })
    const r = await runRetentionFiles(h.deps)
    expect(r).toMatchObject({ removed: 2, failed: 1 })
    expect(h.calls[1].args.p_removed).toEqual(['u/a.png', 'u/c.png'])
  })
  test('the storage layer throws: nothing is forgotten, the failure is counted, no exception escapes', async () => {
    const h = harness({ live: true, days: 180, count: 2, names: ['u/a.png', 'u/b.png'] }, { removeFails: true })
    const r = await runRetentionFiles(h.deps)
    expect(r).toMatchObject({ removed: 0, failed: 2 })
    expect(h.calls[1].args.p_removed).toEqual([])
  })
  test('a name that is not a plain string or that tries to climb out is ignored', async () => {
    const h = harness({ live: true, days: 180, count: 3, names: ['u/ok.png', '../x', 5, ''] })
    await runRetentionFiles(h.deps)
    expect(h.removeCalls).toEqual([['u/ok.png']])
  })
})

describe('faults', () => {
  test('the plan cannot be read: nothing is removed and the report says so', async () => {
    const h = harness(null, { planError: true })
    expect(await runRetentionFiles(h.deps)).toMatchObject({ error: 'plan_failed', removed: 0 })
    expect(h.removeCalls).toEqual([])
  })
  test('the book cannot be written: the report says so', async () => {
    const h = harness({ live: false, days: 180, count: 0, names: [] }, { doneError: true })
    expect((await runRetentionFiles(h.deps)).error).toBe('record_failed')
  })
})
