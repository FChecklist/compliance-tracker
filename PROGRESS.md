# PROGRESS -- task-20260804-091305-pm-decision--owner-has-resolved-the-proj

SPEC: PM decision under OCID-038 (UMR-20260803-042801-ec4b) / OCID-021
(UMR-20260802-173631-ca85), resolving GAP-OCID038-PROJEXA-DOMAIN-BRAND-MISMATCH
per the Owner's direct decision: PROJEXA is the first brand on the one VERIDIAN
platform (one runtime/DB/UMR/UTR), never a separate platform. Enhance
org-branding-service.ts's resolveBranding with a new Stage 1 (pre-auth,
host-header-based) resolution layer; keep Stage 2 (post-auth, org-based)
exactly as-is.

## Discovery (honest findings before writing code)

- [x] Confirmed GAP-OCID038-PROJEXA-DOMAIN-BRAND-MISMATCH is real and open in
      `ai-os/MASTER-TRACKER.yaml` -- matches this task's own SPEC framing.
- [x] Read `src/lib/services/org-branding-service.ts` in full + all real callers
      (`api/me/route.ts`, `api/settings/branding/route.ts`, `api/settings/branding/logo/route.ts`).
      `resolveBranding(orgId)` is genuinely org-scoped/post-login only, exactly
      as the gap's discovery_brief says.
- [x] **Real additional gap found, as instructed to report honestly**: there is
      NO `middleware.ts` anywhere in this repo (`git ls-files` confirms zero
      matches for `middleware.(ts|js)`). There is no pre-auth request
      interception point today at all -- Stage 1 has nothing to attach to as
      literal Next.js Middleware.
      Resolution chosen: rather than introduce a brand-new, unverified
      Next.js-Middleware-with-Node-runtime surface (this repo has zero
      precedent for it, and Node-runtime Middleware is a newer/riskier Next.js
      surface not worth gambling a circuit-breaker retry on), Stage 1 is wired
      directly into the real pre-auth server components that already render
      before login (`src/app/layout.tsx`, `src/app/page.tsx`,
      `src/app/login/page.tsx`) via `await headers()` -- an established pattern
      already used in this exact codebase (`src/lib/supabase/auth-guard.ts`).
      This satisfies the real requirement ("resolve the real HTTP host header
      to a brand configuration and render the correct landing and login pages
      before any login happens") without inventing new infrastructure.
- [x] Confirmed the real reusable brand-configuration data: `organisations.customDomain`
      (unique, already validated, already part of `OrgBranding`) -- NOT
      `product_branches.domain`, which despite its name is a business-category
      label (`'compliance'`), not an HTTP hostname (confirmed via
      `drizzle/0017_wave20_module_registry_and_product_branches.sql`). Reusing
      the wrong column would have been a real, silent bug.
- [x] Confirmed zero real PROJEXA org has `customDomain` set to `projexa-ai.com`
      today (only 1 synthetic test-fixture org platform-wide has any
      `customDomain` at all, per the gap's own discovery_brief) -- this is a
      **data/config precondition**, not a code gap. Flagging as a genuine
      follow-up, not fabricating a production data assignment as part of this
      code change.

## Completed

- [x] `resolveBrandingByHost(host)` added to `org-branding-service.ts` -- reuses
      `resolveBranding()` itself, keys off `organisations.customDomain`, zero
      new table/registry.
- [x] Root `layout.tsx` brand-aware `generateMetadata()` (was static `metadata`)
      -- document `<title>`/favicon/OG/twitter card resolve per-host, default
      VERIDIAN metadata unchanged when no host match.
- [x] `page.tsx` (root landing) nav wordmark/logo + hero micro-label swap when
      a brand resolves; unchanged fallback otherwise.
- [x] `login/page.tsx` converted from a client to a server component reading
      `await headers()`; `login-form.tsx` accepts an optional `brand` prop
      (logo/name), default VERIDIAN branding when `undefined`.
- [x] Real tests added to `org-branding-service.test.ts` (5 new, `describe("resolveBrandingByHost...")`):
      a fixture org with `customDomain: "projexa-ai.com"` resolves
      `brandName: "PROJEXA"`; a host with no matching row (base VERIDIAN
      domain) resolves `null`; null/undefined/empty host short-circuits
      without a DB call; a host:port is normalized before lookup; a malformed
      host short-circuits without a DB call.
- [x] **Real pre-existing, unrelated bug found and fixed while making the test
      file runnable**: every one of the file's 13 original `mock.module("@/lib/db", ...)`
      calls omitted `productBranches` from the mocked module object, even
      though `org-branding-service.ts` has statically imported
      `{ db, organisations, productBranches }` since before this wave --
      confirmed via `git stash` that this failure (`SyntaxError: Export named
      'productBranches' not found`) reproduces identically on the file's
      original, unmodified content (0/13 pass), so it predates this task and
      isn't something introduced here. Fixed by adding `productBranches: {}`
      alongside each existing `organisations: {},` stub (mechanical,
      minimal -- Bun's ESM module-mock requires every statically-imported
      named binding to be present in the mock object). All 18 tests
      (13 original + 5 new) now pass.
- [x] `bunx tsc --noEmit` clean (`NODE_OPTIONS=--max-old-space-size=8192` --
      this repo's full `tsc` OOMs at the default Node heap size regardless of
      this change, a pre-existing environment constraint, not something this
      task introduced or needs to fix).
- [x] `bunx eslint` clean on every changed file.
- [x] Full `bun test` (matches CI's `unit-tests` job, `.github/workflows/ci.yml`
      line 53): 2490 pass, 0 fail, across 219 files -- no regressions anywhere
      else in the codebase.
- [ ] Commit + push (claim already pushed; real implementation commit next)
- [ ] PR opened, independent review/audit (not self-certified)
- [ ] Merge commit independently verified as ancestor of `origin/main`
- [ ] `ai-os/MASTER-TRACKER.yaml` updated to close the gap
- [ ] Report OCID-038 closure back to PM

## Known, honestly-disclosed follow-up (data precondition, not a code gap)

Zero real PROJEXA org has `organisations.customDomain` set to `projexa-ai.com`
today (confirmed via the gap's own discovery_brief -- only 1 synthetic
test-fixture org platform-wide has any `customDomain` set at all). This PR
ships the real, tested mechanism; making `https://projexa-ai.com` actually
render PROJEXA branding in production additionally requires an Owner/admin
data action -- setting `customDomain = 'projexa-ai.com'` on whichever real
PROJEXA org is the intended canonical identity for that anonymous-visitor
domain (a product decision about which of the 6+ real PROJEXA orgs, if any,
that domain represents -- not something this code change can or should
decide unilaterally). Flagging this explicitly rather than fabricating a
production data assignment as part of this PR.

## Remaining
- [ ] Commit + push the real implementation
- [ ] PR + independent review/audit + merge-ancestor verification
- [ ] MASTER-TRACKER.yaml gap closure + PM report

---

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
