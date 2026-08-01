# PROGRESS -- task-20260801-173753-retry-ai-documentation-lifecycle-v2

SPEC: VERIDIAN Review Framework gap-closure, AI Documentation / Documentation Lifecycle (5 Medium findings).

## Completed
- [x] Read AGENTS.md/CONSTITUTION.yaml governance chain, checked ai-os/boss/ACTIVE-CLAIMS.yaml (no conflicting claim), registered this task's claim, committed+pushed (`8bd8695b`)
- [x] Verified real, current drift before writing code: `ai-os/system-tree/*.yaml` claimed 377 tables/106 enums/614 API routes/~130 pages/~65 components; actual (git ls-files + grep on schema.ts) is 443 tables/130 enums/991 API routes/163 pages/81 components -- API routes alone are 61% off. Confirms findings #1 (Automatic Documentation Generation) and #3 (Documentation Accuracy) are still live, not stale evaluation text.
- [x] **Findings #1 + #3** (Automatic Documentation Generation / Documentation Accuracy): added `scripts/check-doc-drift.mjs` + `ai-os/system-tree/doc-counts-baseline.yaml` (baseline reset to the real 2026-08-01 counts) -- a lightweight CI check (tolerance-band, not exact-match, since counts shift on nearly every PR in this repo) that fails the build when tables/enums/API-routes/pages/components drift >10% from the recorded baseline, flagging that `ai-os/system-tree/` needs a refresh. Wired as a new `Doc Drift Check` job in `.github/workflows/ci.yml` (same convention as the existing Doc Quarantine Banner / Doc Cross-Reference checks). Tested locally (both pass and induced-fail paths) using a scratch `js-yaml` install since `bun` isn't available in this sandbox -- CI itself uses `bun install --frozen-lockfile` per the existing job pattern, no repo changes needed for that.
- [x] Refreshed the stale count-level facts in `ai-os/system-tree/00-INDEX.md`, `11-compliance-tracker-api.yaml`, `12-compliance-tracker-database.yaml`, `13-compliance-tracker-ui.yaml` headers to the real current counts, with an honest note that per-domain content (which tables/rules/routes exist in each domain) was NOT re-synthesized this pass -- that's a separate, larger effort tracked via `SYSTEM-AUDIT-ROUND-3.md`'s cadence recommendation, not silently implied as done.
- [x] Also fixed a now-stale "honesty note" in `00-INDEX.md` that claimed `CLAUDE.md` still understated the schema as "9 tables, 6 enums" -- verified `CLAUDE.md` was already corrected (now says "hundreds of tables ... do not cite a specific count") and updated the note to reflect that as resolved, rather than repeating a claim that's no longer true.
- [x] **Finding #2** (Documentation Versioning): verified, no code change made, per the finding's own recommended approach ("current mechanism is adequate; no urgent enhancement needed"). Confirmed the binary current/archived mechanism the finding describes is real and still CI-enforced: `ai-os/registry/stale-doc-manifest.yaml` (133 lines, `moved`/`already_archived` groups) + `scripts/check-doc-quarantine-banner.mjs`, wired as the existing `Doc Quarantine Banner Check` CI job. This matches the finding's own gap description exactly (binary, not full version history) and its own recommendation not to build anything further.

## Blocked (known, documented workaround applied)
- [x] This session's `gh` token (account FChecklist) has scopes `gist, read:org, repo` but not `workflow` -- GitHub rejects any push that touches `.github/workflows/*.yml` from this token, even on a feature branch (`refusing to allow an OAuth App to create or update workflow ci.yml without workflow scope`). Verified via `gh auth status`, not assumed stale. Per prior-session precedent for this exact blocker: split the commit so everything except the `ci.yml` job addition pushes normally; the one new `doc-drift` CI job (9 lines, added after `doc-cross-references` in `.github/workflows/ci.yml`, exact diff below) needs a manual push/PR by whoever has `workflow` scope (or the owner). `scripts/check-doc-drift.mjs` + its baseline are fully pushed and runnable standalone (`node scripts/check-doc-drift.mjs`) in the meantime -- only the automatic CI wiring is blocked, not the check itself.
  ```diff
        - run: node scripts/check-doc-cross-references.mjs
  +  doc-drift:
  +    name: Doc Drift Check
  +    runs-on: ubuntu-latest
  +    steps:
  +      - uses: actions/checkout@v7
  +      - uses: oven-sh/setup-bun@v2
  +      - run: bun install --frozen-lockfile
  +      - run: node scripts/check-doc-drift.mjs
    e2e:
  ```
  (Full version with explanatory comment is in this session's local working tree diff of `.github/workflows/ci.yml`, not committed to any pushed branch.)

## Remaining
- [ ] **Finding #4** (Documentation Completeness) + **Finding #5** (Documentation Synchronization with Code): Round 3 pass on `ai-os/system-tree/50-merged-tree.yaml` -- fill `guardrails` for a judged subset of the 48/94 (51%) still-empty domains, prioritizing highest-risk (ERP/DB-15, Compliance core/DB-02, Access review+ingestion/DB-05, Legal/DB-07, e-signature/DB-14, Compliance core pages/UI-02, Admin pages/UI-07, Finance/ERP pages/UI-08), following the Round 1/Round 2 pattern (real code-grounded content, honest about what's still open). Write `SYSTEM-AUDIT-ROUND-3.md` documenting the pass, and include a defined-cadence recommendation for periodic spot-check audits (finding #5's own recommended approach) as the practical complement to the new structural CI check.
- [ ] Commit + push the Round 3 work
- [ ] Open PR covering all 5 findings, confirm CI passes (do not merge/self-audit per Rule 6/7(c))
