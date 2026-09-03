// R42 seq12 (M26 P2) -- the validation gate every L0/L1 classification
// output must pass before a task is ever created. M26: "A candidate that
// fails validation is a FAIL, not a suggestion" -- callers must treat a
// failed validate() result the same as a miss (gap_log + honest "cannot do
// that yet"), never surface it to the user as a lower-confidence option.

import { slotCode, type SlotErrorCode } from "./function-slots";

export type ValidationCandidate = {
  functionId: string;
  params: Record<string, unknown>;
};

// Everything validate() needs, pre-resolved by the caller (a route/service
// with real auth + BOQ context) -- this file does no DB access and no auth
// lookup itself, so it stays a pure, fast, exhaustively-testable gate.
export type ValidationContext = {
  /** The module's own candidate set for this submission (5-15 functions, M26 -- never the full catalogue). */
  candidateFunctionIds: readonly string[];
  /** Real boq_line_item ids that exist IN THIS BOQ (not just anywhere in the org). */
  boqLineItemIds: ReadonlySet<string>;
  /** function_ids this user's role is permitted to execute. */
  userPermittedFunctionIds: ReadonlySet<string>;
  /** project ids this user/org may reach (write or read, per the candidate's own needs). */
  reachableProjectIds: ReadonlySet<string>;
};

/**
 * R67 C-03 (decision D-03) -- A FAILURE NOW CARRIES A CODE AND THE FIELD.
 *
 * `reason` is unchanged and still the engineer-facing sentence every existing
 * caller logs; `code` and `missing` are ADDITIVE, and they are what a product
 * is allowed to render. PROJEXA's src/lib/task-errors.ts turns the code into
 * the one sentence a person reads ("Pick a BOQ line"), so a camelCase param
 * name, a function id or a pooler IP can never reach a site engineer's screen
 * again -- which is exactly how they did reach it before this.
 */
export type ValidationFailure = {
  valid: false;
  reason: string;
  code: SlotErrorCode;
  /** The field the user has to supply or correct, when the failure names one. */
  missing: string[];
};

export type ValidationResult = { valid: true } | ValidationFailure;

function fail(reason: string, code: SlotErrorCode, missing: string[] = []): ValidationFailure {
  return { valid: false, reason, code, missing };
}

// Minimal, generic type-checking by param NAME convention rather than a full
// per-function schema registry (that arrives with the real function
// catalogue at seq20's screen_definitions) -- '*Percent'/'percent' must be a
// finite number in [0,100]; anything ending 'Id' must be a non-empty string.
// A param this convention doesn't recognise is passed through unchecked --
// this gate catches the specific failure MODES M26 calls out (a hallucinated
// id, an out-of-range percent), not every conceivable type error.
function checkParamTypes(functionId: string, params: Record<string, unknown>): ValidationResult {
  for (const [key, value] of Object.entries(params)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === "percent" || lowerKey.endsWith("percent")) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
        return fail(
          `${key} must be a number between 0 and 100, got ${JSON.stringify(value)}`,
          slotCode(functionId, key) ?? "VALUE_REQUIRED",
          [key]
        );
      }
    } else if (lowerKey.endsWith("id") && lowerKey !== "id") {
      if (typeof value !== "string" || value.length === 0) {
        return fail(
          `${key} must be a non-empty string, got ${JSON.stringify(value)}`,
          slotCode(functionId, key) ?? "VALUE_REQUIRED",
          [key]
        );
      }
    }
  }
  return { valid: true };
}

/**
 * validate() -- every check M26 requires, in order, first failure wins:
 *   1. function_id in candidate set
 *   2. boq_line_item_id (if present in params) exists IN THIS BOQ
 *   3. types correct (see checkParamTypes above)
 *   4. user permitted
 *   5. project reachable (if projectId present in params)
 */
export function validate(candidate: ValidationCandidate, ctx: ValidationContext): ValidationResult {
  if (!ctx.candidateFunctionIds.includes(candidate.functionId)) {
    return fail(
      `function_id "${candidate.functionId}" is not in this module's candidate set`,
      "FUNCTION_NOT_AVAILABLE"
    );
  }

  const boqLineItemId = candidate.params.boqLineItemId;
  if (typeof boqLineItemId === "string" && boqLineItemId.length > 0) {
    if (!ctx.boqLineItemIds.has(boqLineItemId)) {
      return fail(`boq_line_item_id "${boqLineItemId}" does not exist in this BOQ`, "BOQ_LINE_NOT_FOUND", [
        "boqLineItemId",
      ]);
    }
  }

  const typeCheck = checkParamTypes(candidate.functionId, candidate.params);
  if (!typeCheck.valid) return typeCheck;

  if (!ctx.userPermittedFunctionIds.has(candidate.functionId)) {
    return fail(`user is not permitted to execute "${candidate.functionId}"`, "FUNCTION_NOT_AVAILABLE");
  }

  const projectId = candidate.params.projectId;
  if (typeof projectId === "string" && projectId.length > 0) {
    if (!ctx.reachableProjectIds.has(projectId)) {
      return fail(`project "${projectId}" is not reachable by this user`, "PROJECT_REQUIRED", ["projectId"]);
    }
  }

  return { valid: true };
}
