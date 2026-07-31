# PROGRESS -- task-20260731-044016-pm--automation-rules-chaining

## Completed
- [x] Read ACTIVE-CLAIMS.yaml (no collision), registered this session's claim
- [x] Read automation-rule-service.ts + schema (automation_rules/automation_rule_runs) -- confirmed triggerType/actionType are plain `text`, no DB CHECK constraint, so this task needs zero migrations
- [x] Read the real trigger catalog (grepped every evaluateAndRunRules() call site, not the stale UI dropdown) -- confirmed 6 real call sites
- [x] Read KERNEL_CONSOLIDATION_STATUS.md's Task #47 finalized gap analysis + PLATFORM_STRATEGY.md §15.3 Wave 30 origin note for the reference's 8 event types (Zoho WorkflowRule: Create/Edit/Delete/StatusChange/DueDate/Assignment/Comment/Time-based)
- [x] Confirmed origin/main fresh (no new commits since last fetch) and that no migration is needed for this task

- [x] Implement multi-condition AND/OR matching in automation-rule-service.ts (backward-compatible with existing single-condition rules) -- `conditionsMatch()`, `TriggerConditionGroup`
- [x] Implement rule chaining: new `trigger_rule` action type + pure `planRuleChain()` cycle-detection (path-based, not just global-visited) + rewire evaluateAndRunRules() to use it
- [x] Add 2 new trigger call sites: pms_issue.assigned (Assignment) in pms-issue-service.ts's updateIssue(); pms_issue.due_soon (Time-based/DueDate) via new checkPmsIssuesDueSoon(), wired into /api/internal/metric-alerts/run cron
- [x] Update automation/page.tsx TRIGGER_TYPES + createAutomationRule() validation for new action type/trigger types
- [x] Write automation-rule-service.test.ts covering chaining, multi-condition AND/OR, and cycle-detection stopping an infinite chain -- 17 tests, all passing (`bun test`, 34 expect() calls, 0 fail)

## Remaining
- [ ] npx tsc --noEmit clean -- OOM'd twice under this shared box's memory pressure (13-14Gi/15Gi used by concurrent sessions' processes); retrying now with NODE_OPTIONS max-old-space-size=4096 in background, not yet confirmed clean
- [ ] Commit + push, open PR (CI-green, no self-merge, no self-audit)
- [ ] Append PR line to KERNEL_CONSOLIDATION_STATUS.md's Task #47 section
