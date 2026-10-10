// lf-b2-ai-crud GROUP 3 -- update_permit, delete_permit and archive_project.
//
//   - update_permit and delete_permit run permit-service.ts, the write path PATCH and DELETE /api/v1/projexa/permits/{id} now share (it used to be
//     inline in the route). Member rank, like the route. A delete is a draft the person confirms (level 2); the edit is a direct write (level 1).
//     The permit must be a permit of THIS project (the service finds it by id and organisation only).
//   - archive_project sets the project's lifecycle status (construction-dashboard-service.ts updateProjectStatus): "cancelled" or "completed"
//     archives it, "active", "planning" or "paused" brings it back; nothing is deleted. The app has no route that changes a project's status, so the
//     rank is the manager's (the link asks for more, never less) and it is a draft the person confirms. It changes the task's own project only.
// Tests: src/lib/pipeline/coverage-crud-b2-group3.test.ts.
import { deletePermit, updatePermit } from "@/lib/services/permit-service";
import { PROJECT_STATUSES, updateProjectStatus } from "@/lib/services/construction-dashboard-service";
import { bustProjectDashboardCache } from "@/lib/services/project-dashboard-cache";
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import { created, RANK_MANAGER, RANK_MEMBER } from "./common";
import { bad, BAD, guarded, needText, notFound, optDate, optOneOf, projectExists } from "./record-scope";
import { given, optClean, recordOfProject } from "./wave79-scope";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { and, eq } from "drizzle-orm";
import { documents } from "@/lib/db/schema";

function patchText(task: ExecutableTask, key: string): string | undefined | typeof BAD {
  const v = optClean(task, key);
  return v === BAD || (given(task, key) && v === undefined) ? BAD : v;
}

/** True when the document is a PERMIT of this project (recordOfProject holds it to the project; a permit's category is "permit"). */
async function permitOfProject(task: ExecutableTask, permitId: string, projectId: string): Promise<boolean> {
  if (!(await recordOfProject(task, "document", permitId, projectId))) return false;
  const row = await withTenantContext({ orgId: task.orgId, userId: task.userId }, (db) =>
    db.query.documents.findFirst({ where: and(eq(documents.id, permitId), eq(documents.orgId, task.orgId)), columns: { category: true } })
  );
  return row?.category === "permit";
}

export async function executeUpdatePermit(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId, actorId }) => {
    const permitId = needText(task, "permitId");
    if (permitId === BAD) return bad(task, "permitId");
    const name = patchText(task, "name");
    if (name === BAD) return bad(task, "name");
    const permitNumber = patchText(task, "permitNumber");
    if (permitNumber === BAD) return bad(task, "permitNumber");
    const permitAuthority = patchText(task, "permitAuthority");
    if (permitAuthority === BAD) return bad(task, "permitAuthority");
    const notes = patchText(task, "notes");
    if (notes === BAD) return bad(task, "notes");
    const issueDate = optDate(task, "issueDate");
    if (issueDate === BAD) return bad(task, "issueDate");
    const expiryDate = optDate(task, "expiryDate");
    if (expiryDate === BAD) return bad(task, "expiryDate");
    if (issueDate && expiryDate && issueDate > expiryDate) return bad(task, "issueDate");
    const patch = {
      ...(name ? { name } : {}),
      ...(permitNumber ? { permitNumber } : {}),
      ...(permitAuthority ? { permitAuthority } : {}),
      ...(notes ? { notes } : {}),
      ...(issueDate ? { issueDate } : {}),
      ...(expiryDate ? { endDate: expiryDate } : {}),
    };
    if (Object.keys(patch).length === 0) return bad(task, "empty_patch");
    if (!(await permitOfProject(task, permitId, projectId))) return notFound(task, "permitId");
    const row = await updatePermit({ orgId: task.orgId, userId: actorId }, permitId, patch);
    bustProjectDashboardCache(task.orgId, projectId);
    return created(row.id, `/permits/${row.id}`, row);
  });
}

export async function executeDeletePermit(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId }) => {
    const permitId = needText(task, "permitId");
    if (permitId === BAD) return bad(task, "permitId");
    if (!(await permitOfProject(task, permitId, projectId))) return notFound(task, "permitId");
    const result = await deletePermit({ orgId: task.orgId }, permitId);
    bustProjectDashboardCache(task.orgId, projectId);
    return created(permitId, "/permits", result);
  });
}

export async function executeArchiveProject(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MANAGER }, async ({ projectId, actorId }) => {
    const status = optOneOf(task, "status", PROJECT_STATUSES);
    if (status === BAD) return bad(task, "status");
    if (!(await projectExists(task, projectId))) return notFound(task, "projectId");
    const row = await updateProjectStatus({ orgId: task.orgId, userId: actorId }, projectId, status ?? "cancelled");
    bustProjectDashboardCache(task.orgId, projectId);
    return created(row.id, "/dashboard/project", { id: row.id, name: row.name, status: row.status });
  });
}
