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
`src/lib/supabase/auth-guard.ts` and `src/lib/api-key-auth.ts`).

**How this document is maintained:** compiled directly from the git history
of `src/app/api/v1/**/route.ts` (every commit that added, removed, or
materially changed a route under this path), not hand-written release notes
kept separately from the code. Entries below are real, dated commits from
this repository — nothing here is a forward-looking promise or a
placeholder. When new `/api/v1/**` routes ship, add an entry here in the
same PR (matching the standing convention documented for `AGENTS.md`'s
change-history habits elsewhere in this repo) rather than backfilling later.

---

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
