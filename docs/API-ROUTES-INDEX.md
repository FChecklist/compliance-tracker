# API Routes — Top-Level Navigation Index

VERIDIAN Review Framework gap-closure, AI Engineering Quality / Code
Structure & Modularity ([Medium] "File & Folder Organization" finding:
*"API route ... folders are large enough to need their own navigation
aids"*). `src/app/api/` holds 1,019 `route.ts` files across 140 top-level
route groups as of this writing — too many to browse by directory listing
alone. This is a generated, mechanically-verifiable index of the top-level
groups by route count, not a hand-maintained description of all 1,019
individual endpoints (that's what each route file's own code is for).

Regenerate the counts with:

```sh
git ls-files src/app/api -- '*route.ts' | awk -F/ '{print $4}' | sort | uniq -c | sort -rn
```

## Largest route groups (>= 10 route.ts files)

| Group | Routes | What it covers |
|---|---:|---|
| `v1/` | 232 | Versioned public/product API surface. The large majority (~190 of the 232) is `v1/projexa/*` — the PROJEXA alias layer over the same compliance-tracker engines, not a second implementation (see `ai-os/system-tree/20-projexa.yaml`). |
| `erp/` | 157 | The ERP product surface (accounting, procurement, inventory, payroll, fixed assets, contracts, budgets — see `src/app/(app)/erp/*` for the matching UI). |
| `pms/` | 37 | Project Management Suite (boards, sprints, issues, time entries, wiki, roadmap). |
| `crm/` | 35 | CRM (leads, opportunities, accounts, campaigns, pipeline). |
| `construction/` | 35 | Construction-vertical engines (BOQ, valuations, progress claims, prevailing-wage rates) — real in schema+API, no dedicated top-level `(app)/` nav item yet (see `[[country-config-architecture-state]]`-style scope caveats noted elsewhere in this repo's docs). |
| `the-firm/` | 29 | The-Firm (CA/audit-firm practice management) vertical. |
| `internal/` | 24 | Internal/ops-only endpoints, not customer-facing product surface. |
| `training/` | 22 | LMS (courses, paths, enrollments). |
| `settings/` | 22 | Org/user settings (branding, SSO, MFA, API keys, webhooks, AI config). |
| `ai/` | 22 | AI orchestration surface (team dispatch, orchestrate, cache utilization). |
| `hr/` | 20 | HR (attendance, shifts, loans, expense claims). |
| `veri-meetings/` | 11 | AI meeting assistant (VERI Meetings). |
| `reports/` | 11 | Custom report builder/catalog/scheduling. |
| `performance-reviews/` | 11 | Performance review cycles, goals, raters. |
| `veri-chat/` | 10 | The core VERI Chat conversational surface. |
| `gst-reconciliation/` | 10 | GST invoice reconciliation engine. |

## Everything else

124 more top-level groups exist, most in the 1–9 route range (e.g.
`compliance/`, `tasks/`, `documents/`, `tickets/`, `orchestra/`,
`legal-matters/`, `esignature/`, `conversations/`, `clm/`, `mdm/`,
`email-intelligence/`, `bcm/`, `notices/`, `knowledge-base/`, `connectors/`,
`auth/`, `assistants/` — one route group per product feature area, mostly
matching a `src/app/(app)/<feature>/` UI page 1:1). Re-run the command
above for the full current breakdown rather than trusting a number here to
stay accurate as the codebase grows.

## Convention

Every route group under `src/app/api/` follows the same two rules
(enforced by `scripts/check-route-error-handling.mjs` and
`scripts/check-route-auth-guard.mjs`, both diff-scoped CI checks — see
their own headers for current CI-wiring status):

1. Call `requireAuth()` (`@/lib/supabase/auth-guard`) before doing anything
   with the request.
2. Wrap the handler body in `try`/`catch` and translate service-layer
   `ServiceError`s into `NextResponse.json({ error }, { status })`.

See `docs/REUSABLE-UTILITIES.md` for the other cross-cutting helpers a new
route typically needs.
