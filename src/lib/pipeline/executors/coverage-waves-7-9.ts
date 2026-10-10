// PROJEXA-BUILD-002 WP-05g and WP-05h (register rows AW-307, AW-308) -- the 20 executors of coverage waves 7, 8 and 9, in one map, so that
// executor.ts carries one import line and one spread line for the three waves and a merge with another wave's lines keeps both.
//   wave 7  progress claims, approvals, KPIs (level-2 drafts only, PMD-41):
//             create_progress_claim draft_progress_claim submit_progress_claim reject_progress_claim
//             submit_change_order_for_approval submit_boq_for_approval submit_kpi_entry approve_kpi_entry
//   wave 8  permits, documents, wiki, mood boards, FF&E:
//             create_permit update_document_metadata create_wiki_page update_wiki_page
//             create_mood_board add_mood_board_item create_ffe_item update_ffe_status get_ffe_margin_summary
//   wave 9  floor plans:
//             create_floor_plan add_room place_furniture
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import { executeCreateProgressClaim, executeDraftProgressClaim, executeRejectProgressClaim, executeSubmitProgressClaim } from "./claims";
import { executeApproveKpiEntry, executeSubmitBoqForApproval, executeSubmitChangeOrderForApproval, executeSubmitKpiEntry } from "./approvals";
import { executeCreatePermit, executeCreateWikiPage, executeUpdateDocumentMetadata, executeUpdateWikiPage } from "./documents-wiki";
import {
  executeAddMoodBoardItem,
  executeAddRoom,
  executeCreateFfeItem,
  executeCreateFloorPlan,
  executeCreateMoodBoard,
  executeGetFfeMarginSummary,
  executePlaceFurniture,
  executeUpdateFfeStatus,
} from "./interior";

export const WAVE_7_9_EXECUTORS: Record<string, (task: ExecutableTask) => Promise<ExecutionOutcome>> = {
  create_progress_claim: executeCreateProgressClaim,
  draft_progress_claim: executeDraftProgressClaim,
  submit_progress_claim: executeSubmitProgressClaim,
  reject_progress_claim: executeRejectProgressClaim,
  submit_change_order_for_approval: executeSubmitChangeOrderForApproval,
  submit_boq_for_approval: executeSubmitBoqForApproval,
  submit_kpi_entry: executeSubmitKpiEntry,
  approve_kpi_entry: executeApproveKpiEntry,
  create_permit: executeCreatePermit,
  update_document_metadata: executeUpdateDocumentMetadata,
  create_wiki_page: executeCreateWikiPage,
  update_wiki_page: executeUpdateWikiPage,
  create_mood_board: executeCreateMoodBoard,
  add_mood_board_item: executeAddMoodBoardItem,
  create_ffe_item: executeCreateFfeItem,
  update_ffe_status: executeUpdateFfeStatus,
  get_ffe_margin_summary: executeGetFfeMarginSummary,
  create_floor_plan: executeCreateFloorPlan,
  add_room: executeAddRoom,
  place_furniture: executePlaceFurniture,
};
