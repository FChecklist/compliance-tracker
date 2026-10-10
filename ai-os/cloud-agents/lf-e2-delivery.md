# Package lf-e2-delivery (laptop app, repo projexa)

Branch `claude/lf-e2-delivery` from `origin/feat/local-first-complete`. Read `ai-os/cloud-agents/lf-e-COMMON.md` (compliance-tracker clone, branch `origin/feat/lf-sync-backend`) right after the PREAMBLE: it holds the module-conversion rules.

## Cluster: project delivery
Cluster file `src/lib/local-first/shell/clusters/delivery.ts`, nav orders 20 to 39. Modules (the visible ones in `src/lib/module-catalogue.ts`): **work-progress** (list, entry, export: `/work-progress`, `/work-progress/entry`, `/work-progress/export` or whatever the real routes are), **labour**, **materials**, **schedule**. Look for related kinds in the replica: construction activities, work progress entries, materials, material receipts/issues, attendance, timesheets, roster, schedule baselines, site diaries.

Priorities: (1) the lists and object screens a site person uses daily must open offline from the local database (progress entries of today, activities, materials stock/receipts, labour attendance, the schedule); (2) the daily WRITE of a progress entry: the backend registry has `record_work_progress` but it does not yet accept `activityId`/`entryBasis` (the review of the sync backend noted this): wire the writes the registry can take now, and describe precisely in GAPS what the registry function must accept so the entry screen can be fully offline; (3) the Gantt/schedule is read from local activities (no server-computed critical path offline: if the online screen computes something, show the stored values only and say "recalculated when online").
