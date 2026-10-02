// lf-b2-ai-crud (owner order 2026-10-02, requirements R5-R7) -- the BOQ and progress changes an AI could not make: update_boq,
// delete_boq, update_boq_line_amounts and delete_progress_entry.
//
// Each wraps the service the matching app route calls (construction-boq-service.ts updateBoq, deleteBoq, updateLineItemMoneyFields;
// construction-progress-service.ts deleteProgressEntry). No second write path, and no rule of the service is relaxed:
//   - update_boq renames a BOQ (title only). A superseded or already revised BOQ is refused by the service (409). Level 1, member rank,
//     like PATCH /api/v1/construction/boq/{id};
//   - delete_boq is the service's own delete: a DRAFT BOQ only (submitted and approved BOQs are real scope and are revised, never
//     deleted), and it removes the BOQ's lines and the progress entries recorded against them. It is a hard delete today. Level 2 (a draft
//     the person confirms) at the manager rank, like DELETE /api/v1/construction/boq/{id};
//   - update_boq_line_amounts changes a line's project-side and contract-side quantity and rate. The contract side of a confirmed BOQ is
//     locked by the service (409). Money: level 2 at the manager rank (stricter than the route's member: a line's rate is hidden below the
//     manager rank on every read, so a member's AI must not write what the member cannot read);
//   - delete_progress_entry removes one entry and rolls the linked task's completion back (the service). Level 2, member rank, like
//     DELETE /api/v1/construction/progress/{id}.
// The BOQ, the line and the entry must be of THIS project (the services find them by id and organisation only).
// Tests: src/lib/pipeline/coverage-crud-b2.test.ts.
import { deleteBoq, updateBoq, updateLineItemMoneyFields } from "@/lib/services/construction-boq-service";
import { deleteProgressEntry } from "@/lib/services/construction-progress-service";
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import { created, RANK_MANAGER, RANK_MEMBER } from "./common";
import { bad, BAD, boqLineInProject, guarded, needText, notFound, recordInProject as fieldRecordInProject } from "./record-scope";
import { recordInProject } from "./scope";
import { needClean } from "./wave79-scope";

export async function executeUpdateBoq(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId }) => {
    const boqId = needText(task, "boqId");
    if (boqId === BAD) return bad(task, "boqId");
    const title = needClean(task, "title");
    if (title === BAD) return bad(task, "title");
    if (!(await recordInProject(task, "boq", boqId, projectId))) return notFound(task, "boqId");
    const row = await updateBoq({ orgId: task.orgId }, boqId, { title });
    return created(row.id, `/scope/${row.id}`, { id: row.id, title: row.title, version: row.version, status: row.status, projectId: row.projectId });
  });
}

export async function executeDeleteBoq(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MANAGER }, async ({ projectId }) => {
    const boqId = needText(task, "boqId");
    if (boqId === BAD) return bad(task, "boqId");
    if (!(await recordInProject(task, "boq", boqId, projectId))) return notFound(task, "boqId");
    // deleteBoq() refuses anything but a draft (400) and removes the lines and their progress entries in the same transaction.
    const result = await deleteBoq({ orgId: task.orgId }, boqId);
    return created(boqId, "/scope", result);
  });
}

type LineAmounts = { qtyProject?: number | null; rateProject?: number | null; qtyContract?: number | null; rateContract?: number | null };
const AMOUNT_KEYS = ["qtyProject", "rateProject", "qtyContract", "rateContract"] as const;

/** Each amount: absent is left alone, null clears it, a finite number (or a string that is one) sets it. Anything else is BAD. */
function readAmounts(task: ExecutableTask): LineAmounts | typeof BAD {
  const out: LineAmounts = {};
  for (const key of AMOUNT_KEYS) {
    const v = task.params[key];
    if (v === undefined) continue;
    if (v === null) {
      out[key] = null;
      continue;
    }
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    if (!Number.isFinite(n)) return BAD;
    out[key] = n;
  }
  return out;
}

export async function executeUpdateBoqLineAmounts(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MANAGER }, async ({ projectId }) => {
    const lineItemId = needText(task, "lineItemId");
    if (lineItemId === BAD) return bad(task, "lineItemId");
    const amounts = readAmounts(task);
    if (amounts === BAD) return bad(task, "amount");
    if (Object.keys(amounts).length === 0) return bad(task, "empty_patch");
    if (!(await boqLineInProject(task, lineItemId, projectId))) return notFound(task, "lineItemId");
    // The service refuses a negative quantity (400) and a contract-side change on a confirmed BOQ (409).
    const row = await updateLineItemMoneyFields({ orgId: task.orgId }, lineItemId, amounts);
    return created(row.id, `/scope/${row.boqId}`, row);
  });
}

export async function executeDeleteProgressEntry(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId }) => {
    const entryId = needText(task, "entryId");
    if (entryId === BAD) return bad(task, "entryId");
    if (!(await fieldRecordInProject(task, "progress_entry", entryId, projectId))) return notFound(task, "entryId");
    const result = await deleteProgressEntry({ orgId: task.orgId }, entryId);
    return created(entryId, "/progress", result);
  });
}
