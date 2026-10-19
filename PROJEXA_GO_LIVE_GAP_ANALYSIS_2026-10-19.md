# PROJEXA go-live gap analysis — as on 19 October 2026

Basis: Sumeet's 111 requirements (`platform.sumeet_requirements`, read live 2026-10-19), the register's own
`status` / `next_action` text, today's merges and deploys, and today's attempt at a UI walk.
Product posture: **PROJEXA is a LOW-security product** (owner). Security/legal rows are therefore kept at
"works and is not embarrassing", not hardened further. Gaps below are ranked by whether they stop a real
customer (Sumeet) using the product, not by how rigorous the evidence is.

## 0. How much of this is verified (read first)

| Fact | Source | Confidence |
|---|---|---|
| 111 rows; ~104 marked done/closed/verified/passing, 7 not closed (R-15, R-47, R-63, R-71, R-A5, R-C13, R-C17) | register, queried today | High (it is the register's claim) |
| 17 rows were later corrected / reopened / found stale or mis-cited | register text | High |
| **0 of 111 were driven in a real browser today** | `SUMEET_111_UI_AUDIT.md` (all NOT-DRIVEN) | High — RAM, then sign-in block |
| Two real defects outside the 111 found today and fixed: Product field on New Project; login asked again between `www` and bare domain | this session | High |
| Both fixes are merged and a production deploy of `main` at commit `c0d018ae` is READY | GitHub + Vercel | High; **behaviour on the live site not yet observed** |

So: this document is a gap analysis from the register, the code and today's evidence. It is **not** a
substitute for the full live walk (gap G-01).

## 1. Summary

| Tier | Meaning | Count |
|---|---|---|
| **P0** | Stops go-live or is visible to every user on day one | 6 |
| **P1** | Real defect or missing capability Sumeet will hit in normal use | 7 |
| **P2** | Post-launch / owner decision / evidence-only (not a product gap) | 7 |
| Not gaps | Security / legal / test rows, accepted under the low-security posture | 9 rows (R-A1…A7, R-B1, R-B2) |

## 2. P0 — fix or confirm before going live

| ID | Gap | Evidence | What "done" looks like |
|---|---|---|---|
| G-01 | **No complete UI walk of the 111 exists.** Closures rest on unit tests, break-restore runs and per-feature e2e, never one signed-in pass over every screen. This is why each new audit finds something. | `SUMEET_111_UI_AUDIT.md`: 0 driven | One committed Playwright suite that signs in as the E2E Meridian test org and walks all 111 rows (input → output → reload → still there), green in CI on every merge. |
| G-02 | **Today's two fixes are deployed but not observed live.** Product removal, and `www`→apex redirect. | Vercel prod deploy `c0d018ae` READY | Open `https://www.projexa-ai.com`, confirm redirect to apex; log in once; type the address again → dashboard, no login. Create a project with name only. |
| G-03 | **Test-login path is down in CI.** The `mint-session-r33` Edge Function returns 401 to the legacy anon key, so every Env-1 end-to-end spec fails at login. This is the regression net for G-01. | R-40 re-verification note, 2026-09-30 | Move the mint function and specs to the new publishable-key scheme (low-security product: a straight owner OK, no further hardening needed). |
| G-04 | **BOQ save "did not respond in time" under load.** R-01 is Sumeet's first requirement. Root cause not pinned; CI DB connection-pool exhaustion is the suspected cause. | CLAUDE.md R83 note; memory "CI DB pool exhaustion" | A reproducible load test of BOQ save; pool/timeout fix; no timeout in 20 consecutive saves on the live stack. |
| G-05 | **Disclaimer pages render literal placeholders** (`[INSERT CONTACT EMAIL]`, `[INSERT WEBSITE]`, `[INSERT DATE]`) on the live site. | R-A5 evidence | Owner supplies real values; one-line edit and redeploy. |
| G-06 | **Percent complete is uncapped** (six 60% entries stored as 360%). R-47. | R-47 status "built"; fix branch `fix/r47-percent-entries-cap` exists, unmerged | Cap or reject > 100% in the API and the form; test; merge. |

## 3. P1 — real defects / capability gaps

| ID | Gap | Evidence | Fix |
|---|---|---|---|
| G-07 | **Report export loops.** Designer-timesheet and cost-analysis Export buttons bounce between screens and never reach a PDF, although the backend PDF route works. R-C15. | Register note (W-PROD catch, 2026-09-11, "not fixed") | Wire the buttons to the real export route; re-check on live. |
| G-08 | **No WhatsApp share of MoM/reports as written.** R-C15 was closed *narrowed* to PDF export + share-to-link on 3 report types. Sumeet asked for WhatsApp. | R-C15 / R-C04 text | Confirm with Sumeet that share-link satisfies "WhatsApp"; else add the share action. |
| G-09 | **Change orders are not linked to the BOQ revision they cause** (R-98). Two parallel change systems, no traceable chain. | R-98 close caveat | Add the link (changeOrderId on the revision) and show it on both screens. |
| G-10 | **Site instructions have no page of their own** (R-C14); only a section inside `/scope/[id]`, and the form shape is assumed. | R-C14 + audit | A `/site-instructions` screen, or confirm with Sumeet the in-BOQ section is enough. |
| G-11 | **Exception checks show "Clear" on the demo project.** The flagged state and drill-down are proven only by unit tests. A demo or a customer's first look will show 28 empty checks. | EXC-ITEM-* evidence (live caveat repeated on every row) | Seed a demo project that trips each detector; confirm one real click-through per screen type. |
| G-12 | **Import (R-70)**: a note says real Sumeet-shaped sub-task rows with a blank Unit were 400-ing on real import; status says re-fixed 2026-09-20/21. Unclear which is current. | R-70 status vs next_action | Import Sumeet's real workbook end-to-end on the live stack; keep it as a test fixture. |
| G-13 | **Slow cold path `ensureConstructionEnabled`** (21 s then 500 on a fresh org). Root cause not found. | CLAUDE.md R74 | Reproduce on a new org; fix or pre-warm. |

## 4. P2 — owner decision, post-launch, or evidence only

| ID | Item | Note |
|---|---|---|
| G-14 | **R-C17 Email engine** needs the owner to set up Resend Inbound + an MX record + webhook secret + apply migration 0598; then a real end-to-end mail test. | Not in Sumeet's original spec (owner-initiated). Recommend: post-launch. |
| G-15 | **R-C16 CRR** (capture/recall/reuse) has no screen; closure covers capture and recall tests only. | Not a Sumeet UI requirement. Post-launch. |
| G-16 | **R-96 naming:** the screen is "Scope of Work (BOQ)", not a separate Scope of Work screen. | Owner/Sumeet to confirm this is acceptable. |
| G-17 | **R-C11:** ERP financial statements render as plain tables, no charts. | Explicitly excluded from the Sumeet closure; not a gap for him. |
| G-18 | **Evidence gaps, not product gaps:** R-17, R-21…R-24, R-52 were verified live but have no committed re-runnable test; R-A6/R-10 rest on weaker evidence. | Closed automatically by G-01. |
| G-19 | **R-63 premise contradicted by code** (no rupee fallback exists). | Record only; do not "fix". |
| G-20 | **Authorisation gap** previously flagged as a top item is closed (R75: `KNOWN_OPEN_GAPS = 0`). | Nothing to do under the low-security posture. |

## 5. Not gaps under the low-security posture

R-A1 (demo password rotated, done), R-A2, R-A3, R-A4 (tenant isolation, tested), R-A5 (owner accepted
the legal risk), R-A6, R-A7, R-B1, R-B2. Keep them as they are; no further hardening before launch.

## 6. Recommended order of work

1. **G-02** confirm today's fixes live (15 minutes, no code).
2. **G-03** restore test login, then **G-01** build the 111-row suite from the existing specs; every other
   gap then shows up as a red test instead of a surprise in the next audit.
3. **G-06, G-05, G-07** (small, certain).
4. **G-04, G-13** (reliability; needs a repro first).
5. **G-09, G-10, G-11, G-12, G-08** with Sumeet's confirmation where noted.
6. Freeze scope: everything new goes on a separate post-launch list.

## 7. What this analysis cannot tell you

- Whether each of the 111 screens looks and behaves right to a first-time user. Only G-01 answers that.
- The size of anything not in the register (login persistence and the Product field were only found
  because we looked outside it). Add a short "basics" checklist to the suite: login persists, no
  "Unauthorized / Couldn't load" on first paint, AED everywhere, no leftover concepts.
