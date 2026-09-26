// PROJEXA-BUILD-002 WP-05g (register row AW-307, wave 8) and the floor plan half of wave 9 -- interior design: mood boards, FF&E items and
// floor plans. create_mood_board, add_mood_board_item, create_ffe_item, update_ffe_status, get_ffe_margin_summary, create_floor_plan,
// add_room and place_furniture.
//
// Each wraps the service PROJEXA's own routes call (interior-design-service.ts, interior-floorplan-service.ts). No second write path.
//   - an FF&E item carries a trade cost and a client price, which feed the margin summary, so create_ffe_item is money sensitive (a draft
//     the person confirms) and its cost and price are null in the answer below the manager rank; changing an item's status may record a
//     purchase, a delivery or a fitting, so update_ffe_status is a draft at the manager rank; the margin summary is money and the manager rank;
//   - a supplier (vendorId), a room's materials (floorMaterialId and the two others) and a material's texture are ORGANISATION records, not
//     project records, so a link cannot name them (spec 9.10): the executors do not read them;
//   - a mood board item points at a stored document of the project (never at an address): its document is held to the project.
//
// Rules, each with a test in src/lib/pipeline/coverage-wave8-9.test.ts:
//   - the mood board, the FF&E item, the floor plan, the room and the documents an id names are held to the task's project (the services
//     find them by id and organisation only, and placeFurniture adds a placement to any room id it is given);
//   - createMoodBoard, createFfeItem and createFloorPlan never look the project up: it is checked here;
//   - numbers are finite and within a real range (a polygon has 3 to 200 points, in centimetres); a status or a category is one of its closed list;
//   - free text is cleaned and held to 2,000 characters.
import { addMoodBoardItem, createFfeItem, createMoodBoard, getMarginSummary, updateFfeItemStatus } from "@/lib/services/interior-design-service";
import { addRoom, createFloorPlan, placeFurniture } from "@/lib/services/interior-floorplan-service";
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import { created, RANK_MANAGER, RANK_MEMBER } from "./common";
import { bad, BAD, guarded, needText, notFound, ok, optNumber, optOneOf, projectExists, withholdFields } from "./record-scope";
import { isOutcome, scopeOf, type ScopeRules } from "./scope";
import { given, listParam, needClean, optClean, optId, optRange, optWhole, recordOfProject, roomOfFloorPlan } from "./wave79-scope";

export const FFE_CATEGORIES = ["furniture", "fixture", "equipment", "finish", "textile", "lighting", "other"] as const;
export const FFE_STATUSES = ["specified", "ordered", "received", "installed"] as const;
const FFE_MONEY = ["unitCost", "unitPrice"] as const;
const MAX_POLYGON_POINTS = 200;
const COORDINATE_LIMIT = 1_000_000;

// -- mood boards -------------------------------------------------------------------------------------------------------------------

export async function executeCreateMoodBoard(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId, actorId }) => {
    const title = needClean(task, "title");
    if (title === BAD) return bad(task, "title");
    const roomOrArea = optClean(task, "roomOrArea");
    if (roomOrArea === BAD || (given(task, "roomOrArea") && roomOrArea === undefined)) return bad(task, "roomOrArea");
    const description = optClean(task, "description");
    if (description === BAD || (given(task, "description") && description === undefined)) return bad(task, "description");
    if (!(await projectExists(task, projectId))) return notFound(task, "projectId");

    const row = await createMoodBoard({ orgId: task.orgId, userId: actorId }, { projectId, title, roomOrArea, description });
    return created(row.id, `/mood-boards/${row.id}`, row);
  });
}

export async function executeAddMoodBoardItem(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId }) => {
    const moodBoardId = needText(task, "moodBoardId");
    if (moodBoardId === BAD) return bad(task, "moodBoardId");
    const documentId = optId(task, "documentId");
    if (documentId === BAD) return bad(task, "documentId");
    const label = optClean(task, "label");
    if (label === BAD || (given(task, "label") && label === undefined)) return bad(task, "label");
    const notes = optClean(task, "notes");
    if (notes === BAD || (given(task, "notes") && notes === undefined)) return bad(task, "notes");
    if (documentId === undefined && label === undefined && notes === undefined) return bad(task, "empty_item");
    if (!(await recordOfProject(task, "mood_board", moodBoardId, projectId))) return notFound(task, "moodBoardId");
    if (documentId !== undefined && !(await recordOfProject(task, "document", documentId, projectId))) return notFound(task, "documentId");

    const row = await addMoodBoardItem({ orgId: task.orgId }, moodBoardId, { documentId, label, notes });
    return created(row.id, `/mood-boards/${moodBoardId}`, row);
  });
}

// -- FF&E --------------------------------------------------------------------------------------------------------------------------

export async function executeCreateFfeItem(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId, actorId }) => {
    const itemName = needClean(task, "itemName");
    if (itemName === BAD) return bad(task, "itemName");
    const roomOrArea = optClean(task, "roomOrArea");
    if (roomOrArea === BAD || (given(task, "roomOrArea") && roomOrArea === undefined)) return bad(task, "roomOrArea");
    const description = optClean(task, "description");
    if (description === BAD || (given(task, "description") && description === undefined)) return bad(task, "description");
    const sku = optClean(task, "sku");
    if (sku === BAD || (given(task, "sku") && sku === undefined)) return bad(task, "sku");
    const category = optOneOf(task, "category", FFE_CATEGORIES);
    if (category === BAD) return bad(task, "category");
    const quantity = optWhole(task, "quantity", 1, 100_000);
    if (quantity === BAD) return bad(task, "quantity");
    const unitCost = optNumber(task, "unitCost");
    if (unitCost === BAD) return bad(task, "unitCost");
    const unitPrice = optNumber(task, "unitPrice");
    if (unitPrice === BAD) return bad(task, "unitPrice");
    const leadTimeDays = optWhole(task, "leadTimeDays", 0, 3650);
    if (leadTimeDays === BAD) return bad(task, "leadTimeDays");
    const widthCm = optRange(task, "widthCm", 0, COORDINATE_LIMIT);
    if (widthCm === BAD) return bad(task, "widthCm");
    const depthCm = optRange(task, "depthCm", 0, COORDINATE_LIMIT);
    if (depthCm === BAD) return bad(task, "depthCm");
    const heightCm = optRange(task, "heightCm", 0, COORDINATE_LIMIT);
    if (heightCm === BAD) return bad(task, "heightCm");
    const documentId = optId(task, "documentId");
    if (documentId === BAD) return bad(task, "documentId");
    if (!(await projectExists(task, projectId))) return notFound(task, "projectId");
    if (documentId !== undefined && !(await recordOfProject(task, "document", documentId, projectId))) return notFound(task, "documentId");

    const row = await createFfeItem(
      { orgId: task.orgId, userId: actorId },
      { projectId, itemName, roomOrArea, category, description, sku, quantity, unitCost, unitPrice, leadTimeDays, documentId, widthCm, depthCm, heightCm }
    );
    return created(row.id, `/ffe/${row.id}`, withholdFields(task, row, FFE_MONEY));
  });
}

export async function executeUpdateFfeStatus(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MANAGER }, async ({ projectId }) => {
    const itemId = needText(task, "itemId");
    if (itemId === BAD) return bad(task, "itemId");
    const status = optOneOf(task, "status", FFE_STATUSES);
    if (status === BAD || status === undefined) return bad(task, "status");
    if (!(await recordOfProject(task, "ffe_item", itemId, projectId))) return notFound(task, "itemId");

    const row = await updateFfeItemStatus({ orgId: task.orgId }, itemId, status);
    return created(row.id, `/ffe/${row.id}`, row);
  });
}

const MONEY_READ: ScopeRules = { minRank: RANK_MANAGER, reason: "manager_rank_required", needsActor: false, rankFirst: true };

export async function executeGetFfeMarginSummary(task: ExecutableTask): Promise<ExecutionOutcome> {
  const scope = scopeOf(task, MONEY_READ);
  if (isOutcome(scope)) return scope;
  // The margin is the trade cost against the client price of THIS project's items only (the service filters on the project itself).
  return ok(await getMarginSummary({ orgId: task.orgId }, scope.projectId));
}

// -- floor plans -------------------------------------------------------------------------------------------------------------------

export async function executeCreateFloorPlan(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId, actorId }) => {
    const name = needClean(task, "name");
    if (name === BAD) return bad(task, "name");
    const floorLevel = optClean(task, "floorLevel");
    if (floorLevel === BAD || (given(task, "floorLevel") && floorLevel === undefined)) return bad(task, "floorLevel");
    if (!(await projectExists(task, projectId))) return notFound(task, "projectId");

    const row = await createFloorPlan({ orgId: task.orgId, userId: actorId }, { projectId, name, floorLevel });
    return created(row.id, `/floor-plans/${row.id}`, row);
  });
}

/** A polygon of 3 to 200 points, each with a finite x and y within a million centimetres: {x, y} pairs only. BAD for anything else. */
function readPolygon(task: ExecutableTask): { x: number; y: number }[] | typeof BAD {
  const list = listParam(task, "polygon", MAX_POLYGON_POINTS);
  if (list === undefined || list === BAD || list.length < 3) return BAD;
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

export async function executeAddRoom(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId }) => {
    const floorPlanId = needText(task, "floorPlanId");
    if (floorPlanId === BAD) return bad(task, "floorPlanId");
    const name = needClean(task, "name");
    if (name === BAD) return bad(task, "name");
    const polygon = readPolygon(task);
    if (polygon === BAD) return bad(task, "polygon");
    const ceilingHeightCm = optRange(task, "ceilingHeightCm", 50, 2000);
    if (ceilingHeightCm === BAD) return bad(task, "ceilingHeightCm");
    if (!(await recordOfProject(task, "floor_plan", floorPlanId, projectId))) return notFound(task, "floorPlanId");

    const row = await addRoom({ orgId: task.orgId }, floorPlanId, { name, polygon, ceilingHeightCm });
    return created(row.id, `/floor-plans/${floorPlanId}`, row);
  });
}

export async function executePlaceFurniture(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId }) => {
    const floorPlanId = needText(task, "floorPlanId");
    if (floorPlanId === BAD) return bad(task, "floorPlanId");
    const ffeItemId = needText(task, "ffeItemId");
    if (ffeItemId === BAD) return bad(task, "ffeItemId");
    const roomId = optId(task, "roomId");
    if (roomId === BAD) return bad(task, "roomId");
    const x = optRange(task, "x", -COORDINATE_LIMIT, COORDINATE_LIMIT);
    if (x === BAD) return bad(task, "x");
    const y = optRange(task, "y", -COORDINATE_LIMIT, COORDINATE_LIMIT);
    if (y === BAD) return bad(task, "y");
    const rotationDeg = optRange(task, "rotationDeg", -360, 360);
    if (rotationDeg === BAD) return bad(task, "rotationDeg");
    if (!(await recordOfProject(task, "floor_plan", floorPlanId, projectId))) return notFound(task, "floorPlanId");
    if (!(await recordOfProject(task, "ffe_item", ffeItemId, projectId))) return notFound(task, "ffeItemId");
    if (roomId !== undefined && !(await roomOfFloorPlan(task, roomId, floorPlanId))) return notFound(task, "roomId");

    const row = await placeFurniture({ orgId: task.orgId }, floorPlanId, { ffeItemId, roomId, x, y, rotationDeg });
    return created(row.id, `/floor-plans/${floorPlanId}`, row);
  });
}
