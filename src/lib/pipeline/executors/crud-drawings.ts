// P5 (AI function coverage, 2026-10-08, ai-os/audit37/AI_FUNCTION_COVERAGE_2026-10-08.md) -- update_drawing.
//
//   - update_drawing runs document-service.ts updateDocumentMetadata, the same call PATCH /api/v1/projexa/drawings/{id} makes, with the same
//     three fields and nothing else: the name, the discipline (the only metadata key the route forwards, so isExternalLink and the rest are never
//     touched) and the category, which must stay a drawing category ("drawing" or "drawing_3d"). Member rank, like the route; a direct write
//     (level 1), like update_permit, its nearest sibling (crud-permits-project.ts), whose shape this copies.
//   - The drawing must be a drawing of THIS project (the service finds a document by id and organisation only).
// Not done here: delete_drawing (removes the stored file with the service-role storage client; an owner decision, ai-os/AI_CRUD_COVERAGE.md).
// Tests: src/lib/pipeline/coverage-crud-drawing.test.ts.
import { updateDocumentMetadata } from "@/lib/services/document-service";
import { bustProjectDashboardCache } from "@/lib/services/project-dashboard-cache";
import { DRAWING_CATEGORIES, isDrawingCategory } from "@/lib/drawings-register";
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import { created, RANK_MEMBER } from "./common";
import { bad, BAD, guarded, needText, notFound, optOneOf } from "./record-scope";
import { given, optClean, recordOfProject } from "./wave79-scope";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { and, eq } from "drizzle-orm";
import { documents } from "@/lib/db/schema";

function patchText(task: ExecutableTask, key: string): string | undefined | typeof BAD {
  const v = optClean(task, key);
  return v === BAD || (given(task, key) && v === undefined) ? BAD : v;
}

/** True when the document is a DRAWING of this project (recordOfProject holds it to the project; a drawing's category is drawing or drawing_3d). */
async function drawingOfProject(task: ExecutableTask, drawingId: string, projectId: string): Promise<boolean> {
  if (!(await recordOfProject(task, "document", drawingId, projectId))) return false;
  const row = await withTenantContext({ orgId: task.orgId, userId: task.userId }, (db) =>
    db.query.documents.findFirst({ where: and(eq(documents.id, drawingId), eq(documents.orgId, task.orgId)), columns: { category: true } })
  );
  return isDrawingCategory(row?.category);
}

export async function executeUpdateDrawing(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId, actorId }) => {
    const drawingId = needText(task, "drawingId");
    if (drawingId === BAD) return bad(task, "drawingId");
    const name = patchText(task, "name");
    if (name === BAD) return bad(task, "name");
    const discipline = patchText(task, "discipline");
    if (discipline === BAD || (discipline !== undefined && discipline.length > 60)) return bad(task, "discipline");
    const category = optOneOf(task, "category", DRAWING_CATEGORIES);
    if (category === BAD) return bad(task, "category");
    const patch = {
      ...(name ? { name } : {}),
      ...(category ? { category } : {}),
      ...(discipline ? { metadata: { discipline } } : {}),
    };
    if (Object.keys(patch).length === 0) return bad(task, "empty_patch");
    if (!(await drawingOfProject(task, drawingId, projectId))) return notFound(task, "drawingId");
    const row = await updateDocumentMetadata({ orgId: task.orgId, userId: actorId }, drawingId, patch);
    bustProjectDashboardCache(task.orgId, projectId);
    return created(row.id, `/drawings/${row.id}`, row);
  });
}
