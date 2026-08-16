// Priority 5 (10-priority5-software-orchestrator-tracker.yaml, dispatch
// agent 2 scope): the hard MISSING_INFORMATION rule for Lower AI's
// instruction-package executor (task-execution-engine.ts's
// executePackageDispatch()). Deliberately a PURE, DB-free, LLM-free module
// -- same separation-of-concerns precedent as software-coverage-service.ts
// (classification) vs capability-learning-service.ts (DB lookups): the
// RULE here is "never invent a value for a required variable", and that
// rule must be checkable without spinning up a live LLM call or a database.
//
// Deliberately narrow extraction strategy: an explicit "key: value" /
// "key = value" pattern in the task's own title+description text. This is
// NOT a general-purpose slot-filling NLU (that would need an LLM call,
// which is exactly the "let the model free-reason instead of following the
// approved package" failure mode this whole mechanism exists to prevent).
// A required variable that isn't stated this explicitly is, by design,
// MISSING_INFORMATION -- Lower AI asks the user rather than guessing.

export class MissingInformationError extends Error {
  readonly missingVariables: string[]
  constructor(missingVariables: string[]) {
    super(`Missing required information: ${missingVariables.join(", ")}`)
    this.name = "MissingInformationError"
    this.missingVariables = missingVariables
  }
}

// Turns a variable name like "gstin_number" or "GSTIN Number" into a regex
// fragment that matches any of the equivalent surface forms a human might
// type ("gstin_number", "gstin number", "GSTIN-Number", ...) -- word
// boundaries collapsed to a shared [\s_-]* separator class.
function keyFragment(variableName: string): string {
  const words = variableName.trim().toLowerCase().split(/[\s_-]+/).filter(Boolean)
  return words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s_-]*")
}

// Resolves a single required variable's value from raw task input text
// (title + description), or null if no explicit "key: value"/"key = value"
// pattern names it. Never returns a guessed/default value -- null is the
// only "not found" signal, matched 1:1 to the caller's MISSING_INFORMATION
// branch.
export function resolvePackageVariable(variableName: string, sourceText: string): string | null {
  const name = variableName?.trim()
  const text = sourceText?.trim()
  if (!name || !text) return null
  const fragment = keyFragment(name)
  if (!fragment) return null
  const regex = new RegExp(`${fragment}\\s*[:=]\\s*([^\\n,;]+)`, "i")
  const match = text.match(regex)
  const value = match?.[1]?.trim()
  return value ? value : null
}

export type PackageVariableResolution = {
  resolved: Record<string, string>
  missing: string[]
}

// Resolves every requiredVariables entry against the same source text --
// the whole-package variant executePackageDispatch() calls directly. Never
// partially throws; callers decide what to do with a non-empty `missing`
// list (executePackageDispatch() throws MissingInformationError).
export function resolvePackageVariables(requiredVariables: string[], sourceText: string): PackageVariableResolution {
  const resolved: Record<string, string> = {}
  const missing: string[] = []
  for (const variableName of requiredVariables) {
    const value = resolvePackageVariable(variableName, sourceText)
    if (value === null) missing.push(variableName)
    else resolved[variableName] = value
  }
  return { resolved, missing }
}

// Convenience wrapper that throws the typed error directly -- the real call
// site in executePackageDispatch() wants a throw (it already runs inside a
// try/catch that distinguishes MissingInformationError from every other
// failure shape), not a result object to re-check.
export function resolvePackageVariablesOrThrow(requiredVariables: string[], sourceText: string): Record<string, string> {
  const { resolved, missing } = resolvePackageVariables(requiredVariables, sourceText)
  if (missing.length > 0) throw new MissingInformationError(missing)
  return resolved
}
