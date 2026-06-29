# Features To Be Added — ComplianceTrack
## Analysis by: DEVABOSS / Claude Code
## Based on: evaluation_by_ca.md (4 evaluations: CA × 2, CFO × 2, Sales × 2) + full codebase review

> **Context:** Zero customers. Pricing undecided. Goal: AI-native Compliance and Audit SaaS for the Indian market.
> This document synthesises every gap raised across all evaluations and maps them against what already exists in the codebase. Features are divided into three tiers based on one filter: **will the absence of this feature prevent a paying customer from signing up or cause them to churn in the first 90 days?**

---

## What Already Exists (Do Not Re-Build)

Before listing additions, here is what the product already has — confirmed from schema + pages:

| Feature | Details |
|---|---|
| Authentication | Supabase Auth SSR — email/password + magic link, middleware-protected routes |
| Organisation | Single org per account, name, slug, logo, plan field |
| Departments | Create/manage departments, assign department head |
| Users & Roles | admin / manager / member / viewer — org-scoped |
| Compliance Items | Title, description, type (10 Indian types), status (6 states), priority (4 levels), due date, department, assigned-to |
| Audit Points | Sub-tasks within each compliance item, separate assignee and due date |
| Documents | File upload per compliance item (URL-stored, Supabase Storage not yet wired) |
| Comments | Threaded comments per compliance item |
| Notifications | In-app: deadline reminder, assignment, status change, comment, mention |
| Audit Log | Full action trail: create, update, delete, status change, assign, login, logout, export |
| Dashboard | Totals, overdue count, due-this-week, completion rate, dept pendency chart, upcoming deadlines, recent activity |
| Reports Page | Status distribution chart, department bar chart, CSV export |
| Penalties Page | Indian penalty calculator (GST, TDS, PF, MCA — accurate rates) |
| Compliance List | Filterable list with search |
| Settings | Profile, Organisation, Notifications, Preferences |
| Team Management | Invite, list, manage team members |
| Search | Global search command (Cmd+K) |
| Theme | Dark / light mode toggle |
| Compliance Types | GST, TDS, MCA, PF, ESIC, Income Tax, ROC, Labour, Environmental, Other |

**What the schema is missing that directly blocks use:** no GSTIN/PAN/TAN field, no period field, no acknowledgement number field, no challan table, no notice table, no location table, no recurrence engine, no approval workflow.

---

---

# TIER 1 — MUST HAVE
### Definition: Without these, the product cannot acquire or retain its first 50 paying customers. These are the features that every evaluator — CA, CFO, salesperson — cited as an immediate blocker.

---

### M-01: Recurring Compliance Engine
**What:** Ability to mark a compliance item as recurring (monthly / quarterly / half-yearly / annually) and have the system auto-generate the next instance when the current one is closed as "Completed."
**Why must-have:** GST, TDS, PF, ESIC, advance tax — all are recurring. A company with 5 GSTINs has 60 GSTR-3B items per year. Manually creating each one is not viable. Every evaluator raised this. Without it, the tool cannot be used for ongoing compliance management — only for one-time tracking.
**Minimum scope:** Recurrence type (monthly/quarterly/half-yearly/annual), auto-create next item on completion, carry forward assignee and department. No complex scheduling needed at V1.

---

### M-02: Registration Number Fields on Compliance Items
**What:** Add structured fields to compliance items: GSTIN (for GST items), TAN (for TDS items), PAN (for Income Tax items), CIN/LLPIN (for ROC/MCA items), PF Code (for PF items), ESIC Code (for ESIC items). These should be optional but prominently placed.
**Why must-have:** A compliance tracker with no registration number is a generic task list. The CA evaluator called this out explicitly — "A product that calls itself a GST compliance tool but has no field for the GSTIN number is not a GST compliance tool." The CFO evaluator cited 24 GSTINs being indistinguishable. Every professional user works by registration number.
**Minimum scope:** Single text field per item labelled based on compliance type selected. No validation at V1 — just capture and display.

---

### M-03: Period / Financial Year Field
**What:** A structured "Period" field on compliance items — month+year for monthly filings (e.g., June 2026), quarter+year for quarterly filings (e.g., Q1 FY2026-27), or assessment year for annual filings (e.g., AY2026-27).
**Why must-have:** Without a period field, 12 GSTR-3B items for a year are 12 identical rows. The CFO and CA evaluators both cited this: you cannot tell which month's return is pending vs. filed. Filing history becomes meaningless without period context.
**Minimum scope:** Free-text period field at V1. Can be made a structured dropdown (month + year) at V2.

---

### M-04: Acknowledgement Number Capture
**What:** A field on each compliance item to record the government-issued acknowledgement/reference number after a filing is made — ARN (GST), acknowledgement number (ITR), SRN (ROC), challan serial number (TDS).
**Why must-have:** "Completed" without proof is meaningless for compliance purposes. The CA evaluator stated: "If a client's IT department sends a notice and asks when was the ITR filed and what is the acknowledgement number, I cannot answer that question from this system." This is the evidence field that transforms the tool from a checklist into a compliance record.
**Minimum scope:** Single text field labelled "Reference / Acknowledgement Number" on the compliance item detail page.

---

### M-05: Challan Tracking Table
**What:** A dedicated section within each compliance item (or a standalone challan register) to record payment details: challan/BSR code, challan serial number, payment date, amount paid, bank used, mode of payment (net banking / OTC).
**Why must-have:** In Indian compliance, filing and payment are two separate acts — both must be tracked. The CFO evaluator: "I can mark a compliance item as Completed with no evidence of what was paid." The CA evaluator cited this specifically. Without challan records, statutory auditors have no payment evidence to rely on, and the tool fails at audit season.
**Minimum scope:** A "Challan Details" card on the compliance item detail page with fields: BSR code, challan serial no., date, amount, bank. Optional at item level. No separate table required at V1.

---

### M-06: Annual Compliance Calendar View
**What:** A 12-month calendar grid where each compliance item appears as a colour-coded block on its due date. Colour by compliance type (GST = orange, TDS = blue, ROC = green, etc.). Click on a block to open the item.
**Why must-have:** The salesperson evaluator: "The single most powerful visual in any compliance software demo is the calendar view... In a demo against a competitor who has a calendar view, I will lose every time." Beyond demos — a calendar view is how compliance professionals actually think about their work. Monthly list view is insufficient for planning.
**Minimum scope:** Monthly calendar grid with item blocks. Filter by type and department. The shadcn/ui calendar component is already in the codebase — extend it.

---

### M-07: India-Specific Due Date Library (Pre-populated Templates)
**What:** A library of standard Indian compliance obligations with pre-populated due dates. When a user selects "GSTR-3B — Monthly" the due date auto-fills as the 20th of the following month. When they select "TDS Return — Q1" it auto-fills 31st July. Covers: GST filing dates, TDS payment/return dates, MCA annual return deadlines, advance tax dates, PF/ESIC challan dates, Professional Tax state-wise dates.
**Why must-have:** Every CA and CFO evaluator noted that manual due date entry is error-prone and inefficient. Auto-populated dates reduce setup time by 70% and eliminate the most common source of compliance misses (typing the wrong date). This is a foundational feature for an Indian compliance SaaS — it is what proves domain expertise.
**Minimum scope:** A "Quick Add" template picker — user selects filing type and period, system fills due date. 40–50 templates covering all 10 compliance types.

---

### M-08: Government Notice / SCN Register
**What:** A dedicated module to log incoming government notices and show-cause notices (SCN). Fields: notice number, issuing authority (GST dept / Income Tax / EPFO / Factories Inspector / Customs), date received, demand amount (if any), reply deadline (auto-calculated: received date + statutory days), assigned to (lawyer / CA / finance manager), status (received / reply filed / appealed / closed), documents (upload notice + reply).
**Why must-have:** The CFO evaluator's single strongest statement: "If I rely on this tool and a GST department notice arrives with a 21-day window that someone forgets to action, my company gets an ex-parte demand order." Notice management is the highest personal-liability feature for any Finance Manager or CFO. It is also a strong differentiator — most compliance trackers in the SME segment ignore this entirely.
**Minimum scope:** A "Notices" section in the sidebar. New notice form with the fields above. Dashboard widget showing "Notices with reply deadline in next 7 days."

---

### M-09: Email Notifications (External Delivery — Verified)
**What:** Confirm and complete the external email notification system — deadline reminders (7 days before, 3 days before, 1 day before, on due date, day after) delivered to the user's email address, not just in-app. User controls frequency in Settings → Notifications.
**Why must-have:** The in-app notification system exists but users are not in the app all day. The CA evaluator: "I am not sitting in this application all day — I am in Tally, in the GST portal, in the income tax portal, in client meetings." Email is the minimum viable external channel. Without external notifications, deadlines will still be missed and the product fails its core promise.
**Minimum scope:** Resend or Supabase edge function triggered on due date approach. Plain-text email with compliance item name, due date, and link to item. Uses existing notification preferences from Settings.

---

### M-10: Bulk Import via CSV
**What:** Allow users to upload a CSV file to bulk-create compliance items. CSV template: title, compliance type, period, due date, registration number, department, assignee email, priority, status. System validates and creates all rows, reports errors row-by-row.
**Why must-have:** The CA evaluator: "Even just the recurring monthly obligations — 24 GSTR-3B items, 42 PF challans — that is 156 items per month I need to create." The salesperson evaluator: "119 clients × 40 items = 4,760 items entered one by one — 238 hours of data entry." Any company with more than 20 compliance items per year cannot onboard without bulk import. It is the first-day experience gate.
**Minimum scope:** CSV upload form in Compliance → Import. Template download. Row-by-row validation with error summary. No partial import — either validate all, or report errors and ask user to fix.

---

### M-11: Free Trial / Self-Serve Signup
**What:** Allow any visitor to sign up and use the product for 14 days without a credit card. Full feature access during trial. On day 10, in-app prompt to select a plan. On day 15, read-only mode until payment.
**Why must-have:** The salesperson evaluator rated this as the #2 rejection reason: "Every prospect must go through me to access the product. That means I am the bottleneck for every evaluation." In 2026, any SaaS without a free trial is invisible to the majority of buyers who self-evaluate before engaging with sales. The product cannot grow without a self-serve path.
**Minimum scope:** `plan` field already exists on the `organisations` table. Add trial start date. Build a trial countdown banner in the app header. Gate creation of new items after trial expires (read-only). No payment integration required at V1 — just the UX flow.

---

### M-12: Public Pricing Page
**What:** A published pricing page on the landing/marketing site with 3 tiers (Starter / Growth / Business), feature comparison table, and a CTA to start free trial. Pricing can be "Contact us" for Enterprise tier.
**Why must-have:** The salesperson evaluator's #1 rejection reason: "I cannot answer the first question every prospect asks." No SaaS can build a repeatable sales or self-serve motion without public pricing. Opaque pricing signals either very high prices or organisational unreadiness — both deter buyers.
**Minimum scope:** A `/pricing` page on the marketing site. Three plan cards. Feature comparison grid. "Start Free Trial" CTA. Annual vs. monthly toggle.

---

### M-13: Approval Workflow (2-Level Maker-Checker)
**What:** Before a compliance item can be marked "Completed," the system requires an approval from a designated reviewer (Finance Manager / Manager role). Assignee marks as "Submitted for Review." Reviewer gets a notification, reviews the item (checks acknowledgement number, challan, documents), and approves or rejects with a comment. Rejection returns item to "In Progress."
**Why must-have:** The CFO evaluator: "My board and statutory auditors require segregation of duties. Any user with 'member' role can mark any compliance item as 'Completed' — no review, no authorisation." Without maker-checker, the tool fails corporate governance requirements. Any mid-market company's internal audit will flag this. It is a standard requirement for companies above 100 employees.
**Minimum scope:** Add "submitted_for_review" to status enum. Add `reviewer_id` to compliance items. Notification to reviewer on submission. Approve/reject action with required comment on rejection. Audit log records approver name and timestamp.

---

### M-14: Dashboard Filters (by Department, Type, Assignee, Status)
**What:** Make the main dashboard and compliance list filterable by: department, compliance type, assignee, status, priority, and date range. Save filter presets. Dashboard summary cards update to reflect active filter.
**Why must-have:** The CFO evaluator: "I cannot filter the dashboard to see: what is overdue at my Chennai office?" The current dashboard is useful for a 10-person company. A company with 5 departments and 200 compliance items needs to slice data. Without filters, the dashboard becomes noise beyond a certain scale. This is table-stakes for any SaaS with a dashboard.
**Minimum scope:** Filter bar on the compliance list page with dropdowns for type, status, department, assignee, priority, and due date range. URL-persisted filters so links can be shared.

---

### M-15: Help Centre / In-App Onboarding
**What:** A basic help centre (10–15 articles covering: how to set up your first compliance item, how to use audit points, how to invite team members, what each status means, how to use the penalty calculator). Plus an in-app onboarding checklist for new users (first 5 steps to get value).
**Why must-have:** The salesperson evaluator: "I become the support desk. I spend 30% of my time supporting existing customers instead of selling to new ones." Without documentation, every new user is dependent on the sales/founding team for onboarding. This does not scale past 20 customers. It also signals product maturity to procurement evaluators.
**Minimum scope:** Static `/help` section with 10 articles (Markdown rendered). In-app first-time-user banner with a 5-step checklist (Add first compliance item → Invite a teammate → Set up a deadline reminder → Try the penalty calculator → Complete your first item).

---

---

# TIER 2 — GOOD TO HAVE
### Definition: These features significantly increase the product's market coverage, reduce churn, or unlock higher-paying customer segments. They are not required to get the first 50 customers but are required to get to 500 customers or to move upmarket.

---

### G-01: Multi-Client Architecture (CA / Consulting Firm Edition)
**What:** A firm-level account that can manage multiple client organisations under one login. The firm admin can switch between client orgs from a top-level selector. A consolidated "All Clients" dashboard shows overdue items across all clients. Each client's data is isolated.
**Why good-to-have:** Every CA evaluator listed this as the #1 reason for rejection. CA firms are the highest-density channel for compliance software in India — if a CA uses this for their practice, they become a referral machine for their 50–100 clients. The current single-org architecture blocks this segment entirely. However, this requires significant schema changes (firm entity, client-firm relationship, org-switching) and is a V2 priority, not V1.

---

### G-02: Location / Branch Management
**What:** Add a `locations` table (name, type: office/factory/warehouse, city, state, address). Assign compliance items to a specific location. Dashboard filterable by location. Location-wise compliance health view.
**Why good-to-have:** The CFO evaluator's Reason 1 was the absence of location management for 42 locations. Any company with more than 2 offices needs location-level compliance tracking. Location is a prerequisite for manufacturing segment penetration. However, the majority of SME buyers (50–150 employees, 2–3 states) can use department-level assignment as a proxy. Make it V2 unless a target enterprise customer requires it.

---

### G-03: Filed Date + Payment Date Fields
**What:** Two additional date fields on compliance items: "Filed On" (actual filing date, separate from due date) and "Paid On" (challan payment date). These are distinct from the due date and from "Completed At" (which currently records when the status was updated in the system).
**Why good-to-have:** Both CA and CFO evaluators raised this. Late filing calculation requires knowing the actual filing date vs. the due date. Payment date is needed for TDS interest computation. The penalty calculator already exists — connecting it to these dates makes it live, not manual. Adds significant audit trail completeness.

---

### G-04: Escalation Engine
**What:** Configurable escalation rules per compliance type or department. Rule example: "If item is not updated 7 days before due date → notify assignee. If 3 days before → notify Department Head. If on due date → notify CFO/Admin." Rules configured in Settings → Escalation. Notifications go via email (and eventually WhatsApp).
**Why good-to-have:** The CFO evaluator's Reason 6 — "I need a system that chases my team so I don't have to." This is a premium feature that drives daily active use of the product and reduces compliance misses. However, basic email notifications (M-09) solve the 80% case for most SME buyers. Escalation chains are needed for enterprise and mid-market — it is a tier-2 feature that unlocks higher ACV.

---

### G-05: ROI Calculator (Public, Marketing Asset)
**What:** A public-facing ROI calculator on the marketing/landing page. Inputs: company size, number of states, number of GSTINs, historical late fees paid. Output: estimated annual penalty savings from using the tool, compared to typical software cost. No login required.
**Why good-to-have:** The salesperson evaluator's Reason 9 — "I cannot justify the price against 'we'll just use Excel' without a document to leave behind." The penalty calculator (already built) is a private in-app tool. A public ROI calculator that works before signup converts top-of-funnel visitors into qualified leads. High marketing ROI, relatively low development effort.

---

### G-06: Mobile-Responsive PWA (Progressive Web App)
**What:** Ensure the web app is fully mobile-optimised with touch-friendly controls, and configure it as a PWA (manifest.json, service worker) so users can add it to their phone's home screen and receive push notifications without a native app.
**Why good-to-have:** The salesperson evaluator's Reason 7 — "When I meet Operations or Factory Manager, they immediately ask: is there a phone app?" A full native iOS/Android app is expensive. A PWA costs 20% of that effort and delivers 60% of the value — home screen icon, push notifications, offline capability for reading. A genuine native app is V3; PWA is achievable now.

---

### G-07: Staff Workload & Performance View
**What:** A view (accessible to admin/manager) showing per-user: number of items assigned, completed in the last 30 days, overdue, and average days-to-complete. Used for capacity planning and performance appraisals.
**Why good-to-have:** The CA evaluator's Reason 13 — "How do I know how many compliance items each person has completed this month?" This is a management feature that makes the product useful to team leads and partners, not just individual contributors. It increases the number of people in a company who benefit from the tool — which drives renewal decisions.

---

### G-08: Board / Audit Committee Report Generator
**What:** A structured quarterly compliance report (PDF export) with: summary table (total obligations, completed %, overdue, penalties paid), compliance type breakdown, notices summary, overdue items detail, and trend vs. last quarter. Template-based, auto-populated from the live data.
**Why good-to-have:** The CFO evaluator's Reason 14. Every CFO presents a quarterly compliance report to the board. If this report generates automatically from the tool, the CFO cannot justify not using the tool. It is a renewal lock-in feature — the CFO becomes dependent on it. However, it requires clean data in the system (notices, challans, penalties paid) before it can be meaningful — so it is a V2 feature that depends on M-05 and M-08 being in place first.

---

### G-09: Financial Exposure Dashboard Widget
**What:** A dashboard widget showing: "Estimated penalty if all overdue items remain unfiled today: ₹X." Computed automatically by cross-referencing overdue items' types and delay days with the penalty calculator rates. Requires a "tax/penalty amount" field on compliance items.
**Why good-to-have:** The CFO evaluator's Reason 20 — "the number I look at every week is what is the financial exposure if all overdue items are not filed today." This is the single metric that makes compliance urgency tangible in money, not count. It requires adding a "tax/fee amount" field to compliance items — a small schema change with enormous dashboard impact.

---

### G-10: SSO / Google Workspace / Microsoft Entra Login
**What:** Add OAuth-based login via Google (for Workspace users) and Microsoft (for Entra ID / Office 365 users). Supabase Auth already supports this — configuration change, not major development.
**Why good-to-have:** The CA evaluator mentioned Google/Microsoft SSO. The CFO evaluator's Reason 18 mentioned SSO as a procurement requirement for mid-market. Supabase Auth has built-in Google and Microsoft OAuth providers — this is a 1-day configuration task, not a sprint. High value to unlock corporate accounts, low effort to implement.

---

### G-11: Document Version Control
**What:** Within the Documents section of each compliance item, support versioning: when a new file is uploaded with the same name or explicitly marked as a version, the system keeps previous versions accessible (download history) while marking the latest as current.
**Why good-to-have:** The CFO and CA evaluators cited this. In a statutory audit, the final signed Form 3CD must be distinguishable from drafts. Without versioning, all uploads are a flat pile. Version control adds audit-grade document management. Moderate effort — requires a `version` field and UI changes to the documents section.

---

### G-12: WhatsApp Notification Integration
**What:** Send compliance deadline alerts and escalation notifications via WhatsApp Business API (Twilio / Interakt / Gupshup) in addition to email. User opts in with their WhatsApp number in Settings.
**Why good-to-have:** Multiple evaluators raised WhatsApp. In India, WhatsApp is the primary professional communication channel — email open rates are 20%, WhatsApp read rates are 95%. A reminder that arrives on WhatsApp is far more likely to trigger action than one in email. However, WhatsApp Business API requires business verification, per-message costs, and template pre-approval — making it an infrastructure lift. Worth it at 200+ customers, not at launch.

---

### G-13: Multi-GSTIN Register
**What:** An org-level GSTIN register: list all GSTIN registrations with their state, registration date, type (Regular / Composition / SEZ), and status (Active / Suspended / Cancelled). Compliance items of type "GST" can be linked to a specific GSTIN from this register.
**Why good-to-have:** The CFO evaluator's Reason 2 — 24 GSTINs generating 24 indistinguishable GSTR-3B rows. The registration number field (M-02) partially solves this by allowing free-text entry. A structured GSTIN register goes further — it enables filtering by GSTIN, auto-populating state, and eventually pulling filing status from the GSTN API. Required for companies with 3+ GSTINs; optional for SMEs with 1.

---

### G-14: Public Roadmap Page
**What:** A public-facing product roadmap (`/roadmap`) showing: what is shipped, what is in progress (current quarter), what is planned (next quarter), and an open voting/suggestion mechanism for customers to upvote features.
**Why good-to-have:** The salesperson evaluator's Reason 20 — "I cannot sell the future when the present has gaps." A public roadmap builds trust with prospects evaluating competing tools, gives sales a tool to handle "when will X be available?" objections, and signals active development velocity. Canny.io or a simple static page is sufficient at V1.

---

### G-15: G2 / Capterra / SoftwareSuggest Listing
**What:** Create verified listings on G2, Capterra, and SoftwareSuggest in the "Compliance Management Software — India" category. Collect 5 reviews from beta users before launch. Maintain actively.
**Why good-to-have:** The salesperson evaluator's Reason 5: "My product does not exist in the prospect's research phase." This is not a product feature — it is a go-to-market action — but it is as important as any feature for early traction. Every Indian SME procurement process includes a Capterra or G2 check. Zero reviews = zero credibility. Achievable in 2 weeks with 5 beta users willing to write a review.

---

---

# TIER 3 — CAN BE IGNORED
### Definition: These features were raised in evaluations but represent either extreme niche requirements, premature enterprise complexity, or infrastructure/regulatory processes that require significant non-engineering investment. Building these before Product-Market Fit would be a distraction.

---

### I-01: EXIM Compliance Module (DGFT, Advance Authorisation, EPCG, RODTEP, Duty Drawback)
**Why ignore now:** Relevant only to companies with active import-export operations. Requires deep DGFT domain knowledge, complex licence-obligation linkage, and regulatory change management. The "Other" compliance type with good tagging handles EXIM items adequately for early customers. Build only when 3+ enterprise EXIM customers request it with budget.

---

### I-02: Full ERP Integration (SAP, Tally API, Oracle, Microsoft Dynamics)
**Why ignore now:** ERP integrations require vendor partnerships, dedicated API maintenance, and enterprise-grade support SLAs. The development cost exceeds the revenue from the first 100 customers. Manual data entry is the right default until 200+ enterprise customers justify the integration investment. A Zapier/webhook interface (G-tier) is the correct stepping stone.

---

### I-03: Factory / Industrial Compliance Lifecycle (PCB Consent, Boiler Certificates, Environmental Clearance)
**Why ignore now:** Relevant only to manufacturing companies with active factories. The "Environmental" compliance type handles these adequately as basic tracking items. The "licence + conditions linkage" feature is complex to model correctly. Build this when manufacturing becomes a primary customer segment — not at launch when the ICP is SME Finance Managers.

---

### I-04: C&F Agent / Third-Party Vendor Compliance Portal
**Why ignore now:** Requires a separate external portal for agents to upload documents, a portal authentication system, and a verification workflow — effectively a second product. The primary product needs to be stable and adopted first. This is a V3 feature for logistics and distribution companies with complex agent networks.

---

### I-05: Contract Labour Compliance Module
**Why ignore now:** The Contract Labour (Regulation and Abolition) Act compliance is relevant to companies with factories and contract workers. The "Labour" compliance type handles basic tracking. A full module (principal employer register, contractor licence tracking, wage compliance monitoring) is complex and applies to a narrow segment of early customers. Add when manufacturing and logistics are primary segments.

---

### I-06: Multi-State Professional Tax Management (18-State PT Module)
**Why ignore now:** Professional Tax is state-specific, with 18 different regimes, slabs, and authorities. A generic PT item with a state tag (enabled by location management — G-02) handles this adequately for most users. A full PT module with state-by-state due date intelligence is a niche within a niche — implement only when state-specific compliance intelligence becomes a paid upsell tier.

---

### I-07: AI-Powered Notice Analysis ("This notice demands ₹X, you have 21 days, here are 3 grounds to contest")
**Why ignore now:** Legally complex — any AI-generated legal advice creates liability exposure. Requires ongoing updates to case law, departmental circulars, and FAQs. The infrastructure (LLM integration, RAG on tax law, legal review process) is significant. First, build the notice register (M-08). After 500+ notices are logged in the system, the dataset and use case will be clear enough to build AI analysis correctly.

---

### I-08: Government Portal API Integration (GSTN API, MCA21 API, TRACES API)
**Why ignore now:** GSTN API requires a GSP (GST Suvidha Provider) license from GSTN — a regulatory process that takes 6–12 months and significant compliance overhead. MCA21 API is restricted to registered intermediaries. TRACES API is similarly gated. This is a regulatory and business development challenge, not a development task. Build the product first; pursue API licenses at Series A stage.

---

### I-09: SOC 2 Type II / ISO 27001 Certification
**Why ignore now:** Certifications are processes, not features. SOC 2 Type II takes 12–18 months of preparation. ISO 27001 takes 6–12 months. Both require significant investment and cannot be rushed. The correct approach: implement security best practices now (already done — auth-guard, row-level isolation, audit logs), document them, and pursue certifications after Series A when an enterprise sales motion justifies the cost. Focus early sales on SME buyers who do not require certifications.

---

### I-10: Billing / Professional Fee Tracking per Compliance Item (CA Firm Billing)
**Why ignore now:** This feature is exclusively relevant to CA firms managing client billing — a segment that requires the multi-client architecture (G-01) first. Building fee tracking before multi-client architecture would be building a room in a house that has no foundation. Once G-01 is built and CA firms are using the product, billing integration becomes the natural next upsell.

---

### I-11: Contingent Liability Disclosure Tracker (Balance Sheet Notes)
**Why ignore now:** This is a financial accounting feature — tracking disputed tax demands for balance sheet disclosure under AS 29 / Ind AS 37. It overlaps with the notice register (M-08) and financial exposure widget (G-09), but requires accounting knowledge and integration with the company's books. Far too specialised for general use. Build only on explicit enterprise customer request.

---

### I-12: Fire and Safety as a Dedicated Module
**Why ignore now:** Fire NOC, extinguisher certificates, mock drills — all can be tracked as "Other" compliance type with a location tag (G-02) and appropriate period/due date fields. A dedicated fire and safety module adds UI complexity without adding data capability that the generic model cannot handle. Build only if a facilities management company becomes a primary target segment.

---

### I-13: FEMA / RBI Transaction Reporting
**Why ignore now:** Extremely niche — relevant only to companies with foreign investments, overseas subsidiaries, or specific foreign exchange transactions. Covered by specialist compliance firms and software. Adding it to a general compliance tool creates noise without adding addressable market.

---

### I-14: Zapier / Webhook / API Integration Marketplace
**Why ignore now:** Building an integration marketplace before having stable APIs and a developer community is premature. Add webhooks (outbound event hooks) after the core product is stable and 3+ enterprise customers request API-based automation. Zapier partnership requires a minimum active user base. Build after 200 customers.

---

---

## Summary Table

| # | Feature | Tier | Effort | Impact |
|---|---|---|---|---|
| M-01 | Recurring compliance engine | Must Have | High | Critical |
| M-02 | Registration number fields (GSTIN/PAN/TAN) | Must Have | Low | Critical |
| M-03 | Period / financial year field | Must Have | Low | Critical |
| M-04 | Acknowledgement number field | Must Have | Low | High |
| M-05 | Challan tracking | Must Have | Medium | High |
| M-06 | Annual calendar view | Must Have | Medium | High |
| M-07 | India due date library / templates | Must Have | Medium | Critical |
| M-08 | Government notice / SCN register | Must Have | Medium | Critical |
| M-09 | Email notifications (verified external) | Must Have | Low | Critical |
| M-10 | Bulk CSV import | Must Have | Medium | High |
| M-11 | Free trial / self-serve signup | Must Have | Low | Critical |
| M-12 | Public pricing page | Must Have | Low | Critical |
| M-13 | Approval workflow (maker-checker) | Must Have | Medium | High |
| M-14 | Dashboard filters | Must Have | Medium | High |
| M-15 | Help centre / in-app onboarding | Must Have | Low | High |
| G-01 | Multi-client architecture (CA Edition) | Good to Have | Very High | Very High |
| G-02 | Location / branch management | Good to Have | High | High |
| G-03 | Filed date + payment date fields | Good to Have | Low | Medium |
| G-04 | Escalation engine | Good to Have | High | High |
| G-05 | Public ROI calculator | Good to Have | Low | High |
| G-06 | Mobile PWA | Good to Have | Medium | High |
| G-07 | Staff workload / performance view | Good to Have | Medium | Medium |
| G-08 | Board report generator (PDF) | Good to Have | High | High |
| G-09 | Financial exposure dashboard widget | Good to Have | Low | High |
| G-10 | SSO / Google / Microsoft login | Good to Have | Low | Medium |
| G-11 | Document version control | Good to Have | Medium | Medium |
| G-12 | WhatsApp notification integration | Good to Have | High | High |
| G-13 | Multi-GSTIN register | Good to Have | Medium | High |
| G-14 | Public roadmap page | Good to Have | Low | Medium |
| G-15 | G2 / Capterra listing | Good to Have | Low | High |
| I-01 | EXIM compliance module | Ignore Now | Very High | Low |
| I-02 | ERP integration (SAP / Tally API) | Ignore Now | Very High | Low |
| I-03 | Factory industrial compliance lifecycle | Ignore Now | High | Low |
| I-04 | C&F agent / vendor compliance portal | Ignore Now | Very High | Low |
| I-05 | Contract labour compliance module | Ignore Now | High | Low |
| I-06 | Multi-state Professional Tax module | Ignore Now | High | Low |
| I-07 | AI-powered notice analysis | Ignore Now | Very High | Medium |
| I-08 | Government portal API (GSTN/MCA/TRACES) | Ignore Now | Very High | Low |
| I-09 | SOC 2 / ISO 27001 certification | Ignore Now | Very High | Medium |
| I-10 | CA billing / fee tracking | Ignore Now | High | Low |
| I-11 | Contingent liability tracker | Ignore Now | Medium | Low |
| I-12 | Fire & safety dedicated module | Ignore Now | Medium | Low |
| I-13 | FEMA / RBI reporting | Ignore Now | High | Low |
| I-14 | Zapier / webhook / API marketplace | Ignore Now | High | Low |

---

## Recommended Build Sequence (Sprint Planning View)

**Sprint 1 (Weeks 1–2): Zero-friction acquisition**
- M-11: Free trial flow
- M-12: Pricing page
- M-15: Help centre + onboarding checklist

**Sprint 2 (Weeks 3–4): Core data completeness**
- M-02: Registration number fields
- M-03: Period field
- M-04: Acknowledgement number field
- G-03: Filed date + payment date fields
- G-10: Google SSO (1 day — Supabase config)

**Sprint 3 (Weeks 5–6): Recurring + bulk setup**
- M-01: Recurring compliance engine
- M-10: Bulk CSV import
- M-07: India due date library / templates

**Sprint 4 (Weeks 7–8): Visibility and control**
- M-06: Calendar view
- M-14: Dashboard filters
- G-09: Financial exposure widget (requires `amount` field on items)
- G-05: Public ROI calculator

**Sprint 5 (Weeks 9–10): Evidence and governance**
- M-05: Challan tracking
- M-13: Approval workflow
- G-11: Document version control

**Sprint 6 (Weeks 11–12): Risk management and notifications**
- M-08: Government notice / SCN register
- M-09: Email notifications (verified external delivery)
- G-04: Escalation engine (basic 2-level)

**After Sprint 6:** Evaluate PMF signals. If CA firms are the primary segment → build G-01 (multi-client). If mid-market companies → build G-02 (location), G-08 (board report). If growth stalls on awareness → G-15 (G2 listing), G-14 (roadmap), G-12 (WhatsApp).

---

*Document prepared by: DEVABOSS / Claude Code*
*Source: evaluation_by_ca.md (6 evaluations across 4 personas) + full codebase review (schema, pages, API routes)*
*Date: 2026-06-29*
*This is a living document. Update after each sprint with completed items and revised priorities.*
