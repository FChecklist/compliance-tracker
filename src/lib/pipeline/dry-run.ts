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
import { deriveChain, type ChainRepo, type DerivedChain } from "./derive-chain";
import { functionWrites, type ExecutableTask, type ExecutionOutcome } from "./executor";
import { functionKind, functionLabel, functionSpec, type CardSchema, type FunctionKind } from "./function-registry";
import { codeForParam, type PipelineErrorCode } from "./error-codes";
import { NO_COMMENTARY_SENTENCE } from "@/lib/ai/refusal";

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

export type DryRunResult = { dryRun: true; proposals: DryRunProposal[] } & Omit<DryRunProposal, "segmentText">;

/** Everything this needs from the outside world. Injected, so it is testable. */
export type DryRunDeps = {
  l0Repo: L0Repo;
  reuseRepo: ReuseCacheRepo;
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
const GAP_CAPABILITIES: ReadonlyArray<{ match: RegExp; noun: string; screen: string; route: string }> = [
  { match: /\bcustomers?\b|\bclients?\b/i, noun: "customers", screen: "Customers", route: "/customers" },
  { match: /\bvendors?\b|\bsuppliers?\b/i, noun: "vendors", screen: "Vendors", route: "/vendors" },
  { match: /\binvoices?\b/i, noun: "invoices", screen: "Invoices", route: "/invoices" },
  { match: /\bquotations?\b|\bquotes?\b/i, noun: "quotations", screen: "Quotations", route: "/quotations" },
  { match: /\bpurchase orders?\b|\bpos?\b/i, noun: "purchase orders", screen: "Purchase Orders", route: "/purchase-orders" },
  { match: /\bemployees?\b|\bstaff\b/i, noun: "employees", screen: "Employees", route: "/employees" },
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
    const value = required.name === "projectId" ? (params.projectId ?? projectId) : params[required.name];
    const empty = value === undefined || value === null || (typeof value === "string" && value.trim().length === 0);
    if (empty) out.push({ name: required.name, label: required.label, code: required.code });
  }
  // A function with no registry entry still gets an honest answer: nothing
  // is claimed to be missing rather than a guessed field list.
  if (!spec) return [];
  return out;
}

function flatten(proposals: DryRunProposal[]): DryRunResult {
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
  return { dryRun: true, proposals, ...rest };
}

/**
 * Resolve and PROPOSE. Mints nothing, executes no write, and returns the
 * derived chain for every verdict so the client can print
 * "Understood: <chain>" before anything happens.
 */
export async function dryRunSubmission(input: DryRunInput, deps: DryRunDeps): Promise<DryRunResult> {
  const { segments } = segment(input.rawInput);
  if (segments.length === 0) return flatten([]);

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
  try {
    const level1 = await resolveMissesWithReuseCache(
      missIndices.map((i) => segments[i].text),
      {
        orgId: input.orgId,
        userId: input.userId,
        projectId: input.projectId ?? null,
        candidateFunctionIds: input.candidateFunctionIds,
      },
      deps.reuseRepo
    );
    resolutions = level1.resolutions;
  } catch (error) {
    console.warn("[pipeline] dry run: Level 1 unavailable, answering from Level 0 only:", error);
  }

  const proposals: DryRunProposal[] = [];
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

  return flatten(proposals);
}

function labelForParam(functionId: string, name: string | undefined): string {
  if (!name) return "Value";
  const spec = functionSpec(functionId);
  const declared = spec?.requiredParams.find((p) => p.name === name);
  if (declared) return declared.label;
  // Fall back to the vocabulary, never to the camelCase parameter itself.
  return codeForParam(name) === "PROJECT_REQUIRED" ? "Project" : "Value";
}

/** A COMMAND verb answers with a route that already carries its parameters. */
function buildRunRoute(route: string | undefined, params: Record<string, unknown>): string {
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
