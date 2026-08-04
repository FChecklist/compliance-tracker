# PROGRESS -- task-20260804-031540-pm-decision--resolve-credit-accountant-b

Cites: `UMR-20260802-165606-4413` (OCID-020), `UMR-20260802-173631-ca85` (OCID-021), standing auto
proceed authorization. PM decision resolving the credit-accountant block on
`task-20260803-214944-pm-final-decision--ocid-020-independentl`.

## Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml`, the blocked task's `worker.log`/`task.yaml`/
      `quality-gate-0.json`, and `/opt/veridian/scripts/quality-gate.sh` directly. Confirmed the
      credit accountant's `system_index` match: `quality-gate.sh` already has a pre-vetted, opt-in
      `BUILD_MAX_OLD_SPACE_MB` heap-ceiling override (default 2048MB) plus a host-wide `flock` build
      serializer (`BUILD_LOCK_WAIT_SECONDS`, default 700s) -- exactly the existing mechanism the
      2026-08-01 comment in that script documents as validated via a real manual build needing ~8GB.
      The blocked task's own last gate failure (`quality-gate-0.json`: `build` exit 124, "TIMED OUT
      after 1800s") is the same heap-thrash-class failure, not a code defect.
- [x] Pulled `origin/main`, found `GAP-PRODUCT-BRANCHES-LIVE-VS-DIRECT-READ-DISCREPANCY` was already
      independently root-caused and resolved by a concurrent session (PR #863, merged): real cause was
      migration `drizzle/0245_create_platform_schema_compartment.sql` moving `product_branches` (and
      21 other tables) from `compliance` to a new `platform` schema -- direct `psql`/PostgREST reads
      queried the stale pre-migration `compliance.product_branches` location, a methodology error, not
      a live-app bug. Stopped a duplicate investigation agent immediately on discovering this to avoid
      wasted spend.

- [x] **Confirmed the fix, real evidence.** Manual, cgroup-unconstrained verification build
      (`systemd-run --user --scope` w/ unlimited memory, `BUILD_MAX_OLD_SPACE_MB=8192`, real
      `flock`-serialized against `/tmp/veridian-quality-gate-build.lock`) against the blocked task's
      own workspace (`task-20260803-214944-pm-final-decision--ocid-020-independentl`, branch
      `chore/active-claims-close-ocid021-item2`): first queued behind a real concurrent build already
      holding the lock (the "duplicate worker" contention case), then ran and passed clean --
      `exit=0`, `elapsed=124s`. No code fix needed; the credit accountant was correct that an existing
      mechanism covers this, and it does.
- [x] Registered this session's claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` before further work.

- [x] **Checked for concurrent duplicate work before resuming task-20260803-214944 myself** (per
      `ACTIVE-CLAIMS.yaml`'s own protocol): its `task.yaml` already shows a fresh checkpoint
      (`2026-08-04T03:24:45Z`, ~minutes old, status flipped back to `in_progress`) from a DIFFERENT,
      independent PM decision (`UMR-20260804-030715-b004` -- not this task's own UMRs) that reached the
      IDENTICAL conclusion (`BUILD_MAX_OLD_SPACE_MB=8192`, confirmed via 2 clean local re-runs) and is
      now proceeding to the same "live end-to-end confirmation of PR #852 against the real deployed
      site" step this task's own spec also asks for. No live systemd unit or process for that task_id
      is currently running (`systemctl --user status` shows `inactive (dead)`; `ps` has zero matches
      for `214944`) -- likely an interactive Super Boss/Claude Desktop session working outside the
      systemd-worker lifecycle, not yet re-invoked for its next turn. Per `ACTIVE-CLAIMS.yaml` protocol
      (a claim under ~4h old is binding, not treated as abandoned): NOT duplicating that live E2E
      confirmation work myself. Recording this here rather than silently reworking it.

## Remaining
- [ ] GAP-OCID-049-SUBSCRIPTION-PLAN-ENTITLEMENT Tasks A/B/C/E (Task D explicitly held for PM/Owner).

---

# PROGRESS -- docs/gap-product-branches-schema-rootcause

Cites: `UMR-20260802-173631-ca85` (OCID-021), `UMR-20260804-030715-b004` (PM decision: find and fix
the real root cause of `GAP-PRODUCT-BRANCHES-LIVE-VS-DIRECT-READ-DISCREPANCY` with real evidence).

## Completed
- [x] **Root cause found and confirmed, real evidence.** `productBranches` and `aiRoutingAuditLog`
      are both defined in `src/lib/db/schema.ts` via `platformSchemaDB.table(...)` --
      `platformSchemaDB = pgSchema('platform')`. Found the real migration that put them there:
      `drizzle/0245_create_platform_schema_compartment.sql` (2026-07-19, Owner directive), which
      literally moved 22 tables from `compliance` to a new `platform` schema via
      `ALTER TABLE ... SET SCHEMA platform`. Every direct psql/PostgREST read this session (both
      occurrences of the tracked gap) queried the pre-migration `compliance` schema location -- a
      real, reproducible methodology error, not a live-app bug.
- [x] Live-reconfirmed with correctly schema-qualified queries: `platform.product_branches` has
      **27 real rows** (including `erp` and `projexa`); `platform.ai_routing_audit_log` has **3 real
      rows** matching known real OCID-049 testing activity timestamps. Both fully explain the
      previously "contradictory" live app behavior (real 403 for erp, real Mother Router audit
      writes) -- the live app was always correct.
- [x] Found and flagged a real, separate, minor finding: `compliance.product_branches` still exists
      as a genuinely separate, orphaned table (1 row, `branch_key='grc'`) -- confirmed via grep that
      no real code references it. Not deleted unilaterally (live data); flagged in
      `ai-os/MASTER-TRACKER.yaml` for whoever next does DB hygiene work.
- [x] Corrected a directly-related false claim already merged into
      `ai-os/VERIDIAN_OCID_038_UNIFIED_PLATFORM_INTEGRATION_DISCOVERY_2026-08-03.md` §9.1 (this
      session's own earlier work, PR #859): the "no PROJEXA branch exists" sub-finding was the exact
      same wrong-schema mistake -- corrected to confirm the real `projexa` branch row does exist in
      `platform.product_branches`, matching the affected org's `primaryProductBranchId` exactly.
- [x] Marked `GAP-PRODUCT-BRANCHES-LIVE-VS-DIRECT-READ-DISCREPANCY` `resolved` in
      `ai-os/MASTER-TRACKER.yaml` with the full evidence chain. No source code change needed --
      `getBranchId()`, `isBranchEnabledForOrg()`, `logRoutingDecision()`, and every other real call
      site already correctly resolve the `platform` schema via Drizzle; nothing was ever broken.

## Remaining
- [ ] The orphaned `compliance.product_branches` row cleanup is a real but low-priority, separate
      DB-hygiene task, not blocking.

---

# PROGRESS -- chore/active-claims-cleanup-stale-projexa-schema-claim

Cites: `UMR-20260802-173631-ca85` (OCID-021), `UMR-20260803-042801-ec4b` (OCID-038),
`UMR-20260804-020819-3a5f` (PM authorization: real housekeeping, docs only).

## Completed

## Remaining
- [ ] Not started
