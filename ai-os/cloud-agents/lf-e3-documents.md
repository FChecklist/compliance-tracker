# Package lf-e3-documents (laptop app, repo projexa)

Branch `claude/lf-e3-documents` from `origin/feat/local-first-complete`. Read `ai-os/cloud-agents/lf-e-COMMON.md` (compliance-tracker clone, branch `origin/feat/lf-sync-backend`) right after the PREAMBLE: it holds the module-conversion rules.

## Cluster: documents
Cluster file `src/lib/local-first/shell/clusters/documents.ts`, nav orders 40 to 59. Modules (visible ones in `src/lib/module-catalogue.ts`): **permits**, **drawings**, **documents**, **moms** (minutes of meetings). Related replica kinds: documents, drawings, permits, meetings, meeting_minutes, rfis, submittals, wiki pages, depending on what the real screens read.

Priorities: (1) the record lists and detail screens (metadata, status, revision history) open offline; (2) **file bodies**: the replica carries metadata, not file contents. Decide and document how a drawing/document PDF or image is handled offline (the app must not download every file for free; propose an on-demand "keep this file on this laptop" that stores the blob in IndexedDB the first time it is opened online, or a size-capped cache of the person's recent files; implement the metadata side and the cache hook if it fits, and say what remains); (3) writes: wire only what the registry can take; minutes of meetings and permit status changes are likely candidates, check the registry; (4) never invent a field the sync does not carry.
