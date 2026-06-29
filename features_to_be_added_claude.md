# Features To Be Added — ComplianceTrack
## Merged Analysis: Claude Code (DEVABOSS) + Z.ai
## Sources: evaluation_by_ca.md (6 evaluations, 4 personas) + Z.ai feature audit + full codebase review
## Last Updated: 2026-06-29

> **Context:** Zero customers. Pricing undecided. Goal: AI-native Compliance and Audit SaaS for the Indian market.
> This is the merged and re-evaluated master list combining both Claude's analysis (from evaluation_by_ca.md) and Z.ai's independent feature audit. Where the two lists disagreed, the final tier reflects a reasoned decision — explained inline.

---

## Conflicts Resolved Between Claude and Z.ai

| Feature | Z.ai Tier | Claude Tier | Final Decision | Reason |
|---|---|---|---|---|
| Recurring compliance engine | Good to Have | Must Have | **Must Have** | Cannot use product sustainably without it — 350 items/month require auto-generation |
| Government notice / SCN register | Good to Have | Must Have | **Must Have** | Personal CFO liability; missed 21-day reply window = ex-parte demand order |
| Challan payment tracking | Good to Have | Must Have | **Must Have** | Filing ≠ Payment; auditors require challan evidence; "Completed" without BSR code is meaningless |
| Tally integration (basic) | Good to Have | Ignore | **Good to Have** | Z.ai is right — Tally has 90%+ Indian SME market share; basic CSV import is achievable and removes the biggest "we already have Tally" objection |
| AI/ML predictive analytics | Ignore | Not listed | **Ignore** | Too early — build dataset first (500+ notices, 10,000+ compliance items), then AI |
| Native mobile apps | Ignore | Not listed (PWA is path) | **Ignore** | PWA delivers 60% of value at 20% of cost; native app is V3 |
| Hierarchical dashboards (CFO→Manager→Location) | Ignore | Not listed | **Good to Have** | Mid-market companies with 5+ departments need role-filtered views; not enterprise-only complexity |

---

## What Already Exists — Do Not Re-Build

Confirmed from schema + live pages + Z.ai's audit:

| Feature | Status | Notes |
|---|---|---|
| Authentication | ✅ Exists | Supabase Auth SSR — email/password + magic link |
| Entity / Organisation | ✅ Exists | Single org per account; name, slug, logo, plan field. Z.ai confirmed: GSTIN, PAN, CIN fields exist at entity level |
| Departments | ✅ Exists | Create/manage, assign department head |
| Users & Roles (RBAC) | ✅ Exists | admin / manager / member / viewer — Z.ai listed RBAC as "Must Have missing"; it already exists |
| Task Assignment | ✅ Exists | assignedToId on compliance items + audit points; Z.ai listed as missing — exists in schema |
| Compliance Items | ✅ Exists | 10 Indian types, 6 statuses, 4 priorities, due date, dept, assignee |
| Audit Points | ✅ Exists | Sub-tasks with separate assignee and due date |
| Documents | ✅ Exists | Upload per item (URL stored — Supabase Storage not yet wired) |
| Comments | ✅ Exists | Threaded per compliance item |
| Notifications | ✅ Exists | In-app: deadline reminder, assignment, status change, comment, mention |
| Audit Log | ✅ Exists | Full action trail — Z.ai listed as "Good to Have"; already built |
| Dashboard | ✅ Exists | Totals, overdue, due-this-week, completion %, dept chart, upcoming deadlines, activity feed |
| Reports + CSV Export | ✅ Exists | Status chart, department chart, CSV — Z.ai listed basic reporting as "Must Have missing"; basic version exists |
| Penalty Calculator | ✅ Exists | Indian rates (GST, TDS, PF, MCA) — Z.ai listed as "Must Have missing"; already built |
| Compliance List with Filters | ✅ Exists | Status and type filters, search |
| Settings | ✅ Exists | Profile, Organisation, Notifications, Preferences |
| Team Management | ✅ Exists | Invite, list, manage |
| Global Search | ✅ Exists | Cmd+K command palette |
| Dark Mode | ✅ Exists | Z.ai listed as "Good to Have"; already built |
| Responsive Design | ✅ Exists | Tailwind-based |

**What the schema is provably missing:** no period field, no acknowledgement/ARN field, no challan table, no notice/SCN table, no location table, no recurrence engine, no approval/maker-checker workflow, no trial date tracking, no filing date / payment date fields.

---
---

# TIER 1 — MUST HAVE
### Without these, the product cannot acquire or retain its first 50 paying customers.
### Both Claude and Z.ai agree on the majority. Disagreements are noted.

---

### M-01: Recurring Compliance Engine
**Source:** Claude (Must Have) | Z.ai (Good to Have — overruled)
**What:** Mark a compliance item as recurring (monthly / quarterly / half-yearly / annually). System auto-generates the next instance when current one is marked "Completed." Carries forward assignee, department, type, and registration number.
**Why Must Have:** GST, TDS, PF, ESIC, advance tax — all repeat on fixed schedules. A company with 5 GSTINs has 60 GSTR-3B filings per year. Manually creating each is not viable. Without this, the product can only be used for one-time tracking — not ongoing compliance management.
**Minimum scope:** Recurrence type selector (monthly/quarterly/half-yearly/annual). Auto-create next item on completion. `recurrence_type` and `recurrence_parent_id` fields on compliance_items table.

---

### M-02: Indian Compliance Calendar Database + Entity-Type Auto-Suggestion
**Source:** Claude (M-07 — India due date library) merged with Z.ai (M1 + M2)
**What:** A library of 60+ standard Indian compliance obligations with pre-populated due dates, mapped to entity type. When a user selects "GSTR-3B — Monthly," due date auto-fills as 20th of following month. When a Private Limited company is created, the system suggests its mandatory annual compliances (AGM, AOC-4, MGT-7, DIR-3 KYC, etc.). Covers: GST, TDS, MCA, PF/ESIC, advance tax, Professional Tax.
**Why Must Have:** Z.ai confirmed entity types exist (Company / LLP / Partnership / Individual) at entity creation. Auto-suggesting compliances based on entity type is the fastest path to first value — new user signs up, creates their Pvt Ltd company, and immediately sees the 15 annual compliances they must track. Eliminates manual setup. Proves domain expertise in the first 5 minutes.
**Minimum scope:** Template library with 60 entries (filing name, type, frequency, standard due date formula, entity types it applies to). Quick-add picker on Compliance → New. Entity-type-based suggestion on first login.

---

### M-03: Period / Financial Year Field
**Source:** Claude (Must Have) | Z.ai (M3 — Financial Year View, Must Have)
**What:** Structured "Period" field on compliance items — month+year for monthly filings (June 2026), quarter+year for quarterly (Q1 FY2026-27), assessment year for annual (AY2026-27). Dashboard and calendar respect the Indian financial year (April–March), not calendar year.
**Why Must Have:** Without a period field, 12 GSTR-3B items for a year are 12 identical rows. Cannot tell which month is filed vs. pending. The Indian FY runs April–March — any date grouping, chart, or calendar that defaults to January–December is wrong for Indian compliance professionals.
**Minimum scope:** Period text field on compliance items. FY selector on the dashboard (FY2025-26, FY2026-27). All charts and calendar group by April–March.

---

### M-04: Acknowledgement Number + Filing Reference Capture
**Source:** Claude (Must Have)
**What:** A field on each compliance item to record the government-issued acknowledgement number after filing — ARN (GST), ITR acknowledgement, SRN (ROC), TDS receipt number. This is the proof of filing.
**Why Must Have:** "Completed" without an acknowledgement number is not a compliance record — it is a checkbox. If a department notice arrives asking "when was GSTR-3B for June 2026 filed?", the Finance Manager cannot answer from this system without an ARN. Transforms the tool from a checklist into a compliance register.
**Minimum scope:** Single "Acknowledgement / Reference No." text field on compliance item detail. Shown in list view. Included in CSV export.

---

### M-05: Challan Payment Tracking
**Source:** Claude (Must Have) | Z.ai (G10 — Good to Have — overruled)
**What:** A "Challan Details" section on each compliance item: BSR code, challan serial number, payment date, amount paid, bank name, mode of payment. Separate from the filing acknowledgement — payment and filing are two distinct acts.
**Why Must Have:** Filing a return and paying the tax are legally separate in India. TDS must be paid before the 7th. GST must be paid before filing GSTR-3B. Without challan records, statutory auditors have no payment evidence. "Completed" with no BSR code means nothing to an auditor. Z.ai classified this as Good-to-Have — overruled because audit season makes this non-negotiable for retention.
**Minimum scope:** Challan card on compliance item detail page. Fields: BSR code, serial no., date, amount, bank. Optional per item. Included in PDF/CSV export.

---

### M-06: Annual Compliance Calendar View
**Source:** Claude (Must Have)
**What:** 12-month calendar grid where each compliance item appears as a colour-coded block on its due date. Colour by compliance type (GST = orange, TDS = blue, ROC = green, PF = purple). Click block to open item. Monthly and annual views. Respects April–March FY (M-03).
**Why Must Have:** The most powerful demo visual in compliance software. A calendar shows the prospect their entire compliance year at a glance — every obligation, every deadline, who owns it. Competitors who have this visual win demos against those who don't. Also how compliance professionals actually plan — not in lists, but in time.
**Minimum scope:** Monthly calendar grid. Colour by compliance type. Filter by department/assignee. The shadcn/ui calendar component is already in the codebase — extend it.

---

### M-07: Government Notice / SCN Register
**Source:** Claude (Must Have) | Z.ai (G5 — Good to Have — overruled)
**What:** Dedicated module to log incoming government notices and show-cause notices. Fields: notice number, issuing authority, date received, demand amount, reply deadline (auto-calculated from statutory days), assigned to, status (received / reply filed / under appeal / closed), document upload (notice PDF + reply PDF).
**Why Must Have:** Z.ai placed this as Good-to-Have. Overruled. This is the highest personal-liability feature for any Finance Manager or CFO. A GST department notice with a 21-day reply window that gets missed results in an ex-parte demand order. No other feature creates more urgency or more goodwill when the customer realises the system saved them from a missed reply. Strong differentiator — most SME compliance tools ignore it entirely.
**Minimum scope:** "Notices" section in sidebar. New notice form. Dashboard widget: "Notices with reply deadline in next 7 days." Auto-calculate reply deadline from received date + statutory days (configurable per authority type).

---

### M-08: Email Notifications (External — Verified Delivery)
**Source:** Claude (Must Have) | Z.ai (M4 — Email Reminder System, Must Have) — Full agreement
**What:** External email delivery of deadline reminders: 7 days before, 3 days before, 1 day before due date, on due date, and 1 day after. User controls which alerts they receive in Settings → Notifications. Also: notice reply deadline reminders (M-07) via email.
**Why Must Have:** In-app notifications exist but users are not in the app all day. Email is the minimum viable external channel. Without external notifications, deadlines will still be missed — the product fails its core promise. Both evaluators agree this is critical.
**Minimum scope:** Resend / Supabase Edge Function cron triggered daily. Plain-text email with item name, due date, days remaining, and direct link. Respects per-user notification preferences from Settings.

---

### M-09: Registration Number Fields on Compliance Items
**Source:** Claude (Must Have) — Z.ai partially addresses this at entity level (GSTIN, PAN, CIN exist on entity), but not on individual compliance items
**What:** Optional registration number field on each compliance item, auto-labelled based on compliance type: "GSTIN" for GST items, "TAN" for TDS, "PAN" for Income Tax, "CIN/LLPIN" for ROC/MCA, "PF Code" for PF, "ESIC Code" for ESIC. Pre-fills from entity registration data where available.
**Why Must Have:** A compliance tracker with no registration number on the filing is a generic task list. Every professional works by registration number. 24 GSTINs generating 24 indistinguishable GSTR-3B rows is the core failure mode for multi-state companies. Z.ai captures registration at entity level — this extends it to the filing level where it matters operationally.
**Minimum scope:** Single conditional text field on compliance item form. Label changes based on compliance type selected. No validation at V1.

---

### M-10: Bulk Import via CSV
**Source:** Claude (Must Have) | Z.ai (G7 — Bulk Operations, Good to Have — upgrading to Must Have)
**What:** Upload a CSV file to bulk-create compliance items. Downloadable template with columns: title, compliance type, period, due date, registration number, department, assignee email, priority. Row-by-row validation with error report.
**Why Must Have:** Any company with more than 20 compliance items cannot onboard manually. A CA firm with 119 clients × 40 items = 4,760 entries. Even a single company with 10 GSTINs has 120 GSTR-3B items per year. Bulk import is the first-day experience gate — without it, onboarding is so painful that users quit before getting value.
**Minimum scope:** CSV upload on Compliance → Import. Template download. Validate all rows before creating any. Error report lists row number + issue.

---

### M-11: Free Trial + Self-Serve Signup
**Source:** Claude (Must Have) | Z.ai (M8 — Pricing Page & Self-Service Sign-Up, Must Have) — Full agreement
**What:** 14-day free trial with no credit card. Full feature access. Trial countdown banner from day 10. Read-only mode after day 15 until plan selected.
**Why Must Have:** Any SaaS without a free trial in 2026 is invisible to self-evaluating buyers. The salesperson evaluator's #2 rejection reason: "I am the bottleneck for every single evaluation." Self-serve is how the first 50 customers find you without a sales team.
**Minimum scope:** `trial_started_at` field on organisations table (already has `plan` field). Trial countdown banner in app header. Lock item creation after trial ends. No payment integration needed at V1 — just the UX gate.

---

### M-12: Public Pricing Page
**Source:** Claude (Must Have) | Z.ai (M8 combined, Must Have) — Full agreement
**What:** `/pricing` page with 3 plan tiers (Starter / Growth / Business), feature comparison table, annual vs. monthly toggle, "Start Free Trial" CTA. Enterprise tier = "Contact us."
**Why Must Have:** Salesperson evaluator's #1 rejection reason: "I cannot answer the first question every prospect asks." Without published pricing, no repeatable sales or self-serve motion is possible. Opaque pricing signals either high cost or unreadiness.
**Minimum scope:** Static marketing page. Three plan cards. Feature grid. Pricing can be ₹X/month placeholders until decided — but the structure must exist.

---

### M-13: Improved Landing Page with Clear Value Proposition
**Source:** Z.ai (M9, Must Have) — not in Claude's original list
**What:** Rewrite the landing page with: a specific, outcome-focused headline ("Never miss a GST deadline again"), a 60-second demo video or animated product walkthrough, social proof section (even if just "Built for Indian compliance"), clear CTA hierarchy (Free Trial primary, Demo secondary), and a public-facing penalty calculator widget.
**Why Must Have:** The salesperson evaluator: "When a competitor's sales rep answers 'here is our pricing page' in the same conversation, I have already lost on perception." The landing page is the first impression for every self-serve prospect. A vague headline ("One Portal. One Truth.") is brand positioning, not conversion copy. The first thing a Finance Manager needs to see is: "this solves my specific problem."
**Minimum scope:** New headline + subheadline copy. Product screenshot or short GIF. Public penalty calculator widget (no login). Single CTA: "Start free trial." Takes 1 week, not 1 sprint.

---

### M-14: Approval Workflow (2-Level Maker-Checker)
**Source:** Claude (Must Have) | Z.ai (G9 — Audit Workflow Module, Good to Have — upgrading to Must Have for companies above 50 employees)
**What:** Before marking "Completed," assignee submits item for review. Reviewer (Manager/Admin) gets notification, checks acknowledgement number and challan, approves or rejects with a mandatory comment. Rejection returns item to "In Progress." Full approval chain in audit log.
**Why Must Have:** Corporate governance standard for companies above 100 employees. The CFO evaluator: "My board and statutory auditors require segregation of duties." Any mid-market company's internal audit will flag the absence of maker-checker. Without it, any "member" can close any compliance item with no review — creating both compliance risk and governance failure.
**Minimum scope:** `submitted_for_review` status added to enum. `reviewer_id` field on compliance items. Notification to reviewer. Approve/reject action with comment. Audit log records approver + timestamp.

---

### M-15: Dashboard Filters (Department, Type, Status, Assignee, Date Range)
**Source:** Claude (Must Have)
**What:** Filter bar on compliance list and dashboard: compliance type, status, department, assignee, priority, due date range. URL-persisted filters. Dashboard summary cards update to reflect active filter.
**Why Must Have:** A company with 5 departments and 200 compliance items cannot work with unfiltered aggregate numbers. The CFO evaluator: "I cannot filter the dashboard to see what is overdue at my Chennai office." Table-stakes for any SaaS with a dashboard and more than 20 records.
**Minimum scope:** Filter bar on compliance list page. Multi-select dropdowns. URL query params for sharing filtered views.

---

### M-16: Help Centre + In-App Onboarding Checklist
**Source:** Claude (Must Have) | Z.ai (noted as missing but not explicitly listed)
**What:** 10–15 help articles (how to create a compliance item, how to use audit points, what each status means, how to use the penalty calculator). Plus in-app first-time-user checklist: 5 steps to first value (add item → invite teammate → set reminder → try penalty calculator → complete first item).
**Why Must Have:** Without documentation, the founding team becomes the support desk. Unscalable past 20 customers. Also signals product maturity to any procurement evaluator who checks.
**Minimum scope:** Static `/help` section with Markdown articles. In-app banner for new users showing the 5-step checklist. Dismiss button. Persistent until all 5 steps done.

---
---

# TIER 2 — GOOD TO HAVE
### These unlock higher-paying segments, reduce churn, or significantly improve conversion. Required to reach 500 customers.

---

### G-01: Multi-Client Architecture (CA / Consulting Firm Edition)
**Source:** Claude | Z.ai (G8 — Client/Vendor Read-Only Portal is a lighter version)
**What:** Firm-level account managing multiple client organisations under one login. Top-level org switcher. Consolidated "All Clients" overdue dashboard. Each client's data fully isolated.
**Note on Z.ai G8:** Z.ai proposed a read-only client portal (clients view their own compliance status). That is the lighter version of this — build the read-only portal first as it requires less architectural change, then extend to full multi-client management.
**Why Good to Have:** CA firms are the best referral channel in Indian compliance software. Current single-org architecture blocks them entirely. High effort (schema change: firm → client relationships) — V2 priority after PMF is confirmed.

---

### G-02: Location / Branch Management
**Source:** Claude
**What:** `locations` table (name, type: office/factory/warehouse, city, state). Assign compliance items to a location. Dashboard filterable by location. Location-wise compliance health card.
**Why Good to Have:** CFO evaluator's Reason 1. Required for manufacturing and multi-state companies. SME buyers (1–2 states) can use departments as a proxy. Build after the core product is stable.

---

### G-03: TDS / TCS Section-Wise Tracking
**Source:** Z.ai (G3) — not in Claude's original list
**What:** When a TDS compliance item is created, allow selection of TDS section: 192 (salary), 194C (contractor), 194I (rent), 194J (professional fees), 194H (commission), etc. Track challan and filing by section. Section-wise TDS summary in reports.
**Why Good to Have:** TDS is India's most voluminous tax compliance — every company deducts TDS under multiple sections monthly. A Finance Manager tracking TDS at item level needs to know which section each payment and challan belongs to. This makes the TDS module genuinely useful vs. a generic "TDS" label. Z.ai is right to add this — it is a meaningful depth feature for the largest compliance type.

---

### G-04: Tally Integration (Basic — Import Only)
**Source:** Z.ai (G4) — Claude originally had as Ignore — upgraded based on Z.ai's reasoning
**What:** Import TDS deductions and GST liability data from Tally Prime via CSV export. Tally's TDL export generates standardised CSVs. Parse these to auto-create compliance items (TDS payment due on 7th, GST payment due before GSTR-3B). No bidirectional sync at V1.
**Why Good to Have:** Tally has 90%+ Indian SME accounting market share. The #1 objection in every demo will be: "we already have Tally." A basic Tally import (not full API integration) removes this objection — "we connect to Tally." Tally CSV export is well-documented, no API partnership needed. Z.ai correctly upgraded this from Ignore to Good-to-Have.

---

### G-05: Escalation Engine
**Source:** Claude | Z.ai (G16 — Email Template Customization partially covers this)
**What:** Configurable escalation rules: "If item not updated 7 days before due date → notify assignee. If 3 days before → notify Department Head. If on due date → notify Admin/CFO." Rules configured in Settings → Escalation Matrix.
**Why Good to Have:** CFO evaluator's Reason 6: "I need a system that chases my team so I don't have to." Basic email notifications (M-08) solve 80% of this. Escalation chains unlock mid-market and enterprise ACV.

---

### G-06: Compliance Health Score
**Source:** Z.ai (G14) — not in Claude's original list
**What:** A single numerical score (0–100) per organisation representing overall compliance health: calculated from completion rate, overdue items, average days-to-file, and pending-vs-due ratio. Shown on dashboard. Trend (up/down from last month). Colour-coded: Green (80+), Yellow (60–79), Red (<60).
**Why Good to Have:** Z.ai correctly identified this — it is the single number a CEO or CFO can read in 2 seconds. It gamifies compliance management. It also creates a shareable metric ("our compliance score went from 62 to 88 this quarter") that drives renewals and word-of-mouth. Easy to compute from existing data.

---

### G-07: Hierarchical Dashboard Views (CFO → Manager → Location)
**Source:** Z.ai (I8 — Can Be Ignored — upgraded) | not in Claude's original list
**What:** Role-filtered dashboard: Admin/CFO sees all departments and all locations. Manager sees only their department. Member sees only their assigned items. Each view shows the same dashboard metrics but filtered to their scope automatically.
**Why Good to Have (not Ignore):** Z.ai put this in "Ignore" — disagree. Companies above 50 employees have multiple managers. A Finance Manager should not see HR compliance items and vice versa. Automatic scope filtering by role is not enterprise complexity — it is basic multi-user product design. Low effort (filter dashboard data by user's department assignment) with high impact on team adoption.

---

### G-08: Filed Date + Payment Date Fields
**Source:** Claude | Z.ai (G10 — Challan Payment Tracking covers payment date)
**What:** Two additional date fields: "Filed On" (actual filing date, separate from due date) and "Paid On" (challan payment date). Enables accurate late-fee calculation: penalty is computed on actual filing date vs. due date, not on when status was updated.
**Why Good to Have:** Late filing penalty requires knowing actual filing date. Payment date is needed for TDS interest computation. Connects the existing penalty calculator to live item data rather than requiring manual entry.

---

### G-09: Financial Exposure Dashboard Widget
**Source:** Claude | Z.ai (I16 — Risk Scoring & Penalty Impact Analysis — placed in Ignore; disagree for the widget version)
**What:** Dashboard widget: "Estimated penalty if all overdue items remain unfiled today: ₹X." Auto-computed by cross-referencing overdue items' types and delay days with penalty calculator rates. Requires adding a "tax/fee amount" field to compliance items.
**Why Good to Have:** The number CFOs look at every week — not "how many items overdue" but "what does the overdue cost us in rupees." Makes compliance urgency tangible in money. Small schema change (`amount` field on items), large dashboard impact.

---

### G-10: Mobile-Responsive PWA
**Source:** Claude (G-06) | Z.ai (G6) — Full agreement
**What:** Ensure full mobile optimisation. Configure as PWA (manifest.json, service worker) — users can add to phone home screen and receive push notifications without a native app.
**Why Good to Have:** Factory managers, warehouse staff, field users are on phones. A web-only tool with no mobile experience loses the operational buyer at every demo. PWA is 20% of the cost of a native app at 60% of the value.

---

### G-11: WhatsApp Notification Integration
**Source:** Claude (G-12) | Z.ai (G1) — Full agreement
**What:** Compliance deadline alerts and escalation notifications via WhatsApp Business API (Interakt / Gupshup). User opts in with WhatsApp number in Settings.
**Why Good to Have:** WhatsApp read rate in India = 95% vs. email = 20%. A deadline reminder on WhatsApp gets acted on. However, WhatsApp Business API requires business verification, template pre-approval, and per-message costs — infrastructure lift. Build at 200+ customers.

---

### G-12: ROC / MCA Compliance Module (Dedicated)
**Source:** Z.ai (G11) — not explicitly in Claude's original list
**What:** Dedicated section for ROC/MCA compliance: annual filings calendar (AOC-4, MGT-7, MGT-14, DIR-3 KYC, ADT-1), SRN tracking per filing, charge satisfaction tracking, director DIN status. Auto-suggests based on company type (Pvt Ltd / Public Ltd / OPC) and paid-up capital.
**Why Good to Have:** ROC compliance is mandatory for every registered company — 10 Pvt Ltd, 2 Public Ltd, 4 LLPs in a CA firm's portfolio all have annual MCA filings. Currently "ROC" is just a compliance type label. A dedicated module with MCA-specific fields and due date intelligence (MGT-7 due 60 days from AGM, etc.) makes the product genuinely useful for CS professionals — unlocking a new user persona.

---

### G-13: Multi-GSTIN Register
**Source:** Claude (G-13) | Z.ai (G12) — Full agreement
**What:** Org-level GSTIN register: all GSTIN registrations with state, registration date, type (Regular/Composition/SEZ), status. GST compliance items link to a specific GSTIN from this register.
**Why Good to Have:** Registration number field (M-09) handles the single-GSTIN case. Multi-GSTIN register handles companies with 3+ state registrations — enables filtering GSTR-3B items by GSTIN and auto-populating state. Required for mid-market segment.

---

### G-14: Email Template Customization
**Source:** Z.ai (G16) — not in Claude's original list
**What:** Allow users to customise the wording of deadline reminder emails — add company name, custom message, CC recipients. Admin can preview before saving. Default templates are professional but editable.
**Why Good to Have:** CA firms forwarding compliance reminders to clients need the email to say "From: Your CA Firm" not a generic ComplianceTrack notification. Small feature, high perceived value for the CA segment. Low development effort.

---

### G-15: Staff Workload + Performance View
**Source:** Claude (G-07)
**What:** Per-user view (Admin/Manager): items assigned, completed in last 30 days, overdue, average days-to-complete.
**Why Good to Have:** CA evaluator: "How do I know how many items each person completed this month?" Management feature that makes the product valuable to team leads — drives renewal when managers see team accountability data.

---

### G-16: Board / Audit Committee Report Generator (PDF)
**Source:** Claude (G-08)
**What:** Structured quarterly PDF report: total obligations, completion %, overdue, penalties paid, notices summary, overdue details, trend vs. last quarter.
**Why Good to Have:** CFO cannot justify not using the tool if this report generates automatically. Renewal lock-in feature. Depends on M-05 (challan) and M-07 (notices) being in place first.

---

### G-17: SSO / Google Workspace / Microsoft Entra Login
**Source:** Claude (G-10) | Z.ai (not listed separately)
**What:** OAuth login via Google and Microsoft. Supabase Auth supports both natively — configuration change.
**Why Good to Have:** Procurement requirement for mid-market. 1-day task using existing Supabase Auth providers. Disproportionate value for low effort.

---

### G-18: Document Version Control
**Source:** Claude (G-11)
**What:** When a new file is uploaded for the same compliance item, keep previous versions accessible. Mark latest as current. Version history with uploader name and timestamp.
**Why Good to Have:** Final signed Form 3CD must be distinguishable from drafts. Audit-grade document management. Moderate effort — `version` field on documents table.

---

### G-19: Public ROI Calculator
**Source:** Claude (G-05)
**What:** Public-facing (no login) ROI calculator on the landing page. Inputs: company size, GSTINs, states, last year's penalties paid. Output: estimated savings vs. software cost.
**Why Good to Have:** Converts top-of-funnel visitors into qualified leads. The penalty calculator already exists in-app — this is a public-facing version of the same logic.

---

### G-20: Public Roadmap Page
**Source:** Claude (G-14)
**What:** `/roadmap` page showing shipped, in-progress, and planned features. Customer upvoting.
**Why Good to Have:** Salesperson evaluator Reason 20: "I cannot sell the future when the present has gaps." Builds trust with prospects and handles the "when will X be ready?" objection in every competitive deal.

---

### G-21: G2 / Capterra / SoftwareSuggest Listing
**Source:** Claude (G-15)
**What:** Verified listings in "Compliance Management Software — India" category. 5 reviews from beta users before launch.
**Why Good to Have:** Salesperson Reason 5: product doesn't exist in the prospect's research phase. Not a product feature but as important as any feature for early traction. 2-week effort.

---
---

# TIER 3 — CAN BE IGNORED
### Premature, niche, or requiring non-engineering investment (regulatory, partnerships, certifications). Do not build before 500+ customers.

---

### I-01: EXIM / Import-Export Compliance Module (DGFT, Advance Authorisation, EPCG, RODTEP, Duty Drawback)
**Source:** Claude + Z.ai (I4) — Full agreement
**Why ignore:** Relevant only to active EXIM companies. Deep DGFT domain knowledge required. "Other" compliance type handles basic tracking. Build only when 3+ enterprise EXIM customers request it with budget.

---

### I-02: Factory Licence + Industrial Compliance Lifecycle (PCB Consent, Boiler Certificates, Environmental Clearance)
**Source:** Claude (I-03) + Z.ai (I1 + I3) — Full agreement
**Why ignore:** Relevant only to companies with factories. "Environmental" type handles basic tracking. Licence-condition linkage is complex to model. Build when manufacturing becomes a primary customer segment.

---

### I-03: Fire + Safety Compliance Module
**Source:** Claude (I-12) + Z.ai (I2) — Full agreement
**Why ignore:** Fire NOC, extinguisher certificates, mock drill records — can all be tracked under "Other" compliance type with location tags (G-02). Dedicated module adds UI complexity without new data capability. Build only if facilities management becomes a target segment.

---

### I-04: C&F Agent / Third-Party Vendor Compliance Portal
**Source:** Claude (I-04) + Z.ai (I5) — Full agreement
**Why ignore:** Requires a separate external portal with its own auth, upload flow, and verification workflow — effectively a second product. V3 feature for logistics and distribution companies.

---

### I-05: Contract Labour Compliance Module
**Source:** Claude (I-05) + Z.ai (I6 — State-Specific Labour Law Variations)
**Why ignore:** Relevant to factories and warehouses with contract workers. "Labour" compliance type handles basic tracking. Full module (principal employer register, contractor licence tracking) requires significant domain complexity.

---

### I-06: ERP Integration (SAP / Oracle)
**Source:** Claude (I-02) + Z.ai (I7)
**Why ignore:** Requires vendor partnership, dedicated API maintenance, enterprise-grade SLAs. Development cost exceeds revenue from first 100 customers. Tally basic import (G-04) is the correct stepping stone.

---

### I-07: AI / ML Predictive Analytics
**Source:** Z.ai (I9)
**Why ignore:** Too early. Build the dataset first — 500+ notices logged, 10,000+ compliance items tracked — then AI analysis becomes meaningful. Premature AI is expensive and under-delivers when the training data does not exist yet.

---

### I-08: AI-Powered Notice Analysis (Auto-identify grounds to contest, demand calculation)
**Source:** Claude (I-07)
**Why ignore:** Legally complex — AI-generated legal advice creates liability exposure. Depends on M-07 (notice register) being built and used first. Revisit when 500+ notices are in the system and legal review process is defined.

---

### I-09: Government Portal API Integration (GSTN API, MCA21 API, TRACES API)
**Source:** Claude (I-08)
**Why ignore:** GSTN API requires a GSP (GST Suvidha Provider) licence — 6–12 month regulatory process. MCA21 and TRACES APIs are similarly gated. This is a regulatory and business development challenge, not a development task.

---

### I-10: SOC 2 Type II / ISO 27001 Certification
**Source:** Claude (I-09) + Z.ai (I11) — Full agreement
**Why ignore now:** A process, not a feature. SOC 2 Type II takes 12–18 months. Implement security best practices now (already done — auth-guard, audit logs, row isolation), document them, pursue certifications post–Series A.

---

### I-11: CA Firm Billing / Professional Fee Tracking
**Source:** Claude (I-10) + Z.ai (G13 — Compliance Fee/Billing Tracking moved to Good to Have)
**Why ignore:** Z.ai placed this as Good-to-Have. Kept in Ignore because fee tracking requires multi-client architecture (G-01) to be built first. Building billing before multi-client is building a room without a foundation. Add after G-01 ships.

---

### I-12: Board Meeting + Corporate Governance Calendar
**Source:** Z.ai (I12) — not in Claude's original list
**Why ignore:** Board meeting dates, quorum requirements, notice periods — relevant only to listed companies or companies with active board governance requirements. Covered by a Company Secretary manually. Too narrow a use case for general compliance SaaS.

---

### I-13: Insurance Compliance Tracking
**Source:** Z.ai (I13) — not in Claude's original list
**Why ignore:** Insurance policy renewals (D&O, asset, workmen's compensation, group health) are managed by the admin/HR team, not the finance/compliance team. Different buyer persona, different tool. Niche feature that adds UI clutter for the core compliance user.

---

### I-14: Real Estate / Property Compliance
**Source:** Z.ai (I14) — not in Claude's original list
**Why ignore:** Vertical-specific (RERA registration, property tax, lease compliance). Requires deep real estate regulatory knowledge. Build a separate product for this segment, not a module in a general compliance SaaS.

---

### I-15: Bank / FI Compliance (CMA Data, LC / BG Tracking)
**Source:** Z.ai (I15) — not in Claude's original list
**Why ignore:** Bank compliance (CMA data submission, stock statement to banks, LC/BG validity) is managed by treasury/finance teams using banking portals. Different tool, different user, different regulatory domain.

---

### I-16: Multi-Currency / Multi-Country Support
**Source:** Z.ai (I18)
**Why ignore:** Product is explicitly built for India. Multi-country support requires separate regulatory databases, currency handling, and tax regime knowledge for each country. Premature internationalisation kills focus. Build India first; internationalise at Series B.

---

### I-17: Native Mobile Apps (iOS / Android)
**Source:** Z.ai (I17) — Claude has PWA (G-10) as the path
**Why ignore:** Native apps require separate iOS and Android codebases, App Store/Play Store submissions, and ongoing maintenance. PWA (G-10) delivers 60% of the value at 20% of the cost. Native apps are V3 if PWA proves insufficient.

---

### I-18: Partner / Channel Sales Programme
**Source:** Z.ai (I10) — not a product feature
**Why ignore:** A go-to-market programme, not a product feature. CA referral partnerships, reseller agreements, and co-marketing deals are business development activities. Cannot be built by engineering. Start informally with 5 CA partners — if it works, formalise it.

---

### I-19: Contingent Liability Disclosure Tracker (Balance Sheet Notes)
**Source:** Claude (I-11)
**Why ignore:** Financial accounting feature (AS 29 / Ind AS 37 disclosure). Overlaps with notice register (M-07) and exposure widget (G-09) but requires accounting system integration. Too specialised for general compliance SaaS.

---

### I-20: FEMA / RBI Transaction Reporting
**Source:** Claude (I-13)
**Why ignore:** Relevant only to companies with foreign investments or specific forex transactions. Covered by specialist compliance consultants and software. Adding it to a general compliance tool creates noise.

---
---

## Master Summary Table

| ID | Feature | Tier | Effort | Impact | Source |
|---|---|---|---|---|---|
| M-01 | Recurring compliance engine | **Must Have** | High | Critical | Both (Claude Must, Z.ai Good — overruled) |
| M-02 | India compliance calendar DB + entity auto-suggest | **Must Have** | Medium | Critical | Both (M1+M2 from Z.ai, M-07 from Claude) |
| M-03 | Period / financial year field (April–March) | **Must Have** | Low | Critical | Both |
| M-04 | Acknowledgement / ARN / reference number field | **Must Have** | Low | High | Claude |
| M-05 | Challan payment tracking (BSR, amount, date) | **Must Have** | Medium | High | Both (Claude Must, Z.ai Good — overruled) |
| M-06 | Annual compliance calendar view | **Must Have** | Medium | High | Claude |
| M-07 | Government notice / SCN register | **Must Have** | Medium | Critical | Both (Claude Must, Z.ai Good — overruled) |
| M-08 | Email notifications (external, verified delivery) | **Must Have** | Low | Critical | Both |
| M-09 | Registration number fields on compliance items | **Must Have** | Low | Critical | Claude |
| M-10 | Bulk import via CSV | **Must Have** | Medium | High | Both (Claude Must, Z.ai Good — upgraded) |
| M-11 | Free trial / self-serve signup | **Must Have** | Low | Critical | Both |
| M-12 | Public pricing page | **Must Have** | Low | Critical | Both |
| M-13 | Improved landing page + value proposition | **Must Have** | Low | High | Z.ai |
| M-14 | Approval workflow — 2-level maker-checker | **Must Have** | Medium | High | Both (Claude Must, Z.ai Good — upgraded) |
| M-15 | Dashboard filters (type, status, dept, assignee) | **Must Have** | Medium | High | Claude |
| M-16 | Help centre + in-app onboarding checklist | **Must Have** | Low | High | Claude |
| G-01 | Multi-client architecture (CA Practice Edition) | Good to Have | Very High | Very High | Claude |
| G-02 | Location / branch management | Good to Have | High | High | Claude |
| G-03 | TDS/TCS section-wise tracking | Good to Have | Medium | High | Z.ai |
| G-04 | Tally integration (basic CSV import) | Good to Have | Medium | High | Z.ai (Claude upgraded from Ignore) |
| G-05 | Escalation engine (configurable rules) | Good to Have | High | High | Claude |
| G-06 | Compliance health score (0–100) | Good to Have | Low | High | Z.ai |
| G-07 | Hierarchical dashboard views (role-scoped) | Good to Have | Medium | High | Z.ai (upgraded from Ignore) |
| G-08 | Filed date + payment date fields | Good to Have | Low | Medium | Claude |
| G-09 | Financial exposure widget (₹X at risk today) | Good to Have | Low | High | Claude |
| G-10 | Mobile PWA | Good to Have | Medium | High | Both |
| G-11 | WhatsApp notification integration | Good to Have | High | High | Both |
| G-12 | ROC / MCA dedicated module | Good to Have | Medium | High | Z.ai |
| G-13 | Multi-GSTIN register | Good to Have | Medium | High | Both |
| G-14 | Email template customisation | Good to Have | Low | Medium | Z.ai |
| G-15 | Staff workload + performance view | Good to Have | Medium | Medium | Claude |
| G-16 | Board / audit committee PDF report | Good to Have | High | High | Claude |
| G-17 | SSO / Google / Microsoft login | Good to Have | Low | Medium | Claude |
| G-18 | Document version control | Good to Have | Medium | Medium | Claude |
| G-19 | Public ROI calculator | Good to Have | Low | High | Claude |
| G-20 | Public roadmap page | Good to Have | Low | Medium | Claude |
| G-21 | G2 / Capterra listing | Good to Have | Low | High | Claude |
| I-01 | EXIM compliance module | Ignore | Very High | Low | Both |
| I-02 | Factory / industrial compliance lifecycle | Ignore | High | Low | Both |
| I-03 | Fire + safety dedicated module | Ignore | Medium | Low | Both |
| I-04 | C&F agent / vendor compliance portal | Ignore | Very High | Low | Both |
| I-05 | Contract labour compliance module | Ignore | High | Low | Both |
| I-06 | ERP integration (SAP / Oracle) | Ignore | Very High | Low | Both |
| I-07 | AI / ML predictive analytics | Ignore | Very High | Medium | Z.ai |
| I-08 | AI-powered notice analysis | Ignore | Very High | Medium | Claude |
| I-09 | Government portal API (GSTN / MCA / TRACES) | Ignore | Very High | Low | Claude |
| I-10 | SOC 2 / ISO 27001 certification | Ignore | Very High | Medium | Both |
| I-11 | CA billing / fee tracking | Ignore | High | Low | Both |
| I-12 | Board meeting + governance calendar | Ignore | Medium | Low | Z.ai |
| I-13 | Insurance compliance tracking | Ignore | Medium | Low | Z.ai |
| I-14 | Real estate / property compliance | Ignore | High | Low | Z.ai |
| I-15 | Bank / FI compliance (CMA, LC/BG) | Ignore | High | Low | Z.ai |
| I-16 | Multi-currency / multi-country | Ignore | Very High | Low | Z.ai |
| I-17 | Native iOS / Android apps | Ignore | Very High | Medium | Z.ai (PWA is the path) |
| I-18 | Partner / channel sales programme | Ignore | N/A | Low | Z.ai (GTM not product) |
| I-19 | Contingent liability disclosure tracker | Ignore | Medium | Low | Claude |
| I-20 | FEMA / RBI reporting | Ignore | High | Low | Claude |

**Totals: 16 Must Have | 21 Good to Have | 20 Can Be Ignored**

---

## Recommended Build Sequence

**Sprint 1 (Weeks 1–2): Acquisition foundation**
- M-11: Free trial flow
- M-12: Pricing page
- M-13: Landing page rewrite
- M-16: Help centre + onboarding checklist
- G-17: Google SSO (1 day — Supabase config)

**Sprint 2 (Weeks 3–4): Core data fields**
- M-03: Period / FY field
- M-04: Acknowledgement number field
- M-09: Registration number fields
- G-08: Filed date + payment date fields
- G-06: Compliance health score (computed from existing data — low effort)

**Sprint 3 (Weeks 5–6): Automation + scale**
- M-01: Recurring compliance engine
- M-10: Bulk CSV import
- M-02: India compliance calendar DB + entity auto-suggest templates

**Sprint 4 (Weeks 7–8): Visibility + control**
- M-06: Annual calendar view
- M-15: Dashboard filters
- G-07: Hierarchical role-scoped dashboard
- G-09: Financial exposure widget

**Sprint 5 (Weeks 9–10): Evidence + governance**
- M-05: Challan tracking
- M-14: Approval workflow (maker-checker)
- G-18: Document version control
- G-03: TDS/TCS section-wise tracking

**Sprint 6 (Weeks 11–12): Risk management + external comms**
- M-07: Government notice / SCN register
- M-08: Email notifications (verified external)
- G-05: Escalation engine (basic 2-level)
- G-19: Public ROI calculator

**Sprint 7 (Weeks 13–14): Market visibility**
- G-21: G2 / Capterra listing (business action, not engineering)
- G-20: Public roadmap page
- G-04: Tally basic CSV import
- G-12: ROC / MCA dedicated module

**Post-Sprint 7 — evaluate PMF signals:**
- CA firms primary segment → Build G-01 (multi-client), G-14 (email templates)
- Mid-market primary → Build G-02 (location), G-16 (board report), G-13 (multi-GSTIN)
- Growth stalling → G-11 (WhatsApp), G-10 (PWA), G-15 (staff performance)

---

*Document prepared by: DEVABOSS / Claude Code*
*Merged with: Z.ai independent feature audit*
*Sources: evaluation_by_ca.md (6 evaluations, 4 personas) + Z.ai feature table + full codebase review (schema, pages, API routes)*
*Date: 2026-06-29*
*This is a living document. Update after each sprint. Where Claude and Z.ai disagreed, decisions are documented in the Conflicts Resolved table at the top.*
