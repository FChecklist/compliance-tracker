# PROGRESS -- task-20260803-180110-pm-decision-resolving-the-umr-and-utm-na

SPEC: PM decision citing `UMR-20260802-165606-4413` (OCID-020) and
`UMR-20260803-174634-5a2f` (the in-progress discovery task comparing the
Owner's proposed Universal Knowledge and Execution Architecture against the
live system). Owner resolved the UMR/UTM naming collision directly: UMR stays
unchanged; the new task-level concept is renamed from "Universal Task
Metadata"/UTM to **Universal Task Registry / UTR**, to avoid colliding with
the live `utm_source`/`utm_medium`/`utm_campaign`/`utm_content`/`utm_term`
columns on `instructions`/`work_items`/`actions`/`system_index`. Discovery and
analysis only -- no schema/code/DB change.

## Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml`, `ai-os/CONSTITUTION.yaml`, `ai-os/OS.yaml` before starting (Rule 11).
- [x] Confirmed `UMR-20260803-174634-5a2f` does not correspond to any task
      reachable in this session's own workspace/branches/ACTIVE-CLAIMS -- it
      is the dispatch UMR for a different task-dir entirely,
      `task-20260803-180428-adopted-umr-utr-euid-discovery-vs-live-system`
      (adopted, `pending_review`), whose real output is PR #835
      (`docs/umr-utr-euid-discovery-vs-live-system`,
      `ai-os/VERIDIAN_UMR_UTR_EUID_DISCOVERY_VS_LIVE_SYSTEM_2026-08-03.md`).
      Fetched and read that document in full from its real head SHA
      (`60403a39e9...`), not narrated.
- [x] Independent audit finding (this session, not trusted from PR #835's own
      claim): PR #835 §0 claims `grep -rli '\bUTR\b'` across
      `resource_governor.py`/`superboss-register.py`/`ai-os/` returned zero
      matches, calling UTR "genuinely clean, currently-unused." That check
      never covered this repo's own `src/` tree (the one place §3 of the
      same document *did* correctly check for the UTM collision). Ran
      `git grep -ni '\butr\b'` across `src/` myself: **two real hits**,
      `src/lib/db/schema.ts:541` and
      `src/lib/services/erp-bank-reconciliation-service.ts:56`, both the
      pre-existing Indian-banking "Unique Transaction Reference" convention
      -- unrelated to the new task-registry concept, but a real collision on
      the literal three-letter term the "zero matches" claim missed.
      Assessed as real but low-severity (a free-text financial
      reference-number value, not a naming/ID-prefix convention like `utm_*`
      was) -- does not change the Owner's UTR decision, but the "zero
      matches"/"genuinely clean" claim needed narrowing to what was actually
      checked, not silently repeated as-is.
- [x] Registered this session's claim in `ai-os/boss/ACTIVE-CLAIMS.yaml`
      before editing anything else.
- [x] Discovered PR #835 had already **merged** to `main`
      (`c294c70c`) by the time this session checked -- its own branch was
      gone (deleted post-merge). Also discovered a genuinely concurrent
      sibling session had, in the same minute, already pushed a follow-up
      amendment branch (`docs/amend-umr-utr-discovery-third-umr-usage-found`,
      commit `88a1d038`, crediting a real 3rd UMR usage from a duplicate PR
      #836) -- not yet opened as a PR at the time this session checked.
- [x] Pushed this session's own correction as a second commit
      (`d03b5b8f`) on top of that same amendment branch (continuing the
      one in-progress amendment lineage for this document rather than
      forking a competing branch/PR), narrowing §0's "UTR is unused" claim
      and naming the real `src/` hits honestly in a new `## 0a. Amendment`
      section.
- [x] By the time this session went to open a PR for that push, a sibling
      session had already opened it as PR #837 (same head SHA `d03b5b8f`,
      confirmed) -- did not fork a duplicate PR; posted an `AUDIT: PASS`
      review comment there instead (Rule 7c: the agent that did not write
      the original artifact is its mandatory auditor).

## Remaining
- [ ] None for this task's own scope. PR #837 itself still needs a
      human/PM merge decision -- not this task's call to make.
