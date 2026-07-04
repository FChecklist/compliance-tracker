# ERP Benchmark Comparison — VERIDIAN vs Odoo/ERPNext/Zoho/SAP

Source data: 10 CSVs supplied 2026-07-05 (`01_Master_Module_List.csv` + 9 Finance
submodule detail files `02`-`10`). This is the "comparison" artifact requested in
step 1 — the master module list plus every Finance feature row, each tagged with
Odoo/ERPNext/Zoho/SAP coverage, priority, and an AI opportunity note. **Only
Finance's detail files exist today** (9 of the 16 submodules the master list
itself claims for M01); modules M02-M17 currently have only the one-line summary
row in `01_Master_Module_List.csv`, not the same feature-level detail. Sections
below are graded to that reality — real evidence where the detail file exists,
explicitly marked "not yet assessable" where it doesn't.

## Master Module List (17 modules, from `01_Master_Module_List.csv`)

| # | Module | Submodules | Priority | VERIDIAN today |
|---|---|---|---|---|
| M01 | Finance & Accounting | 16 | Critical | **Wave 49** scaffolded 5 of these (GL/COA, AP, AR, Banking-lite, basic Assets) across 37 tables. See Finance gap analysis below — 9 of 16 detail files reviewed. |
| M02 | CRM | 8 | High | **Wave 41** — leads, opportunities, convert-to-client. Partial; no detail CSV yet to gap-check precisely. |
| M03 | Sales | 10 | Critical | **Wave 49 Selling** — quotations, sales orders, delivery notes, sales invoices. No CPQ, no sales commission, no returns (RMA). |
| M04 | Procurement | 9 | Critical | **Wave 49 Buying** — POs, purchase receipts, purchase invoices. No RFQ/vendor-comparison workflow, no purchase requisition/approval routing distinct from PO itself. |
| M05 | Inventory & Warehouse | 14 | Critical | **Wave 49 Stock** — warehouses (tree), items, stock ledger (append-only), stock reconciliation. No batch/serial tracking, no valuation method (FIFO/moving avg) configuration, no inter-warehouse transfer as its own document type. |
| M06 | Manufacturing | 15 | Critical | **Explicitly out of scope** — user's own Wave 49 scoping decision: VERIDIAN's customers are CA/legal/consulting firms, not manufacturers. Not revisited unless the user changes that call. |
| M07 | Quality | 6 | High | Depends on Manufacturing; same out-of-scope call applies unless told otherwise. |
| M08 | HRMS | 10 | High | **Wave 40** — employee directory, leave requests/balances, org chart. Partial; no detail CSV yet. |
| M09 | Payroll | 8 | High | **Real gap.** The existing "Payroll Compliance" module (Wave 8) tracks statutory *compliance* (filings, due dates), not actual salary computation/payslip/statutory-deduction processing. If real payroll processing is wanted, this is genuinely unbuilt. |
| M10 | Projects | 8 | Medium | **Waves 25-28** — issues, sprints, wiki, time tracking, budgets, meetings, Gantt. VERIDIAN already *exceeds* this master list's stated scope here. |
| M11 | Service | 7 | High | **Wave 39** — Ticketing with SLA tracking. Solid coverage. |
| M12 | Document Management | 5 | Medium | **Real gap.** Attachments exist ad hoc per-module (e.g. journal-entry attachments, per Finance CSV JE010) but no unified DMS with versioning/central repository. |
| M13 | Workflow & Approvals | 6 | Critical | **Real cross-cutting gap.** Every module (GRC, PMS, and now ERP) reinvents its own draft→submit→approve status enum rather than sharing one configurable approval-matrix engine. This is arguably the single highest-leverage investment across the whole platform, not a per-module fix. |
| M14 | Security & Roles | 5 | Critical | VERIDIAN's RBAC + org-scoped RLS genuinely exceeds this benchmark — this has been the disciplined core of every wave in this project. |
| M15 | Reporting & BI | 8 | Critical | **Wave 38** — metric alert rules/monitoring exist, but no real dashboard/KPI builder, and the ERP-specific financial statements (Trial Balance, P&L, Balance Sheet) are a named Wave 49 gap below. |
| M16 | AI & Automation | 8 | Strategic | **VERIDIAN's strongest area by a wide margin** — Prompt OS, Worker Agents, Orchestra multi-agent layer, Purpose-Bound AI enforcement, Policy Engine, VERI FDE, embeddings/capability registry. Likely ahead of all 4 benchmarked products here; this is the actual differentiator, not a gap to close. |
| M17 | Integrations & API | 7 | Critical | REST API v1, API-key auth, OpenAPI spec, MCP server. Solid coverage. |

**Headline finding**: VERIDIAN is not starting ERP breadth from zero. 8 of 17
master-list modules already have real, shipped coverage from prior waves (CRM,
Sales/Selling, Procurement/Buying, Inventory/Stock, HR, Projects, Service,
Security) — built under a compliance-first framing rather than an
ERP-first one, but structurally the same ground. The genuinely open gaps are:
Finance depth (below), Payroll processing, Document Management, and — the
biggest single opportunity — one shared Workflow & Approvals engine instead of
N per-module reinventions.

## Finance & Accounting — feature-level gap analysis (9 of 16 submodules)

Every row below is checked against the actual `erp_*` tables shipped in Wave 49
(`src/lib/db/schema.ts`), not assumed.

### General Ledger (`02`, GL001-GL015)
| Feature | VERIDIAN status |
|---|---|
| Company ledger, COA, journal entry create/edit/post | **Built** (`erpAccounts`, `erpJournalEntries`, `erpJournalEntryLines`) |
| Reverse journal | Schema supports it (draft/submitted/cancelled), no reversal *service* written yet |
| FX journal | `erpCurrencies` + `erpExchangeRates` exist as primitives; no currency/rate field on `erpJournalEntryLines` itself yet |
| Open/Close Period | **Gap** — `erpFiscalYears.isClosed` exists but there is no sub-period (monthly) table at all, no module-level lock |
| Trial Balance, P&L, Balance Sheet, GL Report | **Gap** — pure service-layer work sitting on schema that already exists (sum `erpJournalEntryLines` by account/rootType). Highest-value next wave: without this, the scaffold cannot produce a single financial statement. |
| Audit Trail | VERIDIAN's `audit_logs` system (Wave 7, immutable, org-scoped) is mature but not yet wired to ERP transactions specifically |
| AI Account Suggestion | **Gap**, but VERIDIAN's Prompt OS/LLM infra makes this a thin wrapper, not new infrastructure, once wanted |

### Chart of Accounts (`03`, COA001-COA010)
Root/child accounts, edit, categories: **built** (`erpAccounts` self-FK tree, free-text `accountType`). Gaps: account merge, opening-balance-as-its-own-flow (only a `isOpeningEntry` boolean on journal entries, no dedicated wizard), statutory account mapping, multi-company COA (VERIDIAN's org model is single-entity-per-org; no sub-"company" concept for group consolidation), semantic account search.

### Fiscal Year & Periods (`04`, FY001-FY010)
Fiscal year create/close: **built** (`erpFiscalYears`). **Real, meaningful gap**: no accounting-period (monthly) sub-entity at all — no open/close/reopen, no per-module period lock, no year-end wizard. This directly blocks the Trial Balance/P&L gap above from being date-range-safe in production (nothing stops posting into a "closed" year today because there's no period grain to lock).

### Journal Entries (`05`, JE001-JE010)
Core CRUD/approval/post: **built**. Gaps: recurring journals (no recurrence schema), journal templates (no template table), bulk CSV import (VERIDIAN has a general ingestion pipeline elsewhere, not wired here), journal attachments (VERIDIAN has generic document attachment infra elsewhere, not linked to `erpJournalEntries`).

### Accounts Payable (`06`, AP001-AP012)
Vendor master, PO, purchase invoice: **built** (`erpSuppliers`, `erpPurchaseOrders`, `erpPurchaseReceipts`, `erpPurchaseInvoices` — the actual primitives for 3-way matching already exist as separate linked tables). Gaps: no 3-way-match *service* logic yet, no vendor credit note table, no payment-run/proposal batching (only a generic `erpPaymentEntries` row), no AP aging/ledger report, no India-specific TDS logic beyond the generic `erpTaxTemplates` (worth flagging given VERIDIAN's India-compliance-first customer base — CA firms will expect TDS, not just GST).

### Accounts Receivable (`07`, AR001-AR015)
Customer master, sales invoice: **built** (`erpCustomers`). **Confirmed gap** (checked the actual columns): no credit-limit field on `erpCustomers` at all. Other gaps: no sales credit note table, no collection/reminder workflow (this is exactly the CSV's own named "AI collection scoring" opportunity — a natural fit for VERIDIAN's existing Worker Agent/Prompt OS infra rather than new infrastructure), no AR aging/ledger report.

### Banking (`08`, BK001-BK015)
Bank account master: **built** (`erpBankAccounts`, confirmed it already has `currencyId` — multi-currency accounts are *not* a gap, I was wrong to assume otherwise before checking). **Real gaps**: no bank statement import at all (the CSV explicitly names ISO20022/MT940/CAMT.053/UPI/NEFT/RTGS/IMPS — see GitHub candidates below), no reconciliation logic/table, no cheque management/printing, no account-freeze status.

### Cash Management (`09`, CM001-CM015)
**Entirely unbuilt** — zero cash-specific tables in Wave 49 (petty cash, cash receipt/payment, cash count, cash forecast, treasury position, daily cash closing all missing).

### Cost Centers (`10`, CC001-CC015)
**Mostly unbuilt, but not from zero**: `erpJournalEntryLines.costCenter` already exists as a free-text tag on every GL line (a lightweight hook, not a real dimension). Missing: an actual `erp_cost_centers` master table with hierarchy, budget-by-cost-center, allocation rules, variance analysis. VERIDIAN already has `departments` and `projects` tables from prior GRC/PMS waves that are natural mapping targets for cost-center dimensions rather than needing invention from scratch.

## What's needed for a genuine mid-size ERP (Finance), ranked

1. **Accounting periods (open/close/lock)** — currently zero schema. Blocks everything below from being safe.
2. **Financial reports (Trial Balance, P&L, Balance Sheet, AR/AP aging)** — schema is ready; this is pure service-layer aggregation and the single highest-value next wave.
3. **Cash Management** — entire submodule, zero schema.
4. **Cost Center dimension table** — upgrade the existing free-text tag into a real master table + link to `departments`/`projects`.
5. **Bank statement import + reconciliation** — see GitHub candidates below; don't hand-roll parsers for MT940/CAMT.053/ISO20022.
6. **Sales/Purchase credit notes** — currently zero schema on either side.
7. **Service-layer logic on top of existing schema**: 3-way matching, recurring journals, journal templates, reversal flow, payment-run batching.
8. **India-specific TDS** on top of the existing generic tax-template schema (GST already has a natural home there; TDS does not yet).

## GitHub candidates for reuse (step 5/6 — don't build, integrate)

Targeted at the concrete gaps above, license-checked, not "search for an ERP":

- **Bank statement formats (MT940/CAMT.053/ISO20022)**: `mt940` (npm, MIT) and `camt053-parser`-style packages parse these formats directly into structured transaction lists — this is exactly the "import bank statement" gap (BK006) and should be pulled in as a dependency, not hand-rolled regex/XML parsing.
- **India payment rails (UPI/NEFT/RTGS/IMPS) reconciliation**: these arrive as bank-specific CSV/Excel exports in practice more often than a single standard format; no single dominant open-source parser — likely needs a thin per-bank-format adapter layer over whichever CSV a customer's bank actually exports, not a generic library.
- **OCR invoice/receipt parsing** (named as an AI opportunity in AP CSV, JE010): Tesseract.js (Apache-2.0) is already a common Node-ecosystem choice; VERIDIAN's own Prompt OS + vision-capable OpenRouter models are actually a stronger fit here than a dedicated OCR library, since the extraction is semi-structured, not fixed-form.
- **Double-entry bookkeeping validation reference**: not adopting code, but `medici` (npm, a well-known double-entry ledger library) is worth reading for its balance-validation approach as a design reference the way ERPNext's doctypes were used for Wave 49 — same "research, don't copy" discipline.

I have **not** run these GitHub searches for modules M02-M17 yet because their
detail CSVs (the AP/AR/Banking-style feature breakdowns, not just the one-line
master-list summary) aren't in `Downloads` yet — only Finance's 9 files are
present as of this analysis. The next section below should be read before
continuing to steps 5-9 for those modules.
