# VERIDIAN Human Input & Output Taxonomy

## Why this document exists

Humans communicate with software in a small, highly predictable set of patterns — regardless of whether the domain is finance, HR, legal, facilities, or sales. This document catalogs those patterns once, so that:

- **Every new AI-touching feature classifies its inputs against this catalog first**, instead of inventing a new ad hoc category each wave.
- **This is the first concrete artifact for Intent Engineering** (named as a gap in `AI_OS_MASTER_PROMPT_GAP_ANALYSIS.md`, Wave 110) — a future intent classifier's job is to map free text onto Part 1's pattern types, not to guess from scratch.
- **New team members (human or AI agent) building the next module can look up how similar input has already been handled**, rather than re-deriving the UX/schema/service pattern from zero.

This is a living document. When a genuinely new pattern shows up that doesn't fit Part 1 or Part 2, add it there — don't silently special-case it inside one module.

---

## Part 1 — Canonical Human Input Patterns

Across every module VERIDIAN has built (50+ waves, spanning GRC, ERP, HR, CRM, PMS, Legal, Facilities, Practice Management, Sales), human input collapses into these twelve patterns. Each is a distinct **speech act** — what the human wants to happen as a result of saying it — independent of domain vocabulary.

| # | Pattern | What it wants | Recognizable phrasing | Typical trigger |
|---|---|---|---|---|
| 1 | **Command / Action Request** | A state change | "Create X", "Approve this", "Send the notice", "Mark as complete" | Imperative mood, names a target entity |
| 2 | **Query / Retrieval Request** | Information, no state change | "What is X", "Show me all Y", "How many overdue items" | Interrogative, or an implicit list/filter request |
| 3 | **Status / Progress Check** | A narrower query about ongoing work | "Is X done yet", "What's the status of the GST filing" | References something already in motion |
| 4 | **Upload / Attach** | The system to ingest a file as the primary payload | A photo, Excel sheet, PDF, scanned register — text (if any) is a caption | File attached; may carry zero accompanying text |
| 5 | **Approval / Decision** | A binary or small-enum response to something already proposed | "Approve", "Reject", "Hold", "Sign", "Decline" | Responding to a specific pending item, not a fresh request |
| 6 | **Correction / Feedback** | A refinement of a previous output | "That's wrong, it should be Y", "No, I meant the other one" | Follows a prior system response |
| 7 | **Escalation / Exception Report** | Urgent attention to an unplanned deviation | "This is broken", "We have a problem with X", "The vendor hasn't responded" | Often carries urgency/frustration signal |
| 8 | **Delegation / Assignment** | Routing work to another entity (human or agent) | "Have Priya handle this", "Assign this to the finance team" | Names a recipient, not the requester |
| 9 | **Configuration / Preference Setting** | A standing rule, not a one-off action | "Always require two approvers for this", "Default my invoices to Net 30" | Says "always"/"from now on"/"by default" |
| 10 | **Free-form Conversation / Clarification** | Open dialogue, exploration | "What if I structured it this way instead?", follow-up questions | No clear action target yet |
| 11 | **Bulk / Batch Operation** | Pattern #1 applied at scale | "Do this for all clients in Maharashtra", "Send reminders to everyone overdue" | Names a set, not a single entity |
| 12 | **Scheduled / Recurring Intent** | Sets up automation rather than performing the action now | "Every month, remind me about X", "Renew this automatically" | Names a cadence, not "now" |

**Why this matters for routing (ties to the routing cascade in `AI_OS_MASTER_PROMPT_GAP_ANALYSIS.md`):** patterns #1, #2, #3, #5, #9, #11, #12 are almost always answerable *without* an LLM call once classified — #2/#3 are SQL queries, #5 is a status-column UPDATE, #9/#12 are config/rule writes, #11 is #1 looped. Only #4 (extraction), #6/#7/#10 (genuinely open-ended language understanding), and novel #1/#2 phrasings that don't match a known intent actually need a real LLM call. Classifying the pattern *first* is what makes "AI as last resort" (the master prompt's own framing) operationally possible instead of aspirational.

---

## Part 1B — Verbatim Example Inputs (written the way a real person actually types)

An intent classifier trained on clean textbook phrasing ("Please create a new purchase order") will misfire the moment a real user types the way real users actually type: short, impatient, sometimes bundling two asks in one line, sometimes in Hinglish, sometimes with a typo, rarely with punctuation. These examples are drawn across VERIDIAN's real personas — a CA firm partner, a facilities technician, an HR manager, a sales reseller, an ERP accountant, a compliance officer — written as they would actually message, not as a spec would phrase it. Every pattern classifier this platform ever builds should be tested against messages that look like these, not the clean Part 1 examples.

**1. Command / Action Request**
- "mark the gst return as filed pls"
- "create new client - sharma textiles nashik, gstin is 27AABCS1234A1Z5"
- "send the notice reply to the officer today itself, dont wait"
- "pls approve rohit's leave 15th to 18th"
- "book the DG set service, vendor confirmed tmrw 10am"
- "close ticket 4521 customer said its fixed"

**2. Query / Retrieval Request**
- "which clients have pending tds this month"
- "show leads not contacted in 2 weeks"
- "kitne assets ka amc is month khatam ho raha hai"
- "who all on leave next week"
- "total outstanding from customers right now?"

**3. Status / Progress Check**
- "any update on sharma textiles secretarial audit"
- "board resolution draft ready ya nahi"
- "vendor confirmed the po or not yet"
- "checking - payroll done for this month?"

**4. Upload / Attach**
- *[photo of a physical AMC register page, no caption at all]*
- "bank statement for reconciliation" *[Excel attached]*
- *[PDF of a GST notice]* "got this today"
- "scanning the old asset register in parts, sending 3 photos"

**5. Approval / Decision**
- "approved"
- "reject - amount looks wrong check again"
- "hold this need to discuss with partner first"
- "yes sign it"
- "go ahead no changes"

**6. Correction / Feedback**
- "wrong vendor, its the pune one not mumbai"
- "amount is wrong should be 45,000 not 4,500"
- "no i meant last month not this month"
- "client name is sharma not verma, you got it wrong"

**7. Escalation / Exception Report**
- "urgent - client says notice deadline is tomorrow and nothing filed yet"
- "DG set not starting, need technician asap"
- "server down 2 hrs nobody can mark attendance"
- "this vendor hasnt replied in a week now, escalate pls"

**8. Delegation / Assignment**
- "give this to priya she did the last one"
- "nashik client compliance - assign to junior team"
- "let facilities handle the ac issue"
- "route this to billing not me"

**9. Configuration / Preference Setting**
- "always cc me on notices above 1 lakh from now"
- "default payment terms net 45 for this client going forward"
- "2 approvers required for any refund from now on"
- "make weekly ppm checklist mandatory for all dg sets"

**10. Free-form Conversation / Clarification**
- "what happens if we miss the roc filing deadline"
- "why did this client's compliance score drop suddenly"
- "what if we increase the credit limit for this customer, any risk"
- "is there a better way to track this than excel"

**11. Bulk / Batch Operation**
- "send reminder to all clients with pending kyc"
- "mark all as acknowledged for this month's policy update"
- "generate invoices for everyone with unbilled hours this month"
- "run ppm check for all dg sets in noida campus"

**12. Scheduled / Recurring Intent**
- "remind me every quarter about board minutes"
- "auto renew this amc every year unless i cancel"
- "send this report to the partner every monday morning"
- "review this vendor every 6 months"

---

## Part 2 — Canonical VERIDIAN Output Patterns

The response side is equally patterned. Every module's response is one of:

| # | Output Pattern | Shape | Example |
|---|---|---|---|
| A | **Confirmation** | Short acknowledgment that a state change happened | "Compliance item marked complete." |
| B | **Data Table / List** | Structured rows matching a query/filter | Compliance items due this week, CRM leads by stage |
| C | **Single Record View** | One entity's full detail | An asset's PPM history, a client's engagement detail |
| D | **Generated Document** | A new file (PDF/DOCX/JSON) produced from data | An e-invoice IRN payload, a board resolution draft |
| E | **Proposal Awaiting Approval** | Not yet applied — needs a human decision (Pattern #5 response) | A new Worker Agent proposal (VERI FDE), a digitized register batch pending review |
| F | **Refusal / Guardrail Message** | The request was denied by policy, not by the model | Policy Enforcement Engine's `refusalMessageFor()` |
| G | **Error / Degraded Result** | Something failed; states what and offers a retry path | LLM call failed after retries, malformed JSON caught by `LLMVerificationError` |
| H | **Dashboard / Aggregate Summary** | Computed metrics across many records | Orchestra Analytics cost dashboard, Sales HQ commission liability |
| I | **Notification / Async Update** | Pushed to the user later, not a direct reply | Metric alert firing, host-notified-on-visitor-checkin |
| J | **Clarifying Question** | The system needs more from the human before it can act | Ambiguous intent, missing required field |

---

## Part 2B — Verbatim Example Outputs (written the way VERIDIAN actually replies, not how a spec describes a reply)

A good system reply reads like a competent colleague answered, not like a template filled in variables. These are drawn from real modules already built in this codebase — the tone (plain, specific numbers, no filler like "Sure! I'd be happy to help") is deliberate and should be the house style for any new module's replies too.

**A. Confirmation**
- "Done — GST return marked filed for Sharma Textiles."
- "Leave approved for Rohit, 15th to 18th."
- "Marked. Ticket 4521 closed."
- "Vendor changed to Pune Fabricators on this PO."

**B. Data Table / List**
- "3 clients have pending TDS this month: Sharma Textiles (₹12,400), Verma Industries (₹8,200), Patel & Co (₹21,000)."
- "7 leads haven't been contacted in 2+ weeks. Sorted oldest first — want me to draft follow-up messages for all of them?"
- "12 assets have AMC expiring this month across Noida and Pune campuses."

**C. Single Record View**
- "Sharma Textiles — GSTIN 27AABCS1234A1Z5, Nashik. Compliance score 82/100. 2 items overdue, 1 due this week."
- "DG Set #GEN-014, Noida basement. Last service 12 Jun. Next PPM due 12 Jul. AMC with Kirloskar, expires 30 Sep."

**D. Generated Document**
- "Invoice INV-2026-0412 generated for Verma Industries — ₹1,84,000, 62 unbilled hours across 3 matters."
- "IRN generated: 3fdc98a1... e-invoice ready to send."
- "Board resolution draft ready for review — added as an attachment, not yet sent to the client."

**E. Proposal Awaiting Approval**
- "I found 14 rows that look like assets from your uploaded photo. Review them before I add anything to the register."
- "No existing agent handles 'auto-approve POs under ₹5,000' — I've drafted a new Worker Agent for this. Needs your approval before it goes live."
- "This looks like a fresh legal matter, not an update to an existing one. Want me to open it as a new matter?"

**F. Refusal / Guardrail Message**
- "I can't process a fund transfer — that needs to be done directly by you in your banking app."
- "That's outside what I'm set up to help with here. This assistant handles compliance and filings, not HR policy questions — try the HR module."
- "I won't delete this record permanently. If you need it removed, an admin can do that from Settings."

**G. Error / Degraded Result**
- "Couldn't reach the AI provider after 3 tries — try again in a minute, or check your API key in Settings."
- "The response I got back didn't have what I needed to route this properly, so I've logged it as an error instead of guessing. Please try rephrasing."
- "Bank statement import failed on row 47 — the date format doesn't match. Rest of the file processed fine, 46/47 rows matched."

**H. Dashboard / Aggregate Summary**
- "This month: 340 API calls, ₹412 in model cost, 2 failed executions (both retried successfully)."
- "Sales HQ: 6 active partners, 23 referrals in pipeline, ₹38,000 commission accrued, ₹12,000 already paid out."
- "Sprint burndown: 18 of 24 points done, 3 days left, on track."

**I. Notification / Async Update**
- "Rahul checked in a visitor — Amit Shah, meeting with Rahul, 11:15 AM. You've been notified as the host."
- "Heads up — the vendor payment reminder you scheduled just went out to 8 overdue accounts."
- "Your GST filing reminder: 3 days left for Sharma Textiles."

**J. Clarifying Question**
- "Which client did you mean — there are two 'Sharma' entries, Sharma Textiles and Sharma Enterprises?"
- "By 'this month' do you mean the calendar month or the current billing cycle? They're different for this client."
- "You uploaded a photo but didn't say what it's for — is this for the asset register, or something else?"

---

## Part 3 — Pattern-to-Module Map (grounded in what's actually built)

This section shows, module by module, which input patterns actually occur and how VERIDIAN handles them **today** — not a hypothetical design. Citations point at real files from this codebase.

### Compliance / GRC core
- **#2/#3** "What's overdue this month?" → `complianceItems` filtered query → **Output B**. (`compliance-service.ts`)
- **#1** "Mark this challan as paid" → status UPDATE → **Output A**. (`compliance/recur/route.ts` family)
- **#5** Notice response approval chain → **Output A/E**.
- **#9** Per-module business rules (e.g. POSH witness-count requirement) → `module-rules-resolver.ts` → **Output A** (silent config change).

### ERP (Accounting / Buying / Selling / Stock / Payroll)
- **#1** "Create a purchase order for vendor X" → `erp-buying` service → **Output C** (the new PO record).
- **#11** GRN three-way-match run across a batch of receipts → **Output B** with per-line pass/fail.
- **#4** Bank statement import (reconciliation) → `erp_bank_statement_imports` → **Output B** (matched/unmatched lines).
- **#12** Recurring billing schedule (`erpContractBillingSchedules`, Wave 71) → **Output A** (schedule created, no immediate charge).

### PMS (Project Management)
- **#1** "Create an issue for the login bug" → `pms-issue-service.ts` → **Output C**.
- **#2** Kanban board view → **Output B**, grouped by status.
- **#8** "Assign this to Rahul" → issue `assigneeId` update → **Output A**.
- **#3** Sprint burndown → **Output H**.

### HR / Recruitment / Performance
- **#1** Leave request submission → **Output A** (pending) then **Output I** (approved/rejected notification).
- **#4** Resume upload for a job opening → `job_applications` → **Output C**.
- **#5** Interview feedback / hiring decision → **Output A**.

### CRM
- **#1** "Log this call with the lead" → **Output A**.
- **#2** "Show me leads worth converting" → filtered by `aiScore` (Wave 75 CRM Intelligence) → **Output B**.
- **#6** Correcting an auto-extracted meeting action item → `veri_meetings` action-item edit → **Output A**.

### Legal / Company Secretarial
- **#1** File a new litigation matter → `legal-matters` → **Output C**.
- **#2** "What's our IP portfolio status?" → **Output B**.
- **#7** "We got a legal notice" → notice intake + escalation flag → **Output E** (routes toward a litigation matter proposal) or **Output A**.
- **#4** MCA e-filing document upload → `mca_filings` → **Output A** + tracked SRN.

### Facilities Management & Corporate Services (FM&CS, Wave 107)
- **#4** Photo/Excel of a physical asset register → `fm-register-digitization-service.ts` → **Output E** (staged rows, human review required before any `fm_assets` write — deliberately never auto-commits).
- **#1** Complete a PPM checklist item → `fm-ppm-service.ts`'s `completeOccurrence()` → **Output A**.
- **#12** PPM schedule (multiple simultaneous frequencies per asset) → **Output A** (schedule created; occurrences generated by the rolling-window cron, not on request).
- **#1 (visitor)** Check in a visitor → `fm-visitor-service.ts` → **Output A** + **Output I** (host notified).

### THE FIRM AI OS (Wave 108, practice management)
- **#9** "Enable Legal services for this client" → `firm-client-service-line-service.ts` → **Output A**.
- **#1** Log billable time → `firm-time-tracking-service.ts` → **Output A**; "stop timer" is the same pattern with a computed duration.
- **#1 (bulk)** Generate an invoice from unbilled hours → `firm-billing-service.ts`'s `generateInvoiceFromUnbilledTime()` → **Output D** (the invoice) — this is Pattern #11 (batch) producing Pattern D, the clearest example of bulk-action-into-document in the whole codebase.
- **#3** "Which limitation dates are coming up?" → `firm-practice-dashboard-service.ts`'s `getUpcomingDeadlines()` → **Output B**, merged across three underlying tables.

### VERI FDE ("Make Your Own Agents")
- **#1**, phrased as a novel capability request ("Approve this purchase order" with no existing agent for it) → `fde-service.ts` → embedding search first (cheap, Pattern #2 internally) → if no match, **Output E** (a new Worker Agent proposal, never auto-created — Wave 16's human-approval gate).
- This is the one module explicitly built around **classifying Pattern #1 against a capability catalog before ever reaching an LLM** — the exact "routing cascade" instinct the master-prompt evaluation flagged as only partially generalized elsewhere.

### Sales Engine (Wave 109)
- **#4 (implicit)** Clicking a referral link is a Pattern #4-adjacent event with no text at all — the "payload" is the click itself. → `resolveReferralLinkAndRecordClick()` → **Output A** (silent) + a redirect.
- **#1** Admin creates a sales partner → `sales-engine-service.ts` → **Output C** (partner record + dashboard token).
- **#2** Partner checks their own dashboard → **Output H** (pipeline + commission summary).
- **#5** Admin marks a commission accrual as paid → append-only ledger insert → **Output A**.

### VERI Chat / VERI AI / Page Agent (the only 3 free-text-to-LLM surfaces with real guardrails today)
- **#10** is the dominant pattern here by design — open conversation.
- **#1** embedded inside conversation ("send this to the finance team") → multi-agent chaining (Wave 78) routes to the relevant module's action.
- **#7** injection/off-purpose attempts → Policy Enforcement Engine intercepts before the LLM call → **Output F**.

### Meeting Intelligence / CRM Intelligence (the two real AI-extraction layers)
- **#4** A published meeting transcript is the payload → LLM extraction (Wave 74) → **Output C** (action items, decisions) — the human never explicitly asks for this; publishing *is* the input.
- **#2 (derived)** Lead score / win probability — computed, not queried, but surfaces as **Output B/C** annotations (Wave 75).

---

## Part 4 — How to use this document going forward

1. **Before building a new AI-touching surface**, identify which of the 12 input patterns the feature actually receives, and which of the 10 output patterns it should return. If it's a clean match to an existing pattern, reuse that pattern's established handling shape (e.g., any new "batch action producing a document" feature should look like THE FIRM's invoice-generation, not invent a new bulk-op shape).
2. **If a request doesn't fit any of the 12 input patterns**, that's a genuine signal to slow down and design deliberately — most "novel" requests turn out to be Pattern #1 or #11 with unfamiliar domain vocabulary, not a genuinely new interaction primitive. Real new primitives are rare; add them here explicitly when they occur, with the module that first surfaced them cited.
3. **Every module's route/service layer should be able to say, in one sentence, which input pattern(s) it accepts and which output pattern(s) it returns** — this table is the reference for that sentence, not a replacement for reading the actual code.
4. This document does not replace `VERIDIAN_AI_CONSTITUTION.md` (governance), `MASTER_AI_OS_ARCHITECTURE.md` (product-branch architecture), or `AI_OS_MASTER_PROMPT_GAP_ANALYSIS.md` (AI-engineering-discipline gap analysis) — it sits alongside them as the input/output vocabulary those three assume.
