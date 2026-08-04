# PROGRESS -- task-20260804-062800-register-the-mandatory-governance-direct

SPEC: PM registration of a standing normalization-discipline rule (discover -> verify -> reuse ->
enhance -> standardize -> update UMR -> update UTR -> update canonical artifact -> implement),
parent OCID-20260802-017 (`UMR-20260802-165034-5747`, standing gatekeeper rule) and
OCID-20260802-015 (`UMR-20260802-164801-2ab9`, Master Execution Framework), related OCID-020
(`UMR-20260802-165606-4413`) and OCID-021 (`UMR-20260802-173631-ca85`). No new platform/DB/
framework/auth/execution/knowledge model. Also requested: one real cross-reference table for
OCID-015 through OCID-062, folded into the existing deliverables of OCID-053/OCID-057.

## Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml`, `ai-os/CONSTITUTION.yaml`, `ai-os/OS.yaml` per
      CLAUDE.md's read order. `git pull origin main` -- already up to date.
- [x] Verified the spec's citations independently rather than trusting the prompt text:
      - OCID-20260802-017 / `UMR-20260802-165034-5747` and OCID-20260802-015 /
        `UMR-20260802-164801-2ab9` are **real**, both already `CLOSED` per
        `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` lines 582-583.
      - **OCID-053 and OCID-057, and the UMR IDs the spec cites for them
        (`UMR-20260804-033853-2a17`, `UMR-20260804-035943-3c38`), do not exist anywhere in this
        repo under any format.** `git grep` across `ai-os/` for all four strings: zero hits. The
        real, currently-registered OCID chain tops out at **OCID-052**. This is the same class of
        finding this repo already has one documented precedent for (`CONSTITUTION.yaml` SEC-07,
        the "OCID-021 implementation lock" fictitious-label finding) -- not fabricating content for
        nonexistent OCIDs/UMRs; folding the real table into the real existing artifact that already
        serves this purpose instead.
- [x] Registered this session's claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` before further work.
      Committed+pushed on its own, per that file's own protocol (step 2: fast, before the real
      work PR).

## Remaining
- [ ] Gather real current parent/UMR/dependency/PR-merge status for OCID-015 through OCID-052
      (real ceiling; 053-062 do not exist) by extending the existing real artifacts
      (`ai-os/VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md`,
      `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`) rather than creating a new parallel document.
- [ ] Register the standing normalization-discipline rule as a new `ai-os/CONSTITUTION.yaml` entry
      (SEC-08 or next free ID), citing real parent/related UMRs.
- [ ] Open PR, push, let CI run (docs-only, no src/schema/CI changes).
