# src/app/api/ -- navigation aid

VERIDIAN Review Framework gap-closure (AI Engineering Quality / File & Folder
Organization, 2026-08-15): this API surface is large enough (138 top-level
route groups under `src/app/api/`, ~995 `route.ts` files) that it needs its
own index rather than relying on directory-name guessing. This file is a map
of what's here and how the two real surfaces relate -- not a per-endpoint
catalog (that's what `src/app/api/v1/openapi.json/route.ts` generates for
the versioned surface; every route's own file is still the source of truth
for its exact contract).

## The two real surfaces

- **`src/app/api/v1/`** -- the versioned, documented surface. Nests a
  smaller set of domains (`brain/`, `compliance/`, `connectors/`,
  `construction/`, `documents/`, `erp/`, `notices/`, `platform/`, `pms/`,
  `projexa/`, `reports/`, `tasks/`) and is the one surface with a real
  OpenAPI generator (`v1/openapi.json/route.ts`). `v1/projexa/*` is
  specifically the PROJEXA alias layer -- it re-exposes the same
  compliance-tracker engines under PROJEXA's own contract rather than
  duplicating logic (see `ai-os/registry/` PROJEXA notes / `AGENTS.md`'s own
  brand-layer history).
- **Everything else at the root of `src/app/api/`** -- the original,
  larger, feature-area-per-directory API the app's own frontend
  (`src/app/(app)/*`) calls directly. Every top-level directory name here is
  the feature/domain it serves (e.g. `erp/`, `crm/`, `hr/`, `construction/`)
  -- some domains (`erp`, `compliance`, `construction`, `pms`) exist at
  BOTH the root and under `v1/` because the root version is the original
  in-product surface and the `v1/` version is that same domain's later,
  externally-documented cut; they are not accidental duplicates of each
  other and should not be merged.

Every route file still MUST call `requireAuth()` from
`@/lib/supabase/auth-guard` (per `CLAUDE.md`'s own rule, and enforced
going forward by `scripts/check-api-route-conventions.mjs` in CI -- see
that script's own header) and use Drizzle only, never Prisma.

## Root-level domains, grouped

138 top-level directories is too many to list one-by-one usefully; grouped
by real domain, with a few representative directory names per group so a
directory name is guessable rather than requiring a full scan:

| Group | Representative directories | What it covers |
|---|---|---|
| Compliance & regulatory | `compliance/`, `challans/`, `notices/`, `gst-reconciliation/`, `tds-returns/`, `mca-filings/`, `sebi/`, `rbi/`, `irdai/`, `secretarial-audit/`, `hr-compliance/` | Statutory compliance tracking, GST/TDS reconciliation, regulator-specific filings. |
| ERP / Finance | `erp/`, `charges/`, `cap-table/`, `compliance-costs/` | Accounting, inventory, procurement, fixed assets, budgets -- see `erp/` and `v1/erp/` above. |
| HR & People | `hr/`, `recruitment/`, `performance-reviews/`, `leave-holiday/`, `training/`, `veri-reward/` | Employee lifecycle, performance, L&D. |
| CRM & Sales | `crm/`, `sales-hq/`, `clients/`, `client-portal/`, `partner/`, `vendor-portal/` | Leads/opportunities, sales dashboards, external-facing portals. |
| Construction / PROJEXA | `construction/`, `pms/`, `field-service-dispatches/` | Project/site management -- see `v1/construction/`, `v1/pms/`, `v1/projexa/` for the PROJEXA-facing cut. |
| Legal & Risk | `legal-matters/`, `legal-opinions/`, `legal-vendors/`, `litigation/`, `risks/`, `fraud-cases/`, `whistleblower/`, `ip-portfolio/`, `contract-compliance/` | The-Firm (legal ops) + enterprise risk/fraud/whistleblower intake. |
| Governance & Audit | `audit/`, `audit-engagements/`, `audit-findings/`, `audit-points/`, `governance/`, `committees/`, `board/`, `board-evaluation/`, `directors/`, `doa/`, `delegations/` | Internal/statutory audit workflow, board & governance records. |
| Documents & Comms | `documents/`, `document-correspondents/`, `document-matching-rules/`, `drafted-communications/`, `esignature/`, `conversations/`, `ingest/` | Document store, matching/dedup, e-signature, comms drafting. |
| AI / Orchestra platform | `ai/`, `orchestra/`, `assistants/`, `veri-chat/`, `veri-meetings/`, `veri-todo/`, `worker-agents/`, `capability-registry/`, `capability-tree/`, `forge/`, `mcp/`, `prompt-compiler/`, `prompt-eval/`, `dynamic-chains/`, `fde/`, `instruction-mismatches/` | The AI Dev Team / Orchestra / VERI Chat surfaces -- worker-agent dispatch, capability learning, dynamic chains, MCP. |
| Tickets & Support | `tickets/`, `ticket-teams/`, `ticket-intelligence/`, `voice-tickets/`, `support-sessions/`, `guest-chat/`, `sla-policies/`, `problem-records/`, `incidents/` | Helpdesk/ITSM. |
| Platform / meta | `settings/`, `users/`, `me/`, `auth/`, `departments/`, `approvals/`, `approval-workflows/`, `automation-rules/`, `escalation-rules/`, `access-review/`, `connectors/`, `search/`, `health/`, `webhooks/`, `public/`, `stage0/`, `join-code(s)/`, `invite(-links)/`, `notifications/`, `custom-charts/`, `metric-alert-rules/`, `glossary/`, `frameworks/`, `installed-products/`, `products/`, `track/`, `home/`, `internal/`, `shared/`, `help/`, `kpi-hub/`, `work-dashboard/`, `workspace-memory/`, `bcm/`, `it-dr/`, `esg/`, `mdm/`, `posh/`, `code-change-requests/`, `email-intelligence/`, `knowledge-base/`, `assets/` | Cross-cutting platform concerns not owned by one business domain. |

For any directory not obviously covered above, its own name is the domain
it serves -- `grep -rl` for the resource name inside `src/lib/services/` is
the fastest way to find the service layer backing it (every route here
delegates to a `src/lib/services/*-service.ts`, per this repo's own
convention).
