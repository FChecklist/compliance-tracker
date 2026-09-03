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
import { runLevel1 } from "./level1";
import { deriveChain, type ChainRepo, type DerivedChain } from "./derive-chain";
import { functionWrites, EXECUTABLE_FUNCTION_IDS } from "./executor";
import { makeL0Repo, makeChainRepo, resolveRootLabel, logGapRow } from "./repos";

export type ClassifyOnlyInput = {
  orgId: string;
  userId: string;
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
};

export type ClassifyOnlyResult = {
  segments: ClassifiedSegmentDto[];
  flagged: boolean;
  l0HitRate: number;
  modelCalls: number;
  /** ALWAYS false. This endpoint cannot execute. Present so a caller cannot forget. */
  executed: false;
};

export async function classifyOnly(input: ClassifyOnlyInput): Promise<ClassifyOnlyResult> {
  const { segments: segs, flagged } = segment(input.rawInput);
  if (segs.length === 0) {
    return { segments: [], flagged: false, l0HitRate: 1, modelCalls: 0, executed: false };
  }

  const repo: L0Repo = makeL0Repo(input.orgId, input.userId);
  const chainRepo: ChainRepo = makeChainRepo(input.orgId);
  const rootLabel = await resolveRootLabel(input.orgId, input.projectId);

  const l0 = await Promise.all(segs.map((s) => classifyL0(s.text, { orgId: input.orgId, userId: input.userId }, repo)));
  const missIndices = l0.map((r, i) => (r.kind === "miss" ? i : -1)).filter((i) => i >= 0);

  const level1 = await runLevel1(missIndices.map((i) => segs[i].text), {
    orgId: input.orgId,
    userId: input.userId,
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
    });
  }

  return {
    segments: out,
    flagged,
    l0HitRate: resolvedCount === 0 ? 0 : l0Hits / resolvedCount,
    modelCalls: level1.modelCalls,
    executed: false,
  };
}
