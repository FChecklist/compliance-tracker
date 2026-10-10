// PROJEXA-BUILD-002 WP-07 (register row AW-331) -- create_activity, and the default activity that
// record_work_progress falls back to.
//
// A progress entry is written against an activity (construction_work_progress_entries.activity_id is
// NOT NULL), and a new project has none, so before this an AI could not record progress on a project it
// had just filled. Both paths use the services PROJEXA's own screens call: listCategories(),
// createCategory(), listActivities(), createActivity() of construction-progress-service.ts.
//
// The default is a category named "General" and an activity named "General work" on the project. The
// category is reused when the project already has one of that name; the activity is created only when
// the project has no activity at all, so calling it twice creates one.
//
// Each service call opens and closes its own transaction and none is held open around another (D-06).
import {
  createActivity,
  createCategory,
  listActivities,
  listCategories,
} from "@/lib/services/construction-progress-service";
import { pipelineFailure } from "../error-codes";
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import { badRequest, created, missingRequiredParam, notPermitted, num, pickProject, rankOf, RANK_MEMBER, refuse, str, unidentifiedActor } from "./common";

export const DEFAULT_CATEGORY_NAME = "General";
export const DEFAULT_ACTIVITY_NAME = "General work";

/** The id of the project's "General" category, created when the project has none. */
async function generalCategoryId(orgId: string, projectId: string): Promise<string> {
  const categories = await listCategories({ orgId }, projectId);
  const found = categories.find((c) => c.name.trim().toLowerCase() === DEFAULT_CATEGORY_NAME.toLowerCase());
  if (found) return found.id;
  return (await createCategory({ orgId }, { projectId, name: DEFAULT_CATEGORY_NAME })).id;
}

/**
 * The activity a progress entry is written against when the project has none: the first activity the
 * project has, else a new "General work" one. Returns its id.
 */
export async function ensureDefaultActivity(orgId: string, projectId: string): Promise<string> {
  const existing = await listActivities({ orgId }, { projectId });
  if (existing.length > 0) return existing[0].id;
  const categoryId = await generalCategoryId(orgId, projectId);
  return (await createActivity({ orgId }, { projectId, categoryId, name: DEFAULT_ACTIVITY_NAME })).id;
}

export async function executeCreateActivity(task: ExecutableTask): Promise<ExecutionOutcome> {
  const missing = missingRequiredParam(task);
  if (missing) return refuse(missing);
  const pick = pickProject(task);
  if ("failure" in pick) return refuse(pick.failure);
  if (!pick.projectId) return refuse(pipelineFailure("PROJECT_REQUIRED", ["projectId"]));
  if (!task.actorUserId) return unidentifiedActor();
  if (rankOf(task.role) < RANK_MEMBER) return notPermitted("role_below_member");

  const plannedRaw = task.params.plannedQuantity;
  const plannedQuantity = plannedRaw === undefined || plannedRaw === null ? undefined : num(plannedRaw);
  if (plannedRaw !== undefined && plannedRaw !== null && (plannedQuantity === undefined || plannedQuantity < 0)) {
    return badRequest(task, "plannedQuantity_type");
  }

  const projectId = pick.projectId;
  const named = str(task.params.categoryId);
  let categoryId: string;
  if (named) {
    // The service finds a category by id and organisation only, so the project is checked here: a
    // category of another project is absent, whichever id the caller names.
    const categories = await listCategories({ orgId: task.orgId }, projectId);
    if (!categories.some((c) => c.id === named)) {
      return refuse(pipelineFailure("RECORD_NOT_FOUND", ["value"], { status: 404, functionId: task.functionId, param: "categoryId" }));
    }
    categoryId = named;
  } else {
    categoryId = await generalCategoryId(task.orgId, projectId);
  }

  const row = await createActivity(
    { orgId: task.orgId },
    { projectId, categoryId, name: str(task.params.name)!, unit: str(task.params.unit), plannedQuantity }
  );
  return created(row.id, "/work-progress", row);
}
