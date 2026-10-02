// lf-b2-ai-crud (owner order 2026-10-02, requirements R5-R7) -- the design studio changes an AI could not make: update_room, remove_room,
// update_placement, remove_placement, update_floor_plan_status, update_mood_board and remove_mood_board_item.
//
// Each wraps the service PROJEXA's own routes call (interior-floorplan-service.ts, interior-design-service.ts), at the member rank those
// routes ask for. The rules of add_room and place_furniture (interior.ts) hold here too:
//   - the floor plan and the mood board must be of THIS project, a room and a placement of THAT floor plan, an item of THAT mood board
//     (the services find a plan or a board by id and organisation only, and delete a room, a placement or an item of an id that is not
//     there without saying so, so each id is checked first and an absent one is RECORD_NOT_FOUND with nothing written);
//   - a room's materials are organisation records and are never taken from a link; a polygon has 3 to 200 points within a million cm;
//   - removing a room, a placement or a mood board item deletes it (the services' own hard delete), so each is a draft the person confirms
//     (level 2). A floor plan marked "final" is the plan the client is shown, so the status change is a draft too.
// Tests: src/lib/pipeline/coverage-crud-b2.test.ts.
import { removeMoodBoardItem, updateMoodBoard } from "@/lib/services/interior-design-service";
import { removePlacement, removeRoom, updateFloorPlanStatus, updatePlacement, updateRoom } from "@/lib/services/interior-floorplan-service";
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import { created, RANK_MEMBER } from "./common";
import { bad, BAD, guarded, needText, notFound, optOneOf } from "./record-scope";
import { given, listParam, optClean, optId, optRange, recordOfProject, roomOfFloorPlan } from "./wave79-scope";
import { itemOfMoodBoard, placementOfFloorPlan } from "./crud-scope";

const WRITE = { write: true, minRank: RANK_MEMBER } as const;
export const FLOOR_PLAN_STATUSES = ["draft", "final"] as const;
const MAX_POLYGON_POINTS = 200;
const COORDINATE_LIMIT = 1_000_000;

function patchText(task: ExecutableTask, key: string): string | undefined | typeof BAD {
  const v = optClean(task, key);
  return v === BAD || (given(task, key) && v === undefined) ? BAD : v;
}

/** An optional polygon: absent is undefined; otherwise 3 to 200 {x, y} points within a million cm, else BAD. */
function optPolygon(task: ExecutableTask): { x: number; y: number }[] | undefined | typeof BAD {
  const list = listParam(task, "polygon", MAX_POLYGON_POINTS);
  if (list === undefined) return undefined;
  if (list === BAD || list.length < 3) return BAD;
  const points: { x: number; y: number }[] = [];
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return BAD;
    const { x, y } = entry as { x?: unknown; y?: unknown };
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return BAD;
    if (Math.abs(x) > COORDINATE_LIMIT || Math.abs(y) > COORDINATE_LIMIT) return BAD;
    points.push({ x, y });
  }
  return points;
}

/** The floor plan of this project named by floorPlanId, or the refusal. */
async function planOf(task: ExecutableTask, projectId: string): Promise<string | ExecutionOutcome> {
  const floorPlanId = needText(task, "floorPlanId");
  if (floorPlanId === BAD) return bad(task, "floorPlanId");
  if (!(await recordOfProject(task, "floor_plan", floorPlanId, projectId))) return notFound(task, "floorPlanId");
  return floorPlanId;
}

// -- rooms --------------------------------------------------------------------------------------------------------------------------

export async function executeUpdateRoom(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, WRITE, async ({ projectId }) => {
    const roomId = needText(task, "roomId");
    if (roomId === BAD) return bad(task, "roomId");
    const name = patchText(task, "name");
    if (name === BAD) return bad(task, "name");
    const polygon = optPolygon(task);
    if (polygon === BAD) return bad(task, "polygon");
    const ceilingHeightCm = optRange(task, "ceilingHeightCm", 50, 2000);
    if (ceilingHeightCm === BAD) return bad(task, "ceilingHeightCm");
    if (name === undefined && polygon === undefined && ceilingHeightCm === undefined) return bad(task, "empty_patch");
    const plan = await planOf(task, projectId);
    if (typeof plan !== "string") return plan;
    if (!(await roomOfFloorPlan(task, roomId, plan))) return notFound(task, "roomId");
    // Only the three fields above: the material ids are organisation records and are left as they are.
    const row = await updateRoom({ orgId: task.orgId }, plan, roomId, {
      ...(name !== undefined ? { name } : {}),
      ...(polygon !== undefined ? { polygon } : {}),
      ...(ceilingHeightCm !== undefined ? { ceilingHeightCm } : {}),
    });
    return created(row.id, `/floor-plans/${plan}`, row);
  });
}

export async function executeRemoveRoom(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, WRITE, async ({ projectId }) => {
    const roomId = needText(task, "roomId");
    if (roomId === BAD) return bad(task, "roomId");
    const plan = await planOf(task, projectId);
    if (typeof plan !== "string") return plan;
    if (!(await roomOfFloorPlan(task, roomId, plan))) return notFound(task, "roomId");
    await removeRoom({ orgId: task.orgId }, plan, roomId);
    return created(roomId, `/floor-plans/${plan}`, { removed: true, id: roomId });
  });
}

// -- placements ---------------------------------------------------------------------------------------------------------------------

export async function executeUpdatePlacement(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, WRITE, async ({ projectId }) => {
    const placementId = needText(task, "placementId");
    if (placementId === BAD) return bad(task, "placementId");
    const roomId = optId(task, "roomId");
    if (roomId === BAD) return bad(task, "roomId");
    const x = optRange(task, "x", -COORDINATE_LIMIT, COORDINATE_LIMIT);
    if (x === BAD) return bad(task, "x");
    const y = optRange(task, "y", -COORDINATE_LIMIT, COORDINATE_LIMIT);
    if (y === BAD) return bad(task, "y");
    const rotationDeg = optRange(task, "rotationDeg", -360, 360);
    if (rotationDeg === BAD) return bad(task, "rotationDeg");
    if (roomId === undefined && x === undefined && y === undefined && rotationDeg === undefined) return bad(task, "empty_patch");
    const plan = await planOf(task, projectId);
    if (typeof plan !== "string") return plan;
    if (!(await placementOfFloorPlan(task, placementId, plan))) return notFound(task, "placementId");
    if (roomId !== undefined && !(await roomOfFloorPlan(task, roomId, plan))) return notFound(task, "roomId");
    const row = await updatePlacement({ orgId: task.orgId }, plan, placementId, { ...(roomId !== undefined ? { roomId } : {}), x, y, rotationDeg });
    return created(row.id, `/floor-plans/${plan}`, row);
  });
}

export async function executeRemovePlacement(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, WRITE, async ({ projectId }) => {
    const placementId = needText(task, "placementId");
    if (placementId === BAD) return bad(task, "placementId");
    const plan = await planOf(task, projectId);
    if (typeof plan !== "string") return plan;
    if (!(await placementOfFloorPlan(task, placementId, plan))) return notFound(task, "placementId");
    await removePlacement({ orgId: task.orgId }, plan, placementId);
    return created(placementId, `/floor-plans/${plan}`, { removed: true, id: placementId });
  });
}

// -- floor plan status --------------------------------------------------------------------------------------------------------------

export async function executeUpdateFloorPlanStatus(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, WRITE, async ({ projectId }) => {
    const status = optOneOf(task, "status", FLOOR_PLAN_STATUSES);
    if (status === BAD || status === undefined) return bad(task, "status");
    const plan = await planOf(task, projectId);
    if (typeof plan !== "string") return plan;
    const row = await updateFloorPlanStatus({ orgId: task.orgId }, plan, status);
    return created(row.id, `/floor-plans/${plan}`, row);
  });
}

// -- mood boards --------------------------------------------------------------------------------------------------------------------

export async function executeUpdateMoodBoard(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, WRITE, async ({ projectId }) => {
    const moodBoardId = needText(task, "moodBoardId");
    if (moodBoardId === BAD) return bad(task, "moodBoardId");
    const title = patchText(task, "title");
    if (title === BAD) return bad(task, "title");
    const roomOrArea = patchText(task, "roomOrArea");
    if (roomOrArea === BAD) return bad(task, "roomOrArea");
    const description = patchText(task, "description");
    if (description === BAD) return bad(task, "description");
    const patch = { ...(title ? { title } : {}), ...(roomOrArea ? { roomOrArea } : {}), ...(description ? { description } : {}) };
    if (Object.keys(patch).length === 0) return bad(task, "empty_patch");
    if (!(await recordOfProject(task, "mood_board", moodBoardId, projectId))) return notFound(task, "moodBoardId");
    const row = await updateMoodBoard({ orgId: task.orgId }, moodBoardId, patch);
    return created(row.id, `/mood-boards/${row.id}`, row);
  });
}

export async function executeRemoveMoodBoardItem(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, WRITE, async ({ projectId }) => {
    const moodBoardId = needText(task, "moodBoardId");
    if (moodBoardId === BAD) return bad(task, "moodBoardId");
    const itemId = needText(task, "itemId");
    if (itemId === BAD) return bad(task, "itemId");
    if (!(await recordOfProject(task, "mood_board", moodBoardId, projectId))) return notFound(task, "moodBoardId");
    if (!(await itemOfMoodBoard(task, itemId, moodBoardId))) return notFound(task, "itemId");
    await removeMoodBoardItem({ orgId: task.orgId }, moodBoardId, itemId);
    return created(itemId, `/mood-boards/${moodBoardId}`, { removed: true, id: itemId });
  });
}
