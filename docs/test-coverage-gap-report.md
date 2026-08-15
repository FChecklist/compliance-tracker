# VERIDIAN Test Coverage Gap Report

Generated: 2026-08-15T11:02:58.767Z

Colocated-test coverage: 101/1549 source files (7%) have a colocated `*.test.ts`/`*.test.tsx` file; 103 test files exist total.

## Largest files (split-priority order)

AI Maintainability finding "AI Can Safely Understand Module": understanding quality varies with file size. These are the files to split first.

- 10197 lines -- `src/lib/db/schema.ts`
- 2438 lines -- `src/lib/task-execution-engine.ts`
- 1569 lines -- `src/lib/services/report-engine-service.ts`
- 1492 lines -- `src/lib/services/capability-tree-service.ts`
- 1001 lines -- `src/lib/services/chat-service.ts`
- 796 lines -- `src/lib/services/erp-fixed-assets-service.ts`
- 776 lines -- `src/lib/services/capability-audit-service.ts`
- 727 lines -- `src/components/ui/sidebar.tsx`
- 725 lines -- `src/app/(app)/compliance/[id]/page.tsx`
- 725 lines -- `src/components/veri-chat/VeriChatPanel.tsx`
- 721 lines -- `src/components/veri-chat/VeriComposer.tsx`
- 699 lines -- `src/lib/services/erp-invoicing-service.ts`
- 695 lines -- `src/components/AppSidebar.tsx`
- 678 lines -- `src/app/veri-fm-cs/page.tsx`
- 677 lines -- `src/app/forge/page.tsx`
- 673 lines -- `src/app/office/page.tsx`
- 660 lines -- `src/lib/ai-team/roster.ts`
- 647 lines -- `src/lib/services/training-service.ts`
- 630 lines -- `src/app/(app)/reports/page.tsx`
- 620 lines -- `src/app/(app)/erp/invoicing/page.tsx`

## Highest-traffic untested files (test-generation priority order)

AI Maintainability findings "AI Can Generate Tests for Module" / "AI Can Refactor Module": no untested file is a good place to start, but these are imported by the most other files in this codebase, so covering them first buys the most safety net per test written. "Imported by" is a relative-import fan-in heuristic keyed by basename, not an exact call-graph count -- see this script's header comment.

- imported by ~124 files -- `src/lib/services/compliance-service.ts`
- imported by ~24 files -- `src/lib/services/erp-enablement-service.ts`
- imported by ~9 files -- `src/lib/db.ts`
- imported by ~8 files -- `src/lib/services/firm-enablement-service.ts`
- imported by ~8 files -- `src/lib/services/fm-enablement-service.ts`
- imported by ~8 files -- `src/lib/services/product-branch-service.ts`
- imported by ~7 files -- `src/app/litert-spike-embeddings/types.ts`
- imported by ~7 files -- `src/app/litert-spike/types.ts`
- imported by ~7 files -- `src/lib/ingest/types.ts`
- imported by ~6 files -- `src/lib/db/schema.ts`
- imported by ~6 files -- `src/lib/services/erp-financial-report-service.ts`
- imported by ~5 files -- `src/lib/services/asset-query-service.ts`
- imported by ~5 files -- `src/lib/services/context.ts`
- imported by ~4 files -- `src/components/veri-chat/veri-chat-context.tsx`
- imported by ~3 files -- `src/lib/services/erp-inventory-service.ts`
- imported by ~3 files -- `src/lib/services/report-catalog-service.ts`
- imported by ~2 files -- `src/components/veri-chat/ChainSelector.tsx`
- imported by ~2 files -- `src/i18n/locales.ts`
- imported by ~2 files -- `src/lib/db/tenant-scoped.ts`
- imported by ~2 files -- `src/lib/services/client-access-service.ts`
