# PROGRESS -- task-20260804-144006-ocid-020-group-f-real-business-certifica

SPEC: Real PM decision, OCID-020 (`UMR-20260802-165606-4413`). PR #895 merged, both known
end-user gaps re-verified as not reproduced. Concrete next step: check real status of
OCID-047 through OCID-052 (Group F Business Certification children of OCID-020), identify
the one with least real testing coverage, run one real browser test against live
projexa-ai.com for it, real screenshot + honest result. Discovery/testing only, no fixing.

## Completed
- [x] Registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` per protocol (this session, before real work).
- [x] Fetched `origin/main` fresh (local checkout was already in sync); reviewed real status of
      OCID-047 through OCID-052 via `ai-os/boss/ACTIVE-CLAIMS.yaml` and
      `ai-os/VERIDIAN_OCID_047_052_BUSINESS_CERTIFICATION_PLANNING_2026-08-03.md` on `origin/main`.
      All six have "complete" claims, but real evidence depth varies sharply:
      - OCID-047: 77 real API checks (55 rights + 18 responsibility/clearance + 4 broad-scope).
      - OCID-048: 7/7 real cross-tenant isolation checks + 1 real browser brand-DOM screenshot.
      - OCID-049: 4/4 tiers, ~97 real users via join-code redemption across 4 real orgs.
      - OCID-050: 345/345 real page-checks across 3 real data states (empty/sample/large).
      - OCID-051: 115+115 real nav checks + real PWA manifest/share-target/offline checks.
      - OCID-052: only 2 real chat messages + 1 real screenshot from its single completing pass;
        its own Item 5 was explicitly left "deferred (no active dialogue-script package confirmed
        for testing)" rather than executed. **Least real testing coverage of the six.**
- [x] Picked **OCID-052** (VERI Chat AI Escalation and Deterministic Software Execution
      Certification, `UMR-20260803-115620-29c6`) as the real next concrete test target.

## In progress
- [ ] Fresh, independent, live browser re-verification of OCID-052's own registered finding
      `GAP-VERI-CHAT-NO-VISIBLE-DETERMINISTIC-VS-AI-SIGNAL` (previously confirmed by only one
      prior pass) against live `projexa-ai.com`: new Admin-API-provisioned user, real login, real
      deterministic-trigger + AI-escalating messages, real screenshot, honest reproduction result.

## Remaining
- [ ] Report the real finding (OCID number, evidence, reproduction result) once the live test completes.

## Notes
- Ancillary, unrelated real observation made while probing the live site: `https://projexa-ai.com/`
  (root landing page) returns a consistent `HTTP 500` (same error `digest`, not transient) as of
  2026-08-04T14:5x Z, while `/login`, `/home`, `/dashboard`, `/api/me` all respond normally
  (307/401 as expected for unauthenticated requests). Not investigated further -- out of this
  task's scope (OCID-052, not the landing page), noted here only for visibility, not registered
  as a new gap without deeper confirmation.
