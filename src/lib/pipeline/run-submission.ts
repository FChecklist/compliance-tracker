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
import { eq, sql } from "drizzle-orm";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { submissions, pipelineTasks, pillUsage, chainHistory } from "@/lib/db/schema";
import { segment, rejoinCandidate, type Segment } from "./segment";
import { classifyL0, type L0Repo, type ClassificationResult as L0Result } from "./level0";
import { makeL0Repo, makeChainRepo, resolveRootLabel, logGapRow } from "./repos";
import { classifySegment, classifySubmission, normaliseForMatch, type Classification, type ResolvedFunction, type SubmissionClassification } from "./classify";
import { validate, type ValidationContext } from "./validate";
import { deriveChain, type DerivedChain } from "./derive-chain";
import { runLevel1 } from "./level1";
import { executeTask, hasExecutor, functionWrites, EXECUTABLE_FUNCTION_IDS } from "./executor";
import { createMemoryRecord } from "@/lib/services/memory-service";

// M26: "Pass the module's 5-15 functions ... NEVER 400 unbound functions --
// that is where it hallucinates." The candidate set is exactly what
// executor.ts can actually run, so classifyL0's structural tier, the AI
// adapter's candidate list, validate()'s candidate-set check and the
// executor registry can never silently drift apart.
const CANDIDATE_FUNCTION_IDS = EXECUTABLE_FUNCTION_IDS;

export type RunSubmissionInput = {
  orgId: string;
  userId: string;
  mode: string;
  projectId?: string | null;
  selectedChain?: unknown;
  rawInput: string;
  /** R48 gap-closure (2026-08-30, F089) -- see executor.ts's ExecutableTask.role comment. Optional: callers with no role available (e.g. the MCP AI-link route) simply don't get the redaction. */
  role?: string | null;
};

export type TaskOutcome = {
  taskId: string;
  functionId: string | null;
  /** R53: the per-segment verdict. NEVER one verdict for the whole submission. */
  verdict: "task" | "chat";
  status: "to_do" | "in_progress" | "waiting" | "done" | "blocked";
  segmentText: string;
  result?: unknown;
  error?: string;
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
    return { submissionId: null, status: "chat", classification: "CHAT_ONLY", chatMessages: [], tasks: [], gaps: [], flagged: false, l0HitRate: 1, modelCalls: 0 };
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
  const chainRepo = makeChainRepo(input.orgId);
  const rootLabel = await resolveRootLabel(input.orgId, input.projectId ?? null);
  let l0Hits = 0;
  let resolvedCount = 0;

  // ---- RESOLUTION PASS -------------------------------------------------
  const resolved = await resolveAll(segs, input, repo);
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

    const validationCtx: ValidationContext = {
      candidateFunctionIds: CANDIDATE_FUNCTION_IDS,
      // boqLineItemId existence is re-checked for real inside executor.ts's
      // own DB query regardless, so nothing here trusts an unverified id
      // through to a write.
      boqLineItemIds: new Set(),
      userPermittedFunctionIds: new Set(CANDIDATE_FUNCTION_IDS),
      reachableProjectIds: input.projectId ? new Set([input.projectId]) : new Set(),
    };

    const v = validate({ functionId: c.functionId, params: c.params }, validationCtx);
    if (!v.valid) {
      // M26: "a candidate that fails validation is a FAIL, not a suggestion."
      await logGap(input, submissionId, seg.text, c.functionId, v.reason);
      gaps.push({ text: seg.text, reason: v.reason });
      chatMessages.push(`I can't do that yet: "${seg.text}" (${v.reason})`);
      continue;
    }

    // M26 PARTIAL: a valid function with a missing value is a FORM FIELD,
    // not a gap. ASK THE USER. Do NOT escalate, do NOT log a gap, and do
    // NOT mint a task that would run with a guessed value.
    if (c.missingParams.length > 0) {
      chatMessages.push(c.message ?? `I need ${c.missingParams.join(", ")} for "${seg.text}".`);
      continue;
    }

    // R53 PHASE 5: PHRASE -> FUNCTION -> CHAIN, never the reverse. The chain
    // is derived from the function the PHRASE resolved to, and from the mode
    // and project the request already carried. input.selectedChain -- the
    // user's own pill selection -- is deliberately NOT consulted here: M25
    // calls it a HINT and M26 rules the phrase is the authority.
    const derived = await deriveChain(chainRepo, {
      mode: input.mode,
      rootLabel,
      functionId: c.functionId,
      params: c.params,
    });
    if (!firstDerivedChain) firstDerivedChain = derived;

    const dependsOn = seg.orderingHint !== undefined ? previousOrderedTaskId : null;
    const taskId = await mintTask(input, submissionId, tasks.length, dependsOn, c.functionId, c.params, derived);
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
      const reason = `read as a question, so "${c.functionId}" was not run -- say it as an instruction to record it`;
      await updateTask(input.orgId, taskId, "blocked", undefined, reason);
      tasks.push({ taskId, functionId: c.functionId, verdict: "chat", status: "blocked", segmentText: seg.text, error: reason });
      if (c.message) chatMessages.push(c.message);
      advance(true);
      continue;
    }

    if (seg.orderingHint !== undefined && previousOrderedFailed) {
      const reason = `blocked: dependency task ${previousOrderedTaskId} did not complete`;
      await updateTask(input.orgId, taskId, "blocked", undefined, reason);
      tasks.push({ taskId, functionId: c.functionId, verdict: c.verdict, status: "blocked", segmentText: seg.text, error: reason });
      advance(true);
      continue;
    }

    if (!hasExecutor(c.functionId)) {
      const reason = `no executor is registered for function_id "${c.functionId}" yet`;
      await updateTask(input.orgId, taskId, "blocked", undefined, reason);
      tasks.push({ taskId, functionId: c.functionId, verdict: c.verdict, status: "blocked", segmentText: seg.text, error: reason });
      advance(true);
      continue;
    }

    const outcome = await executeTask({
      orgId: input.orgId,
      userId: input.userId,
      projectId: input.projectId ?? null,
      functionId: c.functionId,
      params: c.params,
      role: input.role,
    });
    if (outcome.success) {
      await updateTask(input.orgId, taskId, "done", outcome.result, undefined);
      tasks.push({ taskId, functionId: c.functionId, verdict: c.verdict, status: "done", segmentText: seg.text, result: outcome.result });
      // R65 Part C Phase 3: task memory, WRITE tasks only -- see this
      // file's own captureTaskResultMemory()/buildTaskResultMemoryContent()
      // header for why.
      if (functionWrites(c.functionId)) {
        await captureTaskResultMemory(input, c.functionId, seg.text, c.params);
      }
    } else {
      await updateTask(input.orgId, taskId, "blocked", undefined, outcome.error);
      tasks.push({ taskId, functionId: c.functionId, verdict: c.verdict, status: "blocked", segmentText: seg.text, error: outcome.error });
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
  };

  const submissionId = await withTenantContext({ orgId: input.orgId, userId: input.userId }, async (db) => {
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
  });

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

  const validationCtx: ValidationContext = {
    candidateFunctionIds: CANDIDATE_FUNCTION_IDS,
    boqLineItemIds: new Set(),
    userPermittedFunctionIds: new Set(CANDIDATE_FUNCTION_IDS),
    reachableProjectIds: input.projectId ? new Set([input.projectId]) : new Set(),
  };
  const v = validate({ functionId: input.functionId, params }, validationCtx);
  if (!v.valid) {
    await logGap(base, submissionId, base.rawInput, input.functionId, v.reason);
    await withTenantContext({ orgId: input.orgId, userId: input.userId }, (db) =>
      db.update(submissions).set({ status: "failed", classification }).where(eq(submissions.id, submissionId))
    );
    return {
      submissionId,
      status: "failed",
      classification,
      chatMessages: [`I can't do that yet: ${v.reason}`],
      tasks: [],
      gaps: [{ text: base.rawInput, reason: v.reason }],
      flagged: false,
      l0HitRate: 1,
      modelCalls: 0,
    };
  }

  const rootLabel = await resolveRootLabel(input.orgId, input.projectId ?? null);
  const derived = await deriveChain(makeChainRepo(input.orgId), {
    mode: input.mode,
    rootLabel,
    functionId: input.functionId,
    params,
  });

  const taskId = await mintTask(base, submissionId, 0, null, input.functionId, params, derived);

  let outcome: { success: boolean; result?: unknown; error?: string };
  if (!hasExecutor(input.functionId)) {
    outcome = { success: false, error: `no executor is registered for function_id "${input.functionId}" yet` };
  } else {
    outcome = await executeTask({
      orgId: input.orgId,
      userId: input.userId,
      projectId: input.projectId ?? null,
      functionId: input.functionId,
      params,
      role: input.role,
    });
  }

  if (outcome.success) {
    await updateTask(input.orgId, taskId, "done", outcome.result, undefined);
    // R65 Part C Phase 3: task memory, same as runSubmission()'s own
    // execution loop above -- WRITE tasks only.
    if (functionWrites(input.functionId)) {
      await captureTaskResultMemory(base, input.functionId, base.rawInput, params);
    }
  } else {
    await updateTask(input.orgId, taskId, "blocked", undefined, outcome.error);
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
    chatMessages: outcome.success ? [] : [outcome.error ?? "That did not run."],
    tasks: [
      {
        taskId,
        functionId: input.functionId,
        verdict,
        status: outcome.success ? "done" : "blocked",
        segmentText: base.rawInput,
        result: outcome.result,
        error: outcome.error,
      },
    ],
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
async function resolveAll(segs: Segment[], input: RunSubmissionInput, repo: L0Repo): Promise<ResolvedSegment[]> {
  const l0 = await Promise.all(segs.map((s) => classifyL0(s.text, { orgId: input.orgId, userId: input.userId }, repo)));

  const missIndices = l0.map((r, i) => (r.kind === "miss" ? i : -1)).filter((i) => i >= 0);
  const level1 = await runLevel1(missIndices.map((i) => segs[i].text), level1Context(input));
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
  const retryLevel1 = await runLevel1(retryMissIdx.map((i) => retryTexts[i].text), level1Context(input));
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

async function updateTask(orgId: string, taskId: string, status: TaskOutcome["status"], result: unknown, error: string | undefined) {
  await withTenantContext({ orgId }, (db) =>
    db
      .update(pipelineTasks)
      .set({ status, result: (result as object | undefined) ?? null, error: error ?? null, updatedAt: new Date() })
      .where(eq(pipelineTasks.id, taskId))
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
