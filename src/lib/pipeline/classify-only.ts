// R53 Phase 6 -- the read-only half of the pipeline.
//
// Everything runSubmission() does UP TO the point of minting a row, and
// nothing after it. Segment -> Level 0 -> (misses only) Level 1 -> verdict
// -> derive the chain. No pipeline_tasks row, no execution, no side effect
// on any business table.
//
// *** IT DOES WRITE gap_log. *** That is not an exception to "read-only", it
// is the point: a phrase the product cannot understand is a fact worth
// keeping whether or not the user goes on to submit it, and gap_log is the
// only place Phase 7's promotion loop can ever learn from. Nothing else is
// written.
import { segment } from "./segment";
import { classifyL0, type L0Repo } from "./level0";
import { classifySegment, normaliseForMatch, type ResolvedFunction } from "./classify";
import { runLevel1, refusalAsUnresolved, level1RefusalCode, type Level1LaneOutcome, type Level1RefusalCode } from "./level1";
import { deriveChain, type ChainRepo, type DerivedChain } from "./derive-chain";
import { functionWrites, hasExecutor, EXECUTABLE_FUNCTION_IDS } from "./executor";
import { makeL0Repo, makeChainRepo, resolveRootLabel, logGapRow } from "./repos";
import { NO_COMMENTARY_SENTENCE } from "@/lib/ai/refusal";
import type { AiProviderRefusalError } from "@/lib/ai/adapter";

export type ClassifyOnlyInput = {
  orgId: string;
  userId: string;
  /** PROJEXA-BUILD-001 U-49: the acting person the Level 1 provider gate compares -- see level1.ts's Level1Context.personId. */
  level1PersonId?: string | null;
  mode: string;
  projectId: string | null;
  rawInput: string;
};

export type ClassifiedSegmentDto = {
  index: number;
  text: string;
  verdict: "task" | "chat" | "gap";
  functionId: string | null;
  params: Record<string, unknown>;
  missingParams: string[];
  derivedChain: DerivedChain | null;
  source: string;
  level: 0 | 1 | null;
  message: string | null;
  reason: string | null;
  /**
   * R67 C-12 -- WOULD SUBMITTING THIS WRITE ANYTHING, AND CAN THIS PIPELINE
   * RUN IT AT ALL?
   *
   * PROJEXA's composer offers a "Record" button on a preview, and C-12 rules
   * that it may only do so "for registered writes; every other leaf loads the
   * chain and stops". Both facts already exist in executor.ts
   * (WRITE_FUNCTION_IDS, EXECUTORS) and neither reached the client, so the
   * only way for the composer to know was to hard-code a copy of the registry
   * and go stale the day a write was added. They are computed here, from the
   * registry itself, on the endpoint whose whole job is answering "what would
   * happen if I submitted this".
   *
   * `writes:false, executable:true` is a read -- it runs, and it changes
   * nothing. `executable:false` is the honest gap: the product cannot do this
   * yet, which is a sentence the user is owed rather than a disabled button.
   */
  writes: boolean;
  executable: boolean;
};

export type ClassifyOnlyResult = {
  segments: ClassifiedSegmentDto[];
  flagged: boolean;
  l0HitRate: number;
  modelCalls: number;
  /** ALWAYS false. This endpoint cannot execute. Present so a caller cannot forget. */
  executed: false;
  /**
   * PROJEXA-BUILD-001 U-49 (BR-220/BR-221). What the Level 1 lane did, in the
   * vocabulary compliance.submissions.level1_outcome uses, and its closed
   * refusal code. Returned, not stored: this endpoint writes no submissions
   * row and gap_log has no such columns, so the response is the only record.
   * On `refused`, `message` is NO_COMMENTARY_SENTENCE and `segments` still
   * carries every classification Level 0 made -- an answer, not a 400.
   */
  level1Outcome: Level1LaneOutcome;
  level1RefusalCode: Level1RefusalCode | null;
  message: string | null;
};

/** U-49: the response's Level 1 fields, from the refusal (if any) and how many texts reached the lane. */
function level1Fields(refusal: AiProviderRefusalError | undefined, misses: number): Pick<ClassifyOnlyResult, "level1Outcome" | "level1RefusalCode" | "message"> {
  const outcome: Level1LaneOutcome = refusal ? "refused" : misses > 0 ? "resolved" : "not_needed";
  return {
    level1Outcome: outcome,
    level1RefusalCode: level1RefusalCode(outcome, refusal?.kind, refusal?.message ?? null),
    message: refusal ? NO_COMMENTARY_SENTENCE : null,
  };
}

export async function classifyOnly(input: ClassifyOnlyInput): Promise<ClassifyOnlyResult> {
  const { segments: segs, flagged } = segment(input.rawInput);
  if (segs.length === 0) {
    return { segments: [], flagged: false, l0HitRate: 1, modelCalls: 0, executed: false, ...level1Fields(undefined, 0) };
  }

  const repo: L0Repo = makeL0Repo(input.orgId, input.userId);
  const chainRepo: ChainRepo = makeChainRepo(input.orgId);
  const rootLabel = await resolveRootLabel(input.orgId, input.projectId);

  const l0 = await Promise.all(segs.map((s) => classifyL0(s.text, { orgId: input.orgId, userId: input.userId }, repo)));
  const missIndices = l0.map((r, i) => (r.kind === "miss" ? i : -1)).filter((i) => i >= 0);

  // U-49 (BR-221): the gate's refusal is "nothing resolved" for the misses,
  // not a throw -- the Level 0 classifications below still come back.
  const refused: { error?: AiProviderRefusalError } = {};
  const level1 = await refusalAsUnresolved(runLevel1, (error) => {
    refused.error = error;
  })(missIndices.map((i) => segs[i].text), {
    orgId: input.orgId,
    userId: input.userId,
    personId: input.level1PersonId ?? null,
    projectId: input.projectId,
    candidateFunctionIds: EXECUTABLE_FUNCTION_IDS,
  });

  const out: ClassifiedSegmentDto[] = [];
  let l0Hits = 0;
  let resolvedCount = 0;

  for (let i = 0; i < segs.length; i++) {
    const r = l0[i];
    let resolution: ResolvedFunction | null = null;
    let level1Reason: string | null = null;

    if (r.kind === "match") {
      // R67 C-03: missingParams carried through -- see run-submission.ts's
      // l0ToResolution(). A preview that drops it cannot ask the one question
      // the composer exists to ask.
      resolution = { functionId: r.functionId, params: r.params, missingParams: r.missingParams, source: r.source, level: 0 };
    } else if (r.kind === "miss") {
      const at = missIndices.indexOf(i);
      resolution = level1.resolutions[at] ?? null;
      level1Reason = level1.reasons[at] ?? null;
    }

    const c = classifySegment({
      text: segs[i].text,
      resolution,
      nature: resolution ? { writes: functionWrites(resolution.functionId) } : null,
    });

    if (c.verdict !== "gap") {
      resolvedCount++;
      if (c.level === 0) l0Hits++;
    }

    const derivedChain = c.functionId
      ? await deriveChain(chainRepo, { mode: input.mode, rootLabel, functionId: c.functionId, params: c.params })
      : null;

    // PHASE 7's LEARNING LOOP. Two kinds of row, both needed:
    //   - a GAP, so the product knows what it could not do
    //   - a successful LEVEL 1 resolution, so the SAME normalised intent
    //     resolving identically 3+ times can be spotted and promoted into
    //     phrase_map, where it becomes free forever (M26: "l0_hit_rate
    //     rising IS the economic engine")
    // A Level 0 hit is NOT logged -- it is already free, and logging it
    // would inflate the promotion counts with phrases already promoted.
    if (c.verdict === "gap") {
      await logGapRow(input.orgId, input.userId, null, segs[i].text, normaliseForMatch(segs[i].text), c.gapReason ?? level1Reason ?? "unresolved");
    } else if (c.level === 1 && c.functionId) {
      await logGapRow(
        input.orgId,
        input.userId,
        null,
        segs[i].text,
        normaliseForMatch(segs[i].text),
        `level1 resolved to ${c.functionId}`
      );
    }

    out.push({
      index: i,
      text: segs[i].text,
      verdict: c.verdict,
      functionId: c.functionId,
      params: c.params,
      missingParams: c.missingParams,
      derivedChain,
      source: c.source,
      level: c.level,
      message: c.message,
      reason: c.gapReason ?? (c.verdict === "gap" ? level1Reason : null),
      writes: c.functionId ? functionWrites(c.functionId) : false,
      executable: c.functionId ? hasExecutor(c.functionId) : false,
    });
  }

  return {
    segments: out,
    flagged,
    l0HitRate: resolvedCount === 0 ? 0 : l0Hits / resolvedCount,
    modelCalls: level1.modelCalls,
    executed: false,
    ...level1Fields(refused.error, missIndices.length),
  };
}
