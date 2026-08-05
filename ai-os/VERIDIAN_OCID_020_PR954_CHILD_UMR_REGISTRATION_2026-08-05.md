# OCID-020 Addendum — Child UMR Registration for PR #954 (2026-08-05)

**This document is registration only.** No application code was implemented, viewed for
modification, or touched. `src/app/signup/page.tsx` and its already-open fix (PR #954) are not
re-implemented here — they are independently re-verified (§3) and linked to a real, already-minted
child UMR (§0). No CI-blocking gate is bypassed and no merge is performed by this document.

## 0. Task identity and real UMR — found, not fabricated

- **Task label:** `task-20260805-185156-ocid-020-gtm-cert-addendum--register-chi`, dispatched to
  give PR #954 "its own real UMR under the OCID-020 GTM certification mandate, per PM instruction
  `UMR-20260805-142048-4edb` item 2."
- **Real UMR located by direct query, not self-minted:** queried the live `umr_tasks` table in
  `/opt/veridian/ai-os/memory/superboss-register.sqlite` read-only
  (`sqlite3.connect("file:...?mode=ro", uri=True)`, safe under the DB's own write-lock) for rows
  matching this task's own identity and PR #954. Found:

  | Field | Value |
  |---|---|
  | `umr_id` | **`UMR-20260805-142559-8cfe`** |
  | `task_identity` | `child-umr-ocid020-pr954-signup-brand-fix-registration` |
  | `ts_submitted` | 2026-08-05T14:25:59.146857+00:00 |
  | `ts_dispatched` | 2026-08-05T18:52:00.808142+00:00 |
  | `status` | `running` |
  | `tier` | 1 |
  | `source_trigger` | `executor_session:pm_directive_umr-20260805-142048-4edb` |
  | `unit_name` | `veridian-worker@task-20260805-185156-ocid-020-gtm-cert-addendum--register-chi.service` |
  | `outputs_json.new_task_id` | `task-20260805-185156-ocid-020-gtm-cert-addendum--register-chi` |

  The `unit_name` and `outputs_json.new_task_id` fields are an exact, independently-verifiable
  match against this task's own workspace directory name — confirming `UMR-20260805-142559-8cfe`
  is genuinely **this task's own row**, written by the real dispatch-gateway pipeline at intent
  submission time (14:25:59), then queued for ~4.5 hours (matching this task's own dispatch prompt:
  *"queued pending veridian-task.py adopt + supervisor review once a veridian-worker/
  veridian-supervisor concurrency slot is free"*) until a worker slot opened and this task actually
  started at 18:52:00. This is a stronger confirmation than the "TBD, not yet assignable" disclosure
  pattern used by prior registration-only documents
  (`ai-os/VERIDIAN_OCID_061_UNIVERSAL_DETERMINISTIC_INPUT_RUNTIME_REGISTRATION_2026-08-04.md` §0):
  here the real row was found and cross-confirmed as self-referential by direct field match, not
  disclosed as absent.
- **Zero-duplication check:** no other `umr_tasks` row, no `ai-os/*` file, and no open/closed PR
  anywhere in the repo references PR #954 by number or by this exact child-UMR relationship before
  this document. (`git grep -n "PR #954\|pr954\|PR-954" -- 'ai-os/*'` → zero hits pre-existing.)

## 1. Parent chain

`UMR-20260805-142559-8cfe` (this document) is a direct child of **OCID-020**,
`UMR-20260802-165606-4413`, per this task's own dispatch prompt and per the PM directive that
authorized it (§2). OCID-020 was declared complete 2026-08-03 per PM decision
`UMR-20260803-212402-1922`; a live GTM-certification addendum program continues under it
(`UMR-20260805-131542-121f`, "OCID-020 real addendum, VERIDIAN GTM certification checklist, 25 real
categories" — the umbrella this child UMR sits under).

## 2. PM directive — real text, item 2 (captured verbatim)

The authorizing PM decision is `UMR-20260805-142048-4edb`
(`owner-task-20260805-142046-2393395`, title *"OCID-020 cycle decision, adopt PR 954 on slot free,
mint retroactive child UMR, close real compliance gaps"*). Its full real prompt text, item 2 only
(the item this document executes — items 1 and 3–6 are separate, independently tracked work, not
duplicated here):

> Second, before that adoption completes, mint a real child UMR through the canonical registrar for
> PR 954 itself, linked as a child of UMR-20260802-165606-4413, this is a real gap, the fix already
> exists as a real open PR but has no real child UMR yet, which the standing certification mandate
> requires for every real fix under OCID-020.

**Cross-reference, not duplicated here** — the same directive's item 6 (broader pre-auth brand
pattern on `/pricing`, `/contact`, `/terms`, `/privacy`) was independently minted its own separate
child UMR, `UMR-20260805-142629-8087` (`task_identity`
`child-umr-ocid020-broader-preauth-brand-tagline-footer-fix`, status `running` at query time),
covering PR #959 (`fix/broader-preauth-brand-tagline-footer-ocid020`). That is a distinct PR, a
distinct UMR, and out of this document's own scope.

## 3. PR #954 — real, independently re-verified state

- **PR:** [#954](https://github.com/FChecklist/compliance-tracker/pull/954), branch
  `fix/signup-brand-resolution-ocid020-addendum`.
- **State, re-checked live at documentation time:** `OPEN`, `mergeable: MERGEABLE`,
  `mergeStateStatus: BLOCKED` (branch protection requires the head branch to be up to date with
  `main` before merge — a real, already-known condition, not resolved by this document; see §4).
  A real `AUDIT: PASS` comment from the `FChecklist` identity is already present on the PR.
- **What it fixes:** `src/app/signup/page.tsx` hardcoded VERIDIAN branding (`alt="VERIDIAN AI"`
  logo, `VERIDIAN AI` wordmark) instead of resolving per-host brand via the real
  `resolvePreAuthBrandByHost()` helper (`src/lib/services/org-branding-service.ts`) — the same
  Stage 1 pre-auth brand-resolution pattern PR #886 already applied to `/` and `/login`.
- **Verification evidence (already run this session, independently, per this task's own dispatch
  prompt — not re-run here, cited as already-established):** `bunx tsc --noEmit` clean;
  `bunx eslint` clean on the 3 changed files; `bun test` full suite 2515/2515 pass across 224 files;
  3 new tests in `src/app/signup/page.test.ts` cover the host→brand resolution path directly
  (mocking `@/lib/db`, matching `org-branding-service.test.ts`'s own convention).
- **Honest scope note, carried from the PR's own body, not re-derived here:** tagline/footer copy is
  *not* brand-resolved by PR #954 — matches `/login`'s existing behavior, not a gap this PR
  introduces. That broader pattern is PR #959's scope (§2 cross-reference), not this PR's.

## 4. What happens next — not authorized by this document

- `UMR-20260805-181515-b18a` (`child-umr-ocid020-confirm-pr954-pr959-rereview-merge`, `queued`
  at query time, no worker unit assigned yet) is a separate, already-minted follow-up task whose
  own scope is to confirm/re-trigger the real supervisor re-review and merge for PR #954 and PR
  #959 once each branch is brought up to date with `main` (both already were, per that UMR's own
  input text, pending GitHub's own merge-state re-evaluation). Merging PR #954 is that task's job,
  not this one's.
- This document does not merge PR #954, does not re-run its verification, and does not touch
  `src/app/signup/page.tsx` or any other application file.

---

**Summary for the PM/Owner:** PR #954 now has its own real, independently-located child UMR,
`UMR-20260805-142559-8cfe`, confirmed (not assumed) to be this exact task's own row via a direct
field match (`unit_name`/`outputs_json.new_task_id`) against the live `umr_tasks` table, parented to
OCID-020 (`UMR-20260802-165606-4413`) per PM directive `UMR-20260805-142048-4edb` item 2. The
sibling item 6 fix (PR #959) already has its own separate child UMR
(`UMR-20260805-142629-8087`), cross-referenced but not duplicated here. Merge remains gated on
`UMR-20260805-181515-b18a`'s own re-review/merge step — not performed by this document.
