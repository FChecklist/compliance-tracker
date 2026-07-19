// VCEL Calculation Explainability (VERIDIAN Review Framework gap closure,
// 2026-07-18). A shared, optional shape any engine's result type can embed
// so a caller (currently task-execution-engine.ts's executeEngineDispatch)
// can render a real step-by-step breakdown instead of a flat JSON blob --
// see structured-message.ts's "calculation" type and
// StructuredMessageContent.tsx for the render side.
//
// Deliberately additive: `breakdown` is optional on every result type it's
// added to, so existing callers (including the golden-value test suite)
// that only check the pre-existing fields are unaffected.
export type CalculationStep = {
  label: string // e.g. "Slab 800,001-1,200,000 @ 10%"
  formula?: string // e.g. "400,000 x 10%"
  value: number | string // the step's own result, e.g. 40000
}

export type CalculationBreakdown = {
  steps: CalculationStep[]
}
