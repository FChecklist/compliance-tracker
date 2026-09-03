// R42 seq14 / R53 Phase 4 -- M25's submission -> segmentation -> task
// pipeline. SYNCHRONOUS ONLY (M26's own recommendation, on record: "add the
// queue only when something genuinely outlives a request" -- nothing here
// does).
//
// Order: segment() [pure] -> classifyL0() per segment [deterministic, $0]
// -> ONE batched level1() call for the misses [the only AI in this file]
// -> classifySegment() for the TASK/CHAT/GAP verdict [pure] -> validate()
// -> mint the pipeline_tasks row -> executeTask() -> update the row.
//
// *** R53 PHASE 4 CHANGED THE SHAPE OF THIS FILE IN ONE IMPORTANT WAY:
// RESOLUTION IS NOW COMPLETE BEFORE ANY EXECUTION BEGINS. It used to
// resolve-and-execute segment by segment in a single loop. It cannot any
// more, because the re-join-once rule needs to see every segment's outcome
// before deciding which to merge, and merging a segment that had ALREADY
// EXECUTED would run its write a second time. Resolve everything, then
// execute everything. ***
import { and, eq, sql } from "drizzle-orm";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { submissions, pipelineTasks, pillUsage, chainHistory } from "@/lib/db/schema";
import { segment, rejoinCandidate, type Segment } from "./segment";
import { classifyL0, type L0Repo, type ClassificationResult as L0Result } from "./level0";
import { makeL0Repo, makeChainRepo, makeReuseCacheRepo, resolveRootLabel, logGapRow } from "./repos";
import { classifySegment, classifySubmission, normaliseForMatch, type Classification, type ResolvedFunction, type SubmissionClassification } from "./classify";
import { validate, type ValidationContext } from "./validate";
import { deriveChain, type DerivedChain } from "./derive-chain";
import { resolveMissesWithReuseCache, type ReuseCacheRepo } from "./reuse-cache";
import { executeTask, hasExecutor, functionWrites, EXECUTABLE_FUNCTION_IDS } from "./executor";
import { codeForParam, failureLogLine, isRetryableFailure, pipelineFailure, serialiseFailure, type PipelineFailure } from "./error-codes";
import { dryRunSubmission as dryRun, missingParamsFor, type DryRunDeps, type DryRunResult } from "./dry-run";
import { toVerdictResult, type SubmissionVerdictResult } from "./verdict";
import { makeChainOptionsRepo } from "@/lib/services/chain-options-service";
import { assertAiProviderAllowed } from "@/lib/ai/adapter";
import { createMemoryRecord } from "@/lib/services/memory-service";

// M26: "Pass the module's 5-15 functions ... NEVER 400 unbound functions --
// that is where it hallucinates." The candidate set is exactly what
// executor.ts can actually run, so classifyL0's structural tier, the AI
// adapter's candidate list, validate()'s candidate-set check and the
// executor registry can never silently drift apart.
const CANDIDATE_FUNCTION_IDS = EXECUTABLE_FUNCTION_IDS;

// ═══════════════════════════════════════════════════════════════════════════
// R67 B-11 -- THE VALIDATION CONTEXT, BUILT IN ONE PLACE.
//
// FOUND WHILE WIRING B-11's `done` PAYLOAD TO POST /api/v1/projexa/tasks, and
// it is a real break, not a tidy-up: GET /api/v1/projexa/chain-options hands
// the client `params` containing the BOQ line's RECORD ID (that is the whole
// point of offering chips instead of asking the user to retype a code), and
// B-07's verdict does the same. Both call sites below then built a
// ValidationContext with `boqLineItemIds: new Set()`, and validate() refuses
// ANY boqLineItemId that is not in that set -- so every chain the server
// itself offered came back BOQ_LINE_NOT_FOUND on submit, for ever. The
// comment that justified the empty set ("the executor re-checks it anyway")
// is true of the EXECUTOR, but validate() runs first and never got that far.
//
// So the facts are resolved for real, from THE SAME read chain-options uses
// (chain-options-service's latestBoqLines -- one place that knows what "this
// project's latest BOQ" means, with the same version DESC / createdAt DESC
// tiebreaker executor.ts applies inside its own transaction). The executor's
// re-check is untouched: this makes the user's answer legible BEFORE a task
// is minted, it does not become the authority.
export type BoqValidationFacts = {
  /** boq_line_item ids that exist in THIS project's latest BOQ. */
  lineItemIds: ReadonlySet<string>;
  /** item codes ("EX-01") in that same BOQ. */
  itemCodes: ReadonlySet<string>;
  /** the version label the client's sentence names ("v2"), null when there is no BOQ. */
  version: string | null;
};

/**
 * Does this candidate name a BOQ line at all? Only then is the read below
 * worth a round trip -- "show me the dashboard" must not pay for a BOQ query.
 */
export function referencesBoqLine(params: Record<string, unknown>): boolean {
  for (const key of ["boqLineItemId", "itemCode"]) {
    const value = params[key];
    if (typeof value === "string" && value.trim().length > 0) return true;
  }
  return false;
}

/**
 * ONE definition of the context every validate() call in this file gets.
 * `boq` is null when this submission never named a line, and the two BOQ
 * checks in validate.ts are then skipped exactly as they were before -- an
 * absent fact is not a failed check.
 */
export function buildValidationContext(args: {
  projectId: string | null;
  projectLabel: string | null;
  boq: BoqValidationFacts | null;
  /**
   * R67 FIX PASS: the candidate's own params, so a projectId the REQUEST
   * carried is seeded into the reachable set beside the rail's.
   *
   * Without this, chain-options' new project level was a trap of exactly the
   * kind the "the chain the server itself offered must be executable" commit
   * fixed for BOQ lines: that level returns real project ids as option
   * values, and a client that posted one back in params without also
   * switching the top rail had its OWN offered choice refused with
   * PROJECT_NOT_REACHABLE, for ever.
   *
   * This is not a weakened boundary, because it was never the boundary.
   * `reachableProjectIds` is a HALLUCINATION GUARD -- it catches a project id
   * the classifier invented, which is never in the request -- and real
   * reachability is enforced two layers down, by withTenantContext's org
   * scoping and by each service's own lookup (a project outside this org
   * comes back as ServiceError 404 -> RECORD_NOT_FOUND).
   */
  params?: Record<string, unknown>;
}): ValidationContext {
  const requestedProjectIds = [args.projectId, args.params?.projectId].filter(
    (id): id is string => typeof id === "string" && id.trim().length > 0
  );
  return {
    candidateFunctionIds: CANDIDATE_FUNCTION_IDS,
    boqLineItemIds: args.boq?.lineItemIds ?? new Set<string>(),
    ...(args.boq ? { boqItemCodes: args.boq.itemCodes, boqVersion: args.boq.version } : {}),
    userPermittedFunctionIds: new Set(CANDIDATE_FUNCTION_IDS),
    reachableProjectIds: new Set(requestedProjectIds),
    // R67 B-02: the project the composer's top rail already had.
    submissionProjectId: args.projectId ?? null,
    projectLabel: args.projectLabel,
  };
}

/**
 * The read, memoised per run: a submission with three progress segments asks
 * the database once, not three times (the /scope N+1 lesson).
 */
function makeBoqFactsResolver(orgId: string, userId: string, projectId: string | null) {
  let pending: Promise<BoqValidationFacts> | null = null;
  return async (params: Record<string, unknown>): Promise<BoqValidationFacts | null> => {
    if (!projectId || !referencesBoqLine(params)) return null;
    pending ??= (async () => {
      const boq = await makeChainOptionsRepo({ orgId, userId }).latestBoqLines(projectId);
      // A project with NO BOQ still returns facts, with empty sets: "the line
      // you named is not there" is true either way, and it is the same answer
      // executeRecordWorkProgress gives when it finds no BOQ.
      if (!boq) return { lineItemIds: new Set<string>(), itemCodes: new Set<string>(), version: null };
      return {
        lineItemIds: new Set(boq.lines.map((l) => l.id)),
        itemCodes: new Set(boq.lines.map((l) => l.itemCode).filter((c): c is string => typeof c === "string" && c.length > 0)),
        version: `v${boq.version}`,
      };
    })();
    return pending;
  };
}

export type RunSubmissionInput = {
  orgId: string;
  userId: string;
  mode: string;
  projectId?: string | null;
  selectedChain?: unknown;
  rawInput: string;
  /** R48 gap-closure (2026-08-30, F089) -- see executor.ts's ExecutableTask.role comment. Optional: callers with no role available (e.g. the MCP AI-link route) simply don't get the redaction. */
  role?: string | null;
  /**
   * R67 C-03 (decision D-05, the identity bridge) -- see executor.ts's
   * ExecutableTask.actorUserId. `userId` above may be an api_keys.id; this is
   * always a real compliance.users.id or nothing at all.
   */
  actorUserId?: string | null;
};

export type TaskOutcome = {
  taskId: string;
  functionId: string | null;
  /** R53: the per-segment verdict. NEVER one verdict for the whole submission. */
  verdict: "task" | "chat";
  status: "to_do" | "in_progress" | "waiting" | "done" | "blocked";
  segmentText: string;
  result?: unknown;
  /**
   * R67 B-01 (D-03): the structured failure, never a sentence. `error:
   * string` is gone from this shape on purpose -- there is now no field a
   * caller could render verbatim and accidentally show a user a driver
   * message or a camelCase parameter name.
   */
  failure?: PipelineFailure;
};

export type RunSubmissionResult = {
  submissionId: string | null; // null when the input produced zero segments
  status: "chat" | "in_progress" | "done" | "partial" | "failed";
  /**
   * R65 Part D Phase 4 -- directive §3's submission-level discriminant.
   * DISTINCT from `status` above: this is intent-shape (how much executable
   * work was requested), `status` is execution-outcome (what happened when
   * it ran). See classifySubmission() (classify.ts) for the derivation.
   * Persisted on `submissions.classification` (drizzle/0525) whenever a real
   * submission row exists; still returned (not persisted) on the
   * zero-segment early-return path below, where no row is ever inserted.
   */
  classification: SubmissionClassification;
  chatMessages: string[];
  tasks: TaskOutcome[];
  /**
   * R67 B-01: every segment that could not be run, with the closed-vocabulary
   * code that says why. This is what the client turns into a sentence and a
   * Fix chain; `chatMessages` now carries only real conversational replies.
   */
  failures: ({ segmentText: string } & PipelineFailure)[];
  /** segments that resolved to nothing -- one gap_log row each. */
  gaps: { text: string; reason: string }[];
  flagged: boolean; // MAX_SEGMENTS truncation, surfaced so the caller can ask the user to split their message
  /** fraction of resolved segments that Level 0 handled with no model call. */
  l0HitRate: number;
  /** how many model calls this submission actually made. 0 for a pure Level 0 hit. */
  modelCalls: number;
};

function normalisePhrase(text: string): string {
  return normaliseForMatch(text);
}

/**
 * R67 B-06 -- WHICH ROW STATUS A FAILURE DESERVES.
 *
 * `blocked` is M24's loud state and it means a person has to decide or
 * correct something. A transport failure is not that: the request was fine,
 * nothing was saved, and the next move is simply to send it again. Recording
 * it as blocked is what put "write CONNECT_TIMEOUT 3.109.171.244:6543" into
 * the red half of Task Master in the R66 walkthrough and told a site engineer
 * they had made a mistake.
 *
 * `waiting` is the honest in-set answer -- M24's five statuses are closed (see
 * pipelineTaskStatusEnum's own comment in schema.ts, which explicitly refuses
 * a sixth value) and GET /api/v1/projexa/tasks already groups `waiting` under
 * "needs you" WITHOUT the blocked styling, which is exactly where a
 * retryable row belongs.
 *
 * Exported so this rule is provable without a database.
 */
export function statusForFailure(failure: PipelineFailure): TaskOutcome["status"] {
  return isRetryableFailure(failure.code) ? "waiting" : "blocked";
}

// ─── R65 Part C Phase 3: task memory (directive §23/Phase 5) ──────────────
// After a WRITE task genuinely completes, record what happened as a
// TASK_RESULT memory -- directive §23's worked example (First ABC Ltd
// quotation discovers/records payment terms; next request already knows
// them) needs SOMETHING durable written down after a task succeeds, or
// there is nothing for a later searchMemories() call to ever find.
//
// Deliberately narrow: only WRITE tasks (functionWrites()) get a memory --
// a read (e.g. "show me the budget") produced nothing new to remember, and
// writing one for every read would be exactly the "don't blindly embed
// every raw message" mistake directive §12/§39 warns against. Both real
// call sites below already gate on functionWrites(...) before calling this.

/**
 * The canonical content string for a completed WRITE task's memory. Pure
 * and exported so this shape is unit-testable without a DB -- same
 * "formatter kept separate from DB wiring" split chat-service.ts's own
 * formatGlossaryBlock/formatContextEntityBlock already established.
 *
 * HONEST, DISCLOSED GAP vs. directive §12: this is the segment text plus a
 * plain key=value param dump, not an LLM-canonicalized sentence (the
 * directive's own worked example: "Organization/User preference: ABC Ltd
 * quotations normally use 30-day payment terms"). See this PR's
 * description -- the same gap chat-service.ts's detectMemorableStatement()
 * discloses on the chat side.
 */
export function buildTaskResultMemoryContent(functionId: string, segmentText: string, params: Record<string, unknown>): string {
  const paramSummary = Object.entries(params)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(", ");
  return `Task completed: "${segmentText}" -> ${functionId}${paramSummary ? ` (${paramSummary})` : ""}`;
}

/**
 * Best-effort, same "never blocks or fails the thing that already
 * succeeded" posture as chat-service.ts's own fetchRelevantMemories/memory-
 * capture wiring. createMemoryRecord()/storeEmbedding() throw loudly by
 * design when no real embedding provider is configured (see memory-
 * service.ts's own header) -- caught here so that throw can never turn an
 * already-`done` task (updateTask() has already run by both call sites
 * below) into a failed request.
 */
async function captureTaskResultMemory(
  input: RunSubmissionInput,
  functionId: string,
  segmentText: string,
  params: Record<string, unknown>
): Promise<void> {
  try {
    await withTenantContext({ orgId: input.orgId, userId: input.userId }, (db) =>
      createMemoryRecord(db, input.orgId, {
        // R68 Phase 6: identity only, verdict derived server-side. `userId`
        // here may be an api_keys.id (D-05, see RunSubmissionInput's own
        // comment on actorUserId), which is exactly why both are passed --
        // the gate resolves the real user first and falls back to the
        // api-key path, rather than this call site guessing which it holds.
        actor: { orgId: input.orgId, userId: input.userId, actorUserId: input.actorUserId ?? null },
        // A completed task's real result, recorded by the pipeline itself:
        // SYSTEM-originated. Not AI-originated -- the content is a
        // deterministic render of the executed function and its params
        // (buildTaskResultMemoryContent above), not model output -- so no
        // model id or prompt hash is invented to fill the field.
        originatorType: "SYSTEM",
        originatorId: input.actorUserId ?? input.userId,
        scopeType: input.projectId ? "PROJECT" : "ORGANIZATION",
        projectId: input.projectId ?? null,
        userId: input.userId,
        memoryType: "TASK_RESULT",
        content: buildTaskResultMemoryContent(functionId, segmentText, params),
        provenanceType: "DATABASE_CONFIRMED",
        lifecycleState: "ACTIVE",
        sourceType: "task",
      })
    );
  } catch (err) {
    console.error("[pipeline] task-result memory capture failed (non-blocking):", err);
  }
}

/**
 * R53 Phase 6 DONE test: "a Level 0 hit served with ZERO model calls, proven
 * in the logs." Counted, not assumed -- level1.ts reports what it actually
 * did and this accumulates it. Module-scoped rather than threaded through
 * every function signature, and reset at the top of each runSubmission();
 * this pipeline is synchronous and single-request by design (M26: no queue
 * until something outlives a request), so there is no concurrent submission
 * in the same module instance to interleave with it.
 */
let modelCallCount = 0;

/** One segment, all the way through resolution but NOT yet executed. */
type ResolvedSegment = {
  text: string;
  orderingHint?: number;
  classification: Classification;
  /** true once this segment has been absorbed into a neighbour by the re-join rule. */
  merged: boolean;
};

function l0ToResolution(r: L0Result): ResolvedFunction | null {
  if (r.kind !== "match") return null;
  return { functionId: r.functionId, params: r.params, source: r.source, level: 0 };
}

export async function runSubmission(input: RunSubmissionInput): Promise<RunSubmissionResult> {
  modelCallCount = 0;
  const { segments: segs, flagged } = segment(input.rawInput);
  if (segs.length === 0) {
    // No submission row is ever inserted on this path, so there is nothing
    // to persist classification onto -- returned for shape-consistency only.
    // Zero segments means zero task-verdicts, i.e. CHAT_ONLY by the same
    // rule classifySubmission() applies everywhere else.
    return { submissionId: null, status: "chat", classification: "CHAT_ONLY", chatMessages: [], tasks: [], failures: [], gaps: [], flagged: false, l0HitRate: 1, modelCalls: 0 };
  }

  const submissionId = await withTenantContext({ orgId: input.orgId, userId: input.userId }, async (db) => {
    const [row] = await db
      .insert(submissions)
      .values({
        orgId: input.orgId,
        projectId: input.projectId ?? null,
        mode: input.mode,
        selectedChain: (input.selectedChain as object | undefined) ?? null,
        rawInput: input.rawInput,
        userId: input.userId,
      })
      .returning({ id: submissions.id });
    return row.id;
  });

  const repo = makeL0Repo(input.orgId, input.userId);
  const reuseRepo = makeReuseCacheRepo(input.orgId, input.userId);
  const chainRepo = makeChainRepo(input.orgId);
  const rootLabel = await resolveRootLabel(input.orgId, input.projectId ?? null);
  const boqFacts = makeBoqFactsResolver(input.orgId, input.userId, input.projectId ?? null);
  let l0Hits = 0;
  let resolvedCount = 0;

  // ---- RESOLUTION PASS -------------------------------------------------
  const resolved = await resolveAll(segs, input, repo, reuseRepo);
  for (const r of resolved) {
    if (r.classification.verdict !== "gap") {
      resolvedCount++;
      if (r.classification.level === 0) l0Hits++;
    }
  }

  // ---- EXECUTION PASS --------------------------------------------------
  const chatMessages: string[] = [];
  const gaps: { text: string; reason: string }[] = [];
  const tasks: TaskOutcome[] = [];
  const failures: ({ segmentText: string } & PipelineFailure)[] = [];

  // A segment carrying an explicit orderingHint runs as a dependency chain:
  // each depends on the previous ORDERED segment's task. R53 Phase 6:
  // depends_on ONLY when a later segment needs an earlier one's artifact --
  // and an explicit "then" is the only signal in this pipeline that claims
  // one does. A bare "and" gets no orderingHint and therefore no
  // depends_on, so "PP1 is 50% done and show me the budget" never makes the
  // budget read wait on the progress write.
  let previousOrderedTaskId: string | null = null;
  let previousOrderedFailed = false;
  // The chain of the first task minted, used to close submissions.
  // selected_chain when the caller supplied none. See the update at the end.
  let firstDerivedChain: DerivedChain | null = null;
  const chainByTaskId = new Map<string, DerivedChain>();

  for (const seg of resolved) {
    if (seg.merged) continue;
    const c = seg.classification;

    if (c.verdict === "gap") {
      await logGap(input, submissionId, seg.text, normalisePhrase(seg.text), c.gapReason ?? "unresolved");
      gaps.push({ text: seg.text, reason: c.gapReason ?? "unresolved" });
      if (c.message) chatMessages.push(c.message);
      continue;
    }

    if (!c.functionId) {
      // A CHAT verdict with no function is an acknowledgement -- nothing to
      // mint, nothing to run, nothing missing.
      if (c.message) chatMessages.push(c.message);
      continue;
    }

    // M26 PARTIAL: a valid function with a missing value is a FORM FIELD,
    // not a gap. ASK THE USER. Do NOT escalate, do NOT log a gap, and do
    // NOT mint a task that would run with a guessed value.
    //
    // R67 B-01 moved this ABOVE validate(): validate() now enforces each
    // function's declared required params itself, so leaving the order as it
    // was would have turned every M26-PARTIAL "ask the user" into a gap.
    // The answer is a structured failure carrying the same field names --
    // the client renders "Pick a BOQ line", never "I need itemCode".
    if (c.missingParams.length > 0) {
      for (const name of c.missingParams) {
        failures.push({ segmentText: seg.text, ...pipelineFailure(codeForParam(name), [name]) });
      }
      continue;
    }

    // R67 B-11: the real BOQ facts, read once per submission and only when a
    // segment actually names a line. boqLineItemId existence is still
    // re-checked inside executor.ts's own transaction; this only lets the
    // user be told before a task is minted.
    const validationCtx: ValidationContext = buildValidationContext({
      projectId: input.projectId ?? null,
      projectLabel: rootLabel,
      boq: await boqFacts(c.params),
      params: c.params,
    });

    const v = validate({ functionId: c.functionId, params: c.params }, validationCtx);
    if (!v.valid) {
      // M26: "a candidate that fails validation is a FAIL, not a suggestion."
      // The gap_log row keeps a CODE LINE for engineers; the caller gets the
      // structured failure and composes the sentence itself.
      const line = failureLogLine(v);
      await logGap(input, submissionId, seg.text, c.functionId, line);
      gaps.push({ text: seg.text, reason: line });
      failures.push({ segmentText: seg.text, code: v.code, missing: v.missing, context: v.context, picker: v.picker });
      continue;
    }
    // B-02: the params validate() resolved, not the ones the classifier
    // produced -- projectId may have just been filled in from the submission.
    const resolvedParams = v.params;

    // R53 PHASE 5: PHRASE -> FUNCTION -> CHAIN, never the reverse. The chain
    // is derived from the function the PHRASE resolved to, and from the mode
    // and project the request already carried. input.selectedChain -- the
    // user's own pill selection -- is deliberately NOT consulted here: M25
    // calls it a HINT and M26 rules the phrase is the authority.
    const derived = await deriveChain(chainRepo, {
      mode: input.mode,
      rootLabel,
      functionId: c.functionId,
      params: resolvedParams,
    });
    if (!firstDerivedChain) firstDerivedChain = derived;

    const dependsOn = seg.orderingHint !== undefined ? previousOrderedTaskId : null;
    const taskId = await mintTask(input, submissionId, tasks.length, dependsOn, c.functionId, resolvedParams, derived);
    chainByTaskId.set(taskId, derived);

    const advance = (failed: boolean) => {
      if (seg.orderingHint !== undefined) {
        previousOrderedTaskId = taskId;
        previousOrderedFailed = failed;
      }
    };

    // *** A CHAT VERDICT NEVER RUNS A WRITE. *** This is the safety half of
    // "reads as a question -> CHAT": the verdict already refused to call it
    // a task, and this refuses to execute it anyway. Blocked with the
    // honest reason rather than silently skipped.
    if (c.verdict === "chat" && functionWrites(c.functionId)) {
      const f = pipelineFailure("READ_AS_QUESTION", [], { functionId: c.functionId });
      await updateTask(input.orgId, taskId, "blocked", undefined, f);
      tasks.push({ taskId, functionId: c.functionId, verdict: "chat", status: "blocked", segmentText: seg.text, failure: f });
      failures.push({ segmentText: seg.text, ...f });
      if (c.message) chatMessages.push(c.message);
      advance(true);
      continue;
    }

    if (seg.orderingHint !== undefined && previousOrderedFailed) {
      const f = pipelineFailure("DEPENDENCY_FAILED");
      await updateTask(input.orgId, taskId, "blocked", undefined, f);
      tasks.push({ taskId, functionId: c.functionId, verdict: c.verdict, status: "blocked", segmentText: seg.text, failure: f });
      failures.push({ segmentText: seg.text, ...f });
      advance(true);
      continue;
    }

    if (!hasExecutor(c.functionId)) {
      const f = pipelineFailure("FUNCTION_NOT_AVAILABLE", [], { functionId: c.functionId });
      await updateTask(input.orgId, taskId, "blocked", undefined, f);
      tasks.push({ taskId, functionId: c.functionId, verdict: c.verdict, status: "blocked", segmentText: seg.text, failure: f });
      failures.push({ segmentText: seg.text, ...f });
      advance(true);
      continue;
    }

    await markInProgress(input.orgId, taskId);
    const outcome = await executeTask({
      orgId: input.orgId,
      userId: input.userId,
      projectId: (typeof resolvedParams.projectId === "string" ? resolvedParams.projectId : null) ?? input.projectId ?? null,
      functionId: c.functionId,
      params: resolvedParams,
      role: input.role,
      // R67 FIX PASS: the project's name, already resolved above for the
      // derived chain, so the executor's BOQ_LINE_NOT_FOUND carries the same
      // {project} validate()'s does and the one sentence reads the same way
      // whichever stage refused the line.
      projectLabel: rootLabel,
      // R67 C-03 (D-05): the named person a timesheet row is attributed to.
      actorUserId: input.actorUserId ?? null,
    });
    if (outcome.success) {
      await updateTask(input.orgId, taskId, "done", outcome.result, undefined);
      tasks.push({ taskId, functionId: c.functionId, verdict: c.verdict, status: "done", segmentText: seg.text, result: outcome.result });
      // R65 Part C Phase 3: task memory, WRITE tasks only -- see this
      // file's own captureTaskResultMemory()/buildTaskResultMemoryContent()
      // header for why.
      if (functionWrites(c.functionId)) {
        await captureTaskResultMemory(input, c.functionId, seg.text, resolvedParams);
      }
    } else {
      // R67 B-01: the raw driver text goes to the LOG, the code goes to the
      // row. Nothing that reaches the client has ever seen `debug`.
      if (outcome.debug) console.error(`[pipeline] task=${taskId} ${outcome.failure.code} raw=${outcome.debug}`);
      // R67 B-06: a transport failure is a RETRY, not a blocked task.
      const failedStatus = statusForFailure(outcome.failure);
      await updateTask(input.orgId, taskId, failedStatus, undefined, outcome.failure);
      tasks.push({ taskId, functionId: c.functionId, verdict: c.verdict, status: failedStatus, segmentText: seg.text, failure: outcome.failure });
      failures.push({ segmentText: seg.text, ...outcome.failure });
    }
    advance(!outcome.success);
  }

  // R53 Phase 2's two tables, written for the first time. Recording a row is
  // NOT running a task (M24: a history click loads the chain and STOPS) --
  // these are the strip's memory, nothing more.
  for (const t of tasks) {
    const chain = chainByTaskId.get(t.taskId);
    if (!chain) continue;
    await recordPillUse(input, t.functionId, chain);
    await recordChainHistory(input, t.functionId, chain, t.status === "done" ? "ok" : "failed");
  }

  const status = deriveSubmissionStatus(tasks, gaps.length);
  // R65 Part D Phase 4 -- computed from the SAME resolved-segment verdicts
  // the execution pass above already walked (excluding merged segments,
  // same exclusion the execution pass itself applies), not from `tasks[]`:
  // a CHAT-verdict segment with a write-capable function can still appear
  // in `tasks[]` as a blocked audit row (see the loop above), and that must
  // not be counted as requested work. See classify.ts's classifySubmission()
  // for the exact rule.
  const classification = classifySubmission(resolved.filter((r) => !r.merged).map((r) => r.classification.verdict));
  // selected_chain is NULL on every one of the 16 rows that existed before
  // R53. When the caller supplied a chain we keep THEIRS -- it is the user's
  // own pill selection and this column is where it belongs. When they did
  // not, the derived chain of the first task fills it, so the column stops
  // being universally null and Task Master has something to render.
  const selectedChain = (input.selectedChain as object | undefined) ?? (firstDerivedChain as object | null);
  await withTenantContext({ orgId: input.orgId, userId: input.userId }, (db) =>
    db.update(submissions).set({ status, classification, selectedChain }).where(eq(submissions.id, submissionId))
  );

  const l0HitRate = resolvedCount === 0 ? 0 : l0Hits / resolvedCount;

  // THE PROOF, IN THE LOGS. One structured line per submission. A Level 0
  // hit reads model_calls=0; anything that reached the model cannot hide it.
  console.info(
    `[pipeline] submission=${submissionId} segments=${segs.length} resolved=${resolvedCount} l0_hits=${l0Hits} ` +
      `l0_hit_rate=${l0HitRate.toFixed(2)} model_calls=${modelCallCount} tasks=${tasks.length} gaps=${gaps.length} status=${status} classification=${classification}`
  );

  return {
    submissionId,
    status,
    classification,
    chatMessages,
    tasks,
    failures,
    gaps,
    flagged,
    l0HitRate,
    modelCalls: modelCallCount,
  };
}

/**
 * R53 Phase 6 -- THE PILL PATH. One already-chosen function, minted and run
 * directly, with no segmentation and NO MODEL CALL EVER.
 *
 * This exists because M24's strip is a real input method, not a shortcut for
 * typing: a user who clicks Work Progress > New entry has already told the
 * system exactly what they want, and putting that through a classifier would
 * be re-deriving an answer the user already gave.
 *
 * *** IT STILL GOES THROUGH validate() AND THE EXECUTOR REGISTRY. *** A pill
 * click is not authorisation either. The function must be in the candidate
 * set, the params must type-check, and the caller's permission is checked by
 * the route before this is ever reached.
 */
export type RunDirectTaskInput = {
  orgId: string;
  userId: string;
  mode: string;
  projectId?: string | null;
  functionId: string;
  params?: Record<string, unknown>;
  /** the raw text the user typed alongside the pill, kept for the audit trail. */
  note?: string;
  /** R48 gap-closure (2026-08-30, F089) -- see RunSubmissionInput.role. */
  role?: string | null;
  /**
   * R67 B-07: the confirm step runs against the submission the VERDICT was
   * already recorded on, so one message leaves one row in
   * compliance.submissions rather than a proposal row and a second execution
   * row that look like two things the user asked for.
   */
  existingSubmissionId?: string;
  /** R67 C-03 (D-05) -- see RunSubmissionInput.actorUserId. */
  actorUserId?: string | null;
};

export async function runDirectTask(input: RunDirectTaskInput): Promise<RunSubmissionResult> {
  const params = input.params ?? {};
  const base: RunSubmissionInput = {
    orgId: input.orgId,
    userId: input.userId,
    mode: input.mode,
    projectId: input.projectId ?? null,
    rawInput: input.note ?? `[pill] ${input.functionId}`,
    role: input.role,
    actorUserId: input.actorUserId ?? null,
  };

  const submissionId =
    input.existingSubmissionId ??
    (await withTenantContext({ orgId: input.orgId, userId: input.userId }, async (db) => {
      const [row] = await db
        .insert(submissions)
        .values({
          orgId: input.orgId,
          projectId: input.projectId ?? null,
          mode: input.mode,
          rawInput: base.rawInput,
          userId: input.userId,
        })
        .returning({ id: submissions.id });
      return row.id;
    }));

  // R65 Part D Phase 4 -- computed up front (functionWrites() doesn't depend
  // on validation success) so both the validation-failure return below and
  // the success/failure return at the end of this function use the SAME
  // verdict, via classifySubmission([verdict]) -- a pill is always exactly
  // one segment, so this is never MULTIPLE_TASKS. A validation failure is
  // still classified as whatever was actually requested (TASK if the
  // function writes, CHAT_ONLY otherwise) -- one action WAS requested here,
  // it just failed validation; that's a `status` fact, not a `classification`
  // fact (see the type's own comment on RunSubmissionResult).
  const verdict = functionWrites(input.functionId) ? ("task" as const) : ("chat" as const);
  const classification = classifySubmission([verdict]);

  const rootLabel = await resolveRootLabel(input.orgId, input.projectId ?? null);

  // R67 B-02: THE PILL PATH IS WHERE "Review Budget -- blocked -- no project
  // resolved for this task" was reproduced in every budget screenshot. The
  // rail's project is in the POST body; buildValidationContext is where it
  // finally reaches the candidate's params.
  //
  // R67 B-11: it is ALSO the path a finished chain-options chain posts back
  // to ({functionId, params} with the BOQ line addressed by its record id),
  // so the BOQ facts below are what stop the server refusing the very chips
  // it offered.
  const validationCtx: ValidationContext = buildValidationContext({
    projectId: input.projectId ?? null,
    projectLabel: rootLabel,
    boq: await makeBoqFactsResolver(input.orgId, input.userId, input.projectId ?? null)(params),
    params,
  });
  const v = validate({ functionId: input.functionId, params }, validationCtx);
  if (!v.valid) {
    const line = failureLogLine(v);
    await logGap(base, submissionId, base.rawInput, input.functionId, line);
    await withTenantContext({ orgId: input.orgId, userId: input.userId }, (db) =>
      db.update(submissions).set({ status: "failed", classification }).where(eq(submissions.id, submissionId))
    );
    return {
      submissionId,
      status: "failed",
      classification,
      chatMessages: [],
      tasks: [],
      failures: [{ segmentText: base.rawInput, code: v.code, missing: v.missing, context: v.context, picker: v.picker }],
      gaps: [{ text: base.rawInput, reason: line }],
      flagged: false,
      l0HitRate: 1,
      modelCalls: 0,
    };
  }
  const resolvedParams = v.params;

  const derived = await deriveChain(makeChainRepo(input.orgId), {
    mode: input.mode,
    rootLabel,
    functionId: input.functionId,
    params: resolvedParams,
  });

  const taskId = await mintTask(base, submissionId, 0, null, input.functionId, resolvedParams, derived);

  let outcome: { success: true; result: unknown } | { success: false; failure: PipelineFailure; debug?: string };
  if (!hasExecutor(input.functionId)) {
    outcome = { success: false, failure: pipelineFailure("FUNCTION_NOT_AVAILABLE", [], { functionId: input.functionId }) };
  } else {
    // R65 Part D Phase 3 -- see markInProgress()'s own header comment. Only
    // reached once hasExecutor() has already confirmed this task will
    // actually run; the !hasExecutor branch above goes straight to blocked
    // and never passes through 'in_progress'.
    await markInProgress(input.orgId, taskId);
    outcome = await executeTask({
      orgId: input.orgId,
      userId: input.userId,
      projectId: (typeof resolvedParams.projectId === "string" ? resolvedParams.projectId : null) ?? input.projectId ?? null,
      functionId: input.functionId,
      params: resolvedParams,
      role: input.role,
      // R67 FIX PASS -- see the same line in runSubmission()'s loop.
      projectLabel: rootLabel,
      // R67 C-03 (D-05): the named person a timesheet row is attributed to.
      actorUserId: input.actorUserId ?? null,
    });
  }

  if (outcome.success) {
    await updateTask(input.orgId, taskId, "done", outcome.result, undefined);
    // R65 Part C Phase 3: task memory, same as runSubmission()'s own
    // execution loop above -- WRITE tasks only.
    if (functionWrites(input.functionId)) {
      await captureTaskResultMemory(base, input.functionId, base.rawInput, resolvedParams);
    }
  } else {
    if (outcome.debug) console.error(`[pipeline] task=${taskId} ${outcome.failure.code} raw=${outcome.debug}`);
    await updateTask(input.orgId, taskId, statusForFailure(outcome.failure), undefined, outcome.failure);
  }

  await recordPillUse(base, input.functionId, derived);
  await recordChainHistory(base, input.functionId, derived, outcome.success ? "ok" : "failed");

  const status = outcome.success ? "done" : "failed";
  await withTenantContext({ orgId: input.orgId, userId: input.userId }, (db) =>
    db.update(submissions).set({ status, classification, selectedChain: derived as unknown as object }).where(eq(submissions.id, submissionId))
  );

  console.info(
    `[pipeline] submission=${submissionId} source=pill function=${input.functionId} model_calls=0 status=${status} classification=${classification}`
  );

  return {
    submissionId,
    status,
    classification,
    chatMessages: [],
    tasks: [
      {
        taskId,
        functionId: input.functionId,
        verdict,
        status: outcome.success ? "done" : statusForFailure(outcome.failure),
        segmentText: base.rawInput,
        result: outcome.success ? outcome.result : undefined,
        failure: outcome.success ? undefined : outcome.failure,
      },
    ],
    failures: outcome.success ? [] : [{ segmentText: base.rawInput, ...outcome.failure }],
    gaps: [],
    flagged: false,
    l0HitRate: 1, // a pill is Level 0 by definition -- the user supplied the function
    modelCalls: 0,
  };
}

/**
 * MP-RULE-3's storage, written. Upsert, never read-modify-write: the UNIQUE
 * (org_id, user_id, pill_key) index from Phase 2 is what makes "increment
 * the count" safe under concurrency.
 *
 * The pill_key is the CHAIN'S FIRST STEP -- the module the chain roots into
 * ("Work Progress", "Budget"). That is the thing M24's strip actually shows,
 * and it is why two different budget functions rank as one Budget pill
 * rather than splitting the user's own usage in half.
 */
async function recordPillUse(input: RunSubmissionInput, functionId: string | null, chain: DerivedChain) {
  const pillKey = chain.steps[0];
  if (!pillKey) return;
  await withTenantContext({ orgId: input.orgId, userId: input.userId }, (db) =>
    db
      .insert(pillUsage)
      .values({
        orgId: input.orgId,
        userId: input.userId,
        pillKey,
        functionId,
        derivedChain: chain as unknown as object,
        useCount: 1,
      })
      .onConflictDoUpdate({
        target: [pillUsage.orgId, pillUsage.userId, pillUsage.pillKey],
        set: { useCount: sql`${pillUsage.useCount} + 1`, lastUsedAt: new Date(), functionId, derivedChain: chain as unknown as object },
      })
  );
}

/**
 * M24's HISTORY drop-down, written. DEDUP IS A CONSTRAINT, NOT CODE --
 * ON CONFLICT on Phase 2's UNIQUE (org_id, user_id, full_chain) is the whole
 * of "running Daily entry six times leaves ONE row".
 *
 * FAILED CHAINS ARE KEPT. M24: "the commonest reason to re-run something is
 * that it went wrong."
 */
async function recordChainHistory(
  input: RunSubmissionInput,
  functionId: string | null,
  chain: DerivedChain,
  outcome: "ok" | "failed"
) {
  await withTenantContext({ orgId: input.orgId, userId: input.userId }, (db) =>
    db
      .insert(chainHistory)
      .values({
        orgId: input.orgId,
        userId: input.userId,
        fullChain: chain.full,
        functionId,
        mode: input.mode,
        projectId: input.projectId ?? null,
        outcome,
      })
      .onConflictDoUpdate({
        target: [chainHistory.orgId, chainHistory.userId, chainHistory.fullChain],
        set: { useCount: sql`${chainHistory.useCount} + 1`, lastUsedAt: new Date(), outcome, functionId },
      })
  );
}

/**
 * L0 for every segment, ONE batched L1 call for the misses, a verdict for
 * each, then R53's re-join-once retry for whatever still resolved to
 * nothing.
 */
async function resolveAll(segs: Segment[], input: RunSubmissionInput, repo: L0Repo, reuseRepo: ReuseCacheRepo): Promise<ResolvedSegment[]> {
  const l0 = await Promise.all(segs.map((s) => classifyL0(s.text, { orgId: input.orgId, userId: input.userId }, repo)));

  // R65 Part D: reuse_cache is checked BEFORE Level 1 for every miss -- see
  // reuse-cache.ts's own header. A hit is served with zero model calls
  // (level: 0), so modelCallCount below only ever counts genuine AI calls.
  const missIndices = l0.map((r, i) => (r.kind === "miss" ? i : -1)).filter((i) => i >= 0);
  const level1 = await resolveMissesWithReuseCache(missIndices.map((i) => segs[i].text), level1Context(input), reuseRepo);
  modelCallCount += level1.modelCalls;
  const aiByIndex = level1.resolutions;

  const out: ResolvedSegment[] = segs.map((s, i) => {
    let resolution: ResolvedFunction | null = null;
    if (l0[i].kind === "match") {
      resolution = l0ToResolution(l0[i]);
    } else if (l0[i].kind === "miss") {
      const ai = aiByIndex[missIndices.indexOf(i)];
      resolution = ai ?? null;
    }
    return {
      text: s.text,
      orderingHint: s.orderingHint,
      classification: classifySegment({
        text: s.text,
        resolution,
        nature: resolution ? { writes: functionWrites(resolution.functionId) } : null,
      }),
      merged: false,
    };
  });

  // ---- R53's RE-JOIN ONCE ----------------------------------------------
  // *** ONLY EVER JOINS TWO ADJACENT GAPS. *** A gap is never joined with a
  // neighbour that RESOLVED, and that restriction is not conservatism for
  // its own sake: the merged text contains the neighbour's words, so
  // resolving and running it would execute that neighbour's function a
  // SECOND time. "PP1 is 50% done and show me the budget" would record the
  // progress twice. Two adjacent gaps have nothing to duplicate, so merging
  // them is free -- and they are the case a bad split actually produces.
  const gapIndices = out.map((r, i) => (r.classification.verdict === "gap" ? i : -1)).filter((i) => i >= 0);
  const retryTexts: { index: number; text: string; absorbed: number }[] = [];
  for (const i of gapIndices) {
    if (out[i].merged) continue;
    // PREVIOUS neighbour first -- a fragment almost always loses its subject
    // to the left -- then the next one.
    const neighbour = [i - 1, i + 1].find(
      (n) => n >= 0 && n < out.length && !out[n].merged && out[n].classification.verdict === "gap"
    );
    if (neighbour === undefined) continue;
    const upper = Math.max(i, neighbour);
    const lower = Math.min(i, neighbour);
    // rejoinCandidate(segments, index) joins index with its PREVIOUS
    // sibling, so passing the higher of the two adjacent indices merges
    // exactly this pair, in the order the user typed them.
    const candidate = rejoinCandidate(out, upper);
    if (!candidate) continue;
    retryTexts.push({ index: lower, text: candidate.text, absorbed: upper });
    out[lower].merged = true;
    out[upper].merged = true;
  }
  if (retryTexts.length === 0) return out;

  // ONCE. The rejoined text gets one full pass -- L0 then, only if that
  // misses, one more batched L1 call -- and whatever comes back is final.
  const retryL0 = await Promise.all(
    retryTexts.map((r) => classifyL0(r.text, { orgId: input.orgId, userId: input.userId }, repo))
  );
  const retryMissIdx = retryL0.map((r, i) => (r.kind === "miss" ? i : -1)).filter((i) => i >= 0);
  const retryLevel1 = await resolveMissesWithReuseCache(retryMissIdx.map((i) => retryTexts[i].text), level1Context(input), reuseRepo);
  modelCallCount += retryLevel1.modelCalls;
  const retryAi = retryLevel1.resolutions;

  retryTexts.forEach((r, i) => {
    let resolution: ResolvedFunction | null = null;
    if (retryL0[i].kind === "match") resolution = l0ToResolution(retryL0[i]);
    else if (retryL0[i].kind === "miss") resolution = retryAi[retryMissIdx.indexOf(i)] ?? null;

    const classification = classifySegment({
      text: r.text,
      resolution,
      nature: resolution ? { writes: functionWrites(resolution.functionId) } : null,
    });
    // The merged segment takes the LOWER index's slot and keeps its
    // ordering position; the absorbed sibling stays merged and is skipped.
    out[r.index] = {
      text: r.text,
      orderingHint: out[r.index].orderingHint,
      classification,
      merged: false,
    };
    out[r.absorbed].merged = true;
  });

  return out;
}

/**
 * The bound context every Level 1 call gets. M26: "Pass the module's 5-15
 * candidate functions and the valid line-item ids -- NEVER the full
 * catalogue." level1.ts loads the ids itself from this project's latest BOQ.
 */
function level1Context(input: RunSubmissionInput) {
  return {
    orgId: input.orgId,
    userId: input.userId,
    projectId: input.projectId ?? null,
    candidateFunctionIds: CANDIDATE_FUNCTION_IDS,
  };
}

function deriveSubmissionStatus(tasks: TaskOutcome[], gapCount: number): RunSubmissionResult["status"] {
  if (tasks.length === 0) return gapCount > 0 ? "failed" : "chat";
  const doneCount = tasks.filter((t) => t.status === "done").length;
  if (doneCount === tasks.length && gapCount === 0) return "done";
  if (doneCount === 0) return "failed";
  return "partial";
}

async function mintTask(
  input: RunSubmissionInput,
  submissionId: string,
  sequence: number,
  dependsOn: string | null,
  functionId: string,
  params: Record<string, unknown>,
  derivedChain: DerivedChain
): Promise<string> {
  return withTenantContext({ orgId: input.orgId, userId: input.userId }, async (db) => {
    const [row] = await db
      .insert(pipelineTasks)
      .values({
        submissionId,
        sequence,
        dependsOn,
        orgId: input.orgId,
        projectId: input.projectId ?? null,
        projectSource: input.projectId ? "inherited" : "stated",
        derivedChain,
        functionId,
        params,
        executor: "software",
        status: "to_do",
      })
      .returning({ id: pipelineTasks.id });
    return row.id;
  });
}

/**
 * R67 B-01: `error` is now the SERIALISED CLOSED-VOCABULARY FAILURE
 * ({"code":...,"missing":[...],"context":{...}}), never prose and never the
 * driver's own text -- serialiseFailure() has no way to write `debug`, so
 * this column cannot leak an internal address the way it did in R66.
 */
async function updateTask(orgId: string, taskId: string, status: TaskOutcome["status"], result: unknown, failure: PipelineFailure | undefined) {
  await withTenantContext({ orgId }, (db) =>
    db
      .update(pipelineTasks)
      .set({
        status,
        result: (result as object | undefined) ?? null,
        error: failure ? serialiseFailure(failure) : null,
        // R67 B-08 (drizzle/0533): the code and its parameters get real
        // columns, so a failure can be counted and grouped in SQL instead of
        // by parsing JSON out of a text column. `error_params` carries ONLY
        // the business values a sentence interpolates -- never `debug`,
        // which has no field on PipelineFailure at all.
        errorCode: failure?.code ?? null,
        errorParams: (failure?.context as object | undefined) ?? null,
        updatedAt: new Date(),
      })
      .where(eq(pipelineTasks.id, taskId))
  );
}

/**
 * R65 Part D Phase 3 -- wires `pipeline_task_status`'s 'in_progress' value
 * (declared since drizzle/0294, never assigned by any code path until now --
 * see the Phase 0 architecture report's §3.12 finding, confirmed still true
 * immediately before this change). Deliberately a separate, narrower helper
 * than updateTask(): 'in_progress' is a transient marker for whatever the
 * executor is doing right now, not an outcome, so it never touches
 * `result`/`error` (both are already null on a freshly-minted row) the way
 * updateTask()'s terminal 'done'/'blocked' writes do.
 *
 * Called ONLY immediately before the one call in this file that can take
 * real wall-clock time -- executeTask() -- and ONLY once every earlier
 * synchronous guard (chat-verdict-write block, blocked-dependency,
 * no-executor-registered) has already passed. A task that gets blocked by
 * one of those guards never passes through 'in_progress' at all: it never
 * started running, so reporting it as running would be a lie the same way
 * skipping 'to_do' entirely would be.
 *
 * Real effect: GET /api/v1/projexa/tasks (tasks/route.ts) already groups
 * `status: 'in_progress'` rows into its "running" bucket and has since R53
 * Phase 6 -- that bucket has been silently, permanently empty because
 * nothing ever wrote this value. This makes it real.
 */
async function markInProgress(orgId: string, taskId: string) {
  await withTenantContext({ orgId }, (db) =>
    db.update(pipelineTasks).set({ status: "in_progress", updatedAt: new Date() }).where(eq(pipelineTasks.id, taskId))
  );
}

async function logGap(
  input: RunSubmissionInput,
  submissionId: string | null,
  segmentText: string,
  normalisedIntent: string | null,
  reason: string
) {
  await logGapRow(input.orgId, input.userId, submissionId, segmentText, normalisedIntent, reason);
}

export { normalisePhrase };

// ─── R67 B-05: THE DRY RUN ────────────────────────────────────────────────
// The proposal step lives in dry-run.ts (pure apart from its injected deps);
// this is where its real, DB- and provider-backed deps are built, because
// this file already owns every one of those wires. Re-exported from here so
// callers keep one import path for "the pipeline".
export { dryRunSubmission, NO_COMMENTARY_SENTENCE, type DryRunResult, type DryRunProposal } from "./dry-run";

/**
 * The live deps. `providerAvailable` asks the adapter the same question the
 * assistant route asks -- and answers it WITHOUT throwing, because "the model
 * will refuse" is a fact the ASK path must be able to route around, not an
 * error to propagate. That is the whole of B-05's determinism promise: the
 * records answer the question, the model only ever added commentary.
 */
export async function makeDryRunDeps(input: RunSubmissionInput): Promise<DryRunDeps> {
  const rootLabel = await resolveRootLabel(input.orgId, input.projectId ?? null);
  const boqRepo = makeChainOptionsRepo({ orgId: input.orgId, userId: input.userId });
  return {
    l0Repo: makeL0Repo(input.orgId, input.userId),
    reuseRepo: makeReuseCacheRepo(input.orgId, input.userId),
    chainRepo: makeChainRepo(input.orgId),
    rootLabel,
    boqLineOptions: async (projectId: string) => {
      const boq = await boqRepo.latestBoqLines(projectId);
      if (!boq) return [];
      return boq.lines
        .filter((l) => l.childCount === 0)
        .map((l) => ({
          id: l.itemCode ?? l.id,
          label: l.itemCode ? `${l.itemCode} ${l.description}` : l.description,
          // R67 B-07: the same line, addressed by its real id, so the verdict
          // can offer chips the confirm step posts straight back as
          // boqLineItemId -- no retyped code, no second lookup.
          lineItemId: l.id,
        }));
    },
    runRead: (task) => executeTask(task),
    providerAvailable: () => {
      try {
        assertAiProviderAllowed(input.userId);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** The one call a route makes: build the real deps, then propose. */
export async function proposeSubmission(input: RunSubmissionInput): Promise<DryRunResult> {
  const deps = await makeDryRunDeps(input);
  return dryRun({ ...input, candidateFunctionIds: CANDIDATE_FUNCTION_IDS }, deps);
}

// ─── R67 B-07: THE VERDICT, AND THE CONFIRM THAT FOLLOWS IT ───────────────
//
// POST {rawInput} answers with what the server UNDERSTOOD and what it still
// needs. It mints NO compliance.pipeline_tasks row -- which is the whole
// point: the eleven "Needs you" rows the R66 walkthrough found were not
// tasks, they were unanswered questions that had been recorded as blocked
// work and counted in the Home badge.
//
// It DOES record the submission itself. That row is the audit trail of what
// a person actually typed, it is what /api/v1/projexa/submissions has always
// written, and it is what the confirm step reads back so that the server
// never executes a function id a client simply asserted.

export type SubmitVerdictResult = SubmissionVerdictResult & { submissionId: string };

/**
 * Which submission status a verdict leaves behind. `in_progress` means the
 * ball is with the user (a proposal they have not confirmed); `chat` means
 * the message is closed -- a question already answered, an acknowledgement,
 * or a capability that is not wired.
 */
function submissionStatusForVerdict(v: SubmissionVerdictResult): "chat" | "in_progress" {
  return v.verdicts.some((x) => x.status === "ready" || x.status === "needs_input") ? "in_progress" : "chat";
}

export async function submitForVerdict(input: RunSubmissionInput): Promise<SubmitVerdictResult> {
  const submissionId = await withTenantContext({ orgId: input.orgId, userId: input.userId }, async (db) => {
    const [row] = await db
      .insert(submissions)
      .values({
        orgId: input.orgId,
        projectId: input.projectId ?? null,
        mode: input.mode,
        selectedChain: (input.selectedChain as object | undefined) ?? null,
        rawInput: input.rawInput,
        userId: input.userId,
      })
      .returning({ id: submissions.id });
    return row.id;
  });

  const proposal = await proposeSubmission(input);
  const verdict = toVerdictResult(proposal, submissionId);
  const classification = classifySubmission(verdict.verdicts.map((v) => v.verdict));

  await withTenantContext({ orgId: input.orgId, userId: input.userId }, (db) =>
    db
      .update(submissions)
      .set({ status: submissionStatusForVerdict(verdict), classification })
      .where(eq(submissions.id, submissionId))
  );

  console.info(
    `[pipeline] submission=${submissionId} verdict=${verdict.verdict} status=${verdict.status} ` +
      `missing=${verdict.missing.map((m) => m.field).join(",") || "-"} minted=0`
  );

  return { ...verdict, submissionId };
}

export type ConfirmSubmissionInput = {
  orgId: string;
  userId: string;
  submissionId: string;
  /** the function the client was shown. Checked against what the server re-derives. */
  functionId?: string;
  /** the answers to whatever the verdict said was missing. */
  params?: Record<string, unknown>;
  role?: string | null;
  /** R67 C-03 (D-05) -- see RunSubmissionInput.actorUserId. */
  actorUserId?: string | null;
};

export type ConfirmSubmissionOutcome =
  | { ok: true; result: RunSubmissionResult }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_proposed"; failure: PipelineFailure }
  | { ok: false; reason: "needs_input"; verdict: SubmissionVerdictResult };

/**
 * STEP TWO. The client posts {confirm:true, submissionId} and only now is
 * anything executed.
 *
 * *** THE SERVER NEVER TRUSTS THE CLIENT'S FUNCTION ID. *** It re-derives the
 * proposal from the submission's own stored rawInput -- the words the user
 * actually typed -- and refuses if what the client echoes back does not
 * match. Re-deriving costs nothing on the common path: a Level 0 phrase-map
 * hit is deterministic and makes no model call, and a Level 1 resolution was
 * already written to compliance.reuse_cache by the proposal, so the second
 * pass is a cache hit (see reuse-cache.ts). What it buys is that a caller
 * cannot smuggle an arbitrary write in behind a submission id that was
 * proposed for something else.
 *
 * The client's `params` are merged OVER the proposal's -- they are the
 * answers to what was missing -- and then re-checked, so a confirm that is
 * still incomplete comes back as needs_input instead of failing inside a
 * service.
 */
export async function confirmSubmission(input: ConfirmSubmissionInput): Promise<ConfirmSubmissionOutcome> {
  const row = await withTenantContext({ orgId: input.orgId }, async (db) => {
    const [found] = await db
      .select({
        id: submissions.id,
        rawInput: submissions.rawInput,
        mode: submissions.mode,
        projectId: submissions.projectId,
      })
      .from(submissions)
      .where(and(eq(submissions.id, input.submissionId), eq(submissions.orgId, input.orgId)))
      .limit(1);
    return found ?? null;
  });
  if (!row) return { ok: false, reason: "not_found" };

  const base: RunSubmissionInput = {
    orgId: input.orgId,
    userId: input.userId,
    mode: row.mode,
    projectId: row.projectId,
    rawInput: row.rawInput,
    role: input.role,
  };

  const proposal = await proposeSubmission(base);
  const first = proposal.proposals.find((p) => p.functionId) ?? null;
  if (!first || !first.functionId) {
    return { ok: false, reason: "not_proposed", failure: pipelineFailure("FUNCTION_NOT_AVAILABLE") };
  }
  if (input.functionId && input.functionId !== first.functionId) {
    // The words no longer resolve to what the client was shown. Refuse
    // rather than run the newer answer silently.
    return { ok: false, reason: "not_proposed", failure: pipelineFailure("FUNCTION_NOT_AVAILABLE", [], { functionId: input.functionId }) };
  }

  const params: Record<string, unknown> = { ...first.params, ...(input.params ?? {}) };
  const stillMissing = missingParamsFor(first.functionId, params, row.projectId);
  if (stillMissing.length > 0) {
    return {
      ok: false,
      reason: "needs_input",
      verdict: toVerdictResult({ ...proposal, proposals: proposal.proposals.map((p) => (p === first ? { ...p, status: "needs_input", params, missing: stillMissing } : p)) }, row.id),
    };
  }

  const result = await runDirectTask({
    orgId: input.orgId,
    userId: input.userId,
    mode: row.mode,
    projectId: (typeof params.projectId === "string" ? params.projectId : null) ?? row.projectId,
    functionId: first.functionId,
    params,
    note: row.rawInput,
    role: input.role,
    actorUserId: input.actorUserId ?? null,
    existingSubmissionId: row.id,
  });
  return { ok: true, result };
}
