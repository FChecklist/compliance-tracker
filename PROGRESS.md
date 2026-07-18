# PROGRESS -- task-20260718-092002-checks---balances--separation-of-duties

VERIDIAN Review Framework gap-closure: Checks & Balances / Separation of
Duties & Approval Controls. The task listed 8 findings, but they are 4
distinct findings duplicated twice each in the source list -- this PR
closes all 4 in one coherent change, matching the task's own instruction
to keep related findings in one PR.

## Completed

### 1. Separation of Duties (SoD) -- hard requesterId != approverId check
- [x] Read the shared Approval Workflow Engine (`approval-workflow-service.ts`) first: it already has a real, tested `isSelfApproval()` hard check (added in a prior wave, commit `52bc3aa7`) -- the finding's premise that "only role-based gating" exists there is now out of date. Not re-adding it there, reused it everywhere below instead.
- [x] Audited every other approve/reject/decide call site in the codebase (via a dedicated research pass across ~30 candidate files/routes) for a hard requester-vs-approver equality check, not just role-rank.
- [x] Fixed real, confirmed gaps (role-rank check only, no self-check before this PR):
  - `src/app/api/approvals/[id]/route.ts` (PATCH) -- the older single-purpose `approvalRequests` maker-checker table/route. Any admin-rank user who created a `policy_publish`/`worker_agent_proposal`/`code_change_request` row could approve/reject it themselves.
  - `src/lib/services/erp-selling-service.ts:updateQuotationStatus` -- a manager-rank sales rep could approve their own quotation (`erpQuotations.createdById`).
  - `src/lib/services/hr-service.ts:decideLeaveRequest` -- a manager could approve/reject their own leave request (`leaveRequests.userId`).
  - `src/lib/services/construction-boq-service.ts:approveBoq` -- a manager could approve a BOQ they created (`constructionBoqs.createdById`).
  - `src/lib/services/erp-returns-service.ts` -- `approveSalesReturn`, `rejectSalesReturn`, `approvePurchaseReturn`, `rejectPurchaseReturn` (`requestedById` on both `erpSalesReturns`/`erpPurchaseReturns`).
  - `src/lib/services/construction-field-workflow-service.ts:verifyPunchListItemClosed` -- the function's own existing comment already stated the "don't let the person who did the work sign off their own fix" intent but never enforced it (`assignedToId`); now enforced.
  - `src/lib/services/construction-field-workflow-service.ts:reviewSubmittal` -- a reviewer could review their own submittal (`submittedById`).
  - `src/lib/services/access-review-service.ts:reviewCertification` -- a self-certification variant: an admin could certify/revoke their OWN continued-access row (`accessReviewCertifications.userId` is the subject, not a requester, but the same self-attestation hole applies).
  - `src/lib/services/erp-contract-service.ts:approveAmendment` -- confirmed dead code (no route currently calls it), fixed defensively for when it's eventually wired up.
- [x] Confirmed already-fixed, left untouched: `erp-payment-entries-service.ts:canDecidePaymentEntry` (explicit `isSelfApproval` check) and `construction-kpi-service.ts:approveKpiEntry` (explicit inline check).
- [x] `bun test` (full suite): 1428 pass / 0 fail. `bunx tsc --noEmit`: clean. `bunx eslint` on every changed file: clean.

### 2. Four-Eyes Principle for Critical Actions
- [x] Read `high-impact-action-detector.ts` (9 categories: delete/archive/payment/approval/rejection/compliance_submission/access_changes/data_export/configuration_changes) and every existing consumer (AI Team dispatch risk classification, task/chat confirmation gate) before changing anything.
- [x] Cross-wired the same detector into `approval-workflow-service.ts`: a step whose `entityType`/`name` text matches one of the 9 categories now gets `requiredApprovals` **floored at 2** (not just defaulted) -- enforced at `createWorkflowDefinition` (so new definitions are correct from the start) AND again at `startApprovalWorkflow`'s step-instance creation (so a stored definition from before this change, or edited directly, still gets the floor at the real gating chokepoint -- no data migration needed, the floor is live-enforced where it actually matters).
- [x] Extended `delete`'s trigger phrases with "dispose"/"disposal" (additive) so fixed-asset disposal -- a real permanent removal, just not literally named "delete" -- is correctly caught; this benefits every existing consumer of the detector, not just this PR.
- [x] New pure, exported, directly-testable functions: `detectCriticalActionCategory()`, `enforceFourEyesFloor()`. 7 new unit tests added to `approval-workflow-service.test.ts`.

### 3. Role-Based Approval Matrix
- [x] Confirmed no aggregate view existed: `GET /api/approval-workflows` already returns every workflow definition + steps across all entity types when `entityType` is omitted (this was already true), but nothing in the UI rendered that holistically -- the only admin-facing "who approves what" view was the unrelated, manually-entered `src/app/(app)/doa` (Delegation of Authority) table.
- [x] Annotated `listWorkflowDefinitions()`'s response with each step's inferred `highImpactCategory` and `fourEyesSatisfied` flag (derived from the same four-eyes cross-wire above), so the matrix view can show, at a glance, any step that names a critical action but doesn't yet meet the four-eyes floor (e.g. a definition created before this PR).
- [x] New `ApprovalMatrixSection` component (`src/components/home/ApprovalMatrixSection.tsx`), added to the existing `/approvals` page alongside `ApprovalTab` and `WorkflowApprovalsSection` -- one table, every entity type's workflow steps, approver role, required approvals, four-eyes badge, and critical-category badge.

### 4. Conflict of Interest Detection -- correctly deferred, not built
- [x] Audited `entity_relationships` real usage before assuming the finding's premise was still accurate. Every `relationshipType` value actually written today (`triggers_approval`, `depends_on`, `owned_by`, `sourced_from`, `supersedes`, `executed_by`) is a system/asset/chain graph edge -- **zero personal or vendor relationship edges exist**.
- [x] Checked for any other pre-existing COI mechanism (`related_party_transactions` table) -- confirmed it's a manually-entered board/audit-committee disclosure log, not a queryable approver-vs-requester relationship check, and not applicable here.
- [x] Conclusion: the finding's own recommended approach ("scope a COI-flagging feature once entity_relationships has real relationship data to query") is still exactly the right call as of this session -- there is no real relationship data to query yet, so building a detector now would be a feature that can never actually fire. Not building it. When a future wave adds real personal/vendor `entity_relationships` edges (e.g. `reports_to`, `related_to`, `vendor_contact_of`), the natural next step is a `checkConflictOfInterest(orgId, requesterId, approverId)` query against those edges, callable from the same approval decision paths this PR just hardened with `isSelfApproval()` checks.

## Remaining
- [ ] None for this task's 4 findings. COI detection (finding 4) is intentionally deferred per its own recommended approach -- see note above, not a TODO for this PR.
