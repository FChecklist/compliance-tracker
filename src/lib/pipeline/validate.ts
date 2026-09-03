// R42 seq12 (M26 P2) -- the validation gate every L0/L1 classification
// output must pass before a task is ever created. M26: "A candidate that
// fails validation is a FAIL, not a suggestion" -- callers must treat a
// failed validate() result the same as a miss (gap_log + honest "cannot do
// that yet"), never surface it to the user as a lower-confidence option.
//
// R67 lane B (B-01/B-02, decision D-03): THIS FILE NO LONGER COMPOSES
// ENGLISH. Every failure is a {code, missing, context, picker} from the
// closed vocabulary in ./error-codes.ts; the sentence a human reads lives
// in projexa's src/lib/task-errors.ts and nowhere else. A failed result can
// therefore never leak a camelCase parameter name, a function id or a
// host:port into the UI, because it no longer carries a rendered string at
// all.
import {
  codeForParam,
  pipelineFailure,
  type PipelineFailure,
} from "./error-codes";
import { functionSpec, requiredParamSatisfied } from "./function-registry";

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
  /**
   * R67 B-01: real item CODES ("EX-01") in this project's BOQ, when the
   * caller has them. undefined means "not resolved here" and the check is
   * skipped -- executor.ts re-checks the code against the real BOQ inside
   * its own transaction regardless, so an unchecked code can never reach a
   * write; resolving them here only lets the user be told BEFORE a task is
   * minted.
   */
  boqItemCodes?: ReadonlySet<string>;
  /** function_ids this user's role is permitted to execute. */
  userPermittedFunctionIds: ReadonlySet<string>;
  /** project ids this user/org may reach (write or read, per the candidate's own needs). */
  reachableProjectIds: ReadonlySet<string>;
  /**
   * R67 B-02: the project the SUBMISSION already carried -- PROJEXA's top
   * rail sends it on every POST /api/v1/projexa/tasks body. Every budget
   * screenshot in the R66 walkthrough showed "Review Budget -- blocked -- no
   * project resolved for this task" in the left pane while the right pane
   * was already scoped to that very project; the projectId was in the
   * request the whole time and simply never reached the candidate's params.
   */
  submissionProjectId?: string | null;
  /** The BOQ version/label the codes above came from, for the client's sentence. */
  boqVersion?: string | null;
  /** The project's human name, for the client's sentence. */
  projectLabel?: string | null;
};

export type ValidationFailure = { valid: false } & PipelineFailure;
/** On success the caller MUST use `params` -- it carries B-02's resolved projectId. */
export type ValidationSuccess = { valid: true; params: Record<string, unknown> };
export type ValidationResult = ValidationSuccess | ValidationFailure;

function fail(failure: PipelineFailure): ValidationFailure {
  return { valid: false, ...failure };
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim().length === 0);
}

// Minimal, generic type-checking by param NAME convention rather than a full
// per-function schema registry -- '*Percent'/'percent' must be a finite
// number in [0,100]; anything ending 'Id' must be a non-empty string. A
// param this convention doesn't recognise is passed through unchecked --
// this gate catches the specific failure MODES M26 calls out (a hallucinated
// id, an out-of-range percent), not every conceivable type error.
function checkParamTypes(params: Record<string, unknown>): ValidationResult {
  for (const [key, value] of Object.entries(params)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === "percent" || lowerKey.endsWith("percent")) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return fail(pipelineFailure("VALUE_REQUIRED", [key]));
      }
      if (value < 0 || value > 100) {
        return fail(pipelineFailure("VALUE_OUT_OF_RANGE", [key], { field: key, min: 0, max: 100 }));
      }
    } else if (lowerKey.endsWith("id") && lowerKey !== "id") {
      if (typeof value !== "string" || value.trim().length === 0) {
        return fail(pipelineFailure(codeForParam(key), [key]));
      }
    }
  }
  return { valid: true, params };
}

/**
 * validate() -- every check M26 requires, in order, first failure wins:
 *   1. function_id in candidate set
 *   2. the named BOQ item code exists in this project's BOQ (when resolved)
 *   3. boq_line_item_id (if present in params) exists IN THIS BOQ
 *   4. types correct (see checkParamTypes above)
 *   5. the function's own declared required params are present
 *   6. a project-scoped function has a project (falling back to the
 *      submission's own projectId before failing -- R67 B-02)
 *   7. user permitted
 *   8. project reachable
 */
export function validate(candidate: ValidationCandidate, ctx: ValidationContext): ValidationResult {
  if (!ctx.candidateFunctionIds.includes(candidate.functionId)) {
    return fail(pipelineFailure("FUNCTION_NOT_AVAILABLE", [], { functionId: candidate.functionId }));
  }

  // R67 B-01: the code the user actually said ("EX-01"), checked against the
  // codes this project's BOQ really has. This is the failure the R66
  // walkthrough surfaced as the raw string `item code "1" not found in this
  // project's BOQ` -- now a code the client turns into "There is no line 1
  // on Cedar Heights Villa Rev0 -- pick a line".
  const itemCode = candidate.params.itemCode;
  if (ctx.boqItemCodes && typeof itemCode === "string" && itemCode.trim().length > 0) {
    if (!ctx.boqItemCodes.has(itemCode)) {
      return fail(
        pipelineFailure("BOQ_LINE_NOT_FOUND", ["itemCode"], {
          itemCode,
          project: ctx.projectLabel ?? null,
          version: ctx.boqVersion ?? null,
        })
      );
    }
  }

  const boqLineItemId = candidate.params.boqLineItemId;
  if (typeof boqLineItemId === "string" && boqLineItemId.trim().length > 0) {
    if (!ctx.boqLineItemIds.has(boqLineItemId)) {
      return fail(
        pipelineFailure("BOQ_LINE_NOT_FOUND", ["boqLineItemId"], {
          project: ctx.projectLabel ?? null,
          version: ctx.boqVersion ?? null,
        })
      );
    }
  }

  const typeCheck = checkParamTypes(candidate.params);
  if (!typeCheck.valid) return typeCheck;

  // The resolved params the caller must go on to use. A copy, so validate()
  // never mutates the classifier's own object.
  const params: Record<string, unknown> = { ...candidate.params };
  const spec = functionSpec(candidate.functionId);

  // R67 B-04: the function's declared required parameters, checked HERE so a
  // service never has to throw "attendanceDate is required" through the
  // executor's catch block and out to a user as prose.
  if (spec) {
    for (const required of spec.requiredParams) {
      if (required.name === "projectId") continue; // handled by the project rule below
      if (!requiredParamSatisfied(required, params)) {
        // R67 B-09/B-10: `missing` names the field in the D-03 vocabulary
        // ("boqLine"), not the classifier's parameter ("itemCode"). Both
        // callers of this result -- the projexa dictionary and the Fix chain
        // -- key off that vocabulary.
        return fail(pipelineFailure(required.code, [required.field ?? required.name]));
      }
    }
  }

  // R67 B-02: resolve the project from the submission before ever failing.
  if (spec?.requiresProject) {
    if (isMissing(params.projectId) && !isMissing(ctx.submissionProjectId)) {
      params.projectId = ctx.submissionProjectId;
    }
    if (isMissing(params.projectId)) {
      return fail(pipelineFailure("PROJECT_REQUIRED", ["projectId"]));
    }
  }

  if (!ctx.userPermittedFunctionIds.has(candidate.functionId)) {
    return fail(pipelineFailure("NOT_PERMITTED", [], { functionId: candidate.functionId }));
  }

  const projectId = params.projectId;
  if (typeof projectId === "string" && projectId.length > 0) {
    if (!ctx.reachableProjectIds.has(projectId)) {
      return fail(pipelineFailure("PROJECT_NOT_REACHABLE", ["projectId"], { project: ctx.projectLabel ?? null }));
    }
  }

  return { valid: true, params };
}
