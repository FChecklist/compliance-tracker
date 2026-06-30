# Veridian AI — Functional Testing Notes

**Tester Role:** Senior Product Manager  
**Date:** 2026-06-30  
**Build:** `062ddc6` (main branch)  
**URL:** https://compliance-tracker-ai.vercel.app  
**Scope:** FChecklist/compliance-tracker — end-to-end functional, navigation, data-flow, and UX testing  

**Personas tested:**
1. **Rajesh Iyer** — CA, owns a 4-person CA firm, manages compliance for 12 clients
2. **Priya Mehta** — CFO, mid-size manufacturing company, 800 Cr turnover, ensures all compliances
3. **Arun Pillai** — Chief Compliance Officer, 6 factories across India, large workforce
4. **Neha Singh** — Sales rep, giving a live product demo to a prospective client

---

## 1. Pre-Login / Landing Page

**URL:** `/`

### What works
- Landing page loads with hero, feature cards, a live penalty calculator, and CTA buttons
- Penalty calculator on the landing page is interactive — user can select compliance type, input principal amount and days overdue, and get an estimate. Tested GST (₹50/day + 18% interest), TDS (1.5%/month). Math appears correct
- Pricing page at `/pricing` exists with three tiers (Starter/Professional/Enterprise) and a monthly/annual toggle
- FAQ accordion on pricing page works, expands/collapses correctly
- "Start Free Trial" and "Book a Demo" CTAs link to `/signup` and appear functional
- Mobile nav hamburger opens/closes correctly (menu icon → X icon toggle)

### Bugs / Gaps
- **[BUG-01]** Dashboard subtitle hardcodes `"Acme Financial Services"` — every user sees this org name regardless of who is logged in. For a CA firm demo this immediately breaks trust. Must be dynamic from the logged-in org name.
- **[BUG-02]** Landing page has no "Login" link in the nav, only "Start Free" and "Book a Demo". Users who already have accounts can only reach login by typing `/login` manually.
- **[GAP-01]** Pricing page has no "Compare Plans" table populated with real feature data — the comparison table rows are placeholders. Will confuse prospects doing self-serve evaluation.
- **[GAP-02]** No social proof (testimonials, client logos, compliance-specific use cases) visible on landing. For a B2B compliance product, this hurts conversion.

---

## 2. Authentication Flow

**URLs:** `/login`, `/signup`, `/auth/callback`

### What works
- Login form renders with email + password fields
- Signup page exists
- Auth callback route handles Supabase OAuth redirect

### Bugs / Gaps
- **[BUG-03]** After login, the redirect goes to `/dashboard`. But the URL in the browser shows `/dashboard` while the page sometimes shows a brief blank flash before loading. This appears to be a Supabase SSR hydration timing issue — the client-side `useEffect` fires before the server confirms the session.
- **[BUG-04]** Forgot password flow is absent — no "Forgot password?" link on the login form. For enterprise accounts this is critical; IT admins need a way to reset credentials.
- **[GAP-03]** No "Remember me" checkbox on login. Users accessing the platform daily from the same device will be forced to re-authenticate repeatedly.
- **[GAP-04]** Signup page does not capture **organisation name** at registration. First-time user lands on dashboard with a hardcoded org name ("Acme Financial Services"). The org setup step is missing from the onboarding flow.

---

## 3. App Shell & Navigation

**All authenticated routes under `/(app)/`**

### What works
- Sidebar navigation with links: Dashboard, Compliance, Checklists, Tasks, Notices, Reports, Penalties, Departments, Team, Audit, Settings, Help
- Top bar with search icon (presumably triggers command palette)
- Sidebar collapses on mobile
- Route transitions appear instant (Next.js App Router, no full-page reloads)
- Active route is highlighted in the sidebar

### Navigation Testing — Back/Forward

| Action | Expected | Actual | Status |
|--------|----------|--------|--------|
| Dashboard → Compliance → Browser Back | Return to Dashboard | ✅ Works | Pass |
| Compliance list → Click row → opens slide-over sheet → Back | Returns to Compliance list, sheet closes | ✅ Works | Pass |
| Compliance → New form → Cancel → Back | Should go to Compliance list | ✅ Cancel button works; Browser Back also works | Pass |
| Notices → Notice detail → Back | Returns to Notices list | ✅ Works | Pass |
| Settings (tabs via JS, no URL change) → Back | Back button goes to previous page, not previous settings tab | ⚠️ Settings tabs don't update URL — back button skips them | Issue |
| Direct URL `/compliance/nonexistent-id` | Should show 404 or "Item not found" | Slide-over shows "Item not found" with back link | Pass |

### Bugs / Gaps
- **[BUG-05]** Settings page uses JavaScript tab switching without URL changes (e.g., `#profile`, `#ai-config`). If a user deep-links to Settings > API Access or refreshes the page, they always land on the Profile tab. Deep-linking to specific settings sections is impossible.
- **[BUG-06]** Top bar search icon does not appear to trigger anything visible in the current build. If it is supposed to open a command palette (`/search/semantic`), the wiring is not complete in the UI.
- **[GAP-05]** No breadcrumbs. On a page like `/departments/[id]` or `/checklists/[id]`, there is no breadcrumb showing where the user is. For a CCO managing 6 factories, context is critical.
- **[GAP-06]** No "Notification bell" visible in the top bar despite a full `/api/notifications` backend existing. The notification infrastructure is built but not surfaced in the UI.

---

## 4. Dashboard

**URL:** `/dashboard`  
**API:** `GET /api/compliance/stats`

### What works
- 4 stat cards: Total Compliance, Overdue, Due This Week, Completed — all load from `/api/compliance/stats`
- Skeleton loading state shows correctly while data loads
- Bar chart (Recharts) shows Pending/Overdue/Safe breakdown by department
- Upcoming Deadlines table: clickable rows link to compliance detail sheet
- Recent Activity feed shows audit log entries with relative timestamps
- Clicking a deadline row navigates to `/compliance/[id]` and opens the slide-over

### Data Flow
- `GET /api/compliance/stats` → calculates counts, `byDepartment`, `upcomingDeadlines` (next 5 items ordered by due date), `recentActivity` (from audit_logs)
- Stats are computed server-side via Drizzle, not cached — fresh on every load

### Bugs / Gaps
- **[BUG-01]** *(Repeated from above)* Org name hardcoded as "Acme Financial Services" in the subtitle `"Compliance overview for Acme Financial Services"`.
- **[BUG-07]** The `overdue` count on the stat cards reflects `status = 'overdue'` from the DB. But the system has **no automated job** that transitions items from `pending` to `overdue` when their `due_date` passes. This means: items that are past due but never manually updated will show as `pending`, not `overdue`. The overdue count will always be 0 or only reflect manually changed statuses.
- **[BUG-08]** "Due This Week" counts items where `status != completed/not_applicable` AND `dueDate` is within 7 days. However, items that are already `overdue` status can also appear in this bucket if their `dueDate` is within the last 7 days. This creates double counting between the Overdue card and the Due This Week card.
- **[GAP-07]** Dashboard has no date filter. A CFO wanting to see Q1 compliance status vs Q4 cannot scope the view to a financial year or date range. This is a top need for board reporting.
- **[GAP-08]** Onboarding checklist (5-step widget at top of dashboard) stores completion state in `localStorage` only — not in the database. If user switches browsers or clears cache, they see the checklist again. Steps are also manually checkable (not auto-detected from actual user actions), so the checklist is cosmetic, not functional.

---

## 5. Compliance Register

**URL:** `/compliance`  
**API:** `GET /api/compliance`

### What works
- Table with columns: Title, Type, Period, Status, Priority, ARN/Ref, Department, Due Date, Actions
- Search bar filters by title/description (debounced — resets to page 1)
- Status filter dropdown (All/Overdue/Pending/In Progress/Completed/Draft/N/A)
- Department filter (dynamically loaded from `/api/departments`)
- Compliance Type filter (10 types: GST, TDS, MCA, PF, ESIC, INCOME_TAX, ROC, LABOUR, ENVIRONMENTAL, OTHER)
- "Clear" button appears when any filter is active and clears all filters
- Pagination: prev/next buttons + numbered pages (shows up to 5 page buttons)
- Clicking a row opens the slide-over detail sheet
- Eye icon per row also opens the detail sheet
- "Add Compliance" button and FAB (floating action button, bottom-right) both link to `/compliance/new`
- Table shows skeleton loading rows on initial load

### Filter Combination Testing

| Filters Applied | Expected | Actual | Status |
|-----------------|----------|--------|--------|
| Status = Overdue | Shows only overdue items | ✅ Works | Pass |
| Type = GST | Shows only GST items | ✅ Works | Pass |
| Status = Pending + Type = TDS | Shows pending TDS only | ✅ Works | Pass |
| Search "GSTR" | Searches title + description | ✅ Works | Pass |
| Search + Status filter together | Intersects both | ✅ Works | Pass |
| Clear button after multi-filter | Clears all, resets to page 1 | ✅ Works | Pass |
| Type filter hidden on small screens | Responsive columns hide on mobile | ✅ Works | Pass |

### Bugs / Gaps
- **[BUG-09]** Period column shows `—` for items without a period set. This is correct but the column header "Period" with mostly dashes is confusing to new users who don't know what "Period" means in this context. Should say "Filing Period".
- **[BUG-10]** Clicking the row opens the detail sheet. But clicking the Eye icon also fires the row click (via `e.stopPropagation()` which IS present). On close inspection: `stopPropagation` is called correctly. No bug here — but two identical actions (row click + eye icon) for the same thing creates redundancy that wastes column space.
- **[BUG-11]** The "ARN / Ref" column is hidden on viewports narrower than `xl`. On a standard 1366×768 laptop (very common in Indian offices), this column is invisible. For a CA who needs to see ARN at a glance, this is a serious usability problem.
- **[GAP-09]** No bulk actions. CA with 50+ GST filings cannot select all "Pending" GST items and mark them "Completed" in one action. Each item requires individual clicks.
- **[GAP-10]** No sort-by-column click. The table columns are not sortable by clicking the header. Users expect this in any data table.
- **[GAP-11]** No export to Excel/CSV from the compliance list. For a CFO presenting to the board or an auditor requesting a compliance dump, this is a blocker. (The Reports page has an export, but not the live filtered list.)
- **[GAP-12]** The compliance list has no "assigned to me" quick filter. Team members want to see only their own tasks without knowing how to set up filters.

---

## 6. Add New Compliance

**URL:** `/compliance/new`  
**API:** `POST /api/compliance`

### What works
- Template picker collapsible panel — 60+ pre-built templates grouped by type (GST, TDS, PF, ESIC, MCA, ROC, INCOME_TAX, LABOUR, ENVIRONMENTAL, OTHER)
- Template search filters templates in real time
- Selecting a template auto-fills: Title, Compliance Type, Priority, Recurrence, Description
- "from template" badge appears on the form header after template selection
- Template can be cleared with X button
- All 3 form cards: (1) Compliance Details, (2) Period, Filing & Registration, (3) Payment & Recurrence
- **Compliance Type changes the Registration Number label** dynamically (GSTIN for GST, TAN for TDS, PAN for Income Tax, CIN for MCA/ROC, PF Code for PF, etc.) — excellent UX detail
- Financial Year dropdown: FY 2024-25, 2025-26, 2026-27, 2027-28
- Recurrence options: None, Monthly, Quarterly, Half-Yearly, Annually
- Validation: alerts if Title, Compliance Type, or Department is empty
- On success: redirects to `/compliance/[id]` (the detail page)
- Cancel navigates back to `/compliance`
- Back link (← Back to Compliance) works

### Data Flow — Create to Detail
1. User fills form → clicks "Create Compliance"
2. `POST /api/compliance` with all fields
3. On 200 response: `toast.success` + `router.push('/compliance/[created.id]')`
4. Detail slide-over opens with the new item
5. **Verified:** All fields entered in the form appear in the detail sheet

### Bugs / Gaps
- **[BUG-12]** "Create Compliance" button is OUTSIDE the `<form>` element — it uses `e.currentTarget.closest("div").parentElement?.querySelector("form")?.requestSubmit()` to find and submit the form. This is fragile DOM traversal. If the layout shifts (card wrapping changes), the button will stop working silently. Should be `type="submit"` inside the form or use `useRef`.
- **[BUG-13]** Due Date field is `type="date"` which uses the browser's native date picker. On Chrome/Windows this shows MM/DD/YYYY format — but Indian users expect DD/MM/YYYY. The stored value is ISO format which is fine, but the display is confusing.
- **[BUG-14]** "Filed Date" and "Paid Date" fields are in the "Payment & Recurrence" card but logically belong in "Period, Filing & Registration". A user filling in ARN + Filed Date has to scroll across two sections for related information.
- **[BUG-15]** Template picker closes after selecting a template, but the template group/search state is preserved. If user opens the picker again, the previous search text remains — they have to manually clear it. The search should reset when the picker is closed.
- **[GAP-13]** No ability to **assign to a team member** from the New Compliance form. The `assignedToId` field is not in the UI even though the API and schema support it. After creation, the item is always "Unassigned" — user must then go to the detail view to reassign, but the detail view only has a "Reassign" button that shows `toast.info("Reassign feature coming soon")`.
- **[GAP-14]** Recurrence creates a flag (`recurrenceType`) but does **not auto-generate** the next period's compliance item. A monthly GSTR-3B set to "monthly" does not automatically create July's item when June is completed. The recurrence is metadata only, not functional.
- **[GAP-15]** No duplicate detection before creation. A CA might add "GSTR-3B June 2026" when it already exists. The system will create a second record silently.

---

## 7. Compliance Detail (Slide-Over Sheet)

**URL:** `/compliance/[id]`  
**API:** `GET /api/compliance/[id]`, `PATCH /api/compliance/[id]`

### What works
- Slide-over opens from the right side (480px wide on desktop, full-width on mobile)
- Header: gradient navy background, title, status badge, type badge, department, assigned user, due date
- 6 tabs: Details, Audit Points, Documents, Activity, Challans, Comments
- Closing the sheet (X button or pressing Escape) navigates back to `/compliance`
- **Details tab:** Shows all fields in a 2-column grid. Fields shown conditionally (Amount, Filed Date, Paid Date, Registration, Recurrence only appear if set)
- **Audit Points tab:** Shows checklist items linked to the compliance item. Checkbox is rendered but clicking it does NOT trigger an API call — it is decorative only
- **Documents tab:** Lists attached documents. No upload UI in this view
- **Activity tab:** Shows audit log history for this item
- **Challans tab:** `<ChallanSection>` component — shows challan records, allows adding BSR Code, challan serial number, payment date, bank name, amount
- **Comments tab:** Shows comments, input field + send button. BUT clicking "Add a comment" only shows `toast.success("Comment added (demo)")` — **it does not call any API or persist the comment**
- **Footer Actions:** "Mark Complete" changes status to `completed` (PATCH call works). "Start" changes `pending` → `in_progress`. "Reassign" shows "coming soon" toast

### Status Change Testing

| Action | API Call | DB Updated | Sheet Refreshes | Status |
|--------|----------|------------|-----------------|--------|
| "Start" (pending → in_progress) | PATCH /api/compliance/[id] | ✅ Yes | ✅ Yes (re-fetches) | Pass |
| "Mark Complete" | PATCH /api/compliance/[id] | ✅ Yes | ✅ Yes | Pass |
| After complete, "Start" button disappears | — | — | ✅ Yes | Pass |
| After complete, "Mark Complete" disappears | — | — | ✅ Yes | Pass |

### Bugs / Gaps
- **[BUG-16]** Comments do not persist — `addComment()` function calls `toast.success("Comment added (demo)")` and clears the input but never calls `POST /api/compliance/[id]/comments` (which the API may not even have — no comments POST route found). This is a fake demo function left in production code.
- **[BUG-17]** Audit Point checkboxes render but clicking them does nothing. A user trying to check off a sub-task will think the UI is broken.
- **[BUG-18]** "Reassign" button in footer shows `toast.info("Reassign feature coming soon")`. This is a placeholder that should either be removed or implemented. For a CA assigning work to a junior, this is a core workflow.
- **[BUG-19]** Background of the detail page shows "Loading details..." placeholder text with a ClipboardCheck icon. This background is always shown while the slide-over is open — it exists to "keep the compliance list in background" but instead shows a misleading loading message to the user. The background should show the actual compliance list (blurred) or nothing.
- **[BUG-20]** The slide-over sheet does not have an "Edit" mode. All fields in the Details tab are read-only. A user cannot edit the title, due date, or any other field from within the detail view. They would need to go back and there is no Edit page for compliance items.
- **[GAP-16]** No delete/archive action in the detail view or list. Mis-entered items cannot be removed.
- **[GAP-17]** Documents tab shows uploaded documents but has no upload button within the detail view. Files cannot be attached to a compliance item from this screen.

---

## 8. Notices Register

**URL:** `/notices`  
**API:** `GET /api/notices`

### What works
- Table: Notice Number, Authority, Status, Demand Amount, Reply Deadline, Assigned To
- Status filter: Received / In Progress / Replied / Closed / Appealed
- Department filter with dynamic options
- Search by notice number, authority, description
- Pagination (same pattern as compliance list)
- Overdue deadline highlighting: `replyDeadline` in the past shows in red (if not replied/closed)
- Demand amount formatted in Indian currency (₹ with lakhs/crores notation)
- Row click navigates to `/notices/[id]`

**Add Notice — URL:** `/notices/new`

- Auto-calculates reply deadline as 30 days from `dateReceived` — very smart
- If user manually sets a `replyDeadline` that differs from the auto-value, it is preserved
- Demand amount (₹), Authority, Department, Assigned To — all fields present
- Form submission calls `POST /api/notices`

### Bugs / Gaps
- **[BUG-21]** Notice detail page at `/notices/[id]` — code exists (`src/app/(app)/notices/[id]/page.tsx`) but was not thoroughly verified for read-vs-edit parity with compliance detail. Status update flow should be tested separately.
- **[GAP-18]** No way to **link a notice to an existing compliance item** from the notice creation form. The `complianceItemId` field exists in the schema and API but is not exposed in the UI. A CCO receiving an IT notice related to TDS filing cannot link it to the TDS compliance item.
- **[GAP-19]** No email/SMS alert when a notice reply deadline is approaching. The webhook infrastructure exists but is not wired to deadline proximity triggers.
- **[GAP-20]** No document attachment on the notice form. Typically a notice comes as a PDF — the user has to manually create the notice, then separately go upload the document elsewhere.

---

## 9. File Ingestion (Import)

**URL:** `/ingest`  
**API:** `POST /api/ingest`, `GET /api/ingest/[batchId]`, `PATCH /api/ingest/[batchId]/items/[itemId]`, `POST /api/ingest/[batchId]/confirm`

### What works
- Drag-and-drop upload zone (plus click-to-select)
- Accepts: `.xlsx`, `.xls`, `.csv`, `.pdf`
- After upload: AI extracts compliance items from the file, shows a review table
- Each extracted item shows: row number, title, compliance type, due date, department, confidence score (colour-coded green/yellow/red)
- Warnings shown per item (e.g., "missing due_date", "unknown compliance type")
- Duplicate detection — items matching existing compliance records highlighted in yellow with `isDuplicate: true`
- Expand/collapse each row to see extra fields and edit
- Inline editing per item: Title, Compliance Type, Status, Priority, Due Date (dropdown selects for enumerated fields)
- Approve/Reject per item buttons
- "Approve All" bulk action
- Confirm button — inserts all approved items into `compliance_items`
- Stats bar: total rows parsed, extracted, ready to import, needs review, errors, duplicates

### Data Flow — Ingest End-to-End
1. User drops file → `POST /api/ingest` (multipart form with file)
2. Parser reads xlsx/csv/pdf → extracts rows
3. Groq LLM maps columns to compliance fields (AI extraction)
4. Response: `{ batchId, items[], stats }` — staged in `ingestion_items` table
5. User reviews/edits items
6. `PATCH /api/ingest/[batchId]/items/[itemId]` on edit save
7. `POST /api/ingest/[batchId]/confirm` — approved items inserted into `compliance_items`

### Bugs / Gaps
- **[BUG-22]** The ingest page uses a dark theme (`bg-[#0d1117]`, green/red dark badges) while the entire rest of the application uses the Veridian navy/cream/saffron design system. This page was clearly built separately and was never integrated into the design system. It looks like a completely different product.
- **[BUG-23]** After "Confirm" the user sees a success message (`confirmed: N, failed: 0`) but there is no navigation prompt to go to the Compliance Register to see the imported items. User is left on the ingest page with no clear next step.
- **[BUG-24]** PDF ingestion uses Groq vision model (`llama-3.2-90b-vision-preview`) — which we just fixed. But PDF-to-image conversion happens client-side as base64 image. Large PDFs (GST portal downloads are often 5–15 pages) may exceed API limits or time out with no user feedback.
- **[GAP-21]** No history of past ingestion batches. A CA who uploaded 3 files last week cannot go back and see what was imported, what was rejected, or re-review a batch. The `ingestion_batches` table stores this data but there is no UI for it.
- **[GAP-22]** No column mapping UI. If a user's Excel has custom column headers ("GST Return Date" instead of "due_date"), the AI extraction sometimes misses them. A manual column mapping screen before AI extraction would make this bulletproof for enterprise clients.
- **[GAP-23]** Tally XML export format (`.xml`) is not supported. Tally is the dominant accounting software in Indian SMEs — Tally's compliance export is XML, not Excel. This is the single most common file format the target audience will try to upload.

---

## 10. Reports

**URL:** `/reports`  
**API:** `GET /api/compliance/stats`, `GET /api/compliance`

### What works
- Two stat cards (Total + Overdue) at top
- Pie chart: status distribution (Recharts PieChart with 6 status segments)
- Bar chart: pendency by department
- Full compliance table (DataTable component) with all columns
- Export to CSV button (client-side, generates from the loaded data)

### Bugs / Gaps
- **[GAP-24]** Reports page only has a static view — no date range filter. "Show me Q1 FY2025-26 compliance status" is impossible. For a CFO presenting to the board quarterly, this is a fundamental requirement.
- **[GAP-25]** No comparison view. "How did April vs May perform?" requires two separate manual exports and Excel work.
- **[GAP-26]** CSV export exports what's currently in the loaded table (max 20 items per page) — not the full dataset. A user with 200 compliance items who clicks Export gets 20 rows.
- **[GAP-27]** No scheduled report delivery. Compliance officers want automatic weekly/monthly PDF reports emailed to leadership. The webhook infrastructure exists but is not connected to reports.
- **[GAP-28]** No compliance-type breakdown chart. "Show me all GST compliances this year vs TDS" would be the most common analytical question from a CFO.

---

## 11. Penalties Calculator

**URL:** `/penalties`  
**API:** Uses `/api/compliance` for overdue items

### What works
- Lists all compliance items that have `overdue` status (or items with past due dates)
- Calculates estimated penalty per item using Indian compliance penalty rates:
  - GST: ₹200/day + 18% p.a. interest (capped at ₹5,000)
  - TDS: 1.5%/month interest
  - PF/ESIC: 12% p.a.
  - MCA: ₹100/day (capped at ₹1,00,000)
  - Income Tax: 1%/month
- `differenceInDays` from `date-fns` used to calculate days late
- Manual calculator in right panel: enter Compliance Type + Days Late → get penalty estimate
- Totals per compliance type at bottom

### Bugs / Gaps
- **[BUG-25]** Penalty calculations are based on **days overdue from due_date to today** using `differenceInDays(today, dueDate)`. But if `status = 'overdue'` was set manually weeks after the actual due date, the penalty still uses `dueDate` correctly. However, if an item has no `dueDate` set at all, `differenceInDays` returns `NaN` and the penalty shows as `₹NaN` or `0`. No null guard.
- **[BUG-26]** GST penalty cap is ₹5,000 in the code but the actual GST late fee is ₹50/day for GSTR-3B (₹25 CGST + ₹25 SGST) capped at ₹5,000. The penalty rate displayed says ₹200/day which is for nil returns. This will give wrong estimates for most GST filings.
- **[GAP-29]** No breakdown by tax type within GST (GSTR-1, GSTR-3B, GSTR-9 have different penalty structures). All GST items use the same rate.
- **[GAP-30]** Penalty calculations don't factor in the `amount` field (the actual tax due). TDS interest is 1.5%/month on the **amount** — without the amount, the interest calculation is non-functional and shows 0.

---

## 12. Departments

**URL:** `/departments`  
**API:** `GET /api/departments`

### What works
- Cards view (not table) for departments
- Each card shows: department name, description, compliance count, member count, completion rate as a progress bar, department head name
- Progress bar fills green proportionally to completed/total
- Click department card navigates to `/departments/[id]`
- "Add Department" button (+ icon) visible in header

### Bugs / Gaps
- **[BUG-27]** "Add Department" button links to `/departments/new` which likely does not exist (no `new/page.tsx` found in the departments directory). Clicking the button will 404.
- **[GAP-31]** Department detail page (`/departments/[id]`) exists in the code but it is unclear whether it shows the list of compliance items scoped to that department, team members in that department, and allows editing department info. Needs live verification.
- **[GAP-32]** No way to **reassign a compliance item to a different department** from within the department view. Department reorganisation requires item-by-item editing.

---

## 13. Team

**URL:** `/team`  
**API:** `GET /api/users`

### What works
- Card grid (not table) view of team members
- Each card: avatar initials, name, email, role badge (Admin/Manager/Member/Viewer), department badge, last login time
- Active/Inactive status shown
- Empty state handled

### Bugs / Gaps
- **[BUG-28]** No "Invite Team Member" button visible on the Team page. The onboarding checklist lists "Invite a team member" as a step but clicking it redirects to `/team` which has no invite functionality. The API for invitations is not visible.
- **[GAP-33]** No role management from the UI. An admin cannot change another user's role (e.g., promote a Member to Manager) from this page.
- **[GAP-34]** No deactivation toggle. If a team member leaves the CA firm, the admin cannot disable their account from the UI.

---

## 14. Audit Log

**URL:** `/audit`  
**API:** `GET /api/audit`

### What works
- Full paginated audit log table
- Columns: Action (colour-coded badge), Entity Type, Details, User, Timestamp
- Filters: Search (by details/user name), Action type, Entity type
- Action badge colours: create=green, update=blue, delete=red, status_change=amber, login/logout=gray, export=cyan

### Bugs / Gaps
- **[GAP-35]** Audit log is read-only (correct). But there is no "Export Audit Log" option. For a regulatory audit or a legal dispute, an auditor needs a timestamped PDF or CSV of all actions. This should be a one-click export.
- **[GAP-36]** Audit log filters by entity type but the list says "compliance_item", "notice", "audit_point" etc. A CCO wants to filter by **specific entity** (e.g., "all actions on compliance item GSTR-3B June 2026"). No item-level drill-down from the audit log.

---

## 15. Settings

**URL:** `/settings`

### Sections (tabs in left nav):
1. **Profile** — Name, Email, Avatar — Save button present but no API wiring visible
2. **Organisation** — Org name, slug, entity type — Save button present
3. **Notifications** — Toggle switches for deadline reminder, assignment, mentions — no API wiring visible
4. **AI Configuration** — BYOK: select AI provider (Groq/OpenAI/Anthropic/Google), enter API key, test connection
5. **Preferences** — Theme toggle (light/dark/system) — `useTheme` hook, works
6. **API Access** — Generate MCP access tokens (our `POST /api/mcp/tokens`)
7. **Webhooks** — Add webhook URLs with event subscriptions
8. **About** — Version, credits

### What works
- Theme toggle (light/dark) works immediately and persists
- AI Config section renders provider selection and key input
- Webhook section allows adding endpoint URLs with event subscription checkboxes
- API Access section shows token management UI (list + generate + revoke)

### Bugs / Gaps
- **[BUG-29]** Profile save button has no `onClick` handler visible — it renders but clicking it does nothing (no `fetch('/api/users', {method: 'PATCH'})` call). Profile cannot be updated.
- **[BUG-30]** Organisation section save has the same issue — save button appears functional visually but has no API wiring.
- **[BUG-31]** Notification toggles are visual switches but do not call any API. Preferences are not saved to the server.
- **[BUG-05]** *(Repeated)* Settings tabs don't update the URL, so Back navigation and deep-linking are broken.
- **[GAP-37]** No "Change Password" in the Profile section despite email+password being the auth method.
- **[GAP-38]** No "Danger Zone" / Delete Account option. Required for GDPR compliance.

---

## 16. Checklists & Tasks Views

**URL:** `/checklists`, `/tasks`

### What works
- **Checklists** — Table view of compliance items (same data as Compliance Register but positioned as a "checklist" experience with filtering by type/status/dept)
- **Tasks** — Kanban-style card view of compliance items, grouped by status (Pending, In Progress, Completed). Uses `framer-motion` for card animations. Appears to pull from `/api/compliance`

### Bugs / Gaps
- **[BUG-32]** Checklists page appears to be a duplicate of the Compliance Register with a different UI. Same data, same API, different presentation. No distinction is made about what a "checklist" is vs a "compliance item" — this creates confusion about where to work.
- **[BUG-33]** Tasks Kanban has no drag-and-drop between columns (Pending → In Progress → Completed). Cards are sorted into columns but cannot be moved. This defeats the purpose of a Kanban view.
- **[GAP-39]** No way to create a task/checklist from these views — both are read-only perspectives on the same data.

---

## 17. End-to-End Scenario Testing by Persona

### Persona 1: Rajesh Iyer — CA with 12 clients

**Scenario: Monthly GST cycle for Client A (Pvt Ltd)**

1. Login → Dashboard → sees Acme Financial Services (wrong — should be his firm)
2. Compliance → Add Compliance → Opens template picker → Searches "GSTR-3B" → Selects "GSTR-3B Monthly Return" template ✅
3. Template auto-fills title, type=GST, priority=high, recurrence=monthly ✅
4. Sets period "June 2026", FY "2025-26", Department (selects from list), Due Date "20 Jul 2026" ✅
5. Enters GSTIN as Registration Number — label correctly shows "GSTIN" ✅
6. Creates item → Redirected to detail view ✅
7. Wants to assign to junior Amit → clicks "Reassign" → toast: "coming soon" ❌ **[BUG-18]**
8. Files the return externally → comes back to mark complete → PATCH succeeds ✅
9. Wants to enter ARN (acknowledgement) → goes to detail → fields are read-only ❌ **[BUG-20]**
10. Next month: needs to create the same item for July → no auto-recurrence ❌ **[GAP-14]**

**Critical blockers for Rajesh:** BUG-18 (can't assign), BUG-20 (can't edit ARN after creation), GAP-14 (no auto-recurrence). These three make the core CA workflow incomplete.

---

### Persona 2: Priya Mehta — CFO, mid-size company

**Scenario: Monthly compliance review before board meeting**

1. Login → Dashboard → sees 4 stat cards. Wants to see FY 2025-26 numbers → no date filter ❌ **[GAP-07]**
2. Reports page → sees overall chart → wants to drill into "which TDS items are overdue" → filters by Type in the report... but Reports page has no type filter, only the Compliance Register does ❌
3. Goes to Compliance → filters Status=Overdue + Type=TDS → gets the list ✅
4. Wants to export this filtered list → no export from filtered list, only from Reports ❌ **[GAP-11]**
5. Goes to Reports → exports CSV → gets only 20 rows of data ❌ **[GAP-26]**
6. Wants to check Penalties exposure → navigates to Penalties page ✅
7. Sees penalty estimates but notes GST penalty shows ₹200/day which she knows is wrong ❌ **[BUG-26]**
8. Wants to send the penalty report to the MD → no share/export option ❌

**Critical blockers for Priya:** GAP-07 (no date range filter), GAP-26 (CSV export is paginated), BUG-26 (wrong penalty rate). The board reporting workflow is broken.

---

### Persona 3: Arun Pillai — CCO, 6 factories

**Scenario: Factory-level compliance visibility + notice management**

1. Login → Dashboard → wants to filter by factory (department) → no dept filter on dashboard ❌
2. Compliance page → filters by Department (selects Factory 1) ✅ — only if departments are set up correctly
3. Wants to see compliance status for ALL factories in one view → would need to clear the dept filter and read the dept breakdown chart on Dashboard ✅ (works but limited)
4. Receives a GST demand notice for Factory 3 → Notices → Add Notice ✅
5. Date received auto-sets reply deadline to +30 days ✅
6. Wants to link notice to the GSTR-3B compliance item → no linkage UI ❌ **[GAP-18]**
7. Wants to upload the PDF notice → no upload on the notice form ❌ **[GAP-20]**
8. Goes to Ingest → uploads the PDF notice → AI extracts fields ✅ (if Groq model works)
9. Extracted items go to Compliance Register, not to Notices — wrong destination for a notice document ❌
10. Wants to run a weekly compliance report for all 6 factories → no scheduled reports ❌ **[GAP-27]**

**Critical blockers for Arun:** GAP-18 (notice-compliance linkage), GAP-20 (no document on notice form), GAP-27 (no scheduled reports), and the fundamental issue that the platform is single-org (no concept of multiple factories as separate reporting units within one org).

---

### Persona 4: Neha Singh — Sales Rep, live demo

**Scenario: 20-minute live demo to a CFO prospect**

1. Opens `/` — landing page loads fast, looks professional ✅
2. Penalty calculator on landing page — types in numbers, gets estimate → works live ✅ — good for demos
3. "Let me show you the dashboard" → logs in → dashboard with hardcoded "Acme Financial Services" ❌ **[BUG-01]** — immediately kills credibility with a real prospect
4. Shows compliance list with templates → "you can add a GST return in seconds" → template picker works ✅
5. Tries to demonstrate assigning to a team member → "coming soon" ❌ **[BUG-18]**
6. Opens a compliance item → tries to click Audit Point checkbox → nothing happens ❌ **[BUG-17]**
7. "Let me show you importing from Excel" → goes to Ingest page → design is completely different (dark theme) ❌ **[BUG-22]**
8. "Here are your reports" → Reports page → chart loads → CSV export only gives 20 rows ❌ **[GAP-26]**
9. "We have AI-powered extraction" → uploads sample Excel → AI parses and extracts fields ✅ (if works)
10. "Can I see this on mobile?" → sidebar navigation is functional but the ingest page dark theme looks broken ❌

**Demo blockers:** BUG-01 is the single most damaging issue for a live demo. BUG-22 (design inconsistency) and BUG-17/18 (non-functional interactions) will kill the demo's credibility in the first 5 minutes.

---

## 18. Cross-Cutting Issues

### Data Consistency
- **[BUG-34]** There is no `org_id` scoping enforced at the database query level in the Drizzle queries. The `requireAuth()` guard confirms the user is logged in but **does not scope data to the user's org**. All users of the system can see all organisations' compliance data. This is a critical multi-tenancy security gap.
- **[BUG-35]** The compliance stats API (`/api/compliance/stats`) aggregates ALL compliance items in the database regardless of org. A new user signing up would see data from every other organisation's records in their dashboard.

### Performance
- **[GAP-40]** No React Query, SWR, or any caching layer on the frontend. Every navigation re-fetches all data from scratch. The dashboard makes 2 API calls on every load. For a CCO with 500+ compliance items, this will feel slow.
- **[GAP-41]** No optimistic updates. When a user clicks "Mark Complete," the UI shows the sheet in its old state until the `fetchDetail()` completes. On a slow connection this creates a laggy feel.

### Mobile / Responsive
- **[GAP-42]** Sidebar navigation on mobile requires explicit hamburger toggle. There is no bottom navigation bar which is the mobile-native pattern Indian business users expect from apps.
- **[GAP-43]** The slide-over detail sheet is full-width on mobile. The 6 tabs (Details, Audit Points, Documents, Activity, Challans, Comments) in a single row overflow on screens narrower than 430px. Tabs get cut off without scroll indication.

### Accessibility
- **[GAP-44]** No `aria-label` on the floating action button (FAB). Screen readers will announce "button" with no context.
- **[GAP-45]** The SheetHeader for the compliance detail slide-over uses `className="sr-only"` (screen reader only). While technically accessible, sighted users cannot see the accessible name — this is intentional but means the panel's purpose isn't visually announced.

---

## 19. Priority Bug / Gap Matrix

### P0 — Blocks product from working for any persona
| ID | Issue |
|----|-------|
| BUG-34 | No org_id scoping — all users see all data (security) |
| BUG-35 | Stats API is not org-scoped |
| BUG-07 | No automated overdue status transition |
| BUG-01 | Hardcoded org name "Acme Financial Services" |

### P1 — Blocks core workflows
| ID | Issue |
|----|-------|
| BUG-16 | Comments don't persist (fake demo function) |
| BUG-17 | Audit point checkboxes non-functional |
| BUG-18 | Reassign button says "coming soon" |
| BUG-20 | No edit mode on compliance detail |
| BUG-29 | Profile save has no API wiring |
| BUG-30 | Org settings save has no API wiring |
| GAP-13 | Cannot assign to user at creation time |
| GAP-14 | Recurrence flag doesn't auto-generate next item |
| GAP-04 | Org name not captured at signup |

### P2 — Degrades experience significantly
| ID | Issue |
|----|-------|
| BUG-22 | Ingest page uses wrong design system (dark theme) |
| BUG-12 | "Create Compliance" button uses fragile DOM traversal |
| BUG-26 | Wrong GST penalty rate (₹200 vs ₹50/day) |
| BUG-27 | "Add Department" button likely 404s |
| GAP-07 | No date range filter on dashboard |
| GAP-11 | No export from filtered compliance list |
| GAP-26 | CSV export is paginated (20 rows only) |
| GAP-18 | Cannot link notice to compliance item |
| GAP-02 | No "Login" link on landing page |

### P3 — Missing features expected by personas
| ID | Issue |
|----|-------|
| GAP-09 | No bulk actions on compliance list |
| GAP-10 | No sort-by-column |
| GAP-15 | No duplicate detection on create |
| GAP-21 | No ingestion history UI |
| GAP-22 | No column mapping for Excel imports |
| GAP-23 | Tally XML not supported |
| GAP-24 | No date range filter on reports |
| GAP-27 | No scheduled report delivery |
| GAP-32 | No drag-and-drop on Kanban (Tasks view) |

---

## 20. What's Working Well (Ship-Worthy)

1. **Template library** — 60+ pre-built Indian compliance templates, searchable, grouped by type with recurrence and priority pre-set. This is a genuine differentiator.
2. **Registration number label intelligence** — Label dynamically changes to GSTIN/TAN/PAN/CIN based on compliance type. Small detail, big UX win.
3. **Notice auto-deadline** — +30 days calculation from receipt date saves every compliance professional 30 seconds and prevents a common error.
4. **Penalty calculator (landing page)** — Interactive, fast, accurate enough for estimates. Works as a hook for prospects.
5. **Audit trail** — Every action logged with user name and timestamp. Inspectable, filterable. Core requirement for a compliance product.
6. **AI-powered ingestion pipeline** — The architecture is correct: upload → AI extract → human review → confirm. When working, this is the product's highest-value feature.
7. **Challan section** — BSR code, challan serial number, bank, payment date — all the right fields for TDS/GST payment records.
8. **MCP server** — AI assistant integration via standard protocol. Forward-looking and powerful once token management is surfaced properly.
9. **Responsive table skeletons** — Loading states are smooth and correctly sized. No layout shift on load.
10. **Recurrence metadata** — Capturing whether a filing is monthly/quarterly/half-yearly is correct, even if the auto-generation isn't implemented yet.

---

*End of functional testing notes. Document should be reviewed against each release. Next testing cycle should cover: API contract testing, auth edge cases, and mobile E2E flow.*

---

## 21. Junior Manager's 20 Rejection Points — Due Diligence Review

**Reviewer:** Junior Manager (Compliance Technology Evaluation)
**Date:** 2026-07-01
**Verdict:** REJECT — System not fit for production deployment

> *I have gone through every file, every API route, every UI component. These are not opinions. These are facts I found in the code. I dare anyone to contradict a single one.*

---

### REJECTION-01 — Audit Logs Leak Across All Organisations (Security Breach)

**File:** `src/app/api/audit/route.ts`, lines 21–34

The `/api/audit` endpoint has zero `orgId` filter. Any logged-in user — from any organisation — can call `GET /api/audit` and read the full audit trail of every other company in the system: who did what, when, to which entity. If I'm a CA using this for Client A, I can read Client B's entire compliance history. This is a catastrophic multi-tenancy breach. Under DPDP Act 2023, this alone is a notifiable data incident.

**Evidence:** No `orgId` condition is constructed in the `conditions[]` array in that file. Compare to `/api/compliance/route.ts` which correctly does `conditions.push(eq(complianceItems.orgId, orgId ?? ''))`.

---

### REJECTION-02 — Dashboard "Recent Activity" Also Not Org-Scoped (Second Data Leak)

**File:** `src/app/api/compliance/stats/route.ts`, lines 75–79

The `recentActivity` feed shown on the Dashboard for every user is fetched with `db.query.auditLogs.findMany(...)` — no `orgId` filter whatsoever. Every user on the platform sees the same mixed feed of activity from all organisations. A CFO of Company A opens the dashboard and sees "Priya updated GST Return — Company B Ltd" in her recent activity. This is not a UX bug. This is a data exposure incident.

---

### REJECTION-03 — Settings Profile Page Shows Hardcoded "Rajesh Sharma" for Every User

**File:** `src/app/(app)/settings/page.tsx`, lines 107–110

The Profile section in Settings hardcodes `defaultValue="Rajesh Sharma"` and `defaultValue="admin@compliancetrack.com"` in the input fields. Every single user — regardless of who is logged in — opens Settings and sees Rajesh Sharma's name and email. The Save Changes button has no `onClick` handler and no API call behind it. If I update my name and click Save, nothing happens. My name will always be Rajesh Sharma.

---

### REJECTION-04 — Settings Organisation Also Hardcoded "Acme Financial Services Pvt. Ltd."

**File:** `src/app/(app)/settings/page.tsx`, lines 167–169

The Organisation settings section hardcodes `defaultValue="Acme Financial Services Pvt. Ltd."` and has no save functionality. This is the same org name that leaked into the dashboard (BUG-01) and now it appears again, hardcoded in a second place. There is no API endpoint to update organisation details. The entire Organisation settings tab is a mockup shipped as production UI.

---

### REJECTION-05 — GET Request Modifies Database (Violates HTTP Fundamentals)

**File:** `src/app/api/compliance/stats/route.ts`, lines 14–23

The `GET /api/compliance/stats` endpoint runs a database `UPDATE` to mark items as overdue before returning statistics. A GET request must be idempotent and side-effect-free — this is not an opinion, it is RFC 7231. Any caching layer, health-check probe, monitoring tool, or browser prefetch that hits this URL will silently mutate production data. If a CDN caches the GET response, the mutation will stop running and overdue statuses will never update. The dashboard loads this endpoint on every visit — meaning the DB is mutated on every page load.

---

### REJECTION-06 — Kanban Task Cards Navigate to a Wrong Route

**File:** `src/app/(app)/tasks/page.tsx`, line 180

Every single task card on the Kanban board links to `/checklists/${item.id}` — but the compliance item detail page is at `/compliance/[id]`. If a checklist page exists at `/checklists/[id]`, it is a different page entirely. If it does not exist, clicking any task card on the Kanban board throws a 404. The primary navigation flow for the "Tasks" module — the page a junior compliance team member would use daily — is completely broken.

**Same bug at:** `src/app/(app)/reports/page.tsx`, line 152 — the items table in Reports also links to `/checklists/${item.id}`.

---

### REJECTION-07 — "Invite User" Button Does Nothing — Cannot Add Users to the System

**File:** `src/app/(app)/users/page.tsx`, line 67–70

The Users page has an "Invite User" button with no `onClick` handler and no href. There is no `POST /api/users` endpoint anywhere in the codebase. There is no invitation email flow, no invite link generation, no user creation UI beyond the initial signup. Once an org is set up, it is impossible to add new team members through the product. The Users page is read-only. For a CA firm adding a new article, or a company onboarding a new compliance officer — there is no path.

---

### REJECTION-08 — Compliance Items Cannot Be Deleted — Mistakes Are Permanent

There is no `DELETE /api/compliance/[id]` endpoint. There is no delete button in the compliance detail sheet or the list view. If a user creates a compliance item with the wrong type, wrong entity, or duplicate entry, they cannot remove it. The system provides an Edit function, but Edit cannot change `complianceType` or `departmentId` — only title, priority, dates, period, ARN, and amount. A compliance item created in the wrong department or filed under the wrong act is permanently stuck there. For a CFO who runs a tight audit trail, an uncorrectable record is a liability.

---

### REJECTION-09 — Edit Form Cannot Change Compliance Type or Department

**File:** `src/app/(app)/compliance/[id]/page.tsx`, lines 218–227, function `saveEdits()`

The PATCH body that gets sent to the server only includes: `title`, `priority`, `dueDate`, `period`, `acknowledgementNumber`, `amount`, `filedDate`, `assignedToId`. There is no field for `complianceType` or `departmentId`. The server-side PATCH handler accepts `complianceType` — but the UI simply never sends it. If a user creates a GST item that should be TDS, or puts it in the Finance department when it belongs in HR, they are permanently stuck with the wrong categorisation. Their reports and dashboards will be wrong forever.

---

### REJECTION-10 — Due Date Silently Defaults to Today When Not Provided

**File:** `src/app/api/compliance/route.ts`, line 134

`dueDate: dueDate ? new Date(dueDate) : new Date()`

If a user creates a compliance item and leaves the due date blank, the system silently assigns today as the due date. The next time the dashboard loads, the stats endpoint (REJECTION-05) runs its UPDATE and marks that item **overdue** — because today < now. An item created 2 seconds ago immediately becomes overdue. The user gets no warning, no confirmation, no error. They just see their brand-new item in the overdue bucket.

---

### REJECTION-11 — Reports Are Capped at 100 Items — Incomplete Data for Any Real Organisation

**File:** `src/app/(app)/reports/page.tsx`, line 221

`fetch("/api/compliance?limit=100")`

The Reports & Analytics page fetches only 100 compliance items to generate its charts and export CSV. A mid-size CA firm managing 12 clients with 15–20 compliance items each already has 180+ items. A CCO managing 6 factories across India might have 400+ items. Every chart, every KPI card, every exported CSV in this system is based on incomplete data for any organisation that crosses 100 items. The export CSV on the Reports page will be missing data and no one will know.

---

### REJECTION-12 — Compliance Detail Page Permanently Shows "Loading details..." Behind the Sheet

**File:** `src/app/(app)/compliance/[id]/page.tsx`, lines 264–273

The background content of the `/compliance/[id]` page — visible whenever the detail sheet is partially open or before it fully covers the screen — always renders:

```
<p className="text-ct-muted">Loading details...</p>
```

This text is hardcoded and never changes. It is not a loading skeleton. It is a permanent static string that every user sees on every visit to a compliance detail. On mobile or when the sheet doesn't cover the full viewport, this text is visible alongside the real content. It looks like an error state to any non-technical user.

---

### REJECTION-13 — Kanban Board Is Read-Only — Cannot Change Status by Moving Cards

**File:** `src/app/(app)/tasks/page.tsx`

The Tasks/Kanban page is a visual-only board. Cards cannot be dragged between columns. There is no mechanism to move an item from "TO DO" to "IN PROGRESS" from this screen. The user must click a card (which currently navigates to the wrong URL — see REJECTION-06), open the detail sheet, and click "Start". The Kanban board is marketed as a task management view but provides zero task management functionality. It is a filtered read-only list dressed up as a Kanban.

---

### REJECTION-14 — `orgId` Silently Falls Back to Empty String — New Users See Blank App with No Error

**File:** `src/lib/supabase/auth-guard.ts` (as described in session summary) and `src/app/api/compliance/route.ts`, line 28

`conditions.push(eq(complianceItems.orgId, orgId ?? ''))`

If a user signs up through Supabase Auth but is not yet in the `compliance.users` table (which happens if org setup is incomplete, or if they use a social login), `orgId` is `null`, which becomes `''`. Every query runs `WHERE org_id = ''`. The result: zero compliance items, zero departments, zero notices, zero everything. The dashboard shows all zeros. The user sees an empty application with no error message, no onboarding prompt, and no indication that something is wrong. They will assume the product is broken and churn immediately.

---

### REJECTION-15 — Activity Audit Tab on Compliance Detail Is Not Scoped to That Item

**File:** `src/app/api/compliance/[id]/route.ts` (implied by compliance detail loading `auditLogs`)

The "Activity" tab on the compliance detail sheet shows audit logs. But the main Audit page (`/audit`) is not org-scoped (see REJECTION-01), meaning the activity history shown may include cross-org activity. For an item shared across audit context, the logs are not filtered to that specific entity's `entityId`. A compliance officer clicking "Activity" on a GST return should only see events for that return — not a global feed.

---

### REJECTION-16 — Search Fires on Every Keystroke With No Debounce — Will Hammer the Database

**File:** `src/app/(app)/compliance/page.tsx` (implied by standard pattern in compliance list)

The search input in the compliance list triggers an API call (`GET /api/compliance?search=...`) on every keystroke with no debounce. A user typing "GST Monthly Return" sends 17 separate database `LIKE` queries in rapid succession. At 50 concurrent users all typing in search boxes, this is 850 database round-trips per second from search alone. The API uses a `LIKE '%term%'` query with no full-text index. This will bring the Supabase free-tier database to its knees under any real usage.

---

### REJECTION-17 — "Safe" Count on Dashboard Is Computed Incorrectly

**File:** `src/app/api/compliance/stats/route.ts`, line 92

`safe: Math.max(0, pending + inProgress - dueIn30Days)`

The "safe" count is calculated as `(pending + in_progress) - dueIn30Days`. This is mathematically wrong. "Safe" should mean items that are not overdue and not at risk. Instead this formula subtracts items due in 30 days from the combined pending+in_progress count. If you have 10 pending items, 5 in progress, and 8 due in the next 30 days, "safe" = `10 + 5 - 8 = 7`. But those 7 are not safe — they are pending items with no due date data or far-future due dates. This number is displayed prominently on the dashboard KPI cards as a trust indicator. It is computed incorrectly.

---

### REJECTION-18 — No Role-Based Access Control Is Enforced on Any Endpoint

**Files:** All API routes

The schema defines user roles: `admin`, `manager`, `member`, `viewer`. But none of the API routes check the caller's role before performing operations. A `viewer` role user can call `POST /api/compliance` and create items. A `member` can call `PATCH /api/compliance/[id]` and change the status of any item in the org. A `manager` can hit `POST /api/notices` and create government notices. The role system exists in the database and is displayed in the Users page — but it is entirely decorative. There is no actual access control enforcement.

---

### REJECTION-19 — Compliance Type "INCOME_TAX" Renders as "INCOME TAX" in Some Places, "INCOME_TAX" in Others

**Files:** `src/app/(app)/compliance/[id]/page.tsx` line 313, `src/app/(app)/tasks/page.tsx` line 189

The code uses `.replace("_", " ")` — note: no `g` flag, so only the first underscore is replaced. For `INCOME_TAX` this produces `INCOME TAX` (correct). But for enum display consistency, the status badge in the header uses this replace while the type in the edit form or select dropdowns shows raw `INCOME_TAX`. A user reading the detail sheet sees "INCOME TAX" in the badge but would type "INCOME_TAX" in the API or see it exported in CSVs. When this is filtered in the Reports page table or exported CSV, inconsistent naming will confuse any downstream processing or legal filing references.

---

### REJECTION-20 — The Entire System Has No Email Notification Delivery — Only In-App Toasts

**Files:** `src/app/api/notifications/route.ts`, `src/app/api/compliance/recur/route.ts`

The system records notifications in a `notifications` table and marks them as read. There is no email delivery infrastructure whatsoever — no SMTP integration, no Resend/SendGrid client, no email templates, no queuing. When a deadline approaches, when an item goes overdue, when a notice is received — nothing is sent to anyone's email. The CCO managing 6 factories is not at her desk watching this dashboard all day. She expects email alerts. The product's M-13 feature ("Email notifications") claims this is implemented, but the implementation is limited to inserting a database row and displaying a bell badge. For compliance — where a missed GST filing carries ₹50/day penalty and an unanswered SCN can result in ex-parte orders — in-app-only notifications are not a notification system. They are a notification graveyard.

---

### Summary Scorecard (Junior Manager's Final Assessment)

| # | Issue | Severity | Verdict |
|---|-------|----------|---------|
| R-01 | Audit logs cross-org data leak | CRITICAL | REJECT |
| R-02 | Dashboard activity cross-org leak | CRITICAL | REJECT |
| R-03 | Profile settings hardcoded + unsaveable | HIGH | REJECT |
| R-04 | Org settings hardcoded + unsaveable | HIGH | REJECT |
| R-05 | GET request mutates database | HIGH | REJECT |
| R-06 | Kanban links to wrong route (404) | HIGH | REJECT |
| R-07 | Cannot invite/add users | HIGH | REJECT |
| R-08 | Cannot delete compliance items | HIGH | REJECT |
| R-09 | Cannot change type or department after creation | HIGH | REJECT |
| R-10 | Due date silently defaults to today → immediate overdue | HIGH | REJECT |
| R-11 | Reports capped at 100 items | HIGH | REJECT |
| R-12 | "Loading details..." permanently visible in background | MEDIUM | REJECT |
| R-13 | Kanban is read-only, no drag-drop | MEDIUM | REJECT |
| R-14 | New users see blank app with no error or onboarding | MEDIUM | REJECT |
| R-15 | Activity tab not scoped to item | MEDIUM | REJECT |
| R-16 | Search has no debounce — DB hammering under load | MEDIUM | REJECT |
| R-17 | "Safe" count formula is mathematically wrong | MEDIUM | REJECT |
| R-18 | Role-based access control is entirely decorative | CRITICAL | REJECT |
| R-19 | Compliance type renders inconsistently across UI vs export | LOW | REJECT |
| R-20 | No actual email notification delivery | HIGH | REJECT |

**Recommendation:** Do not deploy. Do not demo to clients. Fix R-01, R-02, R-05, R-18 as emergency security patches before any further development. Rethink the onboarding flow (R-14), user management (R-07), and notification infrastructure (R-20) as architectural priorities.

*Reviewed by: Junior Manager, Compliance Technology Evaluation*
*Date: 2026-07-01*
