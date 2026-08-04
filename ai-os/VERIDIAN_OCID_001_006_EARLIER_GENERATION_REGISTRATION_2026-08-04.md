# OCID-001 through OCID-006 — Earlier-Generation Registration

Real UMR for this registration batch: **`UMR-20260804-162430-d156`**. Real correction UMR,
applied before this document was ever published: **`UMR-20260804-163645-e196`**. Real parent:
none of the six numbers below chain to OCID-012 or later — they predate the active OCID chain
entirely (see §3).

**Registration only.** No implementation, no discovery, no code, no repository action is
performed or authorized by this document.

## 1. Correction note (why this document reads the way it does)

An earlier real dispatch this session, `UMR-20260804-162430-d156`, directed this exact
registration but with an incorrect premise: that OCID-001 through OCID-006 had **no** real prior
UMR anywhere in the system, based on a fuzzy-text search against the `umr_tasks` store. That
premise was itself corrected by a follow-up real dispatch, `UMR-20260804-163645-e196`, before any
registration document was ever written or published under the original dispatch (independently
confirmed here: no branch, commit, or PR exists anywhere in this repo's real history for
OCID-001..006 prior to this one — the fuzzy-search-based claim was caught and corrected before it
ever reached a real artifact).

The corrected, real finding: an exact field match against `umr_tasks.umr_id` (not a fuzzy text
search, which does not match against that field at all — independently corroborated by the same
broken method also returning zero matches for OCID-020's own definitely-real UMR) shows all six
UMRs below exist as real, genuine, single rows in the real database.

This document is written directly with the corrected framing — there is no prior "superseded/never
real" version of this document to retract, since none was ever published.

## 2. Independent corroboration performed in this session

This session does not have direct query access to the real `umr_tasks` store referenced above (a
prior, separate finding this same session: the local `/opt/veridian/ai-os/umr_tasks.db` file
exists but contains zero tables, and no Postgres table matching `%umr%` exists in the live
production database this session has `DATABASE_URL` access to — that store lives somewhere this
session cannot directly reach). The PM's exact-field-match finding is therefore cited on the PM's
own authority, not independently re-run against the source database.

As a partial independent check, this repo's own real git history (`git log --all --grep`) and
`ai-os/boss/ACTIVE-CLAIMS.yaml` were searched for each of the six UMR strings. Three of six were
found cited as real, legitimate references in real commits/claims predating this session's own
OCID numbering convention:

- `UMR-20260802-034545-3388` — cited as a real "master directive" in `ACTIVE-CLAIMS.yaml`
  (`task-20260802-040131-parallel-job--collate-existing-module-en` entry) and appears in real
  commit history (`ec867f96`, `a0b03b5c`, `6eab8d3d`).
- `UMR-20260802-054239-4251` — cited as "Kernel reconciliation report verification," a real
  parent UMR in a real amendment entry (`task-20260802-171740-amendment--...`), and appears in
  real commit history (`162a9a71`, `7d278f77`, `115ac4d5`).
- `UMR-20260802-104058-25ba` — cited as "implementation matrix," a real parent UMR in the same
  amendment entry, and appears in real commit history (`162a9a71`, `7d278f77`, `c0df6f02`).

The other three (`UMR-20260802-040056-5319`, `UMR-20260802-105532-775a`,
`UMR-20260802-111028-67b9`) were not found cited by name anywhere in this repo's own history — this
does not contradict the PM's finding (a UMR is a platform-wide construct, not scoped to this one
repo, and this repo would only cite a UMR it happened to reference directly), it simply means this
session's own corroboration for those three is limited to the PM's cited exact-field-match result.

None of the three repo-corroborated citations explicitly use "OCID-001" through "OCID-006" naming
— consistent with, not contradicting, the real premise that these OCID numbers are a retroactive
label being applied now to six already-real, pre-existing UMRs that predate the OCID numbering
convention itself.

## 3. The six real, pre-existing UMRs

| OCID | Real UMR | Status |
|---|---|---|
| OCID-001 | `UMR-20260802-034545-3388` | Real, pre-existing, confirmed by exact `umr_id` field match. Independently corroborated in this repo's own history (§2). Superseded, non-active, historical only. |
| OCID-002 | `UMR-20260802-040056-5319` | Real, pre-existing, confirmed by exact `umr_id` field match (PM authority; not independently corroborated in this repo's own history). Superseded, non-active, historical only. |
| OCID-003 | `UMR-20260802-054239-4251` | Real, pre-existing, confirmed by exact `umr_id` field match. Independently corroborated in this repo's own history (§2). Superseded, non-active, historical only. |
| OCID-004 | `UMR-20260802-104058-25ba` | Real, pre-existing, confirmed by exact `umr_id` field match. Independently corroborated in this repo's own history (§2). Superseded, non-active, historical only. |
| OCID-005 | `UMR-20260802-105532-775a` | Real, pre-existing, confirmed by exact `umr_id` field match (PM authority; not independently corroborated in this repo's own history). Superseded, non-active, historical only. |
| OCID-006 | `UMR-20260802-111028-67b9` | Real, pre-existing, confirmed by exact `umr_id` field match (PM authority; not independently corroborated in this repo's own history). Superseded, non-active, historical only. |

## 4. Status and scope

All six are **real, not fabricated** — each corresponds to a genuine, single, pre-existing row in
the real UMR registry. They represent an earlier generation of this platform's work, superseded by
the current active chain. Per the Owner's separate, standing instruction: the real active OCID
chain for this platform begins at OCID-012 and continues through OCID-015 onward. OCID-001 through
OCID-006 require **no real implementation** under any of them, are **not** to have child tasks
opened, and **no further work is dispatched under any of these six numbers** by this document.
Retained here only for historical traceability.
