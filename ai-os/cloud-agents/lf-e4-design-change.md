# Package lf-e4-design-change (laptop app, repo projexa)

Branch `claude/lf-e4-design-change` from `origin/feat/local-first-complete`. Read `ai-os/cloud-agents/lf-e-COMMON.md` (compliance-tracker clone, branch `origin/feat/lf-sync-backend`) right after the PREAMBLE: it holds the module-conversion rules.

## Cluster: design and change
Cluster file `src/lib/local-first/shell/clusters/design-change.ts`, nav orders 60 to 79. Modules (visible ones in `src/lib/module-catalogue.ts`): **design-studio** (interior design: FF&E items, mood boards, floor plans, design items; look at which of these are visible and which hidden in the catalogue: convert only the visible screens), **change-orders** (and its approval flow: the approval itself is a server decision, never computed on the laptop; offline the person records the request and it is sent later). Related replica kinds: ffe_items, change orders, site_instructions, interim_bills, progress_claims, design items.

Priorities: (1) lists and object screens open offline; (2) change-order create/edit wired through the outbox where the registry has a function (check `function-registry.generated.json`), status shown as "waiting to be sent" until the server accepts; (3) images (mood boards, floor plans) follow the same on-demand local file rule as package E3 (do not download everything): implement the metadata side and report what is needed.
