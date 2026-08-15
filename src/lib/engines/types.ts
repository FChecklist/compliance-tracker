// AI Architecture / Explainability & Transparency gap-closure (2026-07-18).
// "Explain Calculations"/"Explains Calculations Step-by-Step" findings: the
// 24 files under src/lib/engines/* (VCEL compute engines) return plain
// numbers or flat numeric/enum objects with zero explanation field anywhere
// (confirmed by reading every file's exported return types). This is the
// shared contract new/updated engine functions should return.
//
// Deliberately NOT a breaking change to the ~100 existing engine functions'
// signatures -- many are dispatched generically by string key from
// task-execution-engine.ts's VCEL switch, and changing their return shape
// would touch every caller of that dispatch, a much larger blast radius
// than this gap-closure pass. Instead, this is the sanctioned shape for (a)
// new engine functions going forward and (b) additive `*Explained()`
// variants alongside an existing function, wired into the one real caller
// that benefits from it -- see accounting-engine.ts's
// verifyBalancesNetToZeroExplained() and analytics-engine.ts's
// analyzeTrendExplained() for the pattern.

export type EngineResultStep = {
  label: string
  value: number | string
}

export type EngineResult<T> = {
  value: T
  /** Plain-language explanation of what this result means and how it was derived. Required -- this is the whole point of the type. */
  explanation: string
  /** What the calculation assumed to be true (proxies used, data gaps, simplifications). Convention: required on all NEW engine output going forward; optional here only for callers not yet migrated. */
  assumptions?: string[]
  /** Ordered intermediate-calculation trace, when the calculation has real steps worth showing (not every result has a meaningful step-by-step breakdown). */
  steps?: EngineResultStep[]
}
