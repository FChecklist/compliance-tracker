// PROJEXA-BUILD-002 WP-03 (register row AW-201) -- create_project and update_project.
//
// Both wrap the services the app already uses: create_project calls createProject(), the service
// POST /api/v1/projexa/projects calls, and update_project calls updateProjectDetails(), which sits
// next to updateProjectValue() in construction-dashboard-service.ts. No second write path.
//
// Rules, each with a test in src/lib/pipeline/executor-project.test.ts:
//   - the acting person (task.actorUserId) is the project's lead, never the org API key's id, and a
//     task that names no person is refused before anything is read or written (the U-20b rule);
//   - both need at least the member rank, the same floor the projects route has; an absent or
//     unknown role is refused;
//   - create_project makes a SHELL (src/lib/project-shell.ts) when `shell` is true and no name is
//     given: the placeholder project the "New project with my AI" flow hands to an AI. It is on no
//     link (a link is bound to one project); the internal pipeline and that flow call it;
//   - the product is the caller's productId, else the organisation's only active product; when there
//     is none or more than one the task is refused and names what to pick;
//   - update_project changes the project of the task itself: a params.projectId that names another
//     project is refused, and a project of another organisation reads as absent;
//   - the money fields of the project (projectValue, VAT, retention) are returned as null below the
//     manager rank, exactly as the record kind `project` hides them on a link.
import { and, eq } from "drizzle-orm";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { products } from "@/lib/db/schema";
import { createProject, updateProjectDetails, type ProjectPatch } from "@/lib/services/construction-dashboard-service";
import { SHELL_PROJECT_NAME, SHELL_PROJECT_STATUS } from "@/lib/project-shell";
import { pipelineFailure } from "../error-codes";
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import { badRequest, created, missingRequiredParam, notPermitted, num, pickProject, rankOf, RANK_MANAGER, RANK_MEMBER, refuse, str, unidentifiedActor } from "./common";

const PROJECT_ROUTE = "/dashboard/project";

const PROJECT_MONEY_FIELDS = ["projectValue", "vatRatePercent", "retentionPercent"] as const;

/** The project row as the caller may see it: money fields are null below the manager rank. */
function shownProject<T extends Record<string, unknown>>(task: ExecutableTask, row: T): T {
  if (rankOf(task.role) >= RANK_MANAGER) return row;
  const out: Record<string, unknown> = { ...row };
  for (const key of PROJECT_MONEY_FIELDS) if (key in out) out[key] = null;
  out.financialsRedacted = true;
  return out as T;
}

/** The organisation's active products, by name: what a project can nest under. */
async function activeProducts(task: ExecutableTask): Promise<Array<{ id: string; name: string }>> {
  const rows = await withTenantContext({ orgId: task.orgId, userId: task.userId }, (db) =>
    db.query.products.findMany({
      where: and(eq(products.orgId, task.orgId), eq(products.isActive, true)),
      columns: { id: true, name: true },
    })
  );
  return rows.map((r) => ({ id: r.id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function executeCreateProject(task: ExecutableTask): Promise<ExecutionOutcome> {
  if (!task.actorUserId) return unidentifiedActor();
  if (rankOf(task.role) < RANK_MEMBER) return notPermitted("role_below_member");

  const shell = task.params.shell === true;
  const name = str(task.params.name) ?? (shell ? SHELL_PROJECT_NAME : undefined);
  if (!name) return refuse(pipelineFailure("TITLE_REQUIRED", ["name"]));

  let productId = str(task.params.productId);
  if (!productId) {
    const options = await activeProducts(task);
    // Exactly one product is the default. Zero or several is a choice the caller has to make:
    // guessing the first would put the project under a business line nobody picked.
    if (options.length !== 1) {
      return refuse(pipelineFailure("VALUE_REQUIRED", ["value"], { param: "productId", options: options.length }));
    }
    productId = options[0].id;
  }

  const row = await createProject(
    { orgId: task.orgId, userId: task.actorUserId, isRealUser: true },
    {
      productId,
      name,
      description: str(task.params.description),
      clientId: str(task.params.clientId),
      startDate: str(task.params.startDate),
      targetDate: str(task.params.targetDate),
      ...(shell ? { status: SHELL_PROJECT_STATUS } : {}),
    }
  );
  return created(row.id, PROJECT_ROUTE, shownProject(task, row));
}

/** Only the fields the caller sent; a field sent as the wrong type is a 400, never silently dropped. */
function patchFrom(params: Record<string, unknown>): { patch: ProjectPatch } | { bad: string } {
  const patch: ProjectPatch = {};
  const text = (key: "name" | "description" | "clientId" | "startDate" | "targetDate", nullable: boolean): string | null => {
    const v = params[key];
    if (v === undefined) return null;
    if (v === null && nullable) {
      (patch as Record<string, unknown>)[key] = null;
      return null;
    }
    if (typeof v !== "string") return key;
    (patch as Record<string, unknown>)[key] = v;
    return null;
  };
  for (const [key, nullable] of [["name", false], ["description", true], ["clientId", true], ["startDate", true], ["targetDate", true]] as const) {
    const bad = text(key, nullable);
    if (bad) return { bad };
  }
  for (const key of ["projectValue", "vatRatePercent", "retentionPercent"] as const) {
    const v = params[key];
    if (v === undefined) continue;
    if (v === null && key === "projectValue") {
      patch.projectValue = null;
      continue;
    }
    const n = num(v);
    if (n === undefined) return { bad: key };
    patch[key] = n;
  }
  return { patch };
}

export async function executeUpdateProject(task: ExecutableTask): Promise<ExecutionOutcome> {
  const missing = missingRequiredParam(task);
  if (missing) return refuse(missing);
  const pick = pickProject(task);
  if ("failure" in pick) return refuse(pick.failure);
  if (!pick.projectId) return refuse(pipelineFailure("PROJECT_REQUIRED", ["projectId"]));
  if (!task.actorUserId) return unidentifiedActor();
  if (rankOf(task.role) < RANK_MEMBER) return notPermitted("role_below_member");

  const parsed = patchFrom(task.params);
  if ("bad" in parsed) return badRequest(task, `${parsed.bad}_type`);

  const row = await updateProjectDetails({ orgId: task.orgId, userId: task.actorUserId }, pick.projectId, parsed.patch);
  return created(row.id, PROJECT_ROUTE, shownProject(task, row));
}
