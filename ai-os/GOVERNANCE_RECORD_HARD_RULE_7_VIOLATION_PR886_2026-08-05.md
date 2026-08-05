# Governance Record: Hard Rule 7 (SEC-07) Violation, PR #886

**Real dispatch instruction:** `UMR-20260805-025349-a6b8`, "Owner decision, Owner directed, real and final, no retroactive override" (relayed to and executed by this Executor session via the standing live dispatch channel, citing `UMR-20260802-165606-4413`/OCID-020 and the original discovery `UMR-20260804-194323-0bc5`)
**Executed under:** the standing full-autonomy delegation (`AGENTS.md`, Owner directive of 2026-07-31: *"the server and claude code cli will keep working even if laptop is switched off... Full autonomy, no exceptions"*) — this record is a real Executor disposition carrying out that live instruction, not a self-issued or independently-invented decision-ID artifact. No new decision-ID naming convention (e.g. "OD-") is introduced by this record; none exists elsewhere in this repository's own history, and inventing one here would overstate this document's own formal pedigree.
**Related governance artifact:** `GAP-SEC07-OCID038-PREMATURE-IMPLEMENTATION-PR886` (`ai-os/MASTER-TRACKER.yaml`)
**Related standing rule (not altered by this record):** SEC-07 / "Hard Rule 7" (`ai-os/CONSTITUTION.yaml`)

This document is the permanent governance record of the real, final disposition of the SEC-07 violation on PR #886, as directed via `UMR-20260805-025349-a6b8`. It **does not alter, soften, or reinterpret** SEC-07's own lock text in `ai-os/CONSTITUTION.yaml` — that rule stands exactly as written. This record documents a decision made under it, not a change to it.

## Status block

| Axis | Status |
|---|---|
| **Technical status** | MERGED |
| **Governance status** | HISTORICAL RULE VIOLATION — CLOSED |
| **Operational status** | ACTIVE |
| **Audit status** | PERMANENT RECORD |

## What happened (real facts, independently verified)

- **SEC-07** (`ai-os/CONSTITUTION.yaml`) locks real implementation, gap closure, and production changes under OCID-038, OCID-039, and OCID-040 until `UMR-20260802-165606-4413` (OCID-020, the PROJEXA end-user certification sweep) is independently verified complete.
- Real dispatch `UMR-20260804-090421-c647` (submitted 2026-08-04T09:04:21Z) authorized real implementation work under OCID-038 — a new `resolvePreAuthBrandByHost()` function, a new `host_domain` column via drizzle migration `0312`, and changed pre-auth rendering logic. This merged as **PR #886** ("OCID-038 real gap closure: Stage 1 pre-authentication domain-based brand resolution"), merge commit `95f82ed83d6c5f42b853a74527fbea2bf2957758`, **mergedAt `2026-08-04T10:41:41Z`** (independently re-confirmed via `gh pr view` against the live repository).
- **OCID-020 was not independently verified complete at that merge time.** This session's own real history shows the OCID-020 fix documentation (PR #900) was still open as of 17:09 UTC the same day and only genuinely merged and live-reverified after that — nearly 7 hours after PR #886 merged.
- No explicit Owner override of SEC-07 was cited in the dispatch text, the merge commit message, or PR #886's own description — this is a genuine, real governance violation, not a documented exception (contrast with the later, correctly-handled override `UMR-20260804-172011-b839`, which explicitly invoked a one-time exception to this same standing lock).
- **The violation had a real, concrete consequence, not merely a process technicality:** PR #886's own migration `0312` was merged into the repository but never applied to the live production database. This undeployed migration is the confirmed root cause of a real production incident — `GAP-API-ME-500-SUBSCRIPTION-PLAN-STATUS`, a live `GET /api/me` `500` error affecting every authenticated user on `projexa-ai.com`. Implementing OCID-038 work before OCID-020 cleared caused the exact class of incident SEC-07's lock exists to prevent.

## The incident has since been resolved technically

`GAP-API-ME-500-SUBSCRIPTION-PLAN-STATUS` (`ai-os/MASTER-TRACKER.yaml`) is recorded `status: closed`, closed by `UMR-20260804-155457-a16d`: migration `0312` was independently re-confirmed purely additive, applied directly to the live production database, and the fix was independently re-verified live in two separate passes — most recently 4/10 and then 10/10 fresh, real, Admin-API-provisioned users confirmed a real `200` from `GET /api/me`, zero non-200 responses. This is a real, closed, technical resolution, separate from the governance question this record addresses.

## The real, final disposition (per `UMR-20260805-025349-a6b8`)

1. **The SEC-07 violation on PR #886 is acknowledged as a real governance violation** and is permanently recorded as part of this repository's audit history — not disputed, not minimized.
2. **PR #886 does not receive a retroactive authorization.** No exception was ever granted for it, and none is granted now, retroactively or otherwise.
3. **PR #886's real production fix stays merged.** Reverting a verified, real, live-confirmed production fix at this point would introduce unnecessary real operational risk, for no governance benefit — the violation is a fact of record regardless of whether the code is reverted, and reverting a working fix would only create a new, real incident to fix the wrong problem.
4. **The governance violation itself remains part of permanent audit history**, independent of the technical fix's own status. Closing the technical incident does not close, soften, or retroactively excuse the governance violation — these are two independent axes, reflected in the status block above.

## Standing future rule

**No implementation may bypass Hard Rule 7 (SEC-07) again.** SEC-07's own `gap` field already honestly discloses that no automated or runtime enforcement exists today — this is an organizational/process gate, not a technical one, and nothing currently stops a future dispatch from repeating this exact mistake.

Per this decision: **future violations of Hard Rule 7 must be blocked before merge, not only detected and recorded after the fact**, the way this one was. This record does not itself build that enforcement mechanism — implementing a real, dispatch-time or CI-time technical gate for SEC-07 (the same class of enforcement `SEC-06`'s `ddl_authorization_check.py` already provides for live production DDL) is real, separate follow-up work, not undertaken here. Until that enforcement exists, every dispatch under the OCID-038/039/040 chain must continue to explicitly self-report this lock and either confirm OCID-020 is independently verified complete or cite a real, explicit Owner override — exactly as `UMR-20260804-172011-b839` correctly did and `UMR-20260804-090421-c647` did not.

## Real citations

- SEC-07 lock text: `ai-os/CONSTITUTION.yaml`, rule id `SEC-07`
- Governance violation finding: `GAP-SEC07-OCID038-PREMATURE-IMPLEMENTATION-PR886`, `ai-os/MASTER-TRACKER.yaml`
- Technical incident and its closure: `GAP-API-ME-500-SUBSCRIPTION-PLAN-STATUS`, `ai-os/MASTER-TRACKER.yaml`, closed by `UMR-20260804-155457-a16d`
- PR #886: merge commit `95f82ed83d6c5f42b853a74527fbea2bf2957758`, mergedAt `2026-08-04T10:41:41Z`
- Real dispatch instruction directing this disposition: `UMR-20260805-025349-a6b8`, citing `UMR-20260804-194323-0bc5` and `UMR-20260802-165606-4413`
