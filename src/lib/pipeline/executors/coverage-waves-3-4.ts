// PROJEXA-BUILD-002 WP-05c and WP-05d (register rows AW-303, AW-304) -- the 18 executors of coverage waves 3 and 4, in one map, so that
// executor.ts carries one import line and one spread line for both waves and a merge with another wave's lines keeps both.
//   wave 3  field records:   create_rfi answer_rfi close_rfi create_submittal review_submittal create_punch_list_item
//                            mark_punch_item_ready verify_punch_item_closed create_site_diary
//   wave 4  progress, labour, materials:   create_progress_category update_progress_entry get_daily_progress_report
//                            record_attendance_batch update_roster_entry record_material_issue create_material
//                            void_material_receipt get_material_cost_report
// (create_activity, the tenth function of wave 4, is WP-07's and is registered in executor.ts.)
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import {
  executeAnswerRfi,
  executeCloseRfi,
  executeCreatePunchListItem,
  executeCreateRfi,
  executeCreateSubmittal,
  executeMarkPunchItemReady,
  executeReviewSubmittal,
  executeVerifyPunchItemClosed,
} from "./field-records";
import { executeCreateSiteDiary } from "./site-diary";
import { executeCreateProgressCategory, executeGetDailyProgressReport, executeUpdateProgressEntry } from "./progress";
import { executeRecordAttendanceBatch, executeUpdateRosterEntry } from "./labour";
import { executeCreateMaterial, executeGetMaterialCostReport, executeRecordMaterialIssue, executeVoidMaterialReceipt } from "./materials";

export const WAVE_3_4_EXECUTORS: Record<string, (task: ExecutableTask) => Promise<ExecutionOutcome>> = {
  create_rfi: executeCreateRfi,
  answer_rfi: executeAnswerRfi,
  close_rfi: executeCloseRfi,
  create_submittal: executeCreateSubmittal,
  review_submittal: executeReviewSubmittal,
  create_punch_list_item: executeCreatePunchListItem,
  mark_punch_item_ready: executeMarkPunchItemReady,
  verify_punch_item_closed: executeVerifyPunchItemClosed,
  create_site_diary: executeCreateSiteDiary,
  create_progress_category: executeCreateProgressCategory,
  update_progress_entry: executeUpdateProgressEntry,
  get_daily_progress_report: executeGetDailyProgressReport,
  record_attendance_batch: executeRecordAttendanceBatch,
  update_roster_entry: executeUpdateRosterEntry,
  record_material_issue: executeRecordMaterialIssue,
  create_material: executeCreateMaterial,
  void_material_receipt: executeVoidMaterialReceipt,
  get_material_cost_report: executeGetMaterialCostReport,
};
