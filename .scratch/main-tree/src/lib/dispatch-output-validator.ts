// Gap closure, 2026-07-10 (CAPABILITY_COVERAGE.md): "input and output
// correctness" for the deterministic Chain Selector dispatch path.
// Structured dispatch (dispatchTool()/dispatchEngine()) already guarantees
// the CODE that runs is the right code -- what it didn't guarantee is that
// the code's own output is sane. A divide-by-zero, an unhandled edge case
// in a calculation, or a bad upstream data value can all produce NaN or
// Infinity; without this check, that value would be JSON.stringify'd and
// posted to the task chat as if it were a trustworthy computed fact.
//
// Deliberately narrow: this is not a schema validator (computation_engines'
// own input_schema/output_schema columns are unpopulated across the
// registry today, so there's nothing to validate structurally against yet)
// -- it's a sanity floor. A result that fails this check is not "probably
// fine," it is definitionally wrong, so the step is marked failed rather
// than shown.
export class DispatchOutputError extends Error {}

function findFirstInvalidNumber(value: unknown, path: string): string | null {
  if (typeof value === "number") {
    if (Number.isNaN(value)) return `${path || "result"} is NaN`
    if (!Number.isFinite(value)) return `${path || "result"} is not a finite number`
    return null
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const bad = findFirstInvalidNumber(value[i], `${path}[${i}]`)
      if (bad) return bad
    }
    return null
  }
  if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      const bad = findFirstInvalidNumber(v, path ? `${path}.${key}` : key)
      if (bad) return bad
    }
    return null
  }
  return null
}

/** Throws DispatchOutputError if any number anywhere in `output` is NaN/Infinity. Never rejects non-numeric results. */
export function assertValidDispatchOutput(output: unknown): void {
  const problem = findFirstInvalidNumber(output, "")
  if (problem) throw new DispatchOutputError(`Computed result failed a sanity check (${problem}) -- not shown as it may be inaccurate.`)
}
