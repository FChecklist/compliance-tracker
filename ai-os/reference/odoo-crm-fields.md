# Odoo CRM -- Field Reference

**Mirrored here 2026-09-29** from the now-deleted `FChecklist/odoo-reverse-engineering`
repo, verbatim, before that repo's deletion as part of an org-wide repo cleanup (only
`compliance-tracker` and `projexa` remain as live products). This file is cited by a
real, current code comment in `src/lib/services/crm-service.ts` (search for "Lost
Reasons") -- it existed nowhere else, so it's copied here rather than lost. Content
below is unedited from the original.

Reverse-engineered 2026-07-20 by navigating a live logged-in Odoo session (rajatagarwal.odoo.com) via Claude in Chrome. **This session was opened in a NEW tab by Claude (not the Owner's pre-existing tab, which wasn't visible to the automation tooling) navigating directly to the Odoo URL the Owner provided -- the login session carried over automatically because Odoo's auth cookie is stored at the browser-profile level, not per-tab.** This is notable: it confirms the earlier automated Playwright-based Odoo documentation attempt (blocked by Cloudflare Turnstile bot-detection, see `veridian_priority21` / task #9 in prior session history) can be bypassed entirely by riding an already-authenticated real browser session instead of a fresh headless one.

Read-only pass: the one "New Opportunity" form that was opened was explicitly cancelled (X / discard) before any save, after first hitting a "Missing required fields" validation error on the Kanban quick-add card (also discarded via its trash icon, not saved). No records created, edited, or deleted.

## Important finding: this Odoo instance has ZERO real data
The Kanban pipeline view shows what LOOKS like ~12 opportunity cards (REF0001-REF0012, various names/amounts, some with red "Lost" ribbons) behind a "Create an opportunity to start playing with your pipeline" onboarding tooltip. **These are NOT real records** -- they are Odoo's own decorative onboarding-screen background artwork (confirmed: the same "REF0001" card showed different random names/amounts across two separate page loads/screenshots, and removing all filters still showed 0/0/0/0 across all 4 pipeline stages). The only 2 real records in the whole account are the Owner's own 2 contact entries under Customers. Anyone reverse-engineering this account structurally should not mistake the onboarding artwork for a seeded demo dataset the way Zoho's account genuinely had one.

## Top-level navigation
Top bar: **CRM | Sales | Reporting | Configuration**, plus (right side) an AI assistant icon, Discuss/messaging icon (unread-count badge), Activities/clock icon, a tools/wrench icon, and the user avatar.

**Sales** menu: My Pipeline, My Activities, Teams, Customers.
**Configuration** menu: Settings, Sales Teams, **Activities** group (Activity Types, Activity Plans), **Pipeline** group (Tags, Lost Reasons), **Lead Generation** group (Lead Mining Requests).

This confirms the underlying data model has, at minimum: a Sales Team concept, a configurable Activity Type/Plan system (used across Odoo generally, not CRM-specific), pipeline-level Tags and a dedicated Lost Reasons taxonomy (i.e. losing a deal requires/allows selecting a structured reason, not free text), and a "Lead Mining" feature (third-party lead-purchasing/generation, a real Odoo Enterprise feature).

## Module: Pipeline (opportunities)
**Kanban view** (default): 4 stages as columns -- **New, Qualified, Proposition, Won** -- each with a running total and record count. A "Lost" state exists as a status (not a 5th column; handled via a Won/Lost toggle on each record, with the Lost Reasons taxonomy from Configuration presumably prompting for a reason when marking Lost). Top toolbar: **New**, **Generate** (dropdown -- likely AI-assisted opportunity generation, given the sparkle/AI icon elsewhere in the UI), a saved-filter search bar (default filter "My Pipeline"), and 7 view-switcher icons (Kanban/List/Calendar/Pivot-table/Graph/Map/Activity-timeline -- more view types than either Zoho CRM or Zoho Projects exposed).

**List view** columns: Opportunity, Contact Name, Email, Salesperson, Expected Revenue, Stage, plus inline row actions (Reschedule, Email, SMS).

**Kanban quick-add card** (inline, click "+New" without opening full form): Contact, Opportunity's Name* (required -- validation blocked "Edit" until filled), Contact Email, Contact Phone, Expected Revenue (currency, default 0.00) with a 3-star priority rating. Buttons: Add, Edit, Delete.

**Full Opportunity form** (opened via List view's New, not the Kanban quick-add):
- Won / Lost buttons (top-left, record-level status toggle)
- Stage breadcrumb pipeline across the top: New (1m -- time-in-stage indicator) > Qualified > Proposition > Won, clickable to change stage directly
- **Opportunity Name*** (large title-style input, placeholder "e.g. Product Pricing")
- **Expected Revenue** (currency) **at** **Probability** (%, with an AI sparkle icon -- suggests AI-assisted probability scoring, not purely manual)
- Contact (create-or-select), Email, Phone
- Salesperson (defaults to current user)
- Expected Closing (date, with its own 3-star priority rating alongside it)
- Tags
- Two tabs:
  - **Notes**: a free-text description field, plus Odoo's universal "chatter" panel at the bottom of every record (Send message / Log note / Activity, with attachment and follower-count icons) -- this chatter pattern is an Odoo-wide convention, not CRM-specific
  - **Extra Info**: two sections -- **MARKETING** (Campaign, Medium, Source, Referred By) and **OWNERSHIP** (Sales Team)

## Module: Customers (Sales > Customers)
List columns: Name, Email, Phone, Activities, Country. Only 2 real records exist in this account (the Owner's own contact entries), both sharing the same email -- genuinely no external customer data has been entered yet.

## Design/flow observations
- Odoo's chatter (message/log-note/activity panel) is a cross-module convention -- expect to see the identical pattern on every business-object form (leads, customers, likely also on Sales/Invoicing/Projects modules if explored later), not something reverse-engineered per-module.
- The Stage breadcrumb (clickable pipeline across the top of the form) is Odoo's signature UX pattern for stage-based workflows -- functionally similar to Zoho CRM's Kanban "Stage View" but rendered as an inline breadcrumb on the record itself rather than only as a separate board view.
- Marking a deal "Lost" is backed by a structured Lost Reasons config list (Configuration > Pipeline > Lost Reasons), not a free-text field -- useful if this system needs to be modeled with a controlled vocabulary for loss analysis.
- The "Generate" button next to "New" and the AI sparkle icon on Probability both point to built-in AI features in this Odoo edition, not just manual data entry.

## Not yet explored (real, disclosed gap -- ran out of scope for this pass)
- Reporting menu (Pivot/Graph/Dashboard views specific to CRM)
- Settings page itself (only the menu item was seen, not opened)
- Sales Teams, Activity Types, Activity Plans, Tags, Lost Reasons, Lead Mining Requests config pages (menu items identified, none opened)
- Any modules beyond CRM (Odoo is a full ERP suite -- Sales, Invoicing, Inventory, etc. almost certainly exist under the main Odoo app switcher, not explored in this CRM-scoped pass)
- The app switcher / main Odoo home screen itself (this session navigated straight to the CRM URL the Owner provided, never visited the top-level Odoo apps dashboard)
