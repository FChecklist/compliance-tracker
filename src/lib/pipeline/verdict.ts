// R67 lane B (B-07) -- THE SUBMISSION VERDICT.
//
// POST /api/v1/projexa/tasks used to resolve everything and then execute
// everything in one shot (run-submission.ts's own header explains why that
// order exists). The cost of that shape is the defect the R66 walkthrough
// recorded eleven times over: a parameter the classifier could not fill
// became a compliance.pipeline_tasks row with status 'blocked' and an
// English reason. The user was told AFTERWARDS, in prose, about a task they
// never agreed to mint -- and the Home badge counted it.
//
// B-07 answers synchronously instead:
//
//   POST {rawInput}                     -> a VERDICT. Nothing is minted.
//   POST {confirm:true, submissionId}   -> now it runs.
//
// This file is the PURE half: it turns a dry-run proposal (dry-run.ts, which
// already does the classification with every dependency injected) into the
// verdict envelope the client renders. No DB, no model, no I/O -- so every
// branch of the contract is provable without either.
import type { DryRunAnswer, DryRunMissing, DryRunProposal, DryRunResult } from "./dry-run";
import type { PipelineErrorCode } from "./error-codes";
import type { CardSchema } from "./function-registry";

/** M25's per-segment verdict, unchanged -- never one verdict for a whole message. */
export type VerdictKind = "task" | "chat" | "gap";

export type VerdictOption = { id: string; label: string };

/**
 * One thing the user still has to answer.
 *
 *   name  -- THE PARAMETER THE CLIENT POSTS BACK on confirm.
 *   field -- the D-03 vocabulary key, which is what the projexa dictionary
 *            keys its Fix chain off (project | boqLine | value | worker |
 *            material | task | date | boqVersion). Never a camelCase name on
 *            any surface a user can read.
 */
export type VerdictMissing = {
  name: string;
  field: string;
  label: string;
  code: PipelineErrorCode;
  options?: VerdictOption[];
};

export type VerdictLink = { label: string; route: string };

export type SubmissionVerdict = {
  verdict: VerdictKind;
  /** ready | needs_input | answered | gap | chat -- see DryRunProposal. */
  status: DryRunProposal["status"];
  /** What the server understood. `label` is a human name, never a function id. */
  understood: {
    functionId: string;
    label: string;
    projectId: string | null;
    params: Record<string, unknown>;
  } | null;
  missing: VerdictMissing[];
  answer?: DryRunAnswer;
  links?: VerdictLink[];
  /** The derived chain, rendered, so the client can print "Understood: <chain>". */
  chain: string | null;
  schema?: CardSchema;
  /** The sentence for a GAP -- the only closed sentence the server still owns. */
  message?: string;
  /** true when POST {confirm:true, submissionId} will actually execute this. */
  confirmable: boolean;
};

export type SubmissionVerdictResult = SubmissionVerdict & {
  submissionId: string | null;
  /** one verdict per segment; the top level flattens the first, as M25 requires the client not collapse them. */
  verdicts: SubmissionVerdict[];
};

/**
 * The D-03 field vocabulary, by the parameter that carries it. A parameter
 * with no entry keeps its own name -- honest, and the client's dictionary
 * renders from `code` anyway, so an unmapped field never reaches a screen.
 */
const FIELD_BY_PARAM: Readonly<Record<string, string>> = {
  projectId: "project",
  itemCode: "boqLine",
  boqLineItemId: "boqLine",
  boqId: "boqVersion",
  percent: "value",
  percentComplete: "value",
  quantity: "value",
  quantityDone: "value",
  dailyRate: "value",
  hours: "value",
  date: "date",
  entryDate: "date",
  attendanceDate: "date",
  scheduledAt: "date",
  rosterId: "worker",
  name: "worker",
  itemId: "material",
  materialId: "material",
  issueId: "task",
  taskId: "task",
  activityId: "task",
};

/**
 * THE ONE PLACE THE BOQ LINE CHANGES NAME.
 *
 * The classifier extracts a human ITEM CODE from what the user typed ("EX-01"
 * out of "record 50% on EX-01"), which is why dry-run.ts's proposal asks for
 * `itemCode`. The verdict, by contrast, offers the project's REAL BOQ LINES as
 * chips -- so what comes back is a line item id, not a code the user retyped.
 * executor.ts accepts either (see executeRecordWorkProgress), and this is the
 * single conversion point rather than a rule sprinkled across both.
 */
function toVerdictMissing(m: DryRunMissing): VerdictMissing {
  const options = m.options?.map((o) => ({ id: o.lineItemId ?? o.id, label: o.label }));
  if (m.code === "BOQ_LINE_REQUIRED") {
    return { name: "boqLineItemId", field: "boqLine", label: m.label, code: m.code, ...(options ? { options } : {}) };
  }
  return {
    name: m.name,
    field: FIELD_BY_PARAM[m.name] ?? m.name,
    label: m.label,
    code: m.code,
    ...(options ? { options } : {}),
  };
}

export function toVerdict(p: DryRunProposal): SubmissionVerdict {
  const understood = p.functionId
    ? {
        functionId: p.functionId,
        label: p.label ?? p.functionId,
        projectId: typeof p.params.projectId === "string" ? p.params.projectId : null,
        params: p.params,
      }
    : null;

  const links: VerdictLink[] = [];
  if (p.route) {
    // A GAP's own sentence already ends in its destination ("... - Open
    // Customers"); a COMMAND verb's route is the screen that does the thing.
    links.push({ label: p.status === "gap" ? gapLinkLabel(p.message) : `Open ${p.label ?? "it"}`, route: p.route });
  }

  return {
    verdict: p.verdict,
    status: p.status,
    understood,
    missing: p.missing.map(toVerdictMissing),
    ...(p.answer ? { answer: p.answer } : {}),
    ...(links.length > 0 ? { links } : {}),
    chain: p.chain?.full ?? null,
    ...(p.schema ? { schema: p.schema } : {}),
    ...(p.message ? { message: p.message } : {}),
    // ONLY a fully-resolved write is confirmable. An `answered` read already
    // ran (it recorded nothing), a gap has nothing to run, and needs_input is
    // by definition not ready.
    confirmable: p.status === "ready" && p.verdict === "task",
  };
}

/** "Creating customers from chat is not enabled ... - Open Customers" -> "Open Customers". */
function gapLinkLabel(message: string | undefined): string {
  if (!message) return "Open";
  const tail = message.split(" - ").pop()?.trim();
  return tail && tail.startsWith("Open ") ? tail : "Open";
}

const EMPTY: SubmissionVerdict = {
  verdict: "chat",
  status: "chat",
  understood: null,
  missing: [],
  chain: null,
  confirmable: false,
};

export function toVerdictResult(result: DryRunResult, submissionId: string | null): SubmissionVerdictResult {
  const verdicts = result.proposals.map(toVerdict);
  // M25: the verdict is PER SEGMENT. The flattened top level is a convenience
  // for the common one-segment message; `verdicts` is the authority and the
  // client must not collapse it.
  const first = verdicts[0] ?? EMPTY;
  return { ...first, submissionId, verdicts };
}
