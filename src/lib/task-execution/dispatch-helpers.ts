// Shared plumbing for task-execution-engine.ts's per-category computation-
// engine dispatchers (src/lib/task-execution/dispatch-*-engines.ts). Split
// out of task-execution-engine.ts (VERIDIAN Review Framework, "AI
// Engineering Quality / Overall Code Quality" gap-closure) -- dispatchEngine()
// used to be one ~1150-line function containing 24 sequential
// `switch (engineKey) { ... }` blocks, one per computation-engine category
// (GST, Mathematical, Costing, Payroll, ...). Each category is now its own
// module; this file holds the bits every one of them needs.

// Sentinel returned by a category dispatcher when `engineKey` doesn't belong
// to its category, so the caller (dispatchEngine, in task-execution-engine.ts)
// knows to try the next one. A distinct Symbol (not `undefined`/`null`) so a
// real engine result of `undefined`/`null` is never mistaken for "not mine".
export const NOT_HANDLED: unique symbol = Symbol('task-execution-engine.dispatch.not-handled')

// Backs every boolean-ish CapabilityInputField -- the composer sends
// "yes"/"true"/"1" as free text, never a real boolean.
export function truthy(v: unknown): boolean {
  const s = String(v ?? '').trim().toLowerCase()
  return s === 'yes' || s === 'true' || s === '1'
}

// Backs every `number_list` CapabilityInputField -- the composer sends the
// raw comma-separated text unparsed, this is the one place it becomes a
// real number[], with a clear error on a malformed entry rather than
// silently coercing "abc" to NaN and letting a bad value flow into a
// calculation undetected.
export function parseNumberList(v: unknown): number[] {
  const raw = String(v ?? '').trim()
  if (!raw) return []
  return raw.split(',').map((part) => {
    const n = Number(part.trim())
    if (!Number.isFinite(n)) throw new Error(`"${part.trim()}" is not a valid number`)
    return n
  })
}
