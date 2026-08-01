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

- [x] **Findings #4 + #5** (Documentation Completeness / Documentation Synchronization with Code): Round 3 pass on `ai-os/system-tree/50-merged-tree.yaml`. Two parallel Explore-agent research passes independently read the live code (not just the tree's existing text) for the 8 highest-risk still-empty-`guardrails` domains -- ERP (DB-15), Finance/ERP UI (UI-08), e-signature (DB-14), Legal (DB-07), Compliance core (DB-02), Access review/ingestion (DB-05), Compliance core UI (UI-02), Admin UI (UI-07) -- and reported back file:line-grounded findings. Applied all 8 as real `guardrails` content; empty-guardrails count dropped from 48/94 (51%) to 40/94 (43%). Along the way:
  - **Corrected a factual error** in `DB-07`'s `rules` text: the tree claimed AI-drafted legal opinions with human review; the actual code (`legal-opinion-service.ts`'s own header) is explicitly "NOT generative/AI authoring" -- a template token-substitution engine, and there is no finalization/review step in code at all. Fixed in place, correction left visible per this tree's existing honesty convention.
  - **Surfaced, did not fix** (out of scope, no `permission-service.ts`/`auth-guard.ts` changes made): `UI-07`'s `ApiKeySection`/`WebhookSection` call only `requireAuth()`, never `requireRole()` -- any authenticated org member including `viewer` rank can mint a write-scoped API key or register a webhook, with zero activity-log entry. Also flagged smaller gaps in `DB-02` (no sign-off on compliance-item/audit-point status changes), `DB-05` (ingest confirm/reject has no role gate), and `UI-02` (CAPA-finding "ownership" is a label, not an enforced gate) -- same honesty discipline as Round 2's `UI-10` finding (flag, don't silently fix an out-of-scope security issue).
  - Wrote `ai-os/system-tree/SYSTEM-AUDIT-ROUND-3.md` documenting the full pass, plus a **defined audit-cadence recommendation** for finding #5 (every ~90 days, matching AGENTS.md Rule 8's mandate window, or whenever `check-doc-drift.mjs` fires in CI -- ride a semantic spot-check along with the structural refresh it forces anyway).
  - Updated `00-INDEX.md` to reference Round 3 alongside Round 1/2 with the current 43% figure.
  - Mechanically re-verified after all edits: YAML parses cleanly, 94 unique domain ids, zero dangling cross-references.

## Remaining
- [ ] Open PR covering all 5 findings, confirm CI passes (do not merge/self-audit per Rule 6/7(c)); PR description must reproduce the ci.yml diff from the "Blocked" section above so whoever has `workflow` scope can apply it manually
