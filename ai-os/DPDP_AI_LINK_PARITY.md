# DPDP AI work link: what an AI may do, by role (parity with a logged-in person)

Owner requirement (2026-10-04): the AI behind a short link works "as per its role", doing what the person could do by logging in,
but it cannot write code. This file is the inventory: every action a DPDP person can take in the app, who can take it, whether the
AI could reach it before this change, and the decision. Written 2026-10-05 from `src/app/api/dpdp/*`, `src/app/dpdp/(app)/*`, the
live static app `dpdp-app/` (which calls the same `public.dpdp_*` functions) and `supabase/functions/dpdp-ai-link/api-definition.ts`.

## Hard rules (never relaxed, whatever the role)

1. No payments, plan purchase, billing change, payout or bank/PAN detail.
2. No signing, attesting or declaring on anyone's behalf (Yes on a job, owner confirm, CA check/sign, attest, sign-off, appointing an officer).
3. No erasure and no export of personal data.
4. No reading of personal data: the register projections return counts, states and dates, never requester/complainant details,
   answer or summary text, file names, phone numbers, addresses or payment rows. Emails of members only when the link does not hide them.
5. No creating users, no changing permissions, nothing in another organisation.
6. Legal weight or irreversible = a level-2 DRAFT that the person confirms in their own browser, or human-only.
7. The link carries only the powers of the person it belongs to. A staff link never gains owner powers (verified live, below).

Levels: 0 read, 1 direct small edit (only when the link was made with level 1), 2 draft (nothing changes until the person confirms).

## The table

| Action | Role needed | AI-reachable before | Now | Decision | Reason |
|---|---|---|---|---|---|
| Read jobs, one job, playbook, law, history, reports | all (staff/parent: own jobs only) | L0 | L0 | allow, direct | read only |
| Add a note to a job | anyone who sees the job | L1 | L1 | allow, direct | reversible, no legal weight |
| Change a due date | owner | L1 | L1 | allow, direct (emailed link: window only) | owner's own act, undoable 24h |
| Give a job to an existing member | owner | L1 | L1 | allow, direct | existing member only, undoable |
| Mark a job not applicable (with reason) | owner, or the job's person | L1 (draft if today's law requires the job, on an emailed link) | same | allow, direct / draft | reason recorded |
| Say Yes (mark done) | job's person or owner | L2 draft | L2 draft | draft, human confirms | the record cannot be reopened |
| Answer a group job | each member, on their own page | none | none | human-only | each person's own declaration |
| Owner confirms a CA-set-up list | owner | L2 draft | L2 draft | draft | legal confirmation |
| Part 7 sign-off (owner Yes) | owner | L2 draft (MARK_DONE) | same | draft | signing |
| CA manager check / CA partner sign | CA | recorded, not executable | same | human-only | signature |
| Attest (`/api/dpdp/attest`) | signer | none | none | human-only | attestation |
| Add a person (by giving them a job) | owner | L2 draft | L2 draft | draft, owner confirms | creates a user: never direct |
| Remove person, change signer, delete a job | owner | recorded, not executable | same | human-only | irreversible / permissions |
| Publish a notice or the public page | owner | PUBLISH recorded, not executable | same | human-only | public, legal |
| Appoint / change the Grievance Officer | owner | none | none | human-only | legal appointment |
| See the data map | owner, coord, go, CA | none | **GET /register/data-map** | allow, read | no personal data in it |
| See notices (versions, when in force) | owner, coord, go, CA | none | **/register/notices** | allow, read | |
| See who is in the organisation and their role | owner, coord, go, CA | partly (by-person report) | **/register/people** | allow, read | emails honour hide_emails |
| See rights requests (counts, due dates) | owner, coord, go, CA | none | **/register/rights** | allow, read | no requester details |
| See complaints (ref, tier, state, due) | owner, coord, go, CA | none | **/register/grievances** | allow, read | no complainant details |
| See the data-leak register and its clock | owner, coord, go, CA | none | **/register/breach** | allow, read | counts and dates only |
| See public-page status and the published officer | owner, coord, go, CA | none | **/register/public-page** | allow, read | published facts only |
| See firms data is shared with, agreement signed or not | owner, coord, go, CA | none | **/register/processors** | allow, read | |
| See groups and consent-campaign results | owner, coord, go, CA | none | **/register/groups** | allow, read | counts only |
| See how many proof files each job has | owner, coord, go, CA | none | **/register/proof** | allow, read | no file names or content |
| See the plan band and trial end | owner, coord, go, CA | partly (notice) | **/register/plan** | allow, read | never payments |
| Add / confirm a data-map location, ask a holder | owner, coord | none | none | human-only for now | sends a request to a person; a draft verb needs a confirm RPC (not built, see below) |
| Create a principal group; send a consent campaign | owner | none | none | human-only | messages real people; contact lists are personal data |
| Add a processor / sign an agreement | owner | none | none | human-only | signing |
| Answer a rights request; officer decision; escalate a complaint | go | none | none | human-only | answers go to an individual; personal data |
| Record a breach; tell the Board or the people | owner | none | none | human-only | legal notification, time-critical |
| Upload / accept proof | job's person / owner | none | none | human-only | documents may hold personal data; accept = attest |
| Pay, change plan, confirm payment, partner payouts, referral money | owner / partner | none | none | human-only | payments, bank and PAN |
| Make or revoke an AI link | the person | none | none | human-only | credentials |
| Create or switch organisation, revoke a member, own data (`mydata`), access log | person / owner | none | none | human-only | accounts, permissions, personal data |
| Apply or discard an AI proposal (`ai-work`) | owner | none | none | human-only | the confirmation step itself |
| Send an idea to the shared product pool | any link | L0 write | L0 write | allow | about the product only, refuses personal data |

## What was built, and what was not

Built (migration `drizzle/0693_dpdp_ai_link_register.sql`, applied live 2026-10-05): `public.dpdp_ai_link_register(token, kind)`, read only,
owner/coordinator/Grievance Officer/CA links only; `GET /register` and `GET /register/{kind}` in the link API (`api-definition.ts` is the single source,
the manual's section E and the router read it).

Not built, on purpose: new direct or draft write verbs for the data map, groups, processors, consent and similar. Each needs a confirm
step in `dpdp_confirm_ai_draft` and its own review for what it writes; none can be undone by the person in 24 hours the way the four level-1 edits can.
They stay human-only until each is designed. This is a decision for the owner, not an oversight.

## Verified live (test organisation, 2026-10-05)

- Owner link: every register kind answers; NOTE through the GET fallback applied and returned an undo link.
- Staff link: `/register/people` is refused (403, plain sentence); SET_DUE and ASSIGN are refused (403); EXPORT_PERSONAL_DATA is refused at every level.
- `?_method=POST` on any path other than `/actions`, `/drafts`, `/suggestions` is refused (403).
