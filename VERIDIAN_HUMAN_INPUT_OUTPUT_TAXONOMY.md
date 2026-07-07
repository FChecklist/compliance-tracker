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
