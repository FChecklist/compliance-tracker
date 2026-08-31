# VERIDIAN AI OS — Public API Changelog

**Covers:** `/api/v1/**` — the stable, versioned external contract for
building on VERIDIAN AI (mobile apps, ChatGPT Actions, Claude connectors,
reseller white-label apps, custom integrations, and PROJEXA, which is built
on VERIDIAN and reached through the same surface via the `/api/v1/projexa/*`
alias namespace). This is a separate, deliberately stable surface from the
internal `(app)/` UI routes, which can change without notice and are not
covered by this document.

**Current contract:** OpenAPI 3.1, version `1.0.0`, served live at
[`/api/v1/openapi.json`](/api/v1/openapi.json)
(`src/app/api/v1/openapi.json/route.ts` → `src/lib/openapi/generate.ts`).
That endpoint is always the authoritative, up-to-date schema; this document
is the human-readable history of what changed and when. All `/api/v1/**`
routes authenticate via `requireAuthOrApiKey()` (session cookie **or**
`Authorization: Bearer <api-key>` / API-key header — see
`src/lib/supabase/auth-guard.ts` and `src/lib/supabase/api-key-auth.ts`).
Testing safely before pointing real traffic at this surface? See
[`docs/API_SANDBOX.md`](API_SANDBOX.md).

**Rate limiting:** API-key-authenticated requests are subject to a
per-key rate limit — see [`docs/API_RATE_LIMITS.md`](./API_RATE_LIMITS.md)
for the default (unlimited), how to set a cap, and how enforcement works.

**How this document is maintained:** compiled directly from the git history
of `src/app/api/v1/**/route.ts` (every commit that added, removed, or
materially changed a route under this path), not hand-written release notes
kept separately from the code. Entries below are real, dated commits from
this repository — nothing here is a forward-looking promise or a
placeholder. When new `/api/v1/**` routes ship, add an entry here in the
same PR (matching the standing convention documented for `AGENTS.md`'s
change-history habits elsewhere in this repo) rather than backfilling later.

## Versioning Policy

**Added 2026-08-15** (VERIDIAN Review Framework gap-closure, Architecture &
Design / Reusability Across Scope: "Feature Reusability Across
Projects/Modules" — recommended adding versioning like
`/api/v1/projexa` vs `/api/v2/projexa` before breaking changes. The `/api/v1`
prefix itself has existed since 2026-07-03 (Wave 11, see the dated entry
below) and every route added since has landed under it; what this section
adds is the explicit policy for when a *second* version becomes necessary,
which didn't exist as a written rule before now — see "Known gaps in this
history" below, which already flagged this exact gap.

- **The version prefix (`v1`) versions the *contract*, not the product.**
  One `/api/v1/**` surface is shared by every caller — the web app's own
  `(app)/` UI (indirectly, through the same service layer), PROJEXA, MCP
  tools, and third-party integrations. `/api/v1/projexa/**` is a
  product-scoped **alias namespace within v1**, not a separate version —
  PROJEXA reuses the same contract version as core VERIDIAN because its
  routes haven't needed a breaking change relative to `v1`'s guarantees.
  A future `/api/v2/projexa/**` would only appear if PROJEXA specifically
  needed a breaking change that couldn't be made additively; it would not
  imply the rest of `/api/v1/**` moves too, and vice versa. Versioning is
  scoped per top-level namespace segment (`/api/v1/<namespace>/**`), not
  monolithic per-repo.
- **Additive changes stay on the current version — no new prefix.** Adding
  a new endpoint, adding a new optional/nullable response field, adding a
  new optional request parameter, or widening an enum are all additive and
  ship under the existing `v1` prefix with a dated entry in this changelog
  (this has been the actual pattern for every entry below — e.g. the
  nullable `companyId` attribution field added 2026-07-16, multi-currency
  fields added 2026-07-15). No consumer's existing integration breaks.
- **A breaking change requires a new version prefix, not a silent change to
  `v1`.** Breaking = removing/renaming a field or endpoint, changing a
  field's type or semantics, tightening a previously-optional
  request parameter to required, or changing an enum's existing values
  (not just adding new ones). When one is genuinely needed: introduce
  `/api/v2/<namespace>/**` for just that namespace, keep `v1` serving
  unchanged traffic, and record the change here with an explicit
  **Breaking** label and a migration note for existing integrators.
- **Deprecation window:** once a `v2` route exists for a namespace, its `v1`
  equivalent is marked deprecated in `generateOpenApiDocument()`'s schema
  description (not silently removed) and kept live for a minimum of 90 days
  from the `v2` route's ship date before removal is even considered, with
  removal itself requiring a dated changelog entry and the Owner's sign-off,
  the same posture this repo already applies to any other hard-to-reverse,
  outward-facing change. No `v1` route has been
  deprecated as of this writing — every entry below is additive.
- **No breaking change has shipped yet** — the contract has stayed at
  `1.0.0` through every entry below (see "Known gaps in this history").
  This policy exists so the *next* one, whenever it happens, has a rule to
  follow instead of being decided ad hoc.

---

## 2026-07-30

- **CRM auto-distribution + assignment overview** (`8aafc1993`, Task #46) —
  added `GET /api/v1/projexa/leads/assignment-overview`,
  `POST /api/v1/projexa/leads/auto-distribute`,
  `GET /api/v1/projexa/opportunities/assignment-overview`, and
  `POST /api/v1/projexa/opportunities/auto-distribute` — deterministic
  round-robin/load-based lead and opportunity assignment plus a read-only
  per-rep workload overview.
- **FI-AP-005: Payment Proposal List report** (`035f6fb81`, SAP F110
  equivalent) — added `GET /api/v1/projexa/payment-proposal-list`.
- **FI-AP-006: Vendor Payment History / Payment Behavior Analysis**
  (`49f5b005d`) — added `GET /api/v1/projexa/vendor-payment-behavior`.
- **FI-AR-006: Customer Payment Behavior / DSO report** (`c8cdd06b9`) —
  added `GET /api/v1/projexa/customer-payment-behavior`.
- **SD-007: Sales Order Document-Flow Overview** (`9de54f77c`, SAP VBFA
  equivalent) — added `GET /api/v1/projexa/sales-order-document-flow/[id]`.
- **FI-AA-006: Asset-to-GL Reconciliation report** (`1ca47d32b`) — added
  `GET /api/v1/projexa/asset-to-gl-reconciliation` (also fixed a real
  pre-existing GL-posting bug found along the way; see commit for detail).
- **FI-AP-007: Subcontractor Retention Summary report** (`5af1bb3e1`) —
  added `GET /api/v1/projexa/subcontractor-retention-summary` and
  `POST /api/v1/projexa/subcontractor-retention-summary/[invoiceId]/release`
  (retention release action).
- **FI-AP-008: Subcontractor Payment Application Status report**
  (`9679d3660`) — added
  `GET /api/v1/projexa/subcontractor-payment-application-status`.
- **FI-AR-004: Dunning List** (`b2f703d5a`, overdue AR by aging bucket +
  dunning level) — added `GET /api/v1/projexa/dunning-list` and
  `POST /api/v1/projexa/dunning-list/[invoiceId]/record` (record a dunning
  action against an invoice).

## 2026-07-28

- **Permits/Drawings/Documents upload + Minutes of Meeting for PROJEXA**
  (Wave 143) — added `POST /api/v1/documents` (file or `externalUrl`
  upload, previously read-only via this surface), `GET`/`POST
  /api/v1/projexa/drawings` (DWG file or 3D-walkthrough link, scoped by
  `projectId`), and the full Minutes-of-Meeting surface: `GET`/`POST
  /api/v1/projexa/veri-meetings`, `GET`/`PATCH
  /api/v1/projexa/veri-meetings/[id]` (minutes update / publish),
  `GET /api/v1/projexa/veri-meetings/[id]/pdf` (real PDF export), and
  `POST /api/v1/projexa/veri-meetings/[id]/generate-intelligence` (AI
  summary/key-decisions/action items).
- **Permits response field rename, with back-compat alias** —
  `GET /api/v1/projexa/permits` now returns `endDate` alongside the
  original `expiryDate` (both carry the same value) instead of replacing
  it outright. `endDate` is the preferred name going forward; `expiryDate`
  is kept for existing callers built against the original
  (`bab0a768`, 2026-07-14) contract and may be removed in a future
  `2.0.0`. Also gained `POST /api/v1/projexa/permits` (create) and an
  `all=true` list mode covering every permit for a project, not just
  those expiring soon.

## 2026-07-16

- **PROJEXA Reports & Analysis catalog aliases** (`ca46bc31`) — added
  `GET /api/v1/projexa/reports/catalog` and
  `POST /api/v1/projexa/reports/definitions/[id]/run`, exposing the
  ~200-entry report_definitions catalog and its execution engine to PROJEXA
  over the same alias pattern as every other `/api/v1/projexa/*` route.
- **Sales attribution fields** (`2c32fcc9`) — `erp_quotations`,
  `erp_sales_orders`, and `erp_purchase_orders` responses under
  `/api/v1/projexa/quotations`, `/sales-orders`, and `/procurement/purchase-orders`
  now carry an additive, nullable `companyId` field for multi-office/company
  attribution.

## 2026-07-15

- **Microsoft Office Add-in connector** (`f7f82fcc`) — added
  `/api/v1/connectors/office-addin`,
  `/api/v1/connectors/office-addin/departments`, and
  `/api/v1/connectors/office-addin/whoami`.
- **CRM/HR attribution fields** (`91d49840`) — `companyId` added to CRM
  leads, employee profiles, and leave requests responses.
- **Multi-currency Selling & Buying** (`f1e9a007`, `162ecc0c`) — quotations,
  sales orders, and purchase orders across `/api/v1/projexa/*` gained
  multi-currency fields.
- **Platform tenant provisioning** (`dba8569e`, `b233f3c4`) — added
  `POST /api/v1/platform/provision-org` for platform-level tenant
  provisioning (RLS-bypass audited).
- **PROJEXA Wave 1 alias expansion** (`58231a5b`, `97c5f376`, `a6a8a3f6`,
  `25292fc5`) — added `/api/v1/projexa/companies` (multi-office/company
  backend), `/api/v1/projexa/schedule/sprints`, `/wiki`, `/timesheets`
  (time tracking), `/knowledge-base`, `/inventory/*` (stock),
  `/procurement/*` (requisitions/RFQs/goods receipts/purchase orders), and
  `/schedule` task-creation + `/work-progress/activities` aliases.

## 2026-07-14

- **GRC/Accounting/Invoicing PROJEXA aliases** (`fea2e628`) — added
  `/api/v1/projexa/journal-entries`, `/cost-centers`, `/credit-notes`,
  `/sales-invoices`, `/audit-engagements`, `/audit-findings`, `/risks`,
  `/compliance-register`, `/fraud-cases`, `/vendor-risk`, `/grc-dashboard`,
  and related finance/GRC read-and-write endpoints.
- **Sales & CRM for PROJEXA** (`f2de84f6`) — added
  `/api/v1/projexa/leads`, `/opportunities`, `/sales-pipeline`,
  `/quotations` (incl. `/[id]/convert`, `/[id]/revisions`), `/customers`.
- **HR & Payroll thin-alias surface** (`7eb49b79`, `eaa80c29`) — added
  `/api/v1/projexa/payroll/*` (employees, salary structures/components,
  income-tax slabs, payroll runs, payslips incl. `/pdf` and `/tds`),
  `/api/v1/projexa/recruitment/*`, `/leave/*`, `/attendance`.
- **Quotation PDF export + approval gate** (`04b534c5`) — added
  `GET /api/v1/projexa/quotations/[id]/pdf`; quotation creation above a
  configurable value threshold now requires manager-role approval.
- **Meetings/MOM + Kanban board** (`4ec8a3c9`) — added
  `/api/v1/projexa/meetings` (incl. `/[id]/outcomes`) and `/board`.
- **ERP discovery lookups + Permits** (`bab0a768`) — added
  `/api/v1/projexa/permits`, `/currencies`, `/fiscal-years`, and related
  ERP reference-data lookup endpoints.

## 2026-07-10

- **Brain architecture groundwork, Phase A** (`3de9e119`) — added
  `/api/v1/brain/capabilities` and `/api/v1/brain/entity-relationships`.

## 2026-07-08 – 2026-07-09

- **PROJEXA construction modules + `/api/v1/projexa` namespace introduced**
  (`fee81a93`) — the `/api/v1/projexa/*` alias namespace was created; initial
  construction-domain endpoints for BOQ, progress, site diary, and the
  construction capability tree (`d7993313`) shipped alongside it.
- **Scheduling, RFIs/Submittals/Punch Lists/Change Orders, Interior &
  Visual Design** (`e058d926`, `0b83cf1c`, `b718b543`, `69563032`) — added
  `/api/v1/projexa/schedule/gantt`, `/schedule/baselines`, `/rfis`,
  `/submittals`, `/punch-list`, `/change-orders`, `/mood-boards`,
  `/ffe`, `/floor-plans` (incl. nested `/rooms`, `/placements`, `/scene`).
- **PROJEXA vs. 8 reference-system feature checklist** (`1a62258c`) — added
  `/api/v1/projexa/ai/diff-drawings`, `/ai/estimate-progress`,
  `/ai/progress-summary`, `/ai/risk-detection`, `/predictions`.
- **Free-form Discuss chat for PROJEXA** (`2f174b38`) — added
  `/api/v1/projexa/discuss`.

## 2026-07-03

- **`/api/v1` surface introduced** (`ca557089`, "Wave 11: service layer +
  /api/v1 + OpenAPI + expanded MCP coverage") — the original public API
  layer: `/api/v1/compliance` (incl. `/stats`), `/api/v1/tasks` (incl.
  `/[id]/status`), `/api/v1/notices` (incl. `/stats`), `/api/v1/documents`
  (incl. `/expiring`), `/api/v1/erp/budgets`, `/api/v1/erp/inventory`
  (`/ledger`, `/receipts`, `/issues`), `/api/v1/erp/procurement/requisitions`,
  `/api/v1/pms/meetings`, `/api/v1/pms/time-entries`, and the OpenAPI
  document endpoint itself.

---

### Known gaps in this history

- This changelog was compiled retroactively on 2026-07-16 from git history —
  it does not distinguish additive changes from breaking ones on a
  per-field basis for entries before this date, because that intent wasn't
  captured in commit messages at the time. Going forward, new entries should
  say explicitly whether a change is additive (safe) or breaking (requires a
  contract version bump).
- `/api/v1/openapi.json`'s own description states "the remaining ~30
  GRC/ERP/PMS modules are not yet exposed" through the core (non-PROJEXA)
  `/api/v1/**` surface — several of the PROJEXA-side aliases listed above
  cover data models that don't yet have an equivalent core `/api/v1/erp/**`
  or `/api/v1/*` route for non-PROJEXA VERIDIAN AI OS tenants. That gap is
  tracked in `ai-os/MASTER-TRACKER.yaml`, not repeated here.
- The contract version has stayed at `1.0.0` through every entry above —
  no breaking change requiring a `2.0.0` has shipped yet as of this writing.
