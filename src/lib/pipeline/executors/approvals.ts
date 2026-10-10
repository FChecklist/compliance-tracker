// PROJEXA-BUILD-002 WP-05h (register row AW-308, wave 7) -- "submit for approval" and KPI entries as DRAFTS the person confirms:
// submit_change_order_for_approval, submit_boq_for_approval, submit_kpi_entry and approve_kpi_entry.
//
// Each wraps the service PROJEXA's own route calls: construction-change-order-service.ts (submitChangeOrderForApproval, the e-signature request),
// construction-boq-service.ts (submitBoq) and construction-kpi-service.ts (submitKpiEntry, approveKpiEntry). No second write path.
//
// All four are level 2 on a link: the person confirms signed in, and no function here records an approval on its own. Submitting sends work to
// the people who decide; approve_kpi_entry is a decision, so it is a draft and needs the manager rank (the route asks for it too). What an
// approval MEANS for a change order or a BOQ stays with the person: there is no executor that approves a BOQ, or that marks a change order
// approved or rejected (the only real approval of a change order is the signers' own e-signature).
//
// Rules, each with a test in src/lib/pipeline/coverage-wave7.test.ts:
//   - the change order, the BOQ, the KPI definition and the KPI entry are held to the task's project; an organisation-wide KPI (no project) is
//     no project's, so a link cannot submit a value against it;
//   - submit_change_order_for_approval creates an e-signature request for the named signers, EXTERNAL people whose names and e-mail addresses
//     are then stored: each signer must be a name and a well-formed e-mail address, at most 10 signers, no address twice. The acting person is
//     the requester (the service wants their user row); the request id is not returned with any signing token;
//   - submit_boq_for_approval moves a draft BOQ to submitted; for a revision the service also starts a comparison with the BOQ before it and may
//     fire an automation rule (the exec bundle stubs the rule trigger). A BOQ that is not a draft is the service's own 400;
//   - a KPI's value is money until the owner says otherwise (spec U-13): the value is null in the answer below the manager rank;
//   - the submitter cannot approve their own KPI entry: the service's 403 reaches the caller.
import { approveKpiEntry, submitKpiEntry } from "@/lib/services/construction-kpi-service";
import { submitChangeOrderForApproval } from "@/lib/services/construction-change-order-service";
import { submitBoq } from "@/lib/services/construction-boq-service";
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import { created, RANK_MANAGER, RANK_MEMBER } from "./common";
import { bad, BAD, guarded, needText, notFound, withholdFields } from "./record-scope";
import { cleanOneText, recordInProject } from "./scope";
import { listParam, loadActor, needClean, optRange, recordOfProject } from "./wave79-scope";

const MAX_SIGNERS = 10;
const MAX_SIGNER_NAME = 200;
const MAX_EMAIL = 254;
// One local part, one @, a dotted domain: no spaces, no angle brackets, no list separators. A well-formed address, not a proof that it exists.
const EMAIL = /^[^\s@<>(),;:"\\[\]]+@[^\s@<>(),;:"\\[\]]+\.[^\s@<>(),;:"\\[\]]{2,}$/;

type Signer = { name: string; email: string; order?: number };

/** The signers of a change order: names cleaned, addresses well formed and different, at most 10. BAD for anything else. */
function readSigners(task: ExecutableTask): Signer[] | typeof BAD {
  const list = listParam(task, "signers", MAX_SIGNERS);
  if (list === undefined || list === BAD) return BAD;
  const out: Signer[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return BAD;
    const item = entry as Record<string, unknown>;
    const cleaned = cleanOneText(item.name);
    if (!cleaned.ok || cleaned.text === undefined || cleaned.text.length > MAX_SIGNER_NAME) return BAD;
    const name = cleaned.text;
    const email = typeof item.email === "string" ? item.email.trim().toLowerCase() : "";
    if (email.length === 0 || email.length > MAX_EMAIL || !EMAIL.test(email) || seen.has(email)) return BAD;
    seen.add(email);
    const order = item.order;
    if (order !== undefined && order !== null && !(typeof order === "number" && Number.isInteger(order) && order >= 1 && order <= MAX_SIGNERS)) return BAD;
    out.push(typeof order === "number" ? { name, email, order } : { name, email });
  }
  return out;
}

export async function executeSubmitChangeOrderForApproval(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MANAGER }, async ({ projectId, actorId }) => {
    const changeOrderId = needText(task, "changeOrderId");
    if (changeOrderId === BAD) return bad(task, "changeOrderId");
    const signers = readSigners(task);
    if (signers === BAD) return bad(task, "signers");
    if (!(await recordOfProject(task, "change_order", changeOrderId, projectId))) return notFound(task, "changeOrderId");
    const built = await loadActor(task, actorId);
    if ("failure" in built) return built.failure;
    const row = await submitChangeOrderForApproval({ orgId: task.orgId, userId: built.actor.id, dbUser: built.actor }, changeOrderId, signers);
    return created(row.id, `/change-orders/${row.id}`, row);
  });
}

export async function executeSubmitBoqForApproval(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MANAGER }, async ({ projectId }) => {
    const boqId = needText(task, "boqId");
    if (boqId === BAD) return bad(task, "boqId");
    if (!(await recordInProject(task, "boq", boqId, projectId))) return notFound(task, "boqId");
    const row = await submitBoq({ orgId: task.orgId }, boqId);
    return created(row.id, `/scope/${row.id}`, row);
  });
}

export async function executeSubmitKpiEntry(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId, actorId }) => {
    const kpiDefinitionId = needText(task, "kpiDefinitionId");
    if (kpiDefinitionId === BAD) return bad(task, "kpiDefinitionId");
    const period = needClean(task, "period");
    if (period === BAD || period.length > 40) return bad(task, "period");
    const actualValue = optRange(task, "actualValue", -1e12, 1e12);
    if (actualValue === BAD || actualValue === undefined) return bad(task, "actualValue");
    if (!(await recordOfProject(task, "kpi_definition", kpiDefinitionId, projectId))) return notFound(task, "kpiDefinitionId");
    const row = await submitKpiEntry({ orgId: task.orgId, userId: actorId }, { kpiDefinitionId, period, actualValue });
    return created(row.id, "/kpis", withholdFields(task, row, ["actualValue"]));
  });
}

export async function executeApproveKpiEntry(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MANAGER }, async ({ projectId, actorId }) => {
    const entryId = needText(task, "entryId");
    if (entryId === BAD) return bad(task, "entryId");
    if (!(await recordOfProject(task, "kpi_entry", entryId, projectId))) return notFound(task, "entryId");
    const row = await approveKpiEntry({ orgId: task.orgId, userId: actorId }, entryId);
    return created(row.id, "/kpis", row);
  });
}
