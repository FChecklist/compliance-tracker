import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Guards ai-os/PROJEXA_AI_FUNCTION_COVERAGE_2026-10-09.md: every one of Sumeet's
// 111 requirement ids appears exactly once, and every cited function id exists
// in the generated work-link registry.
const root = process.cwd()
const md = readFileSync(join(root, 'ai-os/PROJEXA_AI_FUNCTION_COVERAGE_2026-10-09.md'), 'utf8')
const registry = JSON.parse(
  readFileSync(join(root, 'supabase/functions/ai-work-link/function-registry.generated.json'), 'utf8'),
) as Array<{ function_id: string }>
const known = new Set(registry.map((f) => f.function_id))

const rows = md
  .split('\n')
  .filter((l) => l.startsWith('| ') && !l.startsWith('| id ') && !l.startsWith('| tag '))
  .map((l) => l.split('|').map((c) => c.trim()))
  .filter((c) => /^(R-|EXC-ITEM-)/.test(c[1] ?? ''))

describe('AI function coverage table', () => {
  test('has all 111 requirement ids exactly once', () => {
    const ids = rows.map((r) => r[1])
    expect(ids.length).toBe(111)
    expect(new Set(ids).size).toBe(111)
  })

  test('every cited function id exists in the generated registry', () => {
    const bad: string[] = []
    for (const r of rows) {
      const cell = r[4] ?? ''
      if (cell === '-' || cell === '') continue
      for (const f of cell.split(',').map((s) => s.trim())) {
        if (!known.has(f)) bad.push(`${r[1]}:${f}`)
      }
    }
    expect(bad).toEqual([])
  })

  test('verdicts are from the allowed set', () => {
    const ok = new Set(['AI-COVERED', 'UI-ONLY', 'SERVER-RULE', 'OWNER-INFRA', 'MISSING'])
    for (const r of rows) expect(ok.has(r[3] ?? '')).toBe(true)
  })
})
