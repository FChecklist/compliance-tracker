// lf-b5-ai-crud (owner order 2026-10-02, requirement R7) -- the 18 functions (and one read, list_organisation_records) that finish "the AI can make the complete project, edit,
// delete, update, etc. for that user as per role and its organisation", in one map, so executor.ts carries one import line and one
// spread line for them (the B2 pattern, coverage-crud-b2.ts).
//   the eight that had no service      update_activity update_progress_category update_attendance delete_attendance update_change_order
//                                      cancel_change_order update_boq_line delete_meeting                                    (crud-b5-project.ts)
//   the organisation-scoped class      create_boq_category rename_boq_category delete_boq_category create_vendor update_vendor
//                                      create_customer update_customer create_company create_currency create_exchange_rate     (crud-b5-org.ts)
// None of them touches code, a release bundle or a file. The coverage list, the rules chosen and what is NOT done: ai-os/AI_CRUD_COVERAGE.md.
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import {
  executeCancelChangeOrder,
  executeDeleteAttendance,
  executeDeleteMeeting,
  executeUpdateActivity,
  executeUpdateAttendance,
  executeUpdateBoqLine,
  executeUpdateChangeOrder,
  executeUpdateProgressCategory,
} from "./crud-b5-project";
import {
  executeCreateBoqCategory,
  executeCreateCompany,
  executeCreateCurrency,
  executeCreateCustomer,
  executeCreateExchangeRate,
  executeCreateVendor,
  executeDeleteBoqCategory,
  executeListOrganisationRecords,
  executeRenameBoqCategory,
  executeUpdateCustomer,
  executeUpdateVendor,
} from "./crud-b5-org";

export const CRUD_B5_EXECUTORS: Record<string, (task: ExecutableTask) => Promise<ExecutionOutcome>> = {
  update_activity: executeUpdateActivity,
  update_progress_category: executeUpdateProgressCategory,
  update_attendance: executeUpdateAttendance,
  delete_attendance: executeDeleteAttendance,
  update_change_order: executeUpdateChangeOrder,
  cancel_change_order: executeCancelChangeOrder,
  update_boq_line: executeUpdateBoqLine,
  delete_meeting: executeDeleteMeeting,
  create_boq_category: executeCreateBoqCategory,
  rename_boq_category: executeRenameBoqCategory,
  delete_boq_category: executeDeleteBoqCategory,
  create_vendor: executeCreateVendor,
  update_vendor: executeUpdateVendor,
  create_customer: executeCreateCustomer,
  update_customer: executeUpdateCustomer,
  create_company: executeCreateCompany,
  create_currency: executeCreateCurrency,
  create_exchange_rate: executeCreateExchangeRate,
  // the one read: the ids of the organisation's records the functions above take
  list_organisation_records: executeListOrganisationRecords,
};
