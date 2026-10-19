# PROJEXA go-live gap analysis — as on 19 October 2026 (updated after the live UI walk)

Basis: Sumeet's 111 requirements (`platform.sumeet_requirements`), a real-browser walk of the screens as the
E2E test CEO (`SUMEET_111_UI_AUDIT.md`, per-requirement table), and a live check on `projexa-ai.com` after
today's deploys. Product posture: **PROJEXA is a LOW-security product** (owner): security/legal rows are
kept as they are, no further hardening before launch.

## 0. What is now observed (not claimed)

| Verdict (111 rows) | Count | Meaning |
|---|---|---|
| WORKING | 60 | Observed in a real browser with input entered and the result re-read |
| PARTIAL | 33 | Part observed; the rest needs data, a second user, or a quieter machine |
| N-A | 12 | Security/legal/test/meta rows, not walked |
| BLOCKED | 3 | R-80, R-81, R-91: committed specs timed out on a cold dev server (environment, not a product verdict) |
| MISSING | 1 | R-C14 (site instruction has no create screen) |
| BLOCKED by owner | 1 | R-C17 (email engine) |
| NOT DRIVEN | 1 | R-C16 (backend capability, no screen) |

Live on production after today's deploys (observed): `www.projexa-ai.com` redirects to the bare domain;
New Project has **no Product field** and creating a project with a name only works and appears in the list;
`/projects/from-file` has no Product picker.

Limits: only the test CEO was driven (no finance / HR / site-engineer / client_viewer role checks); approvals
need a second user (self-approval is refused by design); the big Meridian project (3,400+ records) is slow.

## 1. Gaps that block or damage go-live (P0)

| ID | Gap | Evidence | Status |
|---|---|---|---|
| G-1 | **Dashboard shows 0% complete after a BOQ revision** (R-51). Earned value is matched by line id on the latest revision only, so progress logged earlier is lost. | Repro in audit defect 1: 60% logged → revise → dashboard "0% · AED 0.00 of AED 9,000" | Fix in progress (agent), PR to follow |
| G-2 | **A false "nothing was saved" message creates duplicates.** After a cold-server timeout the screen says nothing was saved, the server finishes the write, and Try again duplicates it (3 identical materials rows; BOQs too). No idempotency key. | R-C08 row, audit | Open |
| G-3 | **Disclaimer pages show literal placeholders** (`[INSERT CONTACT EMAIL]`, `[INSERT WEBSITE]`, `[INSERT DATE]`). | R-A5 evidence | Needs your real values |
| G-4 | **Test login is down in CI** (mint function returns 401), so the end-to-end specs cannot run as a safety net. | R-40 re-verification note | Needs your OK on the security setting |
| G-5 | **BOQ save and big-project screens are slow.** Project Status never finished and Exceptions needed two tries on the 3,400-record project; cold-start saves hit 10 s timeouts. | Audit defects 6, 6b; R-91 | Reproduce on production, then fix |

## 2. Real defects, fix before or soon after launch (P1)

| ID | Gap | Evidence |
|---|---|---|
| G-6 | **R-C14 site instruction has no create/upload screen**; only a read-only row on the BOQ page. API exists. | Audit row R-C14 (MISSING) |
| G-7 | **Import skips sub-task rows that have a Breakdown % but no Parent Item Code column** (R-72). It warns, but the row is clearly a sub-task. | Audit defect 5 |
| G-8 | **Billing milestones said "no approved BOQ" when the lookup failed** (R-95). | Fixed in projexa #458 (green, merging) |
| G-9 | **A failed Budget % save leaves the typed value showing** until reload (R-C09). Minor; toast is honest. | Audit defect 4 |
| G-10 | **Exception checks mostly never fire on demo data**: 13 of 28 detectors are wired and rendered but could not be triggered in the test org. A demo will show empty checks. | EXC-ITEM rows PARTIAL |
| G-11 | **Report export and share paths not proven**: MoM Export PDF/WhatsApp, public share page, designer-timesheet export loop (register note, unfixed). | R-C04, R-C15 |
| G-12 | **Design Studio timesheet entry** showed "project list unavailable" after a timeout; not driven. | R-C12 |
| G-13 | **Change order ↔ BOQ revision not linked** (two parallel change systems). | R-97/R-98 caveat |

## 3. Needs a second user, data, or a decision (P2 / owner)

- **R-95, R-97, R-94, R-100:** approve/invoice, milestone create, baseline confirm need a second test user and seeded data.
- **R-C17 email engine:** owner-only (Resend Inbound, MX for projexa-ai.com, webhook secret, migration 0598). Recommend after launch.
- **R-C16 CRR:** no screen; not a Sumeet UI requirement.
- **R-96:** the screen is "Scope of Work (BOQ)"; confirm with Sumeet this is acceptable.
- **R-80/R-81/R-91, R-82:** re-run on a quiet machine (cold-start timeouts, not a verdict).
- **Role checks:** cost visibility for client_viewer and "member refused" checks were not driven (authorisation covered the test CEO only).

## 4. Not gaps under the low-security posture

R-A1…A7, R-B1, R-B2 (rotated password, repo visibility, nanoid fix, legal risk accepted by the owner,
tenant isolation tested). No hardening before launch.

## 5. Order of work

1. G-1 (dashboard 0%) — in progress. 2. G-2 duplicates/false message. 3. G-3 and G-4 (waiting on you).
4. G-6 site-instruction screen, G-7 import, G-10 demo data so exceptions show. 5. G-5 performance on a
big project. 6. Re-run PARTIAL rows with a second test user and the other roles, then freeze scope.

---

## 8. Status after the fix day (20 October 2026)

Shipped and live (backend `bc22bfb0`, frontend `de64136e`): name-only New Project and file import (no Product);
www to bare-domain redirect; R-51 dashboard carries progress across a revision (seen live); materials
de-duplication and honest "may have been saved" wording; import treats dot-numbered Breakdown % rows as
sub-tasks (seen live); site-instruction list/create/view screens; Disclaimer removed (404 live); client_viewer
budget-overlay fields stripped from the API (seen live); demo project where all 28 exception checks flag
(seen live); test-login helper fixed (CI path untested).

Live count of the 111 (final re-check, partly hand-adjusted): WORKING 65, PARTIAL 29, N-A 12, BLOCKED (cold-start
timeouts) 3, BLOCKED by owner 1 (R-C17), NOT DRIVEN 1 (R-C16).

Still open: (1) site-instruction save takes over 10 s on a cold server so the form shows "may have been saved"
instead of landing on the item; (2) the BOQ page still shows the PROJECT (COST)/VARIANCE/Cost coverage headers
to client_viewer (confirm on a project with cost data); (3) BOQ and project create have no duplicate guard;
(4) slow responses over 10 s and a 1-4 minute first-load wait on a fresh browser; (5) rows not yet driven:
R-80, R-81, R-91, R-100, R-C03, R-C04, R-C12, R-62, R-94/R-95 invoice step; (6) R-C17 email engine (owner-only).
