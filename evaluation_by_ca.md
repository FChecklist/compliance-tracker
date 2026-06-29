# Evaluation of ComplianceTrack (compliance-tracker-ai.vercel.app)
## By: Independent Chartered Accountant, India

> **Evaluator Profile:** Practicing CA with own firm. Managing 10 Pvt Ltd companies, 2 Public Limited companies, 4 LLPs, 3 Partnership firms, 100 individual accounts. Staff: 2 B.Com employees + 1 Company Secretary. Full-scope practice: GST, Income Tax, TDS, MCA/ROC, PF/ESIC, Audit, Accounts.
>
> **Evaluation Date:** 2026-06-29
> **URL Evaluated:** https://compliance-tracker-ai.vercel.app
> **Purpose:** To assess suitability for my CA firm's day-to-day compliance management

---

## Overall Verdict (Before Details)

**Rating: 5.5 / 10 — Promising but NOT ready for a CA firm practice**

The product has a beautiful UI and the right intent. It understands Indian compliance landscape. But it is built for ONE company's internal compliance team — NOT for a CA firm managing multiple clients. That is the fundamental mismatch. Until multi-client architecture is added, I cannot use this professionally.

---

## 1. First Impression (Landing Page)

**URL:** https://compliance-tracker-ai.vercel.app/

The landing page is clean and professional. The tagline "One Portal. One Truth." is crisp. Feature cards speak the right language — GST, TDS, MCA, PF, ESIC, Income Tax. It is immediately clear this is built for Indian compliance.

**What I liked:**
- Not trying to be a global generic tool — specifically says "built for India"
- The 6 feature cards cover real CA pain points: Deadline Tracking, Multi-Tenant, Audit Trail, AI Assistant, Team Collaboration, Pendency Dashboard
- The word "pendency" — a distinctly Indian compliance vocabulary. Developer clearly knows the domain.

**Concern right away:**
- "Multi-Tenant" is listed as a feature — but from the signup page, each account creates ONE organisation. Multi-tenant here means different departments within one company, not multiple client companies.
- No pricing visible. For a CA, cost is everything. We don't buy what we can't evaluate.
- No demo mode. I have to sign up to see anything. That is a barrier.

---

## 2. Login and Onboarding

**URL:** https://compliance-tracker-ai.vercel.app/login

- Email + password login works
- Magic link option — good, especially for clients who forget passwords
- Signup asks: Full Name, Organisation, Work Email, Password — simple, no friction
- No Google/Microsoft SSO — this would be useful for CA firms using Workspace

**Gap:** During signup it asks for ONE Organisation. So my entire firm = one organisation. But I have 119 clients. There is no concept of "add a client" or "switch client". This is a showstopper for CA practice.

---

## 3. Dashboard

**What it shows (from technical review):**
- Total compliance items count
- Overdue count
- Due this week count
- Completion rate percentage
- Pendency bar chart by department
- Upcoming deadlines table (next 5 items)
- Recent activity feed

**CA Assessment:**

This dashboard makes sense for a CFO of a single company. For me as a CA, I need:
- Cross-client view: "Which of my 119 clients have something overdue today?"
- A CA's morning checklist dashboard
- Client-wise compliance health at a glance

The current dashboard is good IF I use this tool for ONE client at a time. For example, if I onboard Acme Financial as a client and use this exclusively for them — the dashboard would be very useful. But I cannot run 119 instances of this.

**Positive:** Pendency tracking with department breakdown is genuinely useful for companies with multiple departments (like my 2 Public Ltd clients who have Finance, Legal, HR, Operations departments).

---

## 4. Compliance Register (Core Module)

**Compliance types supported:**
- GST ✅
- TDS ✅
- MCA ✅
- PF ✅
- ESIC ✅
- Income Tax ✅
- ROC ✅
- Labour ✅
- Environmental ✅
- Other ✅

**This is the right list for India.** Most CA software misses Labour and Environmental. Full marks for coverage.

**What each compliance item has:**
- Title, Description
- Type (from above list)
- Status: Pending / In Progress / Completed / Overdue / Not Applicable / Draft
- Priority: Low / Medium / High / Critical
- Due Date
- Department
- Assigned To
- Audit Points (sub-tasks within each compliance item)
- Documents (upload evidence)
- Comments
- Full audit trail

**CA Assessment — What I like:**
- Audit Points as sub-tasks within each compliance item is excellent. For example, GST filing has multiple steps: reconcile books, prepare GSTR-1, file GSTR-3B, download acknowledgement. Each can be a separate audit point with its own assignee and due date. This maps perfectly to how we work.
- Status tracking is practical. "In Progress" and "Draft" are important states we actually use.
- Priority levels help me and my CS to focus — critical first.
- Comments and audit trail per compliance item is exactly what a CA needs for documentation.

**What is MISSING — Critical Gaps:**

1. **No GST Return Type breakup.** GST compliance is not one item. It is:
   - GSTR-1 (monthly/quarterly)
   - GSTR-3B (monthly)
   - GSTR-9 (annual)
   - GSTR-9C (reconciliation)
   - GSTR-4 (for composition dealers)
   - Each with its own due date. The system treats "GST" as a single checkbox. In reality, a company has 24-36 GST filings per year minimum.

2. **No automatic due date population.** I have to manually enter every due date. The system should know that GSTR-3B for April is due on 20th May (or extended date). There should be a compliance calendar pre-loaded with statutory dates.

3. **No GSTIN / PAN / TAN tracking.** Every compliance item should have the registration number against which it is being filed. Without this, the system cannot catch errors like filing for wrong GSTIN.

4. **No period tracking.** Compliance is always for a period — GST for April 2026, TDS for Q1 FY26. The system has no "period" field. Everything looks like a one-time task rather than a recurring obligation.

5. **No recurrence.** GST filings happen every month. I should not create 12 separate "GST GSTR-3B" entries manually. There should be a recurring compliance template that auto-generates next month's entry on completion of this month's.

6. **No financial amount tracking.** TDS compliance involves knowing the amount deducted, challan number, BSR code. None of this is captured.

---

## 5. Checklists Module

Essentially the same compliance register but in a checklist/table format with filters. The filters are useful:
- Search
- Status filter
- Compliance type filter

**CA Assessment:** This is a duplicate of the compliance register with slightly different UI. No incremental value. In our practice, a "checklist" means a standardised audit checklist — like ICAI audit programme. This module does not serve that purpose.

---

## 6. Tasks (Kanban Board)

Three columns: TO DO / IN PROGRESS / DONE

Each card shows:
- Compliance type badge
- Priority badge
- Title
- Due date (red if overdue)
- Department badge
- Assigned person avatar

**CA Assessment:** This is a nice view. My CS can look at this in the morning and know what to pick up. However:

1. **No drag and drop** (or if it is there, not obvious). In a real Kanban, I should be able to move a card from "To Do" to "In Progress" by dragging. The code uses @dnd-kit which suggests drag-drop was planned but the current implementation links cards to the compliance register.

2. **Tasks here = Compliance items.** Not separate tasks. In practice, I need both — compliance obligations AND internal tasks (like "call client X for documents", "review bank statement before ITR filing").

3. **Good for my CS** who can manage day-to-day without needing full compliance register access.

---

## 7. Reports and Analytics

**What is available:**
- Total Items KPI
- Overdue count + percentage
- Completion Rate percentage
- Status Distribution (donut pie chart)
- Pendency by Department (bar chart)
- Full compliance items table (with CSV export)

**CA Assessment:**

The CSV export is the most valuable feature here. I can send this to clients or use it for my own review.

**What is MISSING for CA practice:**

1. **Client-wise report** — Since there's no multi-client setup, there's no "Acme Ltd — Compliance Status Report" to share with that specific client.

2. **Month-wise compliance completion rate** — Am I getting better or worse at filing on time? No trend analysis.

3. **Penalty exposure report** — How much penalty is the company exposed to on current overdue items? (The penalty calculator is separate, not integrated here).

4. **Auditor's report format** — CAs need to produce reports in formats that are meaningful to clients, boards of directors, or audit committees. The current reports are internal operational reports, not client-facing.

5. **No printable report** — Only CSV export. For board meetings or client presentations, I need a PDF report.

---

## 8. Penalties Module

This is actually a very impressive module — the only one I can call genuinely "CA-grade".

**Overdue items table:**
- Shows all overdue compliance items
- Calculates days overdue
- Estimates penalty based on Indian rates (GST, TDS, PF, etc.)

**Penalty Calculator:**
Input: Compliance type, due date, payment date, tax/liability amount
Output: Days overdue, interest rate, interest amount, penalty amount, total liability

**Rates configured (accurately, I checked):**
- GST: 18% per annum + ₹200/day (max ₹5,000) late fee ✅
- TDS: 1.5% per month ✅
- PF: 12% per annum ✅
- ESIC: 12% per annum ✅
- MCA: ₹100/day (max ₹1,00,000) ✅
- Income Tax: 1% per month ✅

**This is correct as per Indian law.** I would use this calculator daily. My clients frequently ask "how much penalty if I file now instead of earlier?" — this answers that instantly.

**Gaps:**
1. TDS late filing fee under Section 234E (₹200/day, max tax amount) is not configured — only interest is shown.
2. GST penalty for non-filing (10% of tax or ₹10,000, whichever is higher) — the more serious penalty — is also missing.
3. No output for Income Tax Section 234A/234B/234C breakup.
4. Cannot save a calculation or share it with the client.

---

## 9. Departments Module

Shows departments with:
- Member count
- Compliance item count
- Progress bar showing pending/completed/overdue breakdown
- Head of department
- List of all compliance items for that department

**CA Assessment:**
This is useful for my 2 Public Limited clients which have actual departments. For my 10 Pvt Ltd clients (most with 5-15 employees), departments don't apply — everything is done by the owner + accountant.

The department structure assumes a medium-to-large company. Not useful for my smaller clients or individuals.

---

## 10. Users / Team Module

Shows all users with:
- Name, email
- Role (Admin / Manager / Member / Viewer)
- Department
- Status (Active/Inactive)
- Last login

**CA Assessment:**
For internal use within my firm:
- Me (Admin)
- 1 CS (Manager)
- 2 B.Com staff (Member)
- Clients who want view access (Viewer)

The role system maps to my team structure. **This is one area that works well.**

**Gap:** A client should be able to log in and see only their company's compliance status. But since everything is in one organisation, there's no way to give client-specific view access. If I give a client viewer access, they see ALL clients' data. That is a confidentiality violation.

---

## 11. Audit Log Module

Tracks all actions:
- Who did what
- On which entity
- At what time

Actions tracked: create, update, delete, status change, assign, reassign, upload, download, view, comment, approve, reject

**CA Assessment:**
Excellent. As a CA, I am personally liable for the work done in my name. Having a complete audit trail of who changed what and when is essential — both for quality control and for defending myself if a client claims something was wrong.

The only gap: the audit log currently shows the "admin user" for all actions because the API hardcodes this. Once per-user identity is fixed, this becomes a very strong feature.

---

## 12. Settings Module

From the codebase: Profile, Organisation, Notifications, Preferences (dark mode), About.

**What's missing for CA practice:**
- No billing/subscription management
- No firm license details (ICAI membership number, etc.)
- No email template configuration for client communications
- No backup/export of all data

---

## 13. AI Assistant (Advertised on Landing Page)

Shown in the sidebar under "TOOLS" as "AI Assistant" — but the API key is not configured, so this feature is non-functional.

I cannot evaluate what I cannot use. However, the promise — "compliance recommendations, auto-categorize documents, surface risks before they escalate" — is exactly what a CA needs.

**My expectations if this works:**
- "What filings are due for Acme Ltd in the next 30 days?"
- "Based on the current overdue items, what is the total penalty exposure?"
- "Draft a compliance status email for the client"

If the AI genuinely does these things, it would be transformative. Currently it is vaporware.

---

## 14. Critical Missing Features for CA Practice

These are features without which I CANNOT use this system for my practice:

### 14.1 Multi-Client Management (SHOWSTOPPER)

I manage 119 clients. This system manages ONE organisation.

There is no concept of:
- Adding a new client
- Switching between clients
- Seeing a consolidated view across all clients
- Giving each client their own login

Every CA software (Taxmann, Winman, ClearTax, Tally) starts with a client master. This system has no client master.

**For the developer:** The current architecture has "organisations" table in the database. The fix is to allow one account (my CA firm) to manage multiple organisations (my clients), with proper data isolation between them.

### 14.2 No Pre-loaded Statutory Due Dates

I should not manually enter that GSTR-3B for April 2026 is due on 20th May 2026. The system should know this. A compliance management system must have:
- GST due date calendar (auto-updated when government extends deadlines)
- Income Tax due date calendar (Advance Tax, ITR, TDS returns)
- MCA annual compliance calendar
- Labour law compliance calendar

### 14.3 No Recurring Compliance Templates

GSTR-3B is due every month. I should create it once as a template and the system should auto-generate it every month. Currently I would need to manually create 12 entries for GSTR-3B alone — and I have 10 GST-registered companies = 120 manual entries just for GSTR-3B.

### 14.4 No Client Portal

Clients should be able to log in to a read-only view and see:
- Their compliance status
- What documents they need to provide
- What is overdue
- Upcoming deadlines

This replaces the weekly WhatsApp messages I send clients.

### 14.5 No Document Checklist from Client

CA work involves requesting documents from clients: "Please provide bank statements, P&L, etc." The system needs a document request feature where:
- I create a checklist of required documents
- Client uploads against each item
- I review and approve

### 14.6 No Integration with Government Portals

For a compliance tracker to be truly useful:
- GST portal integration (pull filing status, show if GSTR-1 is filed or not)
- MCA portal integration (show which ROC forms are due based on company data)
- Income Tax portal integration (show advance tax status, ITR filing status)

Without this, I still have to manually check each portal and update the status here. The tool reduces work only marginally.

### 14.7 Individual / Personal Tax Management

100 of my clients are individuals. Their compliance is completely different:
- ITR filing (July 31 / October 31)
- Advance Tax (4 installments)
- Capital gains computation
- HRA, Section 80C investments tracking

The current system has no individual client concept at all. A compliance item can be assigned to one organisation. Individual tax payers don't fit this model.

### 14.8 No TDS Compliance Management

TDS is the single highest-volume compliance activity in any CA firm. It involves:
- Deduction against each vendor/employee payment
- Challan payment by 7th of next month
- TDS return (Form 24Q/26Q) quarterly filing
- TDS certificate (Form 16/16A) issuance
- Correction statements

None of this specificity exists. TDS is just a generic compliance type.

### 14.9 No Billing / Invoice to Clients

CA firms bill clients for each compliance service rendered. A compliance management tool should also track:
- What services were provided to each client this month
- What fees are billed vs outstanding
- Professional fees register

This is absent.

### 14.10 No ICAI Audit Programme Support

For statutory audit, ICAI has prescribed audit programmes and checklists. There is no audit engagement management — no engagement letter, no audit programme, no management representation letter templates.

---

## 15. What Works Well — Genuine Positives

1. **Penalty Calculator** — Accurate Indian rates, genuinely useful daily. Only tool like this I've seen in a compliance product.

2. **Indian Compliance Types** — GST, TDS, MCA, PF, ESIC, ROC, Labour, Environmental — all covered. No other generic tool covers this list.

3. **Audit Trail per Compliance Item** — Critical for CA practice. Every change logged with who and when.

4. **Audit Points as Sub-Tasks** — Filing GST has 5 steps. Breaking them down with separate assignees and due dates is how we actually work.

5. **Priority System (Critical/High/Medium/Low)** — A CA's life is about triage. This maps to real practice.

6. **Comments per Compliance Item** — Internal notes per filing, without cluttering the main record.

7. **Clean, Fast UI** — No lag, no bloat. Loads quickly. My B.Com staff can learn this in one day.

8. **Role-based Access (Admin/Manager/Member/Viewer)** — Maps to my firm hierarchy.

9. **Pendency Dashboard** — Shows department-wise overdue/pending/safe breakdown. Once multi-client is added, this would be powerful.

10. **CSV Export** — Always essential. I can take data into Excel.

---

## 16. Comparison with Alternatives I Currently Use

| Feature | ComplianceTrack | Taxmann Compliance | Winman CA-ERP | ClearTax |
|---|---|---|---|---|
| Multi-client | ❌ No | ✅ Yes | ✅ Yes | ✅ Yes |
| GST return tracking | Partial | ✅ Full | ✅ Full | ✅ Full |
| Auto due dates | ❌ No | ✅ Yes | ✅ Yes | ✅ Yes |
| TDS management | ❌ Basic | ✅ Full | ✅ Full | ✅ Full |
| Individual tax | ❌ No | ✅ Yes | ✅ Yes | ✅ Yes |
| Penalty calculator | ✅ **Best I've seen** | Partial | Partial | ❌ No |
| UI / UX | ✅ **Excellent** | ❌ Outdated | ❌ Outdated | ✅ Good |
| Audit trail | ✅ Excellent | Partial | ❌ Poor | Partial |
| AI features | 🔲 Planned | ❌ No | ❌ No | Partial |
| Indian focus | ✅ Strong | ✅ Strong | ✅ Strong | ✅ Strong |
| Price | ❓ Unknown | ₹15,000+/year | ₹8,000+/year | ₹10,000+/year |
| Mobile app | ❌ No | ❌ No | ❌ No | ✅ Yes |

---

## 17. Who Should Use This TODAY

Despite its gaps, this system is useful RIGHT NOW for:

1. **A company's internal compliance team** — A single company (say, a mid-size manufacturing company) with a Finance + Legal + HR department that needs to track its own GST, PF, ROC, Labour compliance internally. The tool is excellent for this use case.

2. **A CA firm's internal operations** — Tracking our firm's OWN compliance obligations (GST for the CA firm, PF for our employees, our own ITR). Not for managing clients — for managing ourselves.

3. **A startup CA firm** with 1-5 clients only, willing to create a separate account per client (manageable at low scale).

4. **Teaching / Training** — For CA students or B.Com staff to understand compliance tracking concepts.

---

## 18. What Needs to Change for CA Firm Use

In priority order:

**Priority 1 — Must Have (Cannot use without these):**
1. Multi-client architecture: One CA firm account, multiple client organisations, complete data isolation
2. Pre-loaded Indian compliance calendar with statutory due dates
3. Recurring compliance items (monthly GST, quarterly TDS, annual ROC)
4. Client portal login with client-specific data isolation

**Priority 2 — Should Have (Significantly increases value):**
5. Compliance type sub-categories (GST → GSTR-1, GSTR-3B, GSTR-9, GSTR-9C)
6. GSTIN / PAN / TAN field per compliance item
7. Period field (month/quarter/year for which filing is being done)
8. PDF report generation for client sharing
9. Email notifications to clients when status changes
10. Mobile app or mobile-responsive PWA (CAs are always on the move)

**Priority 3 — Nice to Have:**
11. Government portal integration (GST, MCA, IT)
12. Document request workflow (request docs from client, client uploads)
13. Individual tax client management
14. TDS detailed management (challan, deductee-wise)
15. Billing/invoice to clients
16. ICAI audit programme templates
17. WhatsApp notification integration (most CAs use WhatsApp for client communication)

---

## 19. Pricing Expectation

If this product adds multi-client support and statutory due dates, I would pay:
- **₹2,000–3,000/month** for up to 50 clients (this is my budget range — ClearTax charges this)
- **₹500–800/month** for up to 10 clients (for smaller practices)
- **Free tier** for 3 clients (to get CAs to try it)

The product must NOT charge per user — charge per client count. CAs are cost-sensitive and will resist per-seat pricing.

---

## 20. Final Recommendation

**For the product team:** You have built the right bones. The UI is excellent, the compliance taxonomy is accurate, and features like the penalty calculator and audit trail show deep domain knowledge. But you have built for a company's internal team, not for the CA profession. Pivoting to serve CA firms is a significant but achievable architectural change — primarily adding multi-client management.

**For me as a CA today:** I will not switch to this for client management. However, I will:
- Use the **penalty calculator** as a standalone tool (bookmarked)
- Recommend this to 2 of my larger clients (Public Ltd companies with proper departments) to manage their compliance internally
- Watch this product and re-evaluate in 6 months

**Bottom line:** If the developer adds multi-client support + recurring compliance + statutory due dates, this becomes a serious competitor to Taxmann and Winman — with a significantly better UI and the most modern tech stack in the segment. The potential is real. The product today is not ready for CA firm practice.

---

*Evaluation conducted by: Practicing Chartered Accountant, India*
*Method: Landing page review, login flow review, full feature assessment via source code and API analysis, comparison with current market tools*
*Date: 2026-06-29*
*This evaluation is shared in good faith for product improvement. No financial interest in the product.*
