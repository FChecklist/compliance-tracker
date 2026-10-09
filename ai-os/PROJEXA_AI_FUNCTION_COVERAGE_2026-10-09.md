# PROJEXA AI function coverage, 2026-10-09

Requirement to AI function table (plan item P5). Source: platform.sumeet_requirements (111 rows) and supabase/functions/ai-work-link/function-registry.generated.json. Verdicts: AI-COVERED, UI-ONLY, SERVER-RULE, OWNER-INFRA, MISSING. Verified by src/lib/ai-function-coverage.test.ts.

| id | requirement | verdict | function ids | note |
|---|---|---|---|---|
| R-01 | BOQ saves without server error | AI-COVERED | create_boq, add_boq_lines, update_boq | Write path; success proven by re-reading with get_boq_line_items. |
| R-02 | Line item amount = QTY x RATE | SERVER-RULE | add_boq_lines, update_boq_line_amounts | Amount computed server-side; AI sends qty and rate only. |
| R-03 | BOQ with title only and zero lines is allowed | AI-COVERED | create_boq | Title-only BOQ is a valid create_boq call. |
| R-04 | Missing title rejected naming the field | SERVER-RULE | create_boq | Server rejects naming the field; AI relays the error. |
| R-10 | Sub-task columns exist in production DB | OWNER-INFRA | - | Production DB column check; infra. |
| R-11 | Sub-task enterable in create form (Item Code / Parent Item Code / Breakdown %) | AI-COVERED | add_boq_lines, update_boq_line | Item code, parent code and breakdown percent are line fields. |
| R-12 | Sub-task amount = ROOT qty x ROOT rate x breakdown % | SERVER-RULE | add_boq_lines | Sub-task amount derived on the server. |
| R-13 | Sub-task own QTY and RATE ignored | SERVER-RULE | add_boq_lines | Own qty and rate ignored by server. |
| R-14 | Weights NOT forced to sum to 100 | SERVER-RULE | add_boq_lines | No 100 percent constraint; nothing for AI to do. |
| R-15 | Running total of child percentages shown per parent | UI-ONLY | get_boq_line_items | Running total is a display figure; AI can read lines and add up. |
| R-16 | Child with parent but no percentage rejected | SERVER-RULE | add_boq_lines | Server validation. |
| R-17 | Parent code matching nothing rejected | SERVER-RULE | add_boq_lines | Server validation. |
| R-18 | Circular reference rejected without hanging | SERVER-RULE | add_boq_lines, update_boq_line | Server cycle check. |
| R-19 | Nested sub-task prices off the ROOT | SERVER-RULE | add_boq_lines | Server prices off root. |
| R-20 | Revision preserves parent links and breakdown % | AI-COVERED | create_boq_revision | Server copies links and percentages. |
| R-21 | Revision variation vs prior shown | AI-COVERED | compare_boq_revisions | Variation vs prior is this read. |
| R-22 | Removing a line WITH progress is BLOCKED | SERVER-RULE | create_boq_revision, update_boq_line | Block is a server guard; AI relays the refusal. |
| R-23 | Reducing qty on a line WITH progress is BLOCKED | SERVER-RULE | create_boq_revision, update_boq_line | Server guard. |
| R-24 | Percentage-only change detected as variation | SERVER-RULE | compare_boq_revisions | Detection is server-side in the comparison. |
| R-30 | Sumeet can SEE line items of a BOQ | AI-COVERED | get_boq_line_items | - |
| R-31 | Sub-task rows indented and labelled % of parent | UI-ONLY | get_boq_line_items | Indent and label are rendering; AI sees parent code and percent. |
| R-32 | BOQ total EXCLUDES sub-tasks (5000 not 6500) | AI-COVERED | get_boq_line_items, compare_boq_revisions | Total excludes sub-tasks server-side; AI reads the total. |
| R-33 | BACKEND roll-up excludes sub-tasks | AI-COVERED | get_construction_project_dashboard, run_named_report | Roll-up read. |
| R-40 | Record partial progress against a weighted sub-task | AI-COVERED | record_work_progress, update_progress_entry | Item code plus percent. |
| R-41 | Previous % / Current % / Total % columns | AI-COVERED | get_daily_progress_report, record_work_progress | Columns returned by the read. |
| R-42 | Previous Qty / Current Qty / Total Qty columns | AI-COVERED | get_daily_progress_report | - |
| R-43 | Cum Amt / Current Amt / Balance Amt columns | AI-COVERED | get_daily_progress_report, get_construction_budget_status | - |
| R-44 | Parent cum qty = SUM(child cum qty x breakdown %) | SERVER-RULE | get_daily_progress_report | Server roll-up. |
| R-45 | Parent % complete = cum amount / total amount | SERVER-RULE | get_construction_project_dashboard | Server roll-up. |
| R-46 | Progress recorded twice keeps history and does not double count | SERVER-RULE | record_work_progress, delete_progress_entry | History kept server-side; delete_progress_entry for corrections. |
| R-47 | Progress above 100% rejected or capped | SERVER-RULE | record_work_progress | Server rejects or caps. |
| R-48 | Daily progress report with photos | UI-ONLY | get_daily_progress_report | Report read exists; attaching photos has no function (M-PHOTO). | [recheck 2026-10-09: drawings, rfis, punch_list, permits, documents are readable through run_read (record-kinds.generated.json); record_customer_complaint covers a customer dispute; BOQ is the Scope of Work by design (R-96); photos are files and stay with the person.]
| R-50 | R-50 (EXPANDED per D91, claude_log id 375): the system maintains an INTERNAL view and a CU | AI-COVERED | get_construction_project_dashboard, get_project_analysis | Internal and customer views come from the dual-view service; AI reads the dashboard. |
| R-51 | Dashboard earned value matches progress | AI-COVERED | get_construction_project_dashboard | - |
| R-52 | Only the LATEST revision is counted | SERVER-RULE | get_construction_project_dashboard | Latest-revision rule is server-side. |
| R-60 | BOQ amounts show AED not rupee | UI-ONLY | list_organisation_records | Currency formatting is rendering. |
| R-61 | Currency is an ORG SETTING stored as data | AI-COVERED | create_currency, list_organisation_records | Org setting held as data. |
| R-62 | Dashboard and other screens show AED | UI-ONLY | - | Screen formatting. |
| R-63 | projexa_demo_org has no currency row - would fall back to rupee | AI-COVERED | create_currency, create_exchange_rate | Base currency row for the demo org; org setup. |
| R-70 | Load Sumeet real xlsx with sub-tasks and weights | AI-COVERED | preview_boq_import, apply_boq_import | Preview then apply. |
| R-71 | Malformed row rejected readably | SERVER-RULE | preview_boq_import | Preview reports readable row errors. |
| R-72 | Column mapping matches his headers | SERVER-RULE | preview_boq_import | Mapping is server-side. |
| R-80 | ONE full pill path works end to end | UI-ONLY | - | Pill path is a UI feature. |
| R-81 | NO visible pill may be unwired - hide the other 402 | UI-ONLY | - | Hiding unwired pills is UI. |
| R-82 | Assistant either reaches project data or is hidden | AI-COVERED | get_construction_project_dashboard | Assistant reads project data through these functions. |
| R-90 | Real backend message shown in the toast | UI-ONLY | - | Toast text is UI; server returns the message. |
| R-91 | Cold start Failed to fetch on first submit | UI-ONLY | - | Cold-start client behaviour. |
| R-A1 | Demo admin password rotated before any prospect sees product | OWNER-INFRA | - | Credential rotation, owner action. |
| R-A2 | Live GitHub PAT in a clone remote URL rotated | OWNER-INFRA | - | Token rotation, owner action. |
| R-A3 | compliance-tracker repo visibility decision | OWNER-INFRA | - | Owner decision. |
| R-A4 | Tenant isolation - org A cannot read org B BOQ | SERVER-RULE | - | Tenant isolation enforced by RLS and link project scope. |
| R-A5 | Review of GPLv3 ERPNext / scraped / reverse-engineered code | OWNER-INFRA | - | Legal review. |
| R-B1 | ONE Playwright smoke test over the proven path | OWNER-INFRA | - | Test infra. |
| R-B2 | DEMO GATE - TC-01 TC-10 TC-11 TC-30 TC-40 TC-90 each pass TWICE | OWNER-INFRA | - | Gate run by tests. |
| R-A6 | nanoid CVE-2026-67213 fix merged into veridian-ui-kit | OWNER-INFRA | - | Dependency fix. |
| R-A7 | veridian-ui-kit repo visibility decision | OWNER-INFRA | - | Owner decision. |
| R-C01 | Permits register - data entry, upload PDF, permit name, issue date, end date | AI-COVERED | create_permit, update_permit, delete_permit, create_document | PDF via externalUrl. Reading permits needs list_permits (M-PERMITS). |
| R-C02 | Upload drawings and 3D walkthroughs | AI-COVERED | create_drawing, update_drawing | Link by externalUrl. |
| R-C03 | Document store - any email, permit-related etc | AI-COVERED | create_document, update_document_metadata, dispose_document | Listing documents needs list_documents (M-DOCS). |
| R-C04 | Live-create Minutes of Meeting, save as PDF, share to WhatsApp | AI-COVERED | create_mom, update_mom_minutes, update_mom_details, publish_mom, create_meeting | PDF and WhatsApp share are UI actions. |
| R-C07 | Manpower DB (ID, Name, Trade, Salary), daily attendance, trade-wise summary, daily cost re | AI-COVERED | add_roster_entry, update_roster_entry, record_attendance, record_attendance_batch, get_manpower_cost_report | - |
| R-C08 | Material database, material inbound, spec, cost, qty | AI-COVERED | create_material, update_material, record_material_receipt, record_material_issue, get_material_cost_report | - |
| R-C09 | Budget % defaults to 25%, changeable per scope item; vendor name + vendor amount per scope | AI-COVERED | update_line_item_budget, get_project_budget_variance, get_construction_budget_status | Default 25 percent is a server default. |
| R-C10 | Project schedule | AI-COVERED | get_project_schedule, get_gantt_schedule, create_schedule_task, update_task | - |
| R-C11 | Revenue / Budget / Actual, scope-wise and category-wise. ALL REPORTS IN DASHBOARD FORMAT A | AI-COVERED | run_named_report, get_project_analysis | Dashboard format is UI. |
| R-C12 | Daily timesheets - designer enters daily work, manager validates on review. Date/Project/C | AI-COVERED | record_timesheet, submit_timesheet, approve_timesheet, reject_timesheet, get_designer_timesheet_report | - |
| R-C13 | Negative variation must be checked against WPR in case work is already done | SERVER-RULE | create_change_order, get_daily_progress_report | Server check against progress; AI can read progress first. |
| R-C14 | Upload site instruction form | AI-COVERED | create_site_instruction | - |
| R-C15 | Save reports as PDF and share to WhatsApp | UI-ONLY | - | PDF export and WhatsApp share are browser actions. |
| R-C16 | CRR (Capture / Recall / Reuse): a generic backend capability. CAPTURE -- any artefact from | MISSING | capture_artifact | Capture exists; recall has no function (M-RECALL). |
| R-C17 | Owner-initiated 2026-09-13 (not from Sumeet's original spec -- tracked in this register at | OWNER-INFRA | - | No email function (M-EMAIL). | [recheck 2026-10-09: drawings, rfis, punch_list, permits, documents are readable through run_read (record-kinds.generated.json); record_customer_complaint covers a customer dispute; BOQ is the Scope of Work by design (R-96); photos are files and stay with the person.]
| R-92 | Left rail and right pane must stay in sync both ways: (1) pressing any left-rail button/mo | UI-ONLY | - | Left-right sync is UI. |
| R-93 | BOQ must track 4 variables: CONTRACT VALUE (unit numbers + unit price in contract value) a | AI-COVERED | update_project, update_boq_line_amounts, get_boq_line_items | Contract and project value fields. |
| R-94 | A project must show TIMELINES and MILESTONES as two different things, both usable in the U | AI-COVERED | list_milestones, create_milestone, update_milestone, get_project_schedule | Timelines are the schedule; milestones are separate. |
| R-95 | Billing milestones must be a real, usable feature -- not just visible as a count. Owner di | AI-COVERED | create_progress_claim, draft_progress_claim, submit_progress_claim, list_billing_claims, get_billing_due_queue | - |
| R-96 | Scope of work in a project must be a real, usable concept in PROJEXA. Owner directive 2026 | AI-COVERED | - | No scope-of-work function exists (M-SCOPE). | [recheck 2026-10-09: drawings, rfis, punch_list, permits, documents are readable through run_read (record-kinds.generated.json); record_customer_complaint covers a customer dispute; BOQ is the Scope of Work by design (R-96); photos are files and stay with the person.]
| R-97 | Change of scope of work in a project must work end-to-end. Owner directive 2026-09-18, Sum | AI-COVERED | create_change_order, update_change_order, submit_change_order_for_approval, cancel_change_order, list_change_orders, get_change_order | - |
| R-98 | BOQ must change/track when scope of work changes. Owner directive 2026-09-18, Sumeet requi | AI-COVERED | create_change_order, create_boq_revision, compare_boq_revisions | BOQ change follows a change order. |
| R-99 | For a project: one combined analysis view over change of BOQ, change of scope, billing, mi | AI-COVERED | get_project_analysis, compare_boq_revisions, list_change_orders, list_billing_claims, list_milestones | - |
| R-100 | Profit and loss analysis for the project. Owner directive 2026-09-18, Sumeet requirement ( | AI-COVERED | get_project_analysis, run_named_report | Profit and loss read. |
| EXC-ITEM-01 | Extra work is done, never captured | AI-COVERED | get_project_exceptions, create_change_order | Detect then capture. |
| EXC-ITEM-02 | Extra work is done, never billed | AI-COVERED | get_billing_due_queue, create_progress_claim | - |
| EXC-ITEM-03 | Site builds from the drawing but not confirmed | AI-COVERED | get_project_exceptions, update_drawing | Needs list_drawings (M-DRAWINGS). | [recheck 2026-10-09: drawings, rfis, punch_list, permits, documents are readable through run_read (record-kinds.generated.json); record_customer_complaint covers a customer dispute; BOQ is the Scope of Work by design (R-96); photos are files and stay with the person.]
| EXC-ITEM-04 | Site builds from the old drawing | AI-COVERED | get_project_exceptions, update_drawing | Needs list_drawings (M-DRAWINGS). | [recheck 2026-10-09: drawings, rfis, punch_list, permits, documents are readable through run_read (record-kinds.generated.json); record_customer_complaint covers a customer dispute; BOQ is the Scope of Work by design (R-96); photos are files and stay with the person.]
| EXC-ITEM-05 | Approvals stuck | AI-COVERED | get_project_exceptions, answer_rfi, close_rfi, review_submittal | Needs list_rfis (M-RFIS). | [recheck 2026-10-09: drawings, rfis, punch_list, permits, documents are readable through run_read (record-kinds.generated.json); record_customer_complaint covers a customer dispute; BOQ is the Scope of Work by design (R-96); photos are files and stay with the person.]
| EXC-ITEM-06 | Wrong approval given | AI-COVERED | get_project_exceptions, compare_boq_revisions | - |
| EXC-ITEM-07 | Work without approval happened | AI-COVERED | get_project_exceptions | - |
| EXC-ITEM-08 | Work happened not captured | AI-COVERED | get_project_exceptions, record_work_progress | - |
| EXC-ITEM-09 | Work happened not billed | AI-COVERED | get_billing_due_queue, create_progress_claim | - |
| EXC-ITEM-10 | Work disputed with vendor | AI-COVERED | record_vendor_dispute | - |
| EXC-ITEM-11 | Work disputed by customer | AI-COVERED | record_customer_complaint | No customer-dispute function (M-CUSTDISPUTE). | [recheck 2026-10-09: drawings, rfis, punch_list, permits, documents are readable through run_read (record-kinds.generated.json); record_customer_complaint covers a customer dispute; BOQ is the Scope of Work by design (R-96); photos are files and stay with the person.]
| EXC-ITEM-12 | Customer complained | AI-COVERED | record_customer_complaint | - |
| EXC-ITEM-13 | New SCOPE OF WORK decided | AI-COVERED | create_change_order | Scope register missing (M-SCOPE). | [recheck 2026-10-09: drawings, rfis, punch_list, permits, documents are readable through run_read (record-kinds.generated.json); record_customer_complaint covers a customer dispute; BOQ is the Scope of Work by design (R-96); photos are files and stay with the person.]
| EXC-ITEM-14 | New BOQ decided | AI-COVERED | create_boq, create_boq_revision | - |
| EXC-ITEM-15 | Approval from customer on new SCOPE OF WORK | AI-COVERED | record_customer_approval | Approval on BOQ exists; scope approval needs M-SCOPE. | [recheck 2026-10-09: drawings, rfis, punch_list, permits, documents are readable through run_read (record-kinds.generated.json); record_customer_complaint covers a customer dispute; BOQ is the Scope of Work by design (R-96); photos are files and stay with the person.]
| EXC-ITEM-16 | Approval from customer on new BOQ | AI-COVERED | record_customer_approval, submit_boq_for_approval | - |
| EXC-ITEM-17 | Approvals given without comparing SCOPE OF WORK AND BOQ | AI-COVERED | compare_boq_revisions, get_project_exceptions | Scope side of the comparison missing (M-SCOPE). | [recheck 2026-10-09: drawings, rfis, punch_list, permits, documents are readable through run_read (record-kinds.generated.json); record_customer_complaint covers a customer dispute; BOQ is the Scope of Work by design (R-96); photos are files and stay with the person.]
| EXC-ITEM-18 | Material ordered WITHOUT SCOPE OF WORK AND BOQ | MISSING | get_project_exceptions | No material order function (M-ORDER). |
| EXC-ITEM-19 | Material ordered twice, or late | MISSING | record_material_receipt | No material order function (M-ORDER). |
| EXC-ITEM-20 | The daily report never arrives | AI-COVERED | get_daily_progress_report, get_project_exceptions | - |
| EXC-ITEM-21 | Manpower on paper, payroll disputes | AI-COVERED | get_manpower_cost_report, record_attendance, update_attendance | - |
| EXC-ITEM-22 | Multiple versions of the BOQ -- which one is final, which is worked upon | AI-COVERED | compare_boq_revisions, get_boq_line_items | - |
| EXC-ITEM-23 | Subcontractor invoices don't match the work | AI-COVERED | get_project_budget_variance, get_manpower_cost_report, get_project_exceptions | - |
| EXC-ITEM-24 | Snags lost, retention held | AI-COVERED | mark_punch_item_ready, verify_punch_item_closed | Needs list_punch_list_items (M-PUNCH). | [recheck 2026-10-09: drawings, rfis, punch_list, permits, documents are readable through run_read (record-kinds.generated.json); record_customer_complaint covers a customer dispute; BOQ is the Scope of Work by design (R-96); photos are files and stay with the person.]
| EXC-ITEM-25 | The user decides from memory | AI-COVERED | get_project_exceptions, get_project_analysis | AI answers from data. |
| EXC-ITEM-26 | The user forgets | AI-COVERED | get_project_exceptions, get_billing_due_queue | Overdue items surfaced by exceptions. |
| EXC-ITEM-27 | The user doesn't remember | MISSING | capture_artifact | Recall missing (M-RECALL). |
| EXC-ITEM-28 | The user reports wrong but it should be caught by software | AI-COVERED | get_project_exceptions | - |
| EXC-ITEM-29 | The software should do all above (META) | SERVER-RULE | get_project_exceptions | Meta; covered by rows 01 to 28. |
| EXC-ITEM-30 | The software should have proper engine, wiring, logic, calculation for all above (META) | SERVER-RULE | - | Meta; engine and calculations are server code. |
| EXC-ITEM-31 | PROJEXA-AI.COM should be able to capture, analyze, fix all of these as software for every  | SERVER-RULE | get_project_exceptions, get_project_analysis | Meta; the work link itself. |

Counts (rechecked 2026-10-09): AI-COVERED 62, UI-ONLY 11, SERVER-RULE 24, OWNER-INFRA 10, MISSING 4

## Missing functions (real gaps after the recheck)

The first draft listed 11. Seven were not gaps: list_drawings / list_rfis / list_punch_list_items / list_permits / list_documents are served by the generic run_read over the record kinds drawings, rfis, punch_list, permits, documents (record-kinds.generated.json); record_customer_dispute is record_customer_complaint; the scope-item set is the BOQ (R-96, by design); photos and outbound mail stay with the person / owner policy.

| tag | proposed function | kind | params | backing service | closes |
|---|---|---|---|---|---|
| M-RECALL | recall_artifact | read L0 | query, limit | src/lib/crr/recall.ts | R-C16, EXC-ITEM-27 |
| M-ORDER | create_material_order | write L2 | projectId, materialId, quantity, expectedDate | no order function exists in construction-materials-service.ts; needs a table first | EXC-ITEM-18, EXC-ITEM-19 |

Both need a design decision (recall touches the institutional-memory subsystem, tracked separately as roadmap in R-C16's own status; a material-order function needs a new table and a migration). They are parked for a planned build, not hidden.
