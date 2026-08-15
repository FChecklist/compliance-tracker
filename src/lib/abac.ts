// VERIDIAN Review Framework gap-closure (2026-07-18), "ABAC / Fine-Grained
// Policies" -- Critical: "No attribute-based access control exists; RBAC
// only." Confirmed by reading approval-workflow-service.ts in full: it
// already had exactly one attribute predicate per workflow step
// (conditionField/conditionOperator/conditionValue, Wave 51) -- a real but
// narrow ABAC primitive, one field, AND-able with nothing else. This module
// generalizes that primitive into a reusable, multi-condition evaluator so
// any caller (approval workflow steps, abac-policy-service.ts's deny
// policies, or a future module) can gate on an arbitrary combination of
// resource/actor/environment attributes, not just a single numeric field.
//
// Deliberately pure and deterministic -- no DB access, no LLM call, matches
// every other gate in this codebase (floor-tier-escalation.ts,
// policy-enforcement-engine.ts, confidence-banding.ts).
export type AttributeOperator = "gt" | "gte" | "lt" | "lte" | "eq" | "neq" | "in" | "contains"

export type AttributeCondition = {
  /** Dot-free key looked up directly on the attributes bag passed by the caller, e.g. 'grandTotal', 'department', 'region'. */
  field: string
  operator: AttributeOperator
  /** 'in' expects an array to match against; 'contains' expects a string/array haystack on the attribute side. Every other operator expects a single scalar. */
  value: number | string | Array<number | string>
}

export type UnknownFieldPolicy = "match" | "no_match"

export type EvaluateConditionsOptions = {
  /**
   * What happens when `condition.field` is absent from `attributes`
   * (`undefined`). Two real, opposite-safety-direction call sites already
   * exist in this codebase for exactly this ambiguity:
   *  - approval-workflow-service.ts's startApprovalWorkflow (deciding
   *    whether a workflow STEP applies): fails open toward MORE approval --
   *    an unknown field means "include the step" (default 'match'), since
   *    silently skipping an approval step on missing data would weaken a
   *    control.
   *  - abac-policy-service.ts's deny-policy overlay (deciding whether to
   *    BLOCK an action): fails open toward LESS blocking -- an unknown
   *    field means "this deny condition did not fire" (default 'no_match'),
   *    since RBAC has already gated the base action and this layer should
   *    only add MORE restriction when the data needed to evaluate it is
   *    actually present, never invent a block from missing data.
   * Every caller must pass this explicitly rather than rely on a shared
   * default, so the safety direction is always a deliberate choice at the
   * call site, not an accident of whichever default this module picked.
   */
  unknownField: UnknownFieldPolicy
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Evaluates a single attribute condition against a real value already resolved from the caller's attribute bag (never undefined here -- unknown-field handling happens one level up in evaluateAttributeConditions). */
function evaluateResolvedCondition(operator: AttributeOperator, fieldValue: unknown, target: AttributeCondition["value"]): boolean {
  switch (operator) {
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = coerceNumber(fieldValue)
      const b = coerceNumber(target)
      if (a === null || b === null) return false
      if (operator === "gt") return a > b
      if (operator === "gte") return a >= b
      if (operator === "lt") return a < b
      return a <= b
    }
    case "eq":
      return String(fieldValue) === String(target)
    case "neq":
      return String(fieldValue) !== String(target)
    case "in": {
      const candidates = Array.isArray(target) ? target : [target]
      return candidates.some((c) => String(c) === String(fieldValue))
    }
    case "contains": {
      if (Array.isArray(fieldValue)) return fieldValue.some((v) => String(v) === String(target))
      return String(fieldValue).toLowerCase().includes(String(target).toLowerCase())
    }
  }
}

/** Generalizes approval-workflow-service.ts's original single-field evaluateCondition() to one condition -- kept as its own export so that call site's exact legacy behavior (numeric-only gt/gte/lt/lte/eq) is unaffected by this module existing. */
export function evaluateAttributeCondition(
  condition: AttributeCondition,
  attributes: Record<string, unknown>,
  opts: EvaluateConditionsOptions
): boolean {
  const fieldValue = attributes[condition.field]
  if (fieldValue === undefined) return opts.unknownField === "match"
  return evaluateResolvedCondition(condition.operator, fieldValue, condition.value)
}

/** AND-combines every condition -- the real ABAC generalization: a step or policy can now depend on N attributes at once (e.g. amount > 10000 AND department == 'finance' AND region == 'UAE'), not just one. An empty/absent condition list always matches (nothing to gate on). */
export function evaluateAttributeConditions(
  conditions: AttributeCondition[] | null | undefined,
  attributes: Record<string, unknown>,
  opts: EvaluateConditionsOptions
): boolean {
  if (!conditions || conditions.length === 0) return true
  return conditions.every((c) => evaluateAttributeCondition(c, attributes, opts))
}
