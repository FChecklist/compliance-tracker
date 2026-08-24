// R42 seq14 -- M25's submission -> segmentation -> task pipeline, wired end
// to end for the first time. SYNCHRONOUS ONLY (M27/v5 P-1: "do not add a
// queue or worker" -- this runs inline in the request that submitted it).
//
// Orchestrates, in order: segment() [seq11, pure] -> classifyL0() per
// segment [seq12, deterministic] -> for L0 misses, ONE batched
// adapter.classify() call [seq13, the only AI in this file] -> validate()
// [seq12] -> create the pipeline_tasks row -> executeTask() [this seq,
// executor.ts] -> update the row with its real outcome.
import { eq, and, desc } from "drizzle-orm";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { submissions, pipelineTasks, phraseMap, gapLog } from "@/lib/db/schema";
import { segment } from "./segment";
import { classifyL0, type L0Repo, type ClassificationResult as L0Result } from "./classify";
import { validate, type ValidationContext } from "./validate";
import { getAiProvider, assertAiProviderAllowed } from "@/lib/ai/adapter";
import { executeTask, hasExecutor } from "./executor";

// The real candidate set this pipeline can act on TODAY -- see executor.ts's
// header for why this isn't yet the full M28 registry (that arrives at
// seq20). Kept in one place so classifyL0's structural tier, the AI
// adapter's candidate list, and validate()'s candidate-set check can never
// silently drift apart from what executor.ts can actually run.
const CANDIDATE_FUNCTION_IDS = ["record_work_progress", "get_construction_project_dashboard"] as const;

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
  status: "to_do" | "in_progress" | "waiting" | "done" | "blocked";
  result?: unknown;
  error?: string;
};

export type RunSubmissionResult = {
  submissionId: string | null; // null when the input produced zero segments (nothing to submit)
  status: "chat" | "in_progress" | "done" | "partial" | "failed";
  chatMessages: string[];
  tasks: TaskOutcome[];
  flagged: boolean; // seq11's MAX_SEGMENTS truncation signal, surfaced so the caller can tell the user to split their message
};

function normalisePhrase(text: string): string {
  return text.trim().toLowerCase().replace(/[.!?]+$/, "").replace(/\s+/g, " ");
}

function makeL0Repo(orgId: string, userId: string): L0Repo {
  return {
    async findPhraseMapMatch(_orgId, normalisedPhrase) {
      return withTenantContext({ orgId }, async (db) => {
        const row = await db.query.phraseMap.findFirst({
          where: and(eq(phraseMap.orgId, orgId), eq(phraseMap.normalisedPhrase, normalisedPhrase)),
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

// A "miss" from classifyL0 is always converted into an "ai" entry before it
// ever lands in `resolved` (see the merge step below) -- excluded from this
// type so the rest of the file's narrowing doesn't need to re-check for it.
type ResolvedOutcome = Exclude<L0Result, { kind: "miss" }> | { kind: "ai"; classification: import("@/lib/ai/adapter").ClassificationResult };
type ResolvedSegment = {
  text: string;
  orderingHint?: number;
  outcome: ResolvedOutcome;
};

export async function runSubmission(input: RunSubmissionInput): Promise<RunSubmissionResult> {
  const { segments: segs, flagged } = segment(input.rawInput);
  if (segs.length === 0) {
    return { submissionId: null, status: "chat", chatMessages: [], tasks: [], flagged: false };
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

  // Pass 1: L0 for every segment (cheap, deterministic, never touches AI).
  const l0Results = await Promise.all(segs.map((s) => classifyL0(s.text, { orgId: input.orgId, userId: input.userId }, repo)));

  // Pass 2: batch every L0 miss into ONE adapter.classify() call (M27: "3
  // segments cost the same as 1 and are 3x faster than 3 calls"). L0 hits
  // (chat/match) never reach the adapter at all.
  const missIndices = l0Results.map((r, i) => (r.kind === "miss" ? i : -1)).filter((i) => i >= 0);
  let aiResults: import("@/lib/ai/adapter").ClassificationResult[] = [];
  if (missIndices.length > 0) {
    assertAiProviderAllowed(input.userId);
    const provider = getAiProvider();
    aiResults = await provider.classify(
      missIndices.map((i) => segs[i].text),
      [...CANDIDATE_FUNCTION_IDS],
      { orgId: input.orgId, projectId: input.projectId ?? undefined }
    );
  }

  const resolved: ResolvedSegment[] = segs.map((s, i) => {
    const l0 = l0Results[i];
    if (l0.kind !== "miss") return { text: s.text, orderingHint: s.orderingHint, outcome: l0 };
    const aiIdx = missIndices.indexOf(i);
    return { text: s.text, orderingHint: s.orderingHint, outcome: { kind: "ai", classification: aiResults[aiIdx] } };
  });

  const chatMessages: string[] = [];
  const tasks: TaskOutcome[] = [];
  // orderingHint segments run as a dependency chain: each depends on the
  // previous ordered segment's task (M25's depends_on, the one dependency
  // shape seq11's ordering signal can actually express). A segment with no
  // orderingHint has no declared dependency.
  let previousOrderedTaskId: string | null = null;
  let previousOrderedFailed = false;

  for (const seg of resolved) {
    const validationCtx: ValidationContext = {
      candidateFunctionIds: CANDIDATE_FUNCTION_IDS,
      // Real BOQ-line/permission/project-reachability resolution is the
      // route layer's job once this pipeline is reachable from a real
      // multi-BOQ, multi-role UI (seq20+) -- for this synchronous-first
      // wiring, a function that HAS a real executor is, by construction, one
      // this user's own org can reach; boqLineItemId existence is re-checked
      // for real inside executor.ts's own DB query regardless, so nothing
      // here trusts an unverified id through to a write.
      boqLineItemIds: new Set(),
      userPermittedFunctionIds: new Set(CANDIDATE_FUNCTION_IDS),
      reachableProjectIds: input.projectId ? new Set([input.projectId]) : new Set(),
    };

    let functionId: string | null = null;
    let params: Record<string, unknown> = {};

    if (seg.outcome.kind === "chat") {
      chatMessages.push(`(no task -- read as conversation): "${seg.text}"`);
      continue;
    }
    if (seg.outcome.kind === "match") {
      functionId = seg.outcome.functionId;
      params = seg.outcome.params;
    } else {
      const ai = seg.outcome.classification;
      if (!ai || ai.functionId === null) {
        await logGap(input, seg.text, ai?.unmappedIntent ?? null, "L1 could not map this to any known function");
        chatMessages.push(`I can't do that yet: "${seg.text}"`);
        continue;
      }
      if (ai.missingParams.length > 0) {
        // M26 PARTIAL: ask the user, do not escalate, never guess.
        chatMessages.push(`I found "${ai.functionId}" for "${seg.text}" but need: ${ai.missingParams.join(", ")}`);
        continue;
      }
      functionId = ai.functionId;
      params = ai.params;
    }
    if (!functionId) continue; // unreachable given the branches above, satisfies TS's narrowing for the rest of this loop body

    const v = validate({ functionId, params }, validationCtx);
    if (!v.valid) {
      await logGap(input, seg.text, functionId, v.reason);
      chatMessages.push(`I can't do that yet: "${seg.text}" (${v.reason})`);
      continue;
    }

    const dependsOn = seg.orderingHint !== undefined ? previousOrderedTaskId : null;

    const taskId = await withTenantContext({ orgId: input.orgId, userId: input.userId }, async (db) => {
      const [row] = await db
        .insert(pipelineTasks)
        .values({
          submissionId,
          sequence: tasks.length,
          dependsOn,
          orgId: input.orgId,
          projectId: input.projectId ?? null,
          projectSource: input.projectId ? "inherited" : "stated",
          derivedChain: (input.selectedChain as object | undefined) ?? null,
          functionId,
          params,
          executor: "software",
          status: "to_do",
        })
        .returning({ id: pipelineTasks.id });
      return row.id;
    });

    // A task whose declared dependency already failed is BLOCKED without
    // ever executing (M25: "dependents of a failed task are BLOCKED with
    // reason"). A succeeded task is NEVER rolled back by a later failure.
    if (seg.orderingHint !== undefined && previousOrderedFailed) {
      await updateTask(input.orgId, taskId, "blocked", undefined, `blocked: dependency task ${previousOrderedTaskId} did not complete`);
      tasks.push({ taskId, functionId, status: "blocked", error: `blocked: dependency task ${previousOrderedTaskId} did not complete` });
      if (seg.orderingHint !== undefined) {
        previousOrderedTaskId = taskId;
        previousOrderedFailed = true;
      }
      continue;
    }

    if (!hasExecutor(functionId)) {
      await updateTask(input.orgId, taskId, "blocked", undefined, `no executor is registered for function_id "${functionId}" yet`);
      tasks.push({ taskId, functionId, status: "blocked", error: `no executor is registered for function_id "${functionId}" yet` });
      if (seg.orderingHint !== undefined) {
        previousOrderedTaskId = taskId;
        previousOrderedFailed = true;
      }
      continue;
    }

    const outcome = await executeTask({ orgId: input.orgId, userId: input.userId, projectId: input.projectId ?? null, functionId, params });
    if (outcome.success) {
      await updateTask(input.orgId, taskId, "done", outcome.result, undefined);
      tasks.push({ taskId, functionId, status: "done", result: outcome.result });
    } else {
      await updateTask(input.orgId, taskId, "blocked", undefined, outcome.error);
      tasks.push({ taskId, functionId, status: "blocked", error: outcome.error });
    }

    if (seg.orderingHint !== undefined) {
      previousOrderedTaskId = taskId;
      previousOrderedFailed = !outcome.success;
    }
  }

  const status = deriveSubmissionStatus(tasks, chatMessages.length);
  await withTenantContext({ orgId: input.orgId, userId: input.userId }, (db) =>
    db.update(submissions).set({ status }).where(eq(submissions.id, submissionId))
  );

  return { submissionId, status, chatMessages, tasks, flagged };
}

function deriveSubmissionStatus(tasks: TaskOutcome[], chatCount: number): RunSubmissionResult["status"] {
  if (tasks.length === 0) return "chat";
  const doneCount = tasks.filter((t) => t.status === "done").length;
  if (doneCount === tasks.length) return "done";
  if (doneCount === 0) return "failed";
  return "partial";
}

async function updateTask(orgId: string, taskId: string, status: TaskOutcome["status"], result: unknown, error: string | undefined) {
  await withTenantContext({ orgId }, (db) =>
    db
      .update(pipelineTasks)
      .set({ status, result: (result as object | undefined) ?? null, error: error ?? null, updatedAt: new Date() })
      .where(eq(pipelineTasks.id, taskId))
  );
}

async function logGap(input: RunSubmissionInput, segmentText: string, normalisedIntent: string | null, reason: string) {
  await withTenantContext({ orgId: input.orgId, userId: input.userId }, (db) =>
    db.insert(gapLog).values({
      orgId: input.orgId,
      userId: input.userId,
      segmentText,
      normalisedIntent,
      reason,
    })
  );
}

export { normalisePhrase };
