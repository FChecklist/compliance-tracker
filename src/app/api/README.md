# API Routes Navigation Index

VERIDIAN Review Framework gap-closure ([Medium] File & Folder Organization,
AI Engineering Quality / Code Structure & Modularity): "API route... folders
are large enough to need their own navigation aids." `src/app/api/` has 138
top-level route groups (generated from a real `ls src/app/api` at the time
this doc was written, 2026-08-15) -- this is a grouped index so a new
contributor (human or AI) can find the right area without reading all 138
directory names cold. Every route still requires `requireAuth()` (see
`docs/architecture/REUSABLE-UTILITIES.md`) regardless of which group it's
in -- this index is for *navigation*, not a description of auth posture.

Re-derive/spot-check this list if it's gone stale rather than trusting it
forever -- `ls src/app/api` is the ground truth.

## Core Compliance & Departments
`compliance`, `compliance-costs`, `departments`, `notices`, `challans`,
`charges`, `mca-filings`, `tds-returns`, `hr-compliance`, `irdai`, `rbi`,
`sebi`, `secretarial-audit`

## GRC (Governance, Risk, Audit, Compliance program)
`governance`, `risks`, `frameworks`, `policies`, `audit`,
`audit-engagements`, `audit-findings`, `audit-points`, `incidents`,
`problem-records`, `whistleblower`, `posh`, `fraud-cases`, `access-review`,
`committees`, `board`, `board-evaluation`, `directors`, `delegations`,
`doa` (delegation of authority), `approvals`, `approval-workflows`,
`escalation-rules`, `esg`, `bcm` (business continuity), `it-dr` (IT
disaster recovery)

## HR
`hr`, `recruitment`, `performance-reviews`, `leave-holiday`, `training`

## ERP / Finance
`erp`, `gst-reconciliation`, `pms` (project/professional mgmt-services
billing), `cap-table`

## CRM & Sales
`crm`, `sales-hq`, `clients`, `client-portal`, `partner`, `vendor-portal`,
`vendor-risk`, `contract-compliance`, `clm` (contract lifecycle mgmt),
`installed-products`, `products`

## Legal
`legal-matters`, `legal-opinions`, `legal-vendors`, `litigation`,
`ip-portfolio`, `contact` (legal contact register)

## Construction / PROJEXA
`construction`, `fm` (facilities management), `field-service-dispatches`

## AI / Orchestra / Agents
`ai`, `orchestra`, `assistants`, `worker-agents`, `tasks` (task-execution-
engine.ts's public surface -- see `src/lib/task-execution/` for the
dispatch implementation), `capability-registry`, `capability-tree`,
`dynamic-chains`, `prompt-compiler`, `prompt-eval`, `forge`, `mcp`, `fde`
(free-text/dynamic execution), `automation-rules`, `instruction-mismatches`

## VERI Chat / Collaboration
`veri-chat`, `veri-meetings`, `veri-reward`, `veri-todo`, `guest-chat`,
`conversations`, `drafted-communications`, `email-intelligence`,
`support-sessions`, `ticket-intelligence`, `voice-tickets`

## Tickets / Helpdesk / Field Ops
`tickets`, `ticket-teams`, `help`, `sla-policies`, `business-hours-schedules`,
`metric-alert-rules`

## Docs / Content / Knowledge
`documents`, `document-correspondents`, `document-matching-rules`,
`knowledge-base`, `glossary`, `ingest`, `search`

## Reports / Dashboards
`reports`, `rpt`, `custom-charts`, `kpi-hub`, `work-dashboard`, `track`

## Platform / Auth / Settings / Identity
`auth`, `settings`, `users`, `me`, `invite`, `invite-links`, `join-code`,
`join-codes`, `stage0`, `mdm` (master data mgmt), `assets`,
`esignature`, `webhooks`, `connectors`, `notifications`

## Public / Internal / Misc
`public`, `internal`, `shared`, `home`, `health`, `the-firm`,
`code-change-requests`, `projects`, `workspace-memory`, `v1` (see below)

## `v1/`
A separate versioned sub-surface, largest single group (~164 route.ts files
under `v1/projexa/*` alone, per `ai-os/EXISTING_MODULE_ENGINE_WIRING_MAP_2026-08-02.md`)
-- primarily the PROJEXA alias layer over the same compliance-tracker
engines, plus other explicitly-versioned endpoints. Browse `v1/` directly
rather than expecting it to fit the groupings above.
