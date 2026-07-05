# Comparison CSV Gap Analysis

Source: `C:\Users\Dell\Downloads\comparison.txt` (372 lines, 19 module sections, ~340 individual features), benchmarking VERIDIAN against Odoo/ERPNext/Zoho/SAP/Oracle/Dynamics/Salesforce/Coupa. Saved to memory as `comparison_csv_feature_benchmark`.

Every row below is verified against the live `src/lib/db/schema.ts` and `src/lib/services/*` files as of 2026-07-05 — not against memory or the wave-history summary — per this repo's standing "verify against real code" discipline.

## Method

For each CSV module, checked for a matching schema table + service function. Status:
- **PRESENT** — schema + service already cover the feature category; CSV items are effectively satisfied.
- **PARTIAL** — core entity exists but named sub-features are missing (documented per row).
- **GAP** — no schema/service exists for this feature category at all.

## Module-by-module

| CSV Module | Status | Evidence | Notes |
|---|---|---|---|
| Finance > Budgeting (BD001-018) | **GAP** | No `erp_budget*` table anywhere in schema.ts | Built in Wave 70 below |
| Finance > Fixed Assets (FA001-020) | PRESENT | `erpAssetCategories`, `erpFixedAssets`, `erpDepreciationSchedules`, `erpAssetMovements`, `erpAssetDisposals` (Wave 66/prior) | |
| Finance > Taxation (TAX001-018) | PRESENT | `erpTaxTemplates`/Items, `erpTaxWithholdingCategories`/Rates (Wave 68 TDS), HSN/SAC on items (Wave 65) | |
| Finance > Financial Reporting (FS001-018) | PARTIAL | `erp-financial-report-service.ts`: `trialBalance`, `profitAndLoss`, `balanceSheet` | Missing: Statement of Cash Flows. Added in Wave 70 (small addendum, reuses same service file) |
| Finance > Period Closing (CL001-020) | PRESENT (Wave 82) | `erpAccountingPeriods` + `closePeriod`/`reopenPeriod`/`generatePeriodsForFiscalYear` + Wave 82: `erpPeriodClosingChecklistItems` (seeded accrual/provision/reconciliation/review tasks) + `signOffPeriod()` -- `closePeriod()` now REQUIRES the checklist complete + sign-off before it will close, a real gate not a cosmetic list. New `/erp/periods` page (first UI for periods at all). | |
| CRM > Customer Master (CRM001-018) | PARTIAL | `erpCustomers` (name, GSTIN, PAN, payment terms) | Missing: multiple addresses/contacts, credit limit. Minor — backlogged |
| CRM > Lead Management (LEAD001-018) | PRESENT | `crmLeads` (Wave 41) | |
| CRM > Opportunity Management (OPP001-018) | PRESENT | `crmOpportunities` (Wave 41) | |
| CRM > Quotation Management (QT001-018) | PRESENT | `erpQuotations`/Items | |
| Sales > Sales Order Management (SO001-020) | PRESENT | `erpSalesOrders`/Items | |
| Sales > Shipping & Delivery (SD001-018) | PRESENT | `erpDeliveryNotes`/Items | |
| Sales > Returns & RMA (RMA001-018) | PRESENT | `erpSalesReturns`/`erpPurchaseReturns` + Items (Wave 63) | |
| Sales > Contract Management (SC001-018) | **GAP** | `contractComplianceItems` exists but is the GRC "contract compliance obligations register" (Integrity module) — no SLA, renewals, amendments, recurring billing, revenue recognition, subscription lifecycle, or usage billing anywhere | Built in Wave 71 below |
| CRM > Customer Service (CS001-018) | PRESENT (Wave 81) | `tickets` (Wave 39) + `knowledgeBasePages` (Wave 29, now searchable) + Wave 81: `ticketSatisfactionSurveys` (CSAT/NPS via guest-chat token), `installedProducts` (warranty tracking), `fieldServiceDispatches`, `problemRecords`/`problemTickets` (RCA grouping) | |
| Procurement > Vendor Master (VEN001-018) | PRESENT (Wave 80) | `erpSuppliers` + `vendorRiskProfiles` + Vendor Scorecarding (Wave 64) + Wave 80: KYC docs (reuses `documents`), `erpSupplierBankAccounts` (pgcrypto-encrypted), `erpSupplierQualifications`, `erpSupplierSanctionChecks` (manual screening log, no live API), `erpSupplierPortalLinks` (self-service portal) | Sanction screening is a manual log, not a live external-API check (no sanctions-API key in this environment) |
| Procurement > Purchase Requisition (PR001-018) | PRESENT | `erpPurchaseRequisitions`/Items | |
| Procurement > RFQ Management (RFQ001-018) | PARTIAL | `erpRfqs`/Items/Suppliers + `erpSupplierQuotations`/Items | Missing: reverse auction, formal weighted scoring, negotiation-round tracking. Minor — backlogged |
| Procurement > Purchase Order (PO001-018) | PRESENT | `erpPurchaseOrders`/Items | |
| Procurement > Goods Receipt (GRN001-018) | PARTIAL | `erpPurchaseReceipts`/Items + batch/serial (Wave 57) | Missing: formal three-way-match report, landed-cost allocation, putaway/bin management. Backlogged |

## Status

- **Wave 70 (Budgeting + Cash Flow Statement): DONE.** `erp_budgets`/`erp_budget_line_items`, live Budget vs Actual variance, `/erp/budgets` UI, `erp_fiscal_years` service/route (previously missing entirely), Cash Flow Statement tab on Financial Reports. Migration `wave70_budgeting`, commit `4f2e4f8`, deployed and verified (tsc/eslint clean, live functional + RLS proof via `execute_sql`, `get_advisors` clean, zero runtime errors).
- **Wave 71 (Contract & Commercial Lifecycle Management): DONE.** `erp_contracts`/`erp_contract_amendments`/`erp_contract_billing_schedules`/`erp_contract_revenue_schedules`/`erp_contract_obligations`/`erp_subscription_plans`/`erp_subscriptions`, `/erp/contracts` UI (Contracts + Subscriptions tabs). Migration `wave71_contract_lifecycle_management`, commit `6ec22b4`, deployed and verified (tsc/eslint clean, live functional + RLS proof via `execute_sql`, `get_advisors` clean).
- Both genuine, complete gaps identified in this CSV comparison are now closed. The Backlog section below remains open (partial-module enhancements only, deliberately not built this pass).

## Decision (the "boss" call)

Two modules are complete, zero-schema gaps that stand alone as coherent products in the CSV — these get full new waves, built end-to-end (schema → migration → RLS → service → routes → UI → verified):

- **Wave 70 — Budgeting** (Finance): budgets, budget line items (by account/cost-center/period), budget-vs-actual variance against the existing GL (`erpJournalEntryLines`), approval workflow reusing the existing `approvalWorkflowDefinitions` engine, plus a small Cash Flow Statement addendum to `erp-financial-report-service.ts` (closes the PARTIAL on Financial Reporting cheaply, same wave).
- **Wave 71 — Contract & Commercial Lifecycle Management** (Sales): contracts, SLA terms, renewals, amendments, recurring billing schedules, revenue recognition schedules, subscription plans/lifecycle, obligation tracking, contract audit trail, contract performance dashboard.

Everything marked PARTIAL above is an *enhancement* to an already-shipped module, not a missing product — bundling all of them into this pass would dilute focus across ~6 small feature slices instead of shipping two complete ones. They are captured as an explicit backlog instead of being half-built:

### Backlog (future waves, not built this pass)
1. ~~Vendor Master: KYC document tracking, banking details table, qualification workflow, sanction/blacklist screening, vendor self-service portal.~~ DONE (Wave 80).
2. ~~Customer Service: Knowledge Base articles + search, CSAT/NPS post-ticket surveys, installed-product/warranty tracking, field-service dispatch, problem management/RCA grouping.~~ DONE (Wave 81).
3. ~~Period Closing: formal closing-checklist workflow (accrual/provision tasks, sign-off steps) beyond today's simple open/closed period flag.~~ DONE (Wave 82).
4. RFQ Management: reverse auction, formal weighted vendor scoring, structured negotiation-round log.
5. Customer/Vendor Master: multiple addresses/contacts per record, credit limits.
6. Goods Receipt: three-way-match (PO/GRN/Invoice) report, landed-cost allocation, putaway/bin assignment.

## On the code-copying permission

The user explicitly authorized copying source code directly from GitHub repositories for this task (with a mandatory source-attribution comment), a deliberate one-time relaxation of this session's earlier "read ERPNext/india-compliance for reference only, never copy verbatim" discipline (GPLv3/AGPL avoidance). In practice, neither Wave 70 (Budgeting) nor Wave 71 (Contract/CLM) required lifting any third-party source: both are standard business-logic patterns (variance calculation, recognition-schedule generation, renewal-date math) already expressed idiomatically throughout this codebase's existing ERP services, so building them consistent with VERIDIAN's own conventions was both faster and higher quality than adapting an external doctype/model. No third-party code was copied into either wave; this is noted here rather than manufacturing an attribution comment where nothing was actually reused.
