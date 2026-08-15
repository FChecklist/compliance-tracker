# src/app/api/ -- route directory map

VERIDIAN Review Framework gap-closure (AI Engineering Quality / File &
Folder Organization, Medium): this directory has 129 top-level route
groups and ~880 files with no navigation aid, which is the real half of
that finding (the other half -- consolidating `ai-os/`'s tree4-unified/
audit-tree/system-tree subtrees -- turned out not to match reality on
investigation; see PROGRESS.md for that finding's own writeup).

Every subdirectory is a Next.js App Router route segment
(`src/app/api/<name>/**/route.ts`). All routes call `requireAuth()` (or
`requireAuthOrApiKey()`) from `src/lib/supabase/auth-guard.ts` and use
Drizzle only -- see the root `CLAUDE.md` for those repo-wide rules. This
file is a grouping/index, not a duplicate source of truth for what each
route does -- read the route file itself for behavior.

## Core compliance product

`compliance`, `compliance-costs`, `contract-compliance`, `checklists`
(under `internal`/`tasks`), `notices`, `challans`, `tds-returns`,
`mca-filings`, `gst-reconciliation`, `secretarial-audit`, `departments`,
`documents`, `frameworks`, `policies`, `incidents`, `whistleblower`,
`posh`, `fraud-cases`, `it-dr`, `bcm`.

## Governance / regulator-specific

`rbi`, `sebi`, `irdai`, `esg`, `board`, `board-evaluation`, `committees`,
`cap-table`, `directors`, `doa` (delegation of authority),
`secretarial-audit`.

## Audit

`audit`, `audit-engagements`, `audit-findings`, `audit-points`,
`fm` (fraud management).

## ERP & Finance (`erp/`, 38 sub-routes)

Accounting, Payroll, Fixed Assets, Sales Orders/Quotations, Purchase
Orders/Receipts, Inventory, Banking, Contracts, Budgets, and more --
one subdirectory per module under `src/app/api/erp/`. See
`src/lib/services/permission-service.ts`'s `ERP_ACTION_ROLES` for the
role-gating policy shared across these routes, and
[`../../../REUSABLE-UTILITIES.md`](../../../REUSABLE-UTILITIES.md) for
the other cross-cutting helpers ERP routes lean on.

## CRM / Sales

`crm`, `clients`, `client-portal`, `sales-hq`, `partner`,
`vendor-portal`, `vendor-risk`.

## HR / People

`hr`, `hr-compliance`, `recruitment`, `performance-reviews`,
`leave-holiday`, `the-firm` (org/people directory).

## Legal

`legal-matters`, `legal-opinions`, `legal-vendors`, `litigation`,
`ip-portfolio`, `clm` (contract lifecycle management),
`document-correspondents`, `document-matching-rules`,
`code-change-requests`.

## Construction / PROJEXA

`construction`, `pms` (project management suite), `projects`, `field-service-dispatches`.
(`v1/projexa`, `v1/pms`, `v1/construction` are the versioned public-API
aliases for a subset of these -- see `v1/openapi.json`.)

## AI / Orchestra / Assistants

`ai`, `assistants`, `orchestra`, `dynamic-chains`, `capability-registry`,
`capability-tree`, `fde` (Free-Text Dispatch Engine), `forge`,
`prompt-eval`, `instruction-mismatches`, `mdm` (Master Data Management),
`connectors`, `mcp`.

## Chat / Communication

`veri-chat`, `guest-chat`, `conversations`, `email-intelligence`,
`drafted-communications`, `veri-meetings`, `notifications`,
`ticket-intelligence`, `tickets`, `voice-tickets`, `help`.

## Access / Identity / Platform

`auth`, `users`, `me`, `invite`, `invite-links`, `join-code`,
`join-codes`, `access-review`, `approvals`, `approval-workflows`,
`settings`, `installed-products`, `products`, `workspace-memory`,
`worker-agents`, `stage0`, `internal`, `webhooks`, `search`,
`custom-charts`, `metric-alert-rules`, `automation-rules`, `kpi-hub`,
`reports`, `rpt`, `track`, `veri-reward`, `veri-todo`, `work-dashboard`,
`shared`, `home`, `contact`, `charges`, `esignature`, `ingest`, `health`.

## Versioned public API (`v1/`)

`v1/` holds the versioned, API-key-reachable alias surface
(`requireAuthOrApiKey()`), documented in `v1/openapi.json`: `brain`,
`compliance`, `connectors`, `construction`, `documents`, `erp`, `notices`,
`platform`, `pms`, `projexa`, `tasks`.

---

Keep this file additive/regenerable, not hand-curated prose per route --
if it drifts noticeably from `ls src/app/api`, regenerate the groupings
rather than trust it blindly.
