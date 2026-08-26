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
import { eq, and, desc, isNotNull } from "drizzle-orm";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { submissions, pipelineTasks, phraseMap, gapLog } from "@/lib/db/schema";
import { segment, rejoinCandidate, type Segment } from "./segment";
import { classifyL0, type L0Repo, type ClassificationResult as L0Result } from "./level0";
import { classifySegment, normaliseForMatch, type Classification, type ResolvedFunction } from "./classify";
import { validate, type ValidationContext } from "./validate";
import { getAiProvider, assertAiProviderAllowed } from "@/lib/ai/adapter";
import { executeTask, hasExecutor, functionWrites, EXECUTABLE_FUNCTION_IDS } from "./executor";

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
  chatMessages: string[];
  tasks: TaskOutcome[];
  /** segments that resolved to nothing -- one gap_log row each. */
  gaps: { text: string; reason: string }[];
  flagged: boolean; // MAX_SEGMENTS truncation, surfaced so the caller can ask the user to split their message
  /** fraction of resolved segments that Level 0 handled with no model call. */
  l0HitRate: number;
};

function normalisePhrase(text: string): string {
  return normaliseForMatch(text);
}

function makeL0Repo(orgId: string, userId: string): L0Repo {
  return {
    async findPhraseMapMatch(_orgId, normalisedPhrase) {
      return withTenantContext({ orgId }, async (db) => {
        // seq15: L0 only ever matches a PROMOTED phrase (promotedAt set) --
        // L2's own candidates land in this same table unpromoted (M26:
        // "Level 3 approves phrase-map promotions"). Without this filter, an
        // unreviewed AI-proposed candidate would go live in L0 the instant
        // it's written, skipping the human approval step entirely.
        const row = await db.query.phraseMap.findFirst({
          where: and(eq(phraseMap.orgId, orgId), eq(phraseMap.normalisedPhrase, normalisedPhrase), isNotNull(phraseMap.promotedAt)),
        });
        if (!row) return null;
        return { functionId: row.functionId, fixedParams: (row.fixedParams as Record<string, unknown> | null) ?? null };
      });
    },
    async findLastTask(_orgId, _userId) {
      return withTenantContext({ orgId }, async (db) => {
        const row = await db.query.pipelineTasks.findFirst({
          where: eq(pipelineTasks.orgId, orgId),
          orderBy: [desc(pipelineTasks.createdAt)],
        });
        if (!row || !row.functionId) return null;
        return { functionId: row.functionId, params: (row.params as Record<string, unknown>) ?? {} };
      });
    },
  };
}

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
  const { segments: segs, flagged } = segment(input.rawInput);
  if (segs.length === 0) {
    return { submissionId: null, status: "chat", chatMessages: [], tasks: [], gaps: [], flagged: false, l0HitRate: 1 };
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

    const dependsOn = seg.orderingHint !== undefined ? previousOrderedTaskId : null;
    const taskId = await mintTask(input, submissionId, tasks.length, dependsOn, c.functionId, c.params);

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
    });
    if (outcome.success) {
      await updateTask(input.orgId, taskId, "done", outcome.result, undefined);
      tasks.push({ taskId, functionId: c.functionId, verdict: c.verdict, status: "done", segmentText: seg.text, result: outcome.result });
    } else {
      await updateTask(input.orgId, taskId, "blocked", undefined, outcome.error);
      tasks.push({ taskId, functionId: c.functionId, verdict: c.verdict, status: "blocked", segmentText: seg.text, error: outcome.error });
    }
    advance(!outcome.success);
  }

  const status = deriveSubmissionStatus(tasks, gaps.length);
  await withTenantContext({ orgId: input.orgId, userId: input.userId }, (db) =>
    db.update(submissions).set({ status }).where(eq(submissions.id, submissionId))
  );

  return {
    submissionId,
    status,
    chatMessages,
    tasks,
    gaps,
    flagged,
    l0HitRate: resolvedCount === 0 ? 0 : l0Hits / resolvedCount,
  };
}

/**
 * L0 for every segment, ONE batched L1 call for the misses, a verdict for
 * each, then R53's re-join-once retry for whatever still resolved to
 * nothing.
 */
async function resolveAll(segs: Segment[], input: RunSubmissionInput, repo: L0Repo): Promise<ResolvedSegment[]> {
  const l0 = await Promise.all(segs.map((s) => classifyL0(s.text, { orgId: input.orgId, userId: input.userId }, repo)));

  const missIndices = l0.map((r, i) => (r.kind === "miss" ? i : -1)).filter((i) => i >= 0);
  const aiByIndex = await runLevel1(
    missIndices.map((i) => segs[i].text),
    input
  );

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
  const retryAi = await runLevel1(
    retryMissIdx.map((i) => retryTexts[i].text),
    input
  );

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
 * ONE batched Level 1 call for every unresolved segment (M26/M27: "3
 * segments cost the same as 1 and are 3x faster than 3 calls"). Returns a
 * ResolvedFunction per input, or null where the model produced nothing
 * usable.
 *
 * *** EVERY MODEL OUTPUT IS RE-VALIDATED IN CODE. *** The function_id must
 * be in the candidate set and the confidence must clear M26's 0.8 floor
 * before this returns anything at all; validate() then re-checks types,
 * ids and permission downstream. A model output that fails is a FAIL, not
 * a lower-confidence suggestion.
 */
async function runLevel1(texts: string[], input: RunSubmissionInput): Promise<(ResolvedFunction | null)[]> {
  if (texts.length === 0) return [];
  assertAiProviderAllowed(input.userId);
  const provider = getAiProvider();
  const results = await provider.classify(texts, [...CANDIDATE_FUNCTION_IDS], {
    orgId: input.orgId,
    projectId: input.projectId ?? undefined,
  });
  return results.map((r) => {
    if (!r || r.functionId === null) return null;
    if (!CANDIDATE_FUNCTION_IDS.includes(r.functionId)) return null;
    if (typeof r.confidence !== "number" || r.confidence < 0.8) return null;
    return {
      functionId: r.functionId,
      params: r.params ?? {},
      missingParams: r.missingParams ?? [],
      source: "level1" as const,
      level: 1 as const,
    };
  });
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
  params: Record<string, unknown>
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
        derivedChain: null, // filled by R53 Phase 5's derive-chain.ts
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
  await withTenantContext({ orgId: input.orgId, userId: input.userId }, (db) =>
    db.insert(gapLog).values({
      orgId: input.orgId,
      userId: input.userId,
      submissionId,
      segmentText,
      normalisedIntent,
      reason,
    })
  );
}

export { normalisePhrase };
