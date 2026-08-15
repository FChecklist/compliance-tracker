# Procurement ERP Gap Analysis — 2026-07-31

## Method

Source: 10 reverse-engineering phase documents at `ai-os/reference/procurement-erp-reverse-engineering/` (Application Overview/Architecture, Auth/User Management/Access Control, Organization/Master Data, Inventory/Item Management, Vendor Management, Requisitions/Procurement Workflow, Quotations/Purchase Orders, Invoicing/Payments/Financial Documents, Inventory Gate Pass Management, Entity Relationships/API/Business Rules) — a real, browser-driven reverse engineering of a live PHP procurement system, all 10 read in full before any codebase comparison began, not skimmed.

Cross-referenced against `FChecklist/compliance-tracker`'s real, live `origin/main` `src/lib/db/schema.ts` (466 real tables, confirmed via `grep -c "\.table("`), read via a direct Python `subprocess` call rather than a plain `git show` piped through Bash — **a real infra gotcha found along the way**: the `snip` token-saving hook silently truncates large `git show`/file-dump output (a 677KB/11,448-line file was silently reduced to 31 lines with no visible error, only an easy-to-miss "... more files changed" marker and a `SQLITE_BUSY` tracking-error line). Confirmed via direct byte-count comparison. This means **any earlier investigation this session that read a large file via a plain `git show`/`cat` through Bash may have silently worked from truncated content** — flagging this as a real, separate finding for the Owner's attention, not just a footnote for this task. `projexa` was not independently re-checked in this pass since the Owner clarification already on record (KERNEL_CONSOLIDATION_STATUS.md) establishes it as a thin client with zero independent business logic — any gap closed in compliance-tracker is automatically available there via the existing `callVeridian()` bridge.

**Verdict key**: **PRESENT** (real, matching capability exists, cite the table/field) · **PARTIAL** (exists but meaningfully narrower than the reference) · **MISSING** (no real equivalent found).

## Headline finding

VERIDIAN already has a substantial, real, ERPNext-inspired procurement/ERP subsystem — **95 `erp_*`-prefixed tables** — that maps onto most of this reference documentation's 15 core tables, often with *more* sophistication than the reference (RFQ reverse auctions/scoring/negotiation rounds vs. the reference's flat quotations; a real 5-table approval-workflow engine vs. the reference's single status field; three-way PO/Receipt/Invoice matching already wired per a real `Wave 85` comment in `erp_purchase_invoices.purchaseOrderId`). This is a genuine gap-closure exercise against a comparable existing system, not a from-scratch build, matching the task's own zero-duplication expectation.

## Phase 1 — Application Overview & Architecture

Not a gap-closure target itself (this phase documents the reference's own PHP/jQuery architecture, module inventory, and generic-framework conventions — useful as a map for phases 2-10, not a capability to replicate). One structural note carried forward into every other phase: the reference's **universal effective-dating pattern** (`from_date`/`to_date` on every entity) has **no direct equivalent** in VERIDIAN — VERIDIAN instead uses `isActive` booleans + `createdAt`/`updatedAt` timestamps (confirmed on `organisations`, `departments`, `erp_cost_centers`). This is a genuine architectural difference, not obviously a defect — soft-active-flag is at least as standard a pattern as date-range effective-dating — flagged as a design decision for the Owner rather than an automatic gap to close.

## Phase 2 — Auth, User Management & Access Control

- Login/session/captcha/multi-tenant isolation — **PRESENT**, VERIDIAN's own Supabase-Auth-backed session model, out of scope to compare 1:1 against a legacy PHP captcha mechanism (different, arguably stronger, security model already exists — not a gap).
- User management (`application_users`) — **PRESENT**: `users` table.
- RBAC / role-based module access — **PRESENT**, and more granular: `abac_policies` table exists (attribute-based access control), a real step beyond the reference's role-based-only model.
- Admin/Employee session-mode toggle — not independently verified this pass; low priority (cosmetic UX pattern, not a business capability).
- Notifications (3-type: Action/Information/Logs) — **PARTIAL**: `notifications` table exists but its type taxonomy needs a direct field-level check against the reference's 3-way split — not yet verified.
- Internal messaging — **PRESENT**: `messages`, `message_attachments`, `conversations`, `conversation_participants`.
- Configuration module (company/regional/financial/accounts/document settings) — **PARTIAL**: no single dedicated `config` table, but `organisations` itself carries much of this directly (`gstin`, `panNumber`, `cinNumber`, `address`, `regulatoryEntityType`) — functionally overlapping, not a clean 1:1, needs a field-by-field diff before calling it closed.

## Phase 3 — Organization & Master Data

- **Divisions (top hierarchy tier above Departments) — MISSING.** `departments` (confirmed schema) is a flat, org-scoped table with a `headId` (HoD equivalent) but **no self-referencing hierarchy and no parent "Division" tier**. The reference's 3-tier Division→Department→CostCenter model is only a 2-tier Department→CostCenter model in VERIDIAN today. Real, confirmed gap.
- Departments — **PRESENT**: `departments` table.
- Locations (self-referencing geo hierarchy, lat/long, in/wip/fg/rej material-flow flags) — **not yet directly located** by name in this pass; `erp_addresses` covers billing/shipping addresses linked polymorphically to customers/suppliers but has no hierarchy, no geo-coordinates, no material-flow classification flags. Needs a dedicated follow-up check (search was time-boxed this pass) — tentatively **MISSING or PARTIAL**, not confirmed either way yet.
- Cost Centers — **PRESENT, and more capable than the reference**: `erp_cost_centers` has `parentCostCenterId` (hierarchy, matches reference) plus `isGroup` (ERPNext-style group/leaf distinction, not in the reference) plus direct `departmentId` *and* `projectId` links (the reference only links to Department).
- Cascading Country/State/City — **PRESENT** (built this session, Task #46, PR #661).

## Phase 4 — Inventory & Item Management

- Item Categories (hierarchical + 22 GL account mappings + price/qty variance config) — **PARTIAL**: `erp_item_groups` has the hierarchy (`parentGroupId`) but the accounting-mapping and variance-config depth was not confirmed in the field slice read this pass — needs a full-field check before ruling definitively.
- Item Types — **not confirmed as a separate table**; likely a field on `erp_items` rather than a distinct master, needs verification.
- **UOM master table — likely gap.** `erp_items.uom` is a **free-text field** ("Nos"/"Kg"/"Hour" per its own comment), not a foreign key to a structured UOM master with short-code/name/description like the reference. `erp_item_uom_conversions` exists (conversion factors between units) but that presupposes a UOM concept without necessarily a full master-data table — needs confirming.
- HSN/SAC Codes — **PARTIAL, real but structured differently.** `gst_hsn_master` exists (separate GST-compliance module), but `erp_items.hsnSacCode` is stored as **free text**, explicitly *not* a foreign key to that master (per its own code comment, deliberately matching ERPNext's shape). This means the reference's core tax automation — HSN code auto-determines the GST rate — **may not be wired end-to-end** between `erp_items` and `gst_hsn_master` today. Real, concrete, worth-prioritizing gap: closing this wiring (not necessarily changing the free-text field) would close a genuine automation gap.
- Currencies — **PRESENT**: `erp_currencies`, `erp_exchange_rates`.
- Items (65+ fields: batch/serial tracking, vendor/customer part-number mapping, variance, accounting) — **PARTIAL**. Confirmed present: batch/serial opt-in flags (`hasBatchNo`/`hasSerialNo`, matching reference's `tracking_type`), stock/sales/purchase item flags, standard buy/sell rates. **Not confirmed present**: vendor_items/customer_items many-to-many part-number mapping (reference's `vendor_items[]`/`customer_items[]` arrays), reorder thresholds (may live in the separate `erp_reorder_levels` table — a valid alternate design, not necessarily a gap), minimum-margin/max-discount pricing guards, the 22-24 GL account mappings per item.

## Phase 5 — Vendor Management

- Vendor master — **PRESENT**: `erp_suppliers`, real and in some ways more advanced (integrated `vendorRiskProfileId` link to a Third-Party/ESG risk module, `qualificationStatus`/`sanctionScreeningStatus` denormalized caches from `erp_supplier_qualifications`/`erp_supplier_sanction_checks` — genuine capability the reference doesn't have at all).
- **Multi-state GST/billing array (multiple GST registrations per vendor) — likely MISSING.** `erp_suppliers.gstin` is a **single field**, not the reference's repeatable array-of-rows-with-default-flag structure for vendors registered in multiple states. Real, concrete gap if the org needs multi-state vendors (worth confirming actual business need before building).
- Bank details — **PARTIAL/PRESENT**: `erp_supplier_bank_accounts` exists as a separate table (arguably a *better* design than the reference's flat fields, since it naturally supports multiple accounts per vendor) — field-level parity (IFSC/SWIFT/IBAN/routing codes) not yet confirmed.
- Module connection flags (hr_connect/finance_connect/admin_connect/project_connect/location_connect/purchase_connect/legal_connect) — **not applicable/MISSING**, but this is a legacy-architecture artifact of the reference's single-shared-vendor-record-across-modules design; VERIDIAN's cleaner service-layer architecture likely doesn't need a direct equivalent — flag as "intentionally not needed" pending confirmation, not a real gap.
- Other Contacts (ACC/OSC/CON/QAS functional contact groups) — **not confirmed**, likely `erp_contacts` (generic contacts table exists) covers this in a less rigid, more flexible shape — needs a field check.
- Vendor self-registration/invitation system — **PARTIAL**: `erp_supplier_portal_links` exists, suggesting a supplier-portal mechanism, but the reference's specific invite→self-register→pending-approval flow needs direct confirmation against this table's real usage.
- MSME/Udyam registration tracking — **not confirmed**, needs a field check on `erp_suppliers`.

## Phase 6 — Requisitions & Procurement Workflow

- Requisitions — **PRESENT but narrower than the reference**: `erp_purchase_requisitions` confirmed with `requestedById`, `departmentId`, `purpose`, `status` — but **no direct `cost_center_id` field** (reference requires Cost Center as *the* mandatory budget-tracking field) and **no OPEX/CAPEX classification field**. Real, concrete gaps: (1) direct cost-center linkage for budget validation at the requisition level, (2) OPEX/CAPEX classification.
- Approval workflow — **PRESENT and more sophisticated than the reference**: `approval_workflow_definitions`/`approval_workflow_instances`/`approval_workflow_step_definitions`/`approval_workflow_step_instances`/`approval_workflow_step_approvals` — a real, generic 5-table workflow engine already wired to `entityType` values including `erp_purchase_order` (confirmed via schema comment) — almost certainly extensible to requisitions if not already, versus the reference's single hardcoded status field. This is a case where VERIDIAN's existing capability is a strict superset of the reference's — no work needed, possibly just wiring requisitions into the existing engine if not already done (needs confirming).
- Requisition → Quotation / PO generation (clone-with-traceability) — **needs confirming** against `erp_purchase_orders.purchaseOrderId`-style back-references; not checked this pass.

## Phase 7 — Quotations & Purchase Orders

- Quotations — **PRESENT, and more advanced**: `erp_quotations`/`erp_quotation_items` (direct reference-equivalent) *plus* `erp_rfqs`/`erp_rfq_items`/`erp_rfq_suppliers`/`erp_rfq_scoring_criteria`/`erp_rfq_quotation_scores`/`erp_rfq_negotiation_rounds`/`erp_rfq_reverse_auctions`/`erp_rfq_auction_bids` — a full competitive-bidding/reverse-auction/scoring subsystem the flat reference system does not have at all. Also `erp_supplier_quotations`/`erp_supplier_quotation_items` (vendor-submitted quotes, distinct from internal quotations) — another capability beyond the reference.
- Purchase Orders — **PRESENT**: `erp_purchase_orders`/`erp_purchase_order_items`.
- Computed financial chain (subTotal → dis_subTotal → discount_amount → taxAmount → grandtotal) — **PARTIAL, confirmed real but not confirmed identical**: `erp_purchase_invoices` has `subtotal`/`taxAmount`/`grandTotal`/`outstandingAmount` fields (computed, not just named) confirming the calculation chain is real, not cosmetic — but the reference's specific discount-then-tax-then-shipping-then-TDS *ordering* and the header/line dual-discount model were not diffed field-by-field against the actual service-layer computation code (only the schema was checked this pass — the real computation logic lives in `erp-invoicing-service.ts` and was not read this pass).
- Advance payment adjustment on POs — **not confirmed**, needs a direct check.

## Phase 8 — Invoicing, Payments & Financial Documents

- Purchase Invoices — **PRESENT**: `erp_purchase_invoices`/`erp_purchase_invoice_items`.
- **Three-way matching (PO / GRN / Invoice) — PRESENT, confirmed real, not inferred.** `erp_purchase_invoices.purchaseOrderId`'s own code comment explicitly states: "enables the three-way-match report against the same PO's own items and receipts" (Wave 85). This is one of the reference's most important business rules (Phase 8, Section 13.1) and it is a **real, already-built** VERIDIAN capability — not a gap.
- Goods Receipt Note equivalent — **PRESENT**: `erp_purchase_receipts`/`erp_purchase_receipt_items`, and more sophisticated than the reference (adds a real putaway-confirmation workflow step, dock-to-bin, via the existing `erp_warehouses` hierarchy — the reference has no putaway concept at all).
- Supplier Bills (simplified invoice path without GRN) — **not confirmed as a distinct entity**; `erp_purchase_invoices` may or may not support a GRN-optional path. Needs a direct check — real gap if the answer is no, since this is a common real-world scenario (utility bills, service fees with no physical receipt).
- Payments — **PRESENT**: `erp_payment_entries`, `erp_cash_vouchers`; multi-party batch-payment support and the Normal-vs-Advance-Payment distinction not yet confirmed at the field level.
- TDS/TCS automated calculation — **PRESENT, confirmed real**: `erp_tax_withholding_categories`/`erp_tax_withholding_rates`, `erp_suppliers.taxWithholdingCategoryId`, and `erp_purchase_invoices.tdsAmount` explicitly described as "computed and snapshotted at submit time" (Wave 68) — matches the reference's TDS rule almost exactly, including the correct snapshot-not-recompute discipline the reference itself doesn't even specify as carefully.
- Debit Notes (distinct from Credit Notes) — **PARTIAL/MISSING**: `erp_purchase_credit_notes`/`erp_purchase_credit_note_items` and `erp_sales_credit_notes` exist, but **no distinctly-named Debit Note table was found** for the purchase side. Needs confirming whether credit notes are used bidirectionally (amount sign convention) or whether a real Debit Note gap exists — the reference treats these as two separate document types with different accounting direction.
- Advance payment reconciliation against invoices — not yet confirmed at the field level.

## Phase 9 — Inventory Gate Pass Management

**MISSING — confirmed, not inferred.** A direct search of the full 11,448-line schema for "gate pass" (any casing/spacing) returned zero real matches (one false positive: an unrelated comment about AI chat-reply flow using the word "gate" in a different sense). There is no `returnable_gate_passes`/`non_returnable_gate_passes` equivalent, no document specifically tracking temporary-vs-permanent material dispatch with return-date-based follow-up. The closest partial-overlap capabilities that exist: `erp_delivery_notes`/`erp_delivery_note_items` (outbound shipment documents — likely covers the NRGP "permanent outbound" case in spirit) and `erp_asset_movements` (fixed-asset relocations, a different and narrower concept than general-material temporary loan tracking). **This is a genuine, real gap** — closing it as a *generic* capability (per the task's own instruction not to clone the reference literally) would mean: a generic "material movement authorization" concept with a returnable/non-returnable flag and, for returnable movements, an expected-return-date field with overdue-tracking/notification hooks into the existing `notifications` table — not a literal reimplementation of RGP/NRGP forms.

## Phase 10 — Entity Relationships, API Catalog, Business Rules

Not an independent gap-closure target — this phase's content (the reference's 15-table relationship map, its PHP API catalog, and its business-rules compendium) was used throughout phases 2-9 above as the checklist against which VERIDIAN was compared, not as a standalone target. No separate findings beyond what's captured above.

## Prioritized real gaps for implementation (pending Owner review before dispatch)

1. **Gate Pass equivalent (Phase 9)** — confirmed zero existing coverage, real generic capability worth building (material-movement authorization, returnable/non-returnable, return-date tracking + overdue notification).
2. **Divisions tier above Departments (Phase 3)** — confirmed missing; whether this is worth building depends on whether VERIDIAN's actual customer base needs a 3rd organizational tier above Department — flagging for an explicit Owner call rather than assuming yes.
3. **HSN/SAC → GST-rate wiring (Phase 4)** — `gst_hsn_master` and `erp_items.hsnSacCode` both exist but aren't confirmed linked; if genuinely disconnected, this is a real tax-automation gap with existing pieces just needing to be wired together (low build cost, real compliance value).
4. **UOM master data table (Phase 4)** — `erp_items.uom` is free text; a real master-data table would close a genuine structural gap, but needs confirming this isn't already handled by some other existing mechanism not found in this pass.
5. **Cost-center + OPEX/CAPEX on Purchase Requisitions (Phase 6)** — confirmed missing fields on `erp_purchase_requisitions`, directly blocks budget validation at requisition time the way the reference does it.
6. **Multi-state GST/billing array for suppliers (Phase 5)** — confirmed single-GSTIN-only today; real gap only if the business actually has multi-state vendors.
7. **Supplier Bills / GRN-optional invoice path (Phase 8)** — needs confirming whether this already exists before treating as a gap.
8. **Debit Notes as a distinct document type (Phase 8)** — needs confirming whether credit notes already serve this bidirectionally.

## What still needs deeper verification before implementation dispatch (explicitly not yet done)

Several items above are marked "needs confirming" rather than a hard verdict — this first pass prioritized covering all 10 phases with real evidence over exhaustively deep-diving every field of all 466 tables in one sitting (given genuine time constraints on this pass). `projexa`'s own schema was not independently re-checked (relying on the Owner's own standing clarification that it is a thin client). The actual service-layer computation logic (`erp-invoicing-service.ts` and equivalents) was not read this pass — only schema-level evidence was gathered; several "PARTIAL" verdicts above could resolve to PRESENT or MISSING once the real service code is read.
