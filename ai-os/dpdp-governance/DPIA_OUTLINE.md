# Data protection impact assessment (outline, draft for the lawyer)

DRAFT outline only. It is a starting point, not a finished assessment. It covers the processing that carries the most risk: children's consent, the AI work link, and Sales Partner payout details.

1. **Description.** What is processed, by whom, where, for how long (see `RECORDS_OF_PROCESSING.md`).
2. **Necessity and proportion.** Why each item is needed; what was left out on purpose (no card numbers, no documents kept, no identity-document images).
3. **Risks to the people**, each rated likely / severe, with the control and what is left:
   - A child's consent given by the wrong person. Control: guardian name and relationship recorded; the customer (a school) is the Data Fiduciary and verifies. Left: we cannot verify a guardian ourselves.
   - Personal data reaching a user's AI through the AI work link. Control: other people's e-mails and phone numbers hidden by default, grievance officer by role only, links expire, an alert on unfamiliar use. Left: the user's AI has its own terms.
   - Payout details leaking. Control: encrypted, key in Vault, no browser role can read them. Left: operators with database access.
   - A broken tenant wall. Control: row-level security on every table, definer functions only.
   - E-mail content passing through Resend (Tokyo). Control: no card data, short content. Left: transfer outside India under section 16.
4. **Measures already in place** (list from the Privacy Notice section 6) and **measures still to add** (owner decision list).
5. **Consultation.** Customers (schools, CA firms), a security reviewer, the lawyer.
6. **Sign-off and review date.** Owner signs; review yearly and at any change of sub-processor.

Not a Significant Data Fiduciary assessment: whether VERIDIAN or a customer is notified as one is a question for the lawyer (see `LAWYER_QUESTIONS.md`).
