// PROJEXA-BUILD-002 WP-05d (register row AW-304) -- record_material_issue, create_material, void_material_receipt and
// get_material_cost_report.
//
// They wrap construction-materials-service.ts (createMaterialIssue, createMaterial, voidMaterialReceipt, getMaterialCostReport), the
// service PROJEXA's site materials routes call. record_material_receipt is already in executor.ts (U-38) and is not touched.
//   - record_material_issue takes stock out of the site store. The service refuses an issue above what is on hand (400) and records
//     the person in createdById. The material and the BOQ line it is booked against are held to the task's project first (the service
//     finds the material by id and organisation only and stores the line id as given, with no check at all);
//   - create_material adds a material to the project's list. The project is checked (the service does not), and a second material with
//     the same name on the project is refused (ALREADY_RECORDED), because the table has no unique key and a retried call would
//     otherwise make a duplicate. The unit cost is money: it is null in the answer below the manager rank;
//   - void_material_receipt reverses a ledger row: a soft void that keeps the row, the reason and the person. Manager rank; the receipt
//     is held to the project first, and a receipt that is already void is refused by the service (409);
//   - get_material_cost_report reads the project's receipts (voided ones excluded) grouped by material or by vendor. Manager rank: it
//     states costs.
import { and, eq } from "drizzle-orm";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { constructionMaterials } from "@/lib/db/schema";
import { createMaterial, createMaterialIssue, getMaterialCostReport, voidMaterialReceipt } from "@/lib/services/construction-materials-service";
import { pipelineFailure } from "../error-codes";
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import { created, RANK_MANAGER, RANK_MEMBER, refuse } from "./common";
import {
  bad,
  BAD,
  boqLineInProject,
  guarded,
  needDate,
  needText,
  notFound,
  ok,
  optDate,
  optNumber,
  optOneOf,
  optText,
  projectExists,
  recordInProject,
  withholdFields,
} from "./record-scope";

export async function executeRecordMaterialIssue(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId, actorId }) => {
    const materialId = needText(task, "materialId");
    if (materialId === BAD) return bad(task, "materialId");
    const quantity = optNumber(task, "quantity");
    if (quantity === BAD || quantity === undefined || quantity <= 0) return bad(task, "quantity");
    const issuedDate = needDate(task, "issuedDate");
    if (issuedDate === BAD) return bad(task, "issuedDate");
    const boqLineItemId = optText(task, "boqLineItemId");
    if (boqLineItemId === BAD) return bad(task, "boqLineItemId");
    const issuedTo = optText(task, "issuedTo");
    if (issuedTo === BAD) return bad(task, "issuedTo");
    const note = optText(task, "note");
    if (note === BAD) return bad(task, "note");

    if (!(await recordInProject(task, "material", materialId, projectId))) return notFound(task, "materialId");
    if (boqLineItemId !== undefined && !(await boqLineInProject(task, boqLineItemId, projectId))) return notFound(task, "boqLineItemId");

    const row = await createMaterialIssue({ orgId: task.orgId }, { projectId, materialId, issuedDate, quantity, boqLineItemId, issuedTo, note, createdById: actorId });
    return created(row.id, "/materials", row);
  });
}

/** True when an active material of this project already has the name (compared without case or edge spaces). */
async function materialNameTaken(task: ExecutableTask, projectId: string, name: string): Promise<boolean> {
  const rows = await withTenantContext({ orgId: task.orgId, userId: task.userId }, (db) =>
    db.query.constructionMaterials.findMany({
      where: and(eq(constructionMaterials.orgId, task.orgId), eq(constructionMaterials.projectId, projectId), eq(constructionMaterials.isActive, true)),
      columns: { name: true },
    })
  );
  const wanted = name.trim().toLowerCase();
  return rows.some((r) => r.name.trim().toLowerCase() === wanted);
}

export async function executeCreateMaterial(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId }) => {
    const name = needText(task, "name");
    if (name === BAD) return bad(task, "name");
    const unit = needText(task, "unit");
    if (unit === BAD) return bad(task, "unit");
    const spec = optText(task, "spec");
    if (spec === BAD) return bad(task, "spec");
    const unitCost = optNumber(task, "unitCost");
    if (unitCost === BAD) return bad(task, "unitCost");
    const reorderLevel = optNumber(task, "reorderLevel");
    if (reorderLevel === BAD) return bad(task, "reorderLevel");

    if (!(await projectExists(task, projectId))) return notFound(task, "projectId");
    if (await materialNameTaken(task, projectId, name)) {
      return refuse(pipelineFailure("ALREADY_RECORDED", [], { status: 409, functionId: task.functionId, param: "name" }));
    }
    const row = await createMaterial({ orgId: task.orgId }, { projectId, name, unit, spec, unitCost, reorderLevel });
    return created(row.id, "/materials", withholdFields(task, row, ["unitCost"]));
  });
}

export async function executeVoidMaterialReceipt(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MANAGER }, async ({ projectId, actorId }) => {
    const receiptId = needText(task, "receiptId");
    if (receiptId === BAD) return bad(task, "receiptId");
    const reason = needText(task, "reason");
    if (reason === BAD) return bad(task, "reason");
    if (!(await recordInProject(task, "material_receipt", receiptId, projectId))) return notFound(task, "receiptId");

    const row = await voidMaterialReceipt({ orgId: task.orgId }, receiptId, { voidReason: reason, voidedBy: actorId });
    return created(row.id, "/materials", row);
  });
}

export async function executeGetMaterialCostReport(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: false, minRank: RANK_MANAGER }, async ({ projectId }) => {
    const from = optDate(task, "from");
    if (from === BAD) return bad(task, "from");
    const to = optDate(task, "to");
    if (to === BAD) return bad(task, "to");
    const groupBy = optOneOf(task, "groupBy", ["material", "vendor"]);
    if (groupBy === BAD) return bad(task, "groupBy");
    const report = await getMaterialCostReport({ orgId: task.orgId }, projectId, { from, to, groupBy: groupBy as "material" | "vendor" | undefined });
    return ok(report);
  });
}
