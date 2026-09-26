// PROJEXA-BUILD-001 U-43 (register row BR-582, spec 9.9, audit A-01, C-12,
// F-15) -- THE READ-ONLY EXECUTOR MODE.
//
// A function read through the AI work link (POST /functions/{fn}, MCP
// tools/call of a read function) must not leave a trace in the business
// tables. runDirectTask() cannot serve it: it is the pill path, and it mints a
// submissions row, a pipeline_tasks row, a pill use, a chain-history row and,
// for a write, a task memory -- for a READ too (F-15). Counting a submission
// for every question an AI asks would also fill Task Master with work nobody
// requested.
//
// This is the only path for those reads. It resolves the function in the
// registry, checks it is a read on the caller's effective list, forces the
// project, runs validate(), and then calls executeTask() -- and nothing else:
//
//   NO  compliance.submissions      NO  pipeline_tasks     NO  pill_usage
//   NO  chain_history               NO  gap_log            NO  memory
//   NO  intent
//
// (The call-log row spec 10.5 adds for the request is written by the link host,
// not here.) It imports neither run-submission.ts nor any repo of the write
// path, so a read cannot reach runDirectTask() by accident; execute-read.test.ts
// fails if it does. The read executors themselves only select.
//
// The `run` seam is injectable for tests ONLY, like executeTask()'s own
// `executors` parameter; every production caller uses the default.
import { executeTask, hasExecutor, functionWrites, type ExecutableTask, type ExecutionOutcome } from "./executor";
import { functionSpec } from "./function-registry";
import { validate, type ValidationContext } from "./validate";
import { isRetryableFailure, type PipelineFailure } from "./error-codes";

/**
 * Optional parameters a read accepts that the registry does not declare yet:
 * function-registry.ts's readSpec() declares no parameter at all, but
 * get_boq_line_items pages with boqId, cursor and limit (executor.ts
 * executeGetBoqLineItems). Kept here, next to the rule that needs it, until the
 * registry carries optional parameters itself.
 */
const READ_OPTIONAL_PARAMS: Readonly<Record<string, readonly string[]>> = {
  get_boq_line_items: ["boqId", "cursor", "limit"],
};

export type ExecuteReadInput = {
  orgId: string;
  /** the link's user: a verified person, never an api key (PMD-35). */
  userId: string;
  /** THE link's project. Forced onto the call, never taken from `params`. */
  projectId: string;
  functionId: string;
  params?: Record<string, unknown>;
  /** the live role of the link's user (spec 10.9): money is redacted by it, and null redacts. */
  role: string | null;
  actorUserId?: string | null;
  /** the link's effective function list (spec 10.9). Omitted means every read function this pipeline can run. */
  allowedFunctionIds?: ReadonlySet<string> | readonly string[];
};

export type ExecuteReadOutcome =
  | { ok: true; functionId: string; result: unknown }
  | { ok: false; status: 403; code: "FUNCTION_NOT_READ" | "FUNCTION_NOT_ALLOWED" }
  | { ok: false; status: 422 | 503; failure: PipelineFailure };

/** The parameter names the registry declares for `functionId`: required ones, the names that stand in for them, card fields, and the optional read parameters above. */
export function declaredReadParams(functionId: string): Set<string> {
  const spec = functionSpec(functionId);
  const names = new Set<string>(["projectId"]);
  for (const required of spec?.requiredParams ?? []) {
    names.add(required.name);
    for (const alias of required.alsoSatisfiedBy ?? []) names.add(alias);
  }
  for (const field of spec?.card?.fields ?? []) names.add(field.key);
  for (const name of READ_OPTIONAL_PARAMS[functionId] ?? []) names.add(name);
  return names;
}

export async function executeRead(
  input: ExecuteReadInput,
  run: (task: ExecutableTask) => Promise<ExecutionOutcome> = executeTask
): Promise<ExecuteReadOutcome> {
  // 1. The function must be a read this pipeline can run. A write, a command
  //    verb and an unknown id are all refused here, before anything else.
  const spec = functionSpec(input.functionId);
  if (!spec || spec.writes || spec.kind === "write" || functionWrites(input.functionId) || !hasExecutor(input.functionId)) {
    return { ok: false, status: 403, code: "FUNCTION_NOT_READ" };
  }
  // 2. ...and on the caller's effective list.
  if (input.allowedFunctionIds !== undefined) {
    const allowed = input.allowedFunctionIds instanceof Set ? input.allowedFunctionIds : new Set(input.allowedFunctionIds);
    if (!allowed.has(input.functionId)) return { ok: false, status: 403, code: "FUNCTION_NOT_ALLOWED" };
  }

  // 3. Only the declared parameters; the project is the link's, whatever the
  //    caller named.
  const declared = declaredReadParams(input.functionId);
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input.params ?? {})) {
    if (declared.has(key)) params[key] = value;
  }
  params.projectId = input.projectId;

  // 4. validate(). A failure is a 422 with the code and what is missing, and
  //    writes no gap row -- logging one is exactly the write this mode forbids.
  //    The context is the tightest one: the one function, the one project.
  const context: ValidationContext = {
    candidateFunctionIds: [input.functionId],
    boqLineItemIds: new Set<string>(),
    userPermittedFunctionIds: new Set([input.functionId]),
    reachableProjectIds: new Set([input.projectId]),
    submissionProjectId: input.projectId,
    projectLabel: null,
  };
  const checked = validate({ functionId: input.functionId, params }, context);
  if (!checked.valid) {
    const { valid: _valid, ...failure } = checked;
    return { ok: false, status: 422, failure };
  }

  // 5. The read executor, and only that.
  const outcome = await run({
    orgId: input.orgId,
    userId: input.userId,
    projectId: input.projectId,
    functionId: input.functionId,
    params: checked.params,
    role: input.role,
    actorUserId: input.actorUserId ?? null,
  });
  if (!outcome.success) {
    if (outcome.debug) console.error(`[pipeline] read function=${input.functionId} ${outcome.failure.code} raw=${outcome.debug}`);
    return { ok: false, status: isRetryableFailure(outcome.failure.code) ? 503 : 422, failure: outcome.failure };
  }
  return { ok: true, functionId: input.functionId, result: outcome.result };
}
