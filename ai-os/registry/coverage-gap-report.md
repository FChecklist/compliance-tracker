# AI Maintainability -- Coverage Gap & File-Size Report

Generated: 2026-08-15T05:59:38.347Z

Regenerate with `bun run report:coverage-gaps` (or `bun run scripts/report-maintainability-gaps.ts`). This is a point-in-time snapshot, not a live number -- both the file-size distribution and test coverage change on every merge; re-run before relying on it for a real prioritization decision.

Source data: 1793 non-test .ts/.tsx files under src/, 327 of which appear in the bun:test coverage profile at all (i.e. are imported/exercised by at least one existing test).

## Split-priority: largest files (VERIDIAN Review Framework finding: "AI Can Safely Understand Module")

Files over 500 lines, largest first. Understanding quality varies with file size (framework finding, Low severity) -- these are the files where an AI agent's context window and comprehension are most strained, and the first candidates for splitting into smaller, single-responsibility modules.

| Lines | File |
|---|---|
| 11495 | `src/lib/db/schema.ts` |
| 2584 | `src/lib/task-execution-engine.ts` |
| 1791 | `src/lib/services/report-engine-service.ts` |
| 1599 | `src/lib/services/erp-invoicing-service.ts` |
| 1559 | `src/lib/services/capability-tree-service.ts` |
| 1270 | `src/lib/services/chat-service.ts` |
| 1117 | `src/lib/services/crm-service.ts` |
| 1115 | `src/lib/services/erp-fixed-assets-service.ts` |
| 900 | `src/lib/services/construction-reports-service.ts` |
| 776 | `src/lib/services/capability-audit-service.ts` |
| 765 | `src/components/veri-chat/VeriComposer.tsx` |
| 744 | `src/app/api/ai/team/dispatch/route.ts` |
| 727 | `src/components/ui/sidebar.tsx` |
| 725 | `src/app/(app)/compliance/[id]/page.tsx` |
| 724 | `src/lib/services/erp-selling-service.ts` |
| 715 | `src/components/veri-chat/VeriChatPanel.tsx` |
| 705 | `src/lib/llm-client.ts` |
| 700 | `src/components/AppSidebar.tsx` |
| 696 | `src/lib/services/ticket-service.ts` |
| 692 | `src/lib/services/erp-payment-entries-service.ts` |

## Test-coverage-gap priority list (VERIDIAN Review Framework findings: "AI Can Generate Tests for Module", "AI Can Refactor Module")

Files under 20% line coverage, ranked by `lines x traffic weight` (services and API routes weighted highest -- see `trafficWeight()` in this report's own script for the exact, documented weighting). This is the priority order for both writing new tests (no systematic test-generation tooling today) and for building a refactor safety net before touching high-traffic code (same recommendation, two framework rows).

| Priority score | Lines | Coverage | File |
|---|---|---|---|
| 5373 | 1791 | 12% | `src/lib/services/report-engine-service.ts` |
| 5168 | 2584 | 2% | `src/lib/task-execution-engine.ts` |
| 4797 | 1599 | 15% | `src/lib/services/erp-invoicing-service.ts` |
| 3810 | 1270 | 9% | `src/lib/services/chat-service.ts` |
| 3351 | 1117 | 17% | `src/lib/services/crm-service.ts` |
| 3345 | 1115 | 16% | `src/lib/services/erp-fixed-assets-service.ts` |
| 2088 | 696 | 14% | `src/lib/services/ticket-service.ts` |
| 2076 | 692 | 19% | `src/lib/services/erp-payment-entries-service.ts` |
| 1941 | 647 | 13% | `src/lib/services/training-service.ts` |
| 1800 | 600 | 9% | `src/lib/services/erp-payroll-service.ts` |
| 1779 | 593 | 9% | `src/lib/services/erp-accounting-service.ts` |
| 1773 | 591 | 0% | `src/app/api/mcp/route.ts` |
| 1743 | 581 | 5% | `src/lib/services/compliance-service.ts` |
| 1608 | 536 | 14% | `src/lib/services/erp-contract-service.ts` |
| 1539 | 513 | 8% | `src/lib/services/task-service.ts` |
| 1536 | 512 | 11% | `src/lib/services/stage0-service.ts` |
| 1443 | 481 | 11% | `src/lib/services/fde-service.ts` |
| 1386 | 462 | 13% | `src/lib/services/dynamic-chain-directory-service.ts` |
| 1386 | 462 | 5% | `src/lib/services/veri-reward-service.ts` |
| 1371 | 457 | 9% | `src/lib/services/erp-financial-report-service.ts` |
| 1359 | 453 | 9% | `src/lib/services/erp-procurement-workflow-service.ts` |
| 1338 | 446 | 0% | `src/lib/services/workspace-memory-service.ts` |
| 1215 | 405 | 0% | `src/app/api/ai/orchestrate/route.ts` |
| 1206 | 402 | 9% | `src/lib/services/approval-workflow-service.ts` |
| 1191 | 397 | 0% | `src/lib/services/sales-engine-service.ts` |
| 1137 | 379 | 0% | `src/lib/services/gst-reconciliation-service.ts` |
| 1122 | 374 | 0% | `src/lib/services/risk-register-service.ts` |
| 1056 | 352 | 19% | `src/lib/services/prompt-os-service.ts` |
| 1020 | 510 | 9% | `src/lib/activity-log-service.ts` |
| 1008 | 336 | 17% | `src/lib/services/esignature-service.ts` |
