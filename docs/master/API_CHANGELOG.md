# VERIDIAN AI — Public API Changelog

**Written 2026-07-16, VERIDIAN Review Framework Wave A.** The audit that produced
this workstream flagged that the public `/api/v1/*` surface — the one external
integrators (a mobile app, a ChatGPT Action, a Claude connector, a reseller
white-label app, or a sibling product like PROJEXA) are told to build
against instead of the internal `(app)/` UI routes — had no changelog at
all. This document is that changelog, built from the real commit history
of `src/app/api/v1/`, not a placeholder.

**Source of truth for the current contract:** `GET /api/v1/openapi.json`
(generated live by `src/lib/openapi/generate.ts` — never hand-edited, so it
can't drift from the actual route handlers it documents). This changelog is
the narrative "what changed and when" companion to that spec, not a
replacement for it.

**Honest versioning note:** `generate.ts`'s `info.version` has stayed at
`1.0.0` since it was first written (Wave 11, 2026-07-03) even though the
surface has grown substantially since — see the entries below. Versioning
here has been aspirational rather than actually bumped per change so far;
treat "1.0.0" as "the only version that has ever existed," not as a
signal that nothing has changed underneath it. Fixing that (semantic
version bumps tied to real breaking/additive changes) is a real follow-up,
not done as part of this pass.

---

## 2026-07-15 — Platform tenant provisioning + Office Add-in connector

- **Added** `POST /api/v1/platform/provision-org` — platform-level tenant
  provisioning endpoint (`PLATFORM-01 Wave 1`, commit `dba8569e`), paired
  with an RLS-bypass audit for the elevated access this endpoint
  necessarily requires.
- **Added** `/api/v1/connectors/office-addin` — Microsoft Office Add-in
  connector endpoints (`GAP-CONNECTOR-LAYERS`, Priority 14 Wave 2, commit
  `f7f82fcc`).
- **Not yet in the public OpenAPI spec.** Neither of these paths is
  registered in `src/lib/openapi/generate.ts` yet — they exist as real,
  routable, auth-guarded endpoints, but an external integrator reading only
  `GET /api/v1/openapi.json` won't see them today.

## 2026-07-13/14 — PROJEXA PM-ERP alias expansion (Priority 13)

- **Added** roughly 90 additional directories under `/api/v1/projexa/*` —
  finance (journal entries, trial balance, P&L, balance sheet, bank
  reconciliation, AR aging, credit notes, sales/purchase invoices and
  orders), HR (employees, payroll, leave, recruitment, timesheets), CRM
  (accounts, leads, opportunities, pipeline), audit/GRC (audit engagements
  and findings, compliance register, fraud cases, vendor risk, risks,
  policies), and project-delivery modules (RFIs, submittals, punch lists,
  change orders, permits, mood boards, floor plans, FFE, design materials,
  wiki, knowledge base) — closing the PM-ERP gap analysis from that wave.
- **Known public-spec gap, confirmed by re-reading `generate.ts` for this
  changelog:** the public OpenAPI document only registers the earlier,
  narrower set of `/projexa/*` aliases added in the 2026-07-08 construction
  wave below (vendors, project-budgets, materials, expenses, scope,
  work-progress, site-diary, labour, attendance, kpis, dashboard, reports,
  the AI endpoints, predictions, assistant). **None of the ~90 PM-ERP paths
  added this wave are in the public spec.** They are real, live, and
  reachable by an authenticated caller who already knows the exact path —
  they are simply undiscoverable from `/api/v1/openapi.json` today. This is
  the single largest concrete gap this changelog surfaces; closing it means
  registering those paths in `generate.ts`, not building new endpoints.

## 2026-07-10 — Brain endpoints

- **Added** `/api/v1/brain/capabilities` and
  `/api/v1/brain/entity-relationships` (Wave 153, "Brain architecture
  groundwork, Phase A only", commit `3de9e119`).

## 2026-07-08 — PROJEXA / Construction Intelligence domain launch

- **Added** the full construction domain: `/api/v1/construction/boq`,
  `/attendance`, `/kpi-definitions`, `/kpi-entries`, `/labour-roster`,
  `/predictions`, `/progress`, `/site-diary`.
- **Added** `/api/v1/documents` and `/api/v1/documents/expiring`.
- **Added** `/api/v1/erp/budgets`, `/api/v1/erp/inventory`,
  `/api/v1/erp/procurement`.
- **Added** `/api/v1/pms/meetings`, `/api/v1/pms/time-entries`.
- **Added** the `/api/v1/projexa/*` alias namespace itself — thin aliases
  over the construction/ERP endpoints above, tagged `PROJEXA` in the
  OpenAPI spec so an external caller building against PROJEXA
  specifically doesn't need to know it's the same backend as VERIDIAN's
  own compliance product. (Commit `fee81a93`, "Build PROJEXA construction
  modules inside VERIDIAN AI OS + `/api/v1/projexa` alias namespace".)

## 2026-07-03 — v1 surface established (Wave 11)

- **Added** the `/api/v1/*` surface for the first time: `/compliance`,
  `/compliance/{id}`, `/compliance/stats`, `/tasks`, `/tasks/{id}`,
  `/notices`, `/notices/{id}`, `/notices/stats`.
- **Added** `GET /api/v1/openapi.json` — the live-generated OpenAPI 3.1
  document that remains the authoritative spec today.
- This is the wave that established the "stable external contract,
  separate from the internal `(app)/` UI routes" design principle that
  every later addition above has followed.

---

## What's covered vs. not, as of this writing

Quoting `generate.ts`'s own `info.description` (the honest, load-bearing
line the spec ships with today): the public spec covers *"compliance,
tasks, notices, the full construction domain, erp/budgets, erp/inventory
(ledger/receipts/issues), erp/procurement (requisitions), documents, and
pms/meetings + pms/time-entries; the remaining ~30 GRC/ERP/PMS modules are
not yet exposed here."* That line was written before the 2026-07-13/14
PM-ERP expansion above landed roughly 90 more `/projexa/*` directories on
disk — so the real gap today is larger than "~30 modules," per the note in
that section.

## How to keep this changelog real going forward

Update this file, in the same PR, whenever a path is added to, removed
from, or has a breaking change to its request/response shape in
`src/app/api/v1/**` or `src/lib/openapi/generate.ts`. If a change doesn't
touch either of those, it isn't a public API change and doesn't belong
here.
