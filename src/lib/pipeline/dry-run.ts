// R67 lane B (B-05) -- THE PROPOSAL STEP. Say what you understood BEFORE you
// do anything.
//
// Today POST /api/v1/projexa/tasks resolves and executes in one shot, so a
// parameter the classifier could not fill becomes a pipeline_tasks row with
// status 'blocked' and an English reason. That is the wrong answer twice
// over: the user is told afterwards, in prose, about a task they never
// agreed to mint; and their Home badge counts a "task" that was never a
// task, only an unanswered question.
//
// This is the other half: {rawInput, dryRun:true} classifies, derives the
// chain, works out what is still missing, offers the real choices for it,
// and MINTS NOTHING. The client then posts {functionId, params} to actually
// run it -- the existing pill path, unchanged.
//
// THREE KINDS, from the verb family (function-registry.ts's `kind`, which
// derive-chain.ts's VERB_PREFIXES already grouped the same way):
//   write  Record / Add / Mark / Upload / Log / New / Import -> a card schema
//   ask    View / Show / Check                                -> rows + text
//   run    Run / Export / Share                               -> a route
//
// DB access is confined to the injected deps, so every branch is unit
// testable -- the same seam level0.ts's L0Repo established.
import { segment } from "./segment";
import { classifyL0, type L0Repo } from "./level0";
import { classifySegment, type Classification, type ResolvedFunction } from "./classify";
import { resolveMissesWithReuseCache, type ReuseCacheRepo } from "./reuse-cache";
import type { PhraseFuzzyRepo } from "./phrase-fuzzy";
import { deriveChain, type ChainRepo, type DerivedChain } from "./derive-chain";
import { functionWrites, type ExecutableTask, type ExecutionOutcome } from "./executor";
import { functionKind, functionLabel, functionSpec, requiredParamSatisfied, type CardSchema, type FunctionKind } from "./function-registry";
import { codeForParam, type PipelineErrorCode } from "./error-codes";
import { NO_COMMENTARY_SENTENCE } from "@/lib/ai/refusal";
// R80 Part 2 (1a): the ONE type this file needs from the adapter -- the class
// assertAiProviderAllowed() throws. Importing it is what lets the telemetry
// below tell "the provider gate switched the AI off for this caller" apart
// from "something genuinely broke". adapter.ts's own top-level import is just
// ai/refusal.ts (its providers are lazily require()d), so this adds no module
// weight and no cycle.
import { AiProviderRefusalError } from "@/lib/ai/adapter";

/**
 * A real choice, never "please retype it".
 *
 * `id` is what THIS surface's `missing[].name` expects (for a BOQ line that is
 * the human item code, because the classifier's parameter is `itemCode`).
 * `lineItemId` carries the underlying record's real id alongside it, so
 * B-07's verdict -- which offers the same lines under the parameter
 * `boqLineItemId` -- can resolve one from the other without a second query.
 */
export type DryRunOption = { id: string; label: string; lineItemId?: string };

/** One parameter the user still has to answer, in words plus real choices. */
export type DryRunMissing = {
  name: string;
  label: string;
  code: PipelineErrorCode;
  options?: DryRunOption[];
};

export type DryRunAnswer = {
  /** whatever the read executor returned -- rows, a dashboard object, a list */
  rows: unknown;
  /** null when there is nothing to add beyond the records themselves */
  text: string | null;
  /** the chain, rendered, so the client can print "Understood: <chain>" */
  chain: string;
};

export type DryRunProposal = {
  segmentText: string;
  /**
   *  ready       -> everything is filled in; POST {functionId, params} to run it
   *  needs_input -> answer `missing` first. NOTHING WAS MINTED and nothing is
   *                 counted in the Home badge; this is a question, not a task.
   *  answered    -> an ASK verdict that already ran its read
   *  gap         -> the capability genuinely is not wired; `message` + `route`
   *  chat        -> an acknowledgement; nothing to do
   */
  status: "ready" | "needs_input" | "answered" | "gap" | "chat";
  verdict: Classification["verdict"];
  kind: FunctionKind;
  functionId: string | null;
  /** "Record progress" -- never a function id, on any surface. */
  label: string | null;
  params: Record<string, unknown>;
  missing: DryRunMissing[];
  /** the derived chain, ALWAYS returned so the row can be built from it */
  chain: DerivedChain | null;
  schema?: CardSchema;
  answer?: DryRunAnswer;
  route?: string;
  /** a closed sentence, used only by the `gap` status */
  message?: string;
};

/**
 * R80 PART 2, STEP 1a -- THE SOFTWARE-vs-AI SPLIT, COUNTED WHERE IT HAPPENS.
 *
 * Before this, the live typed path did not merely fail to PERSIST the split --
 * it never computed it. The line that is now `modelCalls = level1.modelCalls`
 * was literally `resolutions = level1.resolutions;`, throwing away the
 * `modelCalls` and `cacheHits` that ReuseCacheOutcome (reuse-cache.ts:72-75)
 * already hands back. Widening any log line downstream would have printed
 * nothing.
 *
 * `resolved` and `l0Hits` are counted with EXACTLY the rule
 * classify-only.ts:117-120 already uses, so the /classify and /tasks engines
 * cannot report two different hit rates for the same input.
 *
 * WHY level1Outcome IS A FOUR-WAY ENUM AND NOT A BOOLEAN:
 *
 *   not_needed  every segment hit Level 0. The Level 1 lane was never entered,
 *               so modelCalls is 0 because there was nothing to ask -- the
 *               genuinely free case, and the one worth celebrating.
 *   resolved    the Level 1 lane ran and returned. It may STILL have made zero
 *               model calls: a reuse_cache hit is exactly that. What separates
 *               a free answer from a paid one is modelCalls/cacheHits, never
 *               this field.
 *   refused     assertAiProviderAllowed() (ai/adapter.ts:63-88, called from
 *               level1.ts:96) threw BEFORE any model work because the caller is
 *               not RAJAT_USER_ID. The AI was switched OFF for this request.
 *               RAJAT_USER_ID is absent from Vercel Production, so today this
 *               is the outcome for every end user there.
 *   error       anything else threw -- a misconfigured provider, a repo
 *               failure. A fault, not a policy decision.
 *
 * Collapsing `refused` into `not_needed` is the single failure this field
 * exists to prevent: it reports a triumphant 100% software / 0% AI split that
 * actually means the model is turned off. `level1RefusalReason` carries the
 * thrown message verbatim -- for `error` as well as `refused` -- so those two
 * are never confused with each other either.
 *
 * DELIBERATELY OFF THE WIRE CONTRACT. `telemetry` lives on DryRunResult and
 * nowhere else. verdict.ts's toVerdictResult() (:180-187) builds
 * SubmissionVerdictResult field by field out of `result.proposals` and never
 * spreads `result`, so this cannot reach SubmissionVerdict or PROJEXA's
 * M24Shell client type. submitForVerdict() reads it off the proposal BEFORE
 * calling toVerdictResult().
 */
export type DryRunTelemetry = {
  /** how many segments segment() produced for this submission */
  segments: number;
  /** classify-only.ts:117 -- `c.verdict !== "gap"` */
  resolved: number;
  /** classify-only.ts:119 -- `c.level === 0`, counted only within `resolved` */
  l0Hits: number;
  /** live model calls actually made. ONE per batch, ZERO for a cache hit. */
  modelCalls: number;
  /** segments served from compliance.reuse_cache -- free, and never model calls */
  cacheHits: number;
  /** P1.2/P1.3: segments served from the trigram fuzzy tier (phrase-fuzzy.ts) -- free, and never model calls, distinct from cacheHits. */
  fuzzyHits: number;
  level1Outcome: "resolved" | "refused" | "not_needed" | "error";
  /** the thrown message, verbatim, for `refused` AND `error`. Null otherwise. */
  level1RefusalReason: string | null;
};

export type DryRunResult = { dryRun: true; proposals: DryRunProposal[]; telemetry: DryRunTelemetry } & Omit<DryRunProposal, "segmentText">;

/** Everything this needs from the outside world. Injected, so it is testable. */
export type DryRunDeps = {
  l0Repo: L0Repo;
  reuseRepo: ReuseCacheRepo;
  /** P1.2/P1.3: optional so every existing test fixture (none of which sets it) is unaffected -- undefined means "no fuzzy tier", same as passing none to resolveMissesWithReuseCache directly. makeDryRunDeps() (the real production factory, run-submission.ts) sets this to a real makePhraseFuzzyRepo(). */
  fuzzyRepo?: PhraseFuzzyRepo;
  chainRepo: ChainRepo;
  rootLabel: string | null;
  /** the project's LEAF BOQ lines, for a missing BOQ-line chip row */
  boqLineOptions: (projectId: string) => Promise<DryRunOption[]>;
  /** runs a read function so an ASK verdict can answer from the records */
  runRead: (task: ExecutableTask) => Promise<ExecutionOutcome>;
  /** false when the model provider will refuse -- see providerAvailable() below */
  providerAvailable: () => boolean;
};

export type DryRunInput = {
  orgId: string;
  userId: string;
  mode: string;
  projectId?: string | null;
  rawInput: string;
  role?: string | null;
  candidateFunctionIds: readonly string[];
};

/**
 * THE SENTENCE THAT REPLACES A REFUSAL, shared with the adapter that throws
 * it (src/lib/ai/refusal.ts) so the two layers can never word it differently.
 */
export { NO_COMMENTARY_SENTENCE };

// The capabilities a user can reasonably ask for that this pipeline
// genuinely cannot do from chat yet. A closed list: a gap it does not
// recognise gets the generic sentence, never an invented promise.
//
// G-23, 2026-09-09 -- WHY THIS LIST GREW FROM SIX ENTRIES TO TWENTY-EIGHT.
// PROJEXA's composer advertises two worked example sentences per module, in
// the module's own vocabulary, rendered as chips under the input
// (M24Shell.tsx, R67 A-02). Measured by joining projexa's MODULE_CATALOGUE
// against ALL_FUNCTION_SPECS in ../pipeline/function-registry.ts:
//
//     39 modules advertise at least one sentence
//     14 have a registered function on their subject   (28 sentences)
//     25 have NONE                                     (50 sentences)
//
// So half of what the product invites a user to type, it cannot execute. That
// is not by itself a defect -- gapAnswer() below exists precisely so a "no" is
// still a useful answer -- but with only six nouns recognised, nineteen of
// those twenty-five modules fell through to "That is not enabled for this
// workspace yet - Open Home", which sends someone who asked about a permit to
// the dashboard.
//
// Every entry below is a module that ADVERTISES a sentence it cannot run, with
// the screen and route taken from that module's own MODULE_CATALOGUE row, so
// the refusal ends on the screen the user was actually asking about. This does
// not close G-23 -- the executors are still missing, and that is the real fix
// -- it stops the gap being answered with a shrug.
//
// ORDER IS SIGNIFICANT: find() returns the FIRST match, so a more specific
// phrase must precede a noun that also appears inside it. "purchase order"
// stays above "order", "site diary" above "site", "bill of quantities" above
// "bill".
const GAP_CAPABILITIES: ReadonlyArray<{ match: RegExp; noun: string; screen: string; route: string }> = [
  // Multi-word phrases first -- see ORDER IS SIGNIFICANT above.
  { match: /\bpurchase orders?\b|\bpos?\b/i, noun: "purchase orders", screen: "Purchase Orders", route: "/purchase-orders" },
  { match: /\bsite diary\b|\bsite diaries\b/i, noun: "site diary entries", screen: "Site Diary", route: "/site-diary" },
  { match: /\bpunch (list|item)s?\b|\bsnags?\b/i, noun: "punch items", screen: "Punch List", route: "/punch-list" },
  { match: /\bmood ?boards?\b/i, noun: "mood boards", screen: "Mood Boards", route: "/mood-boards" },
  // Above "materials" on purpose: the advertised sentence is "submit the
  // tile SAMPLE for approval" and never says "submittal", while "sample"
  // reads as material to the entry below.
  { match: /\bsubmittals?\b|\bsamples?\b|\bsubmit\b[^.]*\bapprovals?\b/i, noun: "submittals", screen: "Submittals", route: "/submittals" },
  { match: /\bknowledge base\b|\barticles?\b/i, noun: "knowledge base articles", screen: "Knowledge Base", route: "/knowledge-base" },
  { match: /\bdesign hours?\b|\bdesign studio\b|\bdrafting\b/i, noun: "design studio entries", screen: "Design Studio", route: "/design-studio" },
  { match: /\bff&?e\b|\bfurniture\b/i, noun: "FF&E items", screen: "FF&E", route: "/ffe" },

  // Single nouns.
  { match: /\bcustomers?\b|\bclients?\b/i, noun: "customers", screen: "Customers", route: "/customers" },
  { match: /\bvendors?\b|\bsuppliers?\b/i, noun: "vendors", screen: "Vendors", route: "/vendors" },
  { match: /\binvoices?\b/i, noun: "invoices", screen: "Invoices", route: "/invoices" },
  { match: /\bquotations?\b|\bquotes?\b/i, noun: "quotations", screen: "Quotations", route: "/quotations" },
  { match: /\bemployees?\b|\bstaff\b/i, noun: "employees", screen: "Employees", route: "/employees" },
  { match: /\bpermits?\b/i, noun: "permits", screen: "Permits", route: "/permits" },
  { match: /\bdrawings?\b|\brevisions? [a-z]\b|\bfloor plans?\b/i, noun: "drawings", screen: "Drawings & 3D", route: "/drawings" },
  { match: /\bmaterials?\b|\bcement\b|\btmt\b/i, noun: "materials", screen: "Material", route: "/materials" },
  { match: /\bjournal entr(y|ies)\b|\btrial balance\b|\bledger\b/i, noun: "accounting entries", screen: "Accounting", route: "/accounting" },
  { match: /\bprocurements?\b/i, noun: "procurement records", screen: "Procurement", route: "/procurement" },
  { match: /\binventor(y|ies)\b|\bwarehouses?\b|\bon hand\b/i, noun: "inventory", screen: "Inventory", route: "/inventory" },
  { match: /\bexpenses?\b|\bclaims?\b|\breimburse/i, noun: "expenses", screen: "Expenses", route: "/expenses" },
  { match: /\bpayrolls?\b|\bsalar(y|ies)\b/i, noun: "payroll", screen: "Payroll", route: "/payroll" },
  { match: /\brecruitments?\b|\bvacanc(y|ies)\b|\bapplications?\b|\binterviews?\b/i, noun: "recruitment records", screen: "Recruitment", route: "/recruitment" },
  { match: /\brfis?\b/i, noun: "RFIs", screen: "RFIs", route: "/rfis" },
  { match: /\bwikis?\b|\bmethod statements?\b/i, noun: "wiki pages", screen: "Wiki", route: "/wiki" },
  { match: /\bmanpower\b|\blabour\b|\blabor\b/i, noun: "manpower records", screen: "Manpower", route: "/labour" },
  { match: /\bpolic(y|ies)\b|\bgovernance\b/i, noun: "governance records", screen: "Governance & Risk", route: "/grc" },
  { match: /\bmargins?\b|\bplanned against actual\b/i, noun: "analysis", screen: "Analysis", route: "/analysis" },
];

const CREATE_VERB = /\b(create|add|new|raise|make|register)\b/i;

/**
 * A GAP is still an answer. "Creating customers from chat is not enabled for
 * this workspace - Open Customers", with the route attached, tells the user
 * exactly where to go; "not available for this account" does not.
 */
export function gapAnswer(text: string): { message: string; route: string } {
  const hit = GAP_CAPABILITIES.find((c) => c.match.test(text));
  if (hit && CREATE_VERB.test(text)) {
    return {
      message: `Creating ${hit.noun} from chat is not enabled for this workspace - Open ${hit.screen}`,
      route: hit.route,
    };
  }
  if (hit) {
    return { message: `That is not enabled for this workspace yet - Open ${hit.screen}`, route: hit.route };
  }
  return { message: "That is not enabled for this workspace yet - Open Home", route: "/dashboard" };
}

/** What is still unanswered, from the function's own declared parameters. */
export function missingParamsFor(functionId: string, params: Record<string, unknown>, projectId: string | null): DryRunMissing[] {
  const spec = functionSpec(functionId);
  const out: DryRunMissing[] = [];
  const declared = spec?.requiredParams ?? [];
  for (const required of declared) {
    const fallback = required.name === "projectId" ? projectId : undefined;
    // R67 B-07: a BOQ line answered with the record id the verdict's own
    // chips carry counts as answered -- see requiredParamSatisfied().
    if (!requiredParamSatisfied(required, params, fallback)) {
      out.push({ name: required.name, label: required.label, code: required.code });
    }
  }
  // A function with no registry entry still gets an honest answer: nothing
  // is claimed to be missing rather than a guessed field list.
  if (!spec) return [];
  return out;
}

function flatten(proposals: DryRunProposal[], telemetry: DryRunTelemetry): DryRunResult {
  const first: DryRunProposal = proposals[0] ?? {
    segmentText: "",
    status: "chat",
    verdict: "chat",
    kind: "ask",
    functionId: null,
    label: null,
    params: {},
    missing: [],
    chain: null,
  };
  const { segmentText: _segmentText, ...rest } = first;
  // `telemetry` last: `rest` is a DryRunProposal and carries no such key, but
  // the ordering makes it impossible for a future proposal field to shadow it.
  return { dryRun: true, proposals, ...rest, telemetry };
}

/**
 * Resolve and PROPOSE. Mints nothing, executes no write, and returns the
 * derived chain for every verdict so the client can print
 * "Understood: <chain>" before anything happens.
 */
export async function dryRunSubmission(input: DryRunInput, deps: DryRunDeps): Promise<DryRunResult> {
  const { segments } = segment(input.rawInput);
  if (segments.length === 0) {
    // Nothing was said, so nothing was asked of the model: "not_needed", never
    // "refused" -- see DryRunTelemetry.
    return flatten([], { segments: 0, resolved: 0, l0Hits: 0, modelCalls: 0, cacheHits: 0, fuzzyHits: 0, level1Outcome: "not_needed", level1RefusalReason: null });
  }

  const l0 = await Promise.all(segments.map((s) => classifyL0(s.text, { orgId: input.orgId, userId: input.userId }, deps.l0Repo)));
  const missIndices = l0.map((r, i) => (r.kind === "miss" ? i : -1)).filter((i) => i >= 0);
  // A MODEL REFUSAL IS NOT AN ERROR HERE. runLevel1() calls
  // assertAiProviderAllowed(), which THROWS for any caller the provider is
  // not configured to serve -- and before this, that exception escaped the
  // whole pipeline and reached the user as a 400 carrying the refusal
  // sentence and no next step, which is exactly the R66 defect B-05 exists
  // to remove. A refusal means "nothing was resolved", which the loop below
  // already knows how to answer: a GAP verdict with a real destination.
  let resolutions: (ResolvedFunction | null)[] = [];
  // PER-INVOCATION LOCALS, DELIBERATELY. run-submission.ts:331 keeps its
  // equivalent counter in a module-level `let` reset at the top of each call,
  // which stops being per-request-safe the moment two submissions overlap.
  // That pattern is not extended here.
  let modelCalls = 0;
  let cacheHits = 0;
  let fuzzyHits = 0;
  let level1Outcome: DryRunTelemetry["level1Outcome"] = "not_needed";
  let level1RefusalReason: string | null = null;
  // No L0 miss means the Level 1 lane is never entered at all --
  // resolveMissesWithReuseCache() returns all-zeros for an empty input, so
  // skipping it is behaviour-identical, and "not_needed" stays true rather than
  // being overwritten with "resolved".
  if (missIndices.length > 0) {
    try {
      const level1 = await resolveMissesWithReuseCache(
        missIndices.map((i) => segments[i].text),
        {
          orgId: input.orgId,
          userId: input.userId,
          projectId: input.projectId ?? null,
          candidateFunctionIds: input.candidateFunctionIds,
        },
        deps.reuseRepo,
        undefined,
        undefined,
        // P1.2/P1.3: the trigram fuzzy tier reads the classification-time
        // similarity signal here, at the same L0-miss -> Level-1 boundary
        // reuse_cache already occupies -- see phrase-fuzzy.ts's own header.
        // Injected via deps (same testability seam as reuseRepo/l0Repo) --
        // undefined for every existing test fixture, a real DB-backed repo
        // from makeDryRunDeps() in production.
        deps.fuzzyRepo
      );
      resolutions = level1.resolutions;
      // The two numbers this line used to drop on the floor.
      modelCalls = level1.modelCalls;
      cacheHits = level1.cacheHits;
      fuzzyHits = level1.fuzzyHits;
      level1Outcome = "resolved";
    } catch (error) {
      // A REFUSAL IS NOT AN OUTAGE, AND NEITHER IS A SUCCESS.
      // assertAiProviderAllowed() throws AiProviderRefusalError before any model
      // work when the configured provider may not serve this caller; anything
      // else reaching here is a genuine fault. Recording both as one boolean --
      // or as silence -- makes "the AI is switched off" indistinguishable from
      // "software answered everything", which is precisely the misreading this
      // telemetry exists to prevent.
      modelCalls = 0;
      cacheHits = 0;
      fuzzyHits = 0;
      level1Outcome = error instanceof AiProviderRefusalError ? "refused" : "error";
      level1RefusalReason = error instanceof Error ? error.message : String(error);
      console.warn(
        `[pipeline] dry run: Level 1 ${level1Outcome} (${level1RefusalReason}), answering from Level 0 only:`,
        error
      );
    }
  }

  const proposals: DryRunProposal[] = [];
  // THE SAME RULE classify-only.ts:117-120 APPLIES, copied verbatim rather than
  // approximated. Two engines answering the same question with two different
  // arithmetics is how a measurement stops being a measurement.
  let resolvedCount = 0;
  let l0Hits = 0;
  for (let i = 0; i < segments.length; i++) {
    const text = segments[i].text;
    const hit = l0[i];
    const resolution =
      hit.kind === "match"
        ? { functionId: hit.functionId, params: hit.params, source: hit.source, level: 0 as const }
        : hit.kind === "miss"
          ? (resolutions[missIndices.indexOf(i)] ?? null)
          : null;

    const classification = classifySegment({
      text,
      resolution,
      nature: resolution ? { writes: functionWrites(resolution.functionId) } : null,
    });

    if (classification.verdict !== "gap") {
      resolvedCount++;
      if (classification.level === 0) l0Hits++;
    }

    if (classification.verdict === "gap" || !classification.functionId) {
      if (classification.verdict === "gap") {
        const gap = gapAnswer(text);
        proposals.push({
          segmentText: text,
          status: "gap",
          verdict: "gap",
          kind: "ask",
          functionId: null,
          label: null,
          params: {},
          missing: [],
          chain: null,
          message: gap.message,
          route: gap.route,
        });
      } else {
        proposals.push({
          segmentText: text,
          status: "chat",
          verdict: classification.verdict,
          kind: "ask",
          functionId: null,
          label: null,
          params: {},
          missing: [],
          chain: null,
        });
      }
      continue;
    }

    const functionId = classification.functionId;
    const params: Record<string, unknown> = { ...classification.params };
    if (input.projectId && params.projectId === undefined && functionSpec(functionId)?.requiresProject) {
      params.projectId = input.projectId;
    }
    const chain = await deriveChain(deps.chainRepo, {
      mode: input.mode,
      rootLabel: deps.rootLabel,
      functionId,
      params,
    });
    const kind = functionKind(functionId);
    const spec = functionSpec(functionId);

    const missing = missingParamsFor(functionId, params, input.projectId ?? null);
    // Real chips, not "please retype it". The BOQ level is the one that
    // actually bit users in R66 ("record 50% on excavation" -> a blocked task
    // naming a line the project does not have), so it is the one that gets
    // its options resolved here.
    for (const m of missing) {
      if ((m.code === "BOQ_LINE_REQUIRED" || m.name === "itemCode") && input.projectId) {
        m.options = await deps.boqLineOptions(input.projectId);
      }
    }

    if (missing.length > 0) {
      proposals.push({
        segmentText: text,
        status: "needs_input",
        verdict: classification.verdict,
        kind,
        functionId,
        label: functionLabel(functionId),
        params,
        missing,
        chain,
        schema: spec?.card,
      });
      continue;
    }

    if (kind === "run") {
      proposals.push({
        segmentText: text,
        status: "ready",
        verdict: classification.verdict,
        kind,
        functionId,
        label: functionLabel(functionId),
        params,
        missing: [],
        chain,
        route: buildRunRoute(spec?.route, params),
      });
      continue;
    }

    if (kind === "ask") {
      // THE ASK PATH IS DETERMINISTIC. It answers from the records through
      // the read executors that already exist; the model was only ever going
      // to add commentary on top, so its absence costs a sentence, not the
      // answer.
      const outcome = await deps.runRead({
        orgId: input.orgId,
        userId: input.userId,
        projectId: (typeof params.projectId === "string" ? params.projectId : null) ?? input.projectId ?? null,
        functionId,
        params,
        role: input.role,
        // R67 FIX PASS: the project's name, so a read that fails on a BOQ
        // line gets the same sentence the write path does.
        projectLabel: deps.rootLabel,
      });
      if (!outcome.success) {
        proposals.push({
          segmentText: text,
          status: "needs_input",
          verdict: classification.verdict,
          kind,
          functionId,
          label: functionLabel(functionId),
          params,
          missing: [
            {
              name: outcome.failure.missing[0] ?? "value",
              label: labelForParam(functionId, outcome.failure.missing[0]),
              code: outcome.failure.code,
            },
          ],
          chain,
        });
        continue;
      }
      proposals.push({
        segmentText: text,
        status: "answered",
        verdict: classification.verdict,
        kind,
        functionId,
        label: functionLabel(functionId),
        params,
        missing: [],
        chain,
        answer: {
          rows: outcome.result,
          text: deps.providerAvailable() ? null : NO_COMMENTARY_SENTENCE,
          chain: chain.full,
        },
      });
      continue;
    }

    proposals.push({
      segmentText: text,
      status: "ready",
      verdict: classification.verdict,
      kind,
      functionId,
      label: functionLabel(functionId),
      params,
      missing: [],
      chain,
      schema: spec?.card,
    });
  }

  return flatten(proposals, {
    segments: segments.length,
    resolved: resolvedCount,
    l0Hits,
    modelCalls,
    cacheHits,
    fuzzyHits,
    level1Outcome,
    level1RefusalReason,
  });
}

function labelForParam(functionId: string, name: string | undefined): string {
  if (!name) return "Value";
  const spec = functionSpec(functionId);
  const declared = spec?.requiredParams.find((p) => p.name === name);
  if (declared) return declared.label;
  // Fall back to the vocabulary, never to the camelCase parameter itself.
  return codeForParam(name) === "PROJECT_REQUIRED" ? "Project" : "Value";
}

/**
 * A COMMAND verb answers with a route that already carries its parameters.
 * Exported for its own sibling test: reaching it only through
 * dryRunSubmission() would mean testing the URL builder through a DB-backed
 * wrapper, which proves less and costs more.
 */
export function buildRunRoute(route: string | undefined, params: Record<string, unknown>): string {
  if (!route) return "/dashboard";
  const [base, existing] = route.split("?");
  const search = new URLSearchParams(existing ?? "");
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}
