// lf-b2-ai-crud (owner order 2026-10-02, requirements R5-R7) -- the 27 create/update/delete executors that let the person's AI change
// everything the person may change, in one map, so executor.ts carries one import line and one spread line for them.
//   GROUP 3             update_permit delete_permit archive_project                                     (crud-permits-project.ts)
//   BOQ and progress    update_boq delete_boq update_boq_line_amounts delete_progress_entry              (crud-boq-progress.ts)
//   schedule            archive_task create_sprint update_sprint close_sprint add_sprint_task remove_sprint_task
//   timesheets          update_time_entry delete_time_entry                                             (crud-schedule-time.ts)
//   records             dispose_document update_mom_details delete_mom update_meeting update_material   (crud-records.ts)
//   design studio       update_room remove_room update_placement remove_placement update_floor_plan_status
//                       update_mood_board remove_mood_board_item                                        (crud-interior.ts)
// None of them touches code, a release bundle or a file: the owner's order is "the AI cannot code on this" (data yes, software never).
// The coverage list, with what is NOT done and why, is ai-os/AI_CRUD_COVERAGE.md.
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import { executeDeleteBoq, executeDeleteProgressEntry, executeUpdateBoq, executeUpdateBoqLineAmounts } from "./crud-boq-progress";
import {
  executeAddSprintTask,
  executeArchiveTask,
  executeCloseSprint,
  executeCreateSprint,
  executeDeleteTimeEntry,
  executeRemoveSprintTask,
  executeUpdateSprint,
  executeUpdateTimeEntry,
} from "./crud-schedule-time";
import { executeDeleteMom, executeDisposeDocument, executeUpdateMaterial, executeUpdateMeeting, executeUpdateMomDetails } from "./crud-records";
import {
  executeRemoveMoodBoardItem,
  executeRemovePlacement,
  executeRemoveRoom,
  executeUpdateFloorPlanStatus,
  executeUpdateMoodBoard,
  executeUpdatePlacement,
  executeUpdateRoom,
} from "./crud-interior";
import { executeArchiveProject, executeDeletePermit, executeUpdatePermit } from "./crud-permits-project";
import { executeUpdateDrawing } from "./crud-drawings";

export const CRUD_B2_EXECUTORS: Record<string, (task: ExecutableTask) => Promise<ExecutionOutcome>> = {
  update_boq: executeUpdateBoq,
  delete_boq: executeDeleteBoq,
  update_boq_line_amounts: executeUpdateBoqLineAmounts,
  delete_progress_entry: executeDeleteProgressEntry,
  archive_task: executeArchiveTask,
  create_sprint: executeCreateSprint,
  update_sprint: executeUpdateSprint,
  close_sprint: executeCloseSprint,
  add_sprint_task: executeAddSprintTask,
  remove_sprint_task: executeRemoveSprintTask,
  update_time_entry: executeUpdateTimeEntry,
  delete_time_entry: executeDeleteTimeEntry,
  dispose_document: executeDisposeDocument,
  update_mom_details: executeUpdateMomDetails,
  delete_mom: executeDeleteMom,
  update_meeting: executeUpdateMeeting,
  update_material: executeUpdateMaterial,
  update_room: executeUpdateRoom,
  remove_room: executeRemoveRoom,
  update_placement: executeUpdatePlacement,
  remove_placement: executeRemovePlacement,
  update_floor_plan_status: executeUpdateFloorPlanStatus,
  update_mood_board: executeUpdateMoodBoard,
  remove_mood_board_item: executeRemoveMoodBoardItem,
  // GROUP 3 (crud-permits-project.ts)
  update_permit: executeUpdatePermit,
  delete_permit: executeDeletePermit,
  archive_project: executeArchiveProject,
  // P5 (2026-10-08, crud-drawings.ts): the drawing edit the app route already had
  update_drawing: executeUpdateDrawing,
};
