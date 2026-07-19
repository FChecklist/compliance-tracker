# PROGRESS -- task-20260719-004413-gap-closure--res-02-phase1

RES-02 / GAP-NARROW-MONITOR-ESCALATION Phase 1 (src/lib/monitor-protocol.ts):
expand Tier-1 rule-engine monitor coverage beyond APPROVAL_GRANTED/
APPROVAL_REJECTED (2 of ~30 documented event types) to as many of the
remaining ~28 as have a REAL call site + genuine deterministic rule +
authenticated dbUser/TenantDb context -- no invented call sites/rules.

## Completed
- [x] Read ai-os/CONSTITUTION.yaml RES-02 entry + src/lib/monitor-protocol.ts
      + PLATFORM_STRATEGY.md §29 in full
- [x] Checked ai-os/boss/ACTIVE-CLAIMS.yaml + `gh pr list` -- no duplicate
      claim found for this specific Phase 1 gap
- [x] Registered claim in ACTIVE-CLAIMS.yaml (separate first commit)
- [x] Researched real call sites for all documented event-type wildcards
      (TASK_*, TODO_*, MEETING_*, MOM_*, DOCUMENT_*, FILE_*, WORKFLOW_*,
      HANDOVER_COMPLETED, REMINDER_SENT, NOTIFICATION_DELIVERED,
      LOGIN_SUCCESS, API_SUCCESS/FAILED, DATABASE_UPDATED, REPORT_GENERATED,
      DASHBOARD_UPDATED) via 3 parallel Explore agents -- see PR description
      for the full per-category findings
- [x] Scoped final Phase 1 slice: 5 new monitors covering 9 event names
      (WORKFLOW_STARTED/COMPLETED, TASK_CREATED/COMPLETED,
      MEETING_SCHEDULED/COMPLETED, MOM_GENERATED, API_SUCCESS/FAILED) at
      real call sites with real dbUser/TenantDb context + genuine
      deterministic rules (no fabricated business logic)

## Remaining
- [ ] Build shared src/lib/monitors/rule-engine-monitor.ts (factors out
      approval-decision-monitor.ts's own registry-lookup + validate +
      escalate + log pattern for reuse -- that file itself untouched)
- [ ] workflow-completion-monitor.ts wired at approval-workflow-service.ts's
      decideApprovalStep (approvalWorkflowInstances.createdAt vs
      completedAt <= SLA)
- [ ] task-completion-monitor.ts wired at task-service.ts's updateTask
      (tasks.dueDate vs updatedAt-at-completion)
- [ ] board-meeting-hold-monitor.ts wired at
      src/app/api/board/[id]/route.ts's "hold" action
      (boardMeetings.meetingDate vs updatedAt-at-hold <= SLA)
- [ ] meeting-intelligence-generation-monitor.ts wired at
      veri-meeting-service.ts's generateMeetingIntelligence (success/failure)
- [ ] webhook-delivery-outcome-monitor.ts wired at webhook-deliver.ts's
      deliverWebhook (per-webhook final attempt success/failure)
- [ ] New drizzle migration seeding the 5 new monitor_agents registry rows
- [ ] Unit tests for the shared executor + all 5 new monitors (happy path +
      escalate path + invalid-report path, mirroring
      dispatch-completion-monitor.test.ts's structure)
- [ ] Update ai-os/CONSTITUTION.yaml RES-02 entry + MASTER-TRACKER.yaml's
      GAP-NARROW-MONITOR-ESCALATION entry to reflect the new real coverage
      count and honestly document which remaining event categories were
      investigated and found to have no real hookable call site (or no
      dbUser/TenantDb context) without inventing new architecture
- [ ] `bunx tsc --noEmit`, `bun run lint`, `bun test` all clean
- [ ] Push branch, open PR against main
- [ ] Post AUDIT: PASS PR comment
- [ ] CI green, self-merge or report tier for sign-off
