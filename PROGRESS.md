# PROGRESS -- docs/ocid063-mechanical-handoff-envelope-discovery
Cites: `UMR-20260804-060832-9fdf` (OCID-063 PM directive), real parent OCID-021
`UMR-20260802-173631-ca85` / OCID-020 `UMR-20260802-165606-4413`, governed by the
Mandatory Governance Directive `UMR-20260804-051521-7099` (OCID-017
`UMR-20260802-165034-5747`).
## Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml` before starting; registered this session's
      claim.
- [x] Real investigation, direct code reads (not narrated): `veridian-task.py`'s
      `cmd_checkpoint` (task.yaml schema), `ACTIVE-CLAIMS.yaml`'s real entry structure,
      `plan_generator.py`'s `check_reuse_before_dispatch()` docstring + `resource_governor.py`'s
      real usage of its result on `metadata_json.reuse_check_result`, `credit-accountant.py`'s
      real deterministic verdict print statements, `src/lib/audit-protocol.ts`'s
      `AuditProtocolFields` + `scripts/validate-audit-verdict.ts`.
- [x] Wrote the honest comparison doc:
      `ai-os/VERIDIAN_OCID_063_MECHANICAL_HANDOFF_ENVELOPE_DISCOVERY_2026-08-04.md`.
      Confirmed real gap: no existing mechanism is a mechanical per-tool-invocation call
      log with real status codes.
- [x] Registered the design proposal in `ai-os/MASTER-TRACKER.yaml`'s
      `needs_owner_decision` section (extend task.yaml's checkpoint schema and/or the
      existing `metadata_json` column, per the `reuse_check_result` precedent, rather than
      a new schema) -- discovery only, no code, held for a fresh PM decision.
- [x] Indexed the new doc in `ai-os/OS.yaml`.
## Remaining
- [ ] Open PR, confirm CI green, hand off for independent audit per Rule 7(c)/10.
- [ ] No implementation performed or proposed as code this cycle, per this OCID's own
      explicit discovery-only scope -- real implementation needs a fresh PM decision.
# PROGRESS -- task-20260803-071119-ocid-039-veridian-real-end-user-producti
Registers OCID-038, OCID-039, OCID-040 under `SEC-07`'s implementation lock
(`ai-os/CONSTITUTION.yaml`, gated on `UMR-20260802-165606-4413` / OCID-020,
... more files changed

---

# PROGRESS -- task-20260803-055110-ocid-032-veridian-universal-task-lifecyc

## Completed
- [x] Read AGENTS.md/CLAUDE.md governance chain, ACTIVE-CLAIMS.yaml protocol
- [x] Discovery: OCID-022..040 status snapshot, CONSTITUTION.yaml task_lifecycle/guardrail_protocols/audit_organization/resilience_and_monitoring, UNIVERSAL_TASK_WRAPPER_DESIGN.md, PR #768 (OCID-023) real state (open, unmerged, truncated doc)
- [x] Confirmed real numbering via superboss-register.sqlite umr_tasks: this task is real OCID-032 (Universal Task Lifecycle Runtime), parent UMR-20260803-041700-a741 is real OCID-031 (Universal Software Execution Engine) -- corrects the earlier OCID-040 snapshot doc's off-by-one table
- [x] Discovery agent: task engine internals (schema.ts real tables/enums, task-service.ts, task-execution-engine.ts, escalation-ladder.ts, approval-workflow-service.ts, monitor-protocol.ts + 6 real monitors, exception-taxonomy.ts, qa-precompletion-gate.ts, handover-protocol.ts, veri-todo-service.ts, ChainSelector.tsx, audit_logs)
- [x] Registered ACTIVE-CLAIMS.yaml entry

- [x] Wrote ai-os/VERIDIAN_UNIVERSAL_TASK_LIFECYCLE_RUNTIME_2026-08-03.md (36 sections, all grounded, gaps named honestly)
- [x] Updated ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md (amendment section)
- [x] Updated ai-os/OS.yaml (index entry)
- [x] Updated ai-os/MASTER_INDEX.yaml (registry entry) -- validated YAML parses (OS.yaml/MASTER_INDEX.yaml both OK; pre-existing unrelated YAML parse issue in ACTIVE-CLAIMS.yaml confirmed present on origin/main before this task touched it, not introduced here, out of scope)

- [x] Committed, pushed, opened PR #780: https://github.com/FChecklist/compliance-tracker/pull/780
- [x] Reported doc location + updated UMR + OCID-033 readiness confirmation to Owner

## Remaining
- [ ] None -- watch PR #780's CI, merge once green (no code changes, low risk)

---

# PROGRESS -- task-20260803-050504-ocid-029-veridian-universal-organization

## Completed
- [x] Read governance chain: ACTIVE-CLAIMS.yaml, CONSTITUTION.yaml (SEC-07), OS.yaml, VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md
- [x] Confirmed "OCID-021 implementation lock" is a fictitious label (per SEC-07); real gate is SEC-07/OCID-020, which locks implementation not documentation -- this task is documentation-only, unaffected
- [x] Confirmed no cluster overlap: no open PR / merged content yet for OCID-026/027/028/030/032/034/035/037 covering org/role/rights model
- [x] Registered claim in ai-os/boss/ACTIVE-CLAIMS.yaml, committed + pushed (dc9a75f3)
- [x] Discovery: organization/user/role/rights/approval/delegation/workflow tables in src/lib/db/schema.ts (via Explore agent, cross-checked)
- [x] Discovery: existing org-model docs (system-tree, audit-tree, priority18b_stage0_design.md, MASTER_INDEX.yaml, IMPLEMENTATION_MATRIX)
- [x] Wrote ai-os/VERIDIAN_UNIVERSAL_ORGANIZATION_RUNTIME_2026-08-03.md (v1.0)
- [x] Amended IMPLEMENTATION_MATRIX_2026-08-02.md, OS.yaml, MASTER_INDEX.yaml index entries for the new doc
- [x] Updated ACTIVE-CLAIMS.yaml entry to closed

- [x] Commit + push (1f163163), open PR (#773)
- [x] Report doc location + updated UMR chain

## Remaining
- [ ] None -- task complete, PR #773 awaiting CI


---

# PROGRESS -- docs/ocid039-active-claims-completion-correction

Real, small housekeeping correction: PR #789 (OCID-038/039/040 real discovery + live
end-user testing, `task-20260803-071119-ocid-039-veridian-real-end-user-producti`) was
independently confirmed genuinely merged into `origin/main`
(merge commit `4284570af7d5d7ff2a4e6f1c32676794d3001ff9`, confirmed a real ancestor of
`origin/main` via a fresh independent clone), after a real, final round-4 `AUDIT: PASS`
and auto-merge.

## Completed
- [x] Checked `ai-os/MASTER-TRACKER.yaml` for any stale "PR #789 open" reference needing
      correction (same class as the earlier PR #865 stale-text fix) -- confirmed zero real
      hits for "789" anywhere in that file; no correction needed there.
- [x] Found the real stale record instead in `ai-os/boss/ACTIVE-CLAIMS.yaml`'s `active:`
      section: this task's own entry was still labeled `[PUSHED, PR #789 OPEN]`, per this
      file's own documented protocol (item 3: "WHEN your work merges ... move your entry
      from `active:` to `recently_completed:`") this is now stale and out of date.
- [x] Moved the entry from `active:` to the top of `recently_completed:`, updating its
      session_label bracket text to `[DONE, PR #789 MERGED after 4 real merge-with-
      origin/main rounds -- merge commit 4284570af7d5d7ff2a4e6f1c32676794d3001ff9,
      independently confirmed a real ancestor of origin/main via fresh clone, 2026-08-04.
      Round 4 posted a real independent AUDIT: PASS and it auto-merged.]`, matching the
      exact correction pattern already used for the credit-accountant-b entry (PR #865)
      elsewhere in this same file.
- [x] Validated the edited YAML parses clean (`python3 -c "import yaml; yaml.safe_load(...)"`),
      confirmed `active:` entry count dropped by exactly 1 and `recently_completed:` grew by
      exactly 1, and confirmed no other content in the file changed
      (`git diff --stat ai-os/boss/ACTIVE-CLAIMS.yaml` shows only this one file touched).
- [x] Ran all 4 governance checks (`check-metadata-index-coverage.mjs`,
      `check-doc-cross-references.mjs`, `check-guardrail-presence.mjs`,
      `check-terminology-guardrail.mjs --diff-only`) -- all 4 pass.

## Remaining
- [ ] Open PR, confirm CI green, hand off for independent audit per this repo's own standing
      review process -- not self-certified here.

---

# PROGRESS -- fix/ocid038-stage1-preauth-domain-brand-resolution

Real gap closure: `GAP-OCID038-PROJEXA-DOMAIN-BRAND-MISMATCH`, per real Owner decision
delivered directly (`UMR-20260804-090421-c647`, parent OCID-038 `UMR-20260803-042801-ec4b` /
OCID-021 `UMR-20260802-173631-ca85`). PROJEXA is the first brand on the one VERIDIAN platform,
not a separate platform -- real Stage 1 (pre-authentication, domain-based) brand resolution,
Stage 2 (org-scoped, post-login, `resolveBranding()`) left completely unchanged.

**Real, disclosed finding, out of this task's own scope, flagged not silently absorbed:** this
branch's own base (`origin/main`, commit `8e90dc35`) already had a genuinely truncated
`PROGRESS.md` (113 lines total, a fabricated-looking `... more files changed` placeholder mid-
section) -- the same recurring truncation-bug class this session has fixed on individual feature
branches multiple times before, but this appears to be the first time it landed on `origin/main`
itself, uncaught, through a real prior merge. Not attempted to reconstruct/restore the lost
historical content here (no reliable source of the true original content from this task's own
working environment, and doing so speculatively would risk fabricating content) -- appending this
new section append-only, as normal, and reporting the finding honestly to the PM as a separate,
real governance-integrity issue.

## Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml` before starting; confirmed zero real collision on this
      file scope (`org-branding`/`projexa-domain`/OCID-038 search, zero hits).
- [x] Real discovery, direct code reads (not narrated): `org-branding-service.ts`'s
      `resolveBranding()` and all its real callers (`git grep`, confirmed `/api/me/route.ts` is
      the only production caller, post-login/org-scoped only); `src/proxy.ts` (real Next.js
      middleware, confirmed it matches nearly every route including pre-auth, but avoided using
      it for the real DB lookup since Next.js middleware commonly runs on the Edge runtime, which
      cannot reliably do a raw Postgres query -- confirmed no `export const runtime` override
      exists anywhere in this codebase's middleware); `src/app/login/page.tsx` /
      `login-form.tsx` (confirmed a SECOND real gap: 100% client-side, hardcoded "VERIDIAN AI",
      zero mechanism to receive/render server-resolved branding); `src/app/layout.tsx` (confirmed
      static `metadata` export, no dynamic title mechanism); `src/app/page.tsx` (confirmed this is
      real, deliberate VERIDIAN-research-lab-specific editorial marketing copy, not a generic
      brand shell -- reskinning it under the PROJEXA name would fabricate marketing content that
      doesn't exist anywhere in this repo).
- [x] Real live DB query (via `.env.local`'s real `DATABASE_URL`) against `platform.product_branches`:
      confirmed `domain` is an unrelated, pre-existing, free-text business-taxonomy column (real
      live values: "construction", "compliance", "project_management", etc.), NOT a DNS hostname
      -- cross-confirmed against `VERIDIAN_DMP_DCF_CONSTITUTION.md`'s own comment on this exact
      column. Confirmed the real, live-referenced PROJEXA brand row (10 real
      `organisations.primary_product_branch_id` rows point at it): `branch_key='projexa'`, id
      `5fceebcd-0a7a-4448-ae2b-a72637124f13`. Found a real, separate, unrelated naming collision
      (a second row, `branch_key='pms'`, also `displayName='PROJEXA'`, referenced by zero real
      orgs) -- not touched, out of this gap's own narrow scope, flagged for a future pass rather
      than guessed at. Confirmed no brand-level logo/tagline/icon data exists for the real PROJEXA
      row either -- honestly kept the default `/logo-mark.svg` rather than fabricate a brand asset
      that doesn't exist.
- [x] Real implementation, zero duplication, enhance not build-a-second-engine:
      `resolvePreAuthBrandByHost(host)` added to the EXISTING `org-branding-service.ts`;
      `drizzle/0312_stage1_preauth_brand_host_lookup.sql` adds one new nullable `host_domain`
      column to the EXISTING `product_branches` table (no new table, no parallel registry),
      seeded for the one real PROJEXA row above; `src/lib/db/schema.ts` updated to match.
      `src/app/login/page.tsx` converted to an async Server Component (the real mechanism to read
      the real HTTP Host header before any session exists) passing the resolved brand as a plain
      prop into the otherwise-unchanged `LoginForm`; `src/app/layout.tsx`'s static `metadata`
      export became a real `generateMetadata()` for a dynamic browser-tab title; `src/app/page.tsx`
      gets a real `redirect()` to `/login` for a resolved non-default-brand host (the honest
      choice given this page's own real marketing-copy content, per the finding above).
- [x] Real test: 5 new tests in `org-branding-service.test.ts` proving a request to
      "projexa-ai.com" resolves the real PROJEXA brand and the base VERIDIAN domain does not,
      plus host:port normalization, case-insensitivity, and null-host short-circuiting (never
      queries the DB for a missing host).
- [x] Real, disclosed byproduct fix: found all 13 PRE-EXISTING tests in this same test file
      were failing (`SyntaxError: Export named 'productBranches' not found` -- their
      `mock.module("@/lib/db", ...)` calls omitted `productBranches`, which the file's own
      top-level import statically requires) -- independently confirmed via `git stash` against
      the unmodified file BEFORE attributing this to my own change (it reproduced identically on
      the original, untouched file). Fixed all 13 (added the missing mock key) since I was
      already touching this exact file for my own new tests and leaving it broken would make any
      "tests pass" claim on this PR false regardless of my own additions' correctness. 18/18 now
      pass.
- [x] Verified: `bunx tsc --noEmit` clean (exit 0). `bunx eslint` clean on every touched file
      (zero output). Real, unconstrained `bun run build`
      (`BUILD_MAX_OLD_SPACE_MB=8192`, `systemd-run --user --scope` w/ unlimited memory,
      `flock`-serialized against `/tmp/veridian-quality-gate-build.lock`) -- clean, full route
      manifest rendered, and confirmed `/` and `/login` both correctly render as dynamic `ƒ`
      (not statically cached), since they now read the real Host header on every request.
- [x] Updated `ai-os/MASTER-TRACKER.yaml`'s `GAP-OCID038-PROJEXA-DOMAIN-BRAND-MISMATCH` entry:
      `status: resolved`, full real resolution narrative citing this branch's real commits.
- [x] Registered this session's claim in `ai-os/boss/ACTIVE-CLAIMS.yaml`.
- [x] Ran all 4 governance checks (`check-metadata-index-coverage.mjs`,
      `check-doc-cross-references.mjs`, `check-guardrail-presence.mjs`,
      `check-terminology-guardrail.mjs --diff-only`) plus `check-migration-collision.mjs`
      (confirms the new migration number doesn't collide with any other in-flight branch) --
      all pass.

## Remaining
- [ ] Open PR, confirm CI green, hand off for independent audit -- not self-certified here.
- [ ] Report the real, live `origin/main` PROGRESS.md truncation finding to the PM separately
      (not this task's own scope to fix).
- [ ] Real, disclosed, out-of-scope items for a future pass: the `pms`/`projexa` branch-key
      naming collision in `product_branches`; brand-level logo/tagline/icon data for PROJEXA
      (none exists today, only org-level); the base VERIDIAN root landing page still has no real
      generic (non-VERIDIAN-lab-specific) brand shell for any future second brand that might
      want to show its OWN marketing copy rather than redirect straight to `/login`.
