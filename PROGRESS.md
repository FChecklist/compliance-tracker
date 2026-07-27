# PROGRESS -- task-20260726-063532-fix-pr562-defense-in-depth-integration-g

Fixing the genuine `AUDIT: FAIL` findings on PR #562 (branch
`worker/task-20260726-043023-phase4-defense-in-depth-prompt-security`), pushed
directly onto that same branch per the task's constraints.

## Prior-art review (the diligence step phase_4's own PROGRESS.md skipped)

Read in full before changing anything, per this task's SCOPE item 1:

- `src/lib/policy-enforcement-engine.ts` -- `enforcePolicy()` is the real,
  already production-wired pre-call gate (Wave 46, VERIDIAN_AI_CONSTITUTION.md
  Sec 18). `checkPromptInjection()` is a deterministic regex list for
  instruction-override/jailbreak/exfiltration phrasings -- narrower in
  category taxonomy than the new Layer 1 module, but it's the one every real
  LLM call site (`api/help/ask/route.ts`) already runs before this pass.
- `src/lib/pii-redaction.ts` -- `redactPii()` is the real, already
  production-wired PII scrubber used when logging to `orchestra_executions`.
  Covers GSTIN/PAN/IFSC/Aadhaar (India-specific, this platform's primary
  market) + email + Indian mobile + generic card-shaped digit runs. No US SSN
  pattern.
- `src/lib/ai-reply-gate.ts` -- `passesReplyGate()`/`detectFalseActionClaim()`
  is the software-first gate against a hallucinated "I've already done X"
  claim in the model's reply. Already wired into `api/help/ask/route.ts`.
  Orthogonal to Layers 1-4 (a distinct concern: false action claims, not
  injection/PII/safety) -- left untouched, still runs after Layer 4.

## Decision: reconcile, don't fully replace (SCOPE option (b))

Layer 1's threat-category taxonomy (role_play_jailbreak,
system_prompt_exfiltration, encoding_obfuscation, invisible_unicode,
delimiter_injection) and Layer 4's need for a typed, structured PII match list
are genuinely broader than what enforcePolicy()/redactPii() return on their
own (`PolicyDecision`/plain redacted string) -- a full replace would have
thrown away real, tested capability (red-team-battery.ts and quality-engine.ts
both depend on Layer 1's richer match/category shape). Full reuse (a) wasn't a
clean fit; silent duplication (the original PR's actual bug) wasn't
acceptable either. So: reconcile, explicitly, in code, not just in a comment:

- **Layer 1** (`layer1-input-sanitization.ts`): `classifyDeterministic()` now
  calls `checkPromptInjection()` from policy-enforcement-engine.ts as a floor
  check -- if the existing production gate would block something this
  module's own THREAT_PATTERNS missed, that's now added as an
  `instruction_override` match instead of the two lists silently diverging.
  Existing pattern list unchanged (still covers the categories
  checkPromptInjection() doesn't attempt).
- **Layer 4** (`layer4-output-filtering.ts`): `scrubPii()` now delegates
  directly to `pii-redaction.ts`'s `findPii()`/`redactPii()` (new: `findPii()`
  added there, refactored to share one code path with `redactPii()` so the two
  can never disagree) instead of maintaining its own divergent
  EMAIL/PHONE/CREDIT_CARD/SSN regex list. This closes the real regression the
  audit found (zero GSTIN/PAN/IFSC/Aadhaar coverage) and adds only the two
  categories pii-redaction.ts genuinely doesn't cover on top: US SSN, and
  US-format phone numbers (pii-redaction.ts's PHONE pattern is India-only).
  `PiiMatch`'s type union extended (types.ts) to include GSTIN/PAN/IFSC/
  AADHAAR. Redaction token format changed from `[REDACTED_X]` to
  `[REDACTED:X]` to match pii-redaction.ts's own convention -- tests updated.

## Layer 3 fail-open bug (SCOPE item 4)

`evaluateWithLlamaGuard()` (layer3-runtime-guardrails.ts) already documented
"throws rather than fails open" as its contract -- the real bug was that
`defense-in-depth.ts`'s orchestrator caught that throw and silently defaulted
the verdict to permissive `safe: true`/`null`, contradicting the module's own
docstring. Fixed: both the input-side and output-side Llama Guard calls now
fail CLOSED on a network/API error (`categories: ["LAYER3_UNAVAILABLE"]`,
`blocked: true`) with an explicit `console.error` log, instead of silently
proceeding as if the guard had cleared the content. As a side effect, an
actually-unsafe (not just unavailable) output-side verdict now blocks the
reply too -- previously computed but never acted on.

## Wiring (SCOPE item 3)

`src/app/api/help/ask/route.ts` -- the one real LLM call site in the repo --
now calls `runDefenseInDepth()` instead of `callLLM()` directly. Extended
`DefenseInDepthOptions` with optional `llmOptions`/`fallback` (forwarded to
the real `callLLM()`) and `DefenseInDepthResult` with `usage: LLMUsage | null`
so this migration doesn't lose the route's existing
`enablePromptCache`/`fallback`/cost-tracking behavior. `groqApiKey` is
`process.env.GROQ_API_KEY ?? null` (the platform's own Groq key -- Llama
Guard/Prompt Guard are always Groq-hosted regardless of which provider the
org's own model resolves to). A `blocked` result now logs
`status: "gated"` to `orchestra_executions` and returns the same
`FALLBACK_ANSWER` the reply-gate-failure path already used.

## Verification

- `grep -rn "prompt-security" src/app/api/help/ask/route.ts` -- 2 matches.
- `grep -rln "policy-enforcement-engine\|pii-redaction" src/lib/prompt-security/` -- 4 files.
- `bun test src/lib/prompt-security/` -- 42 pass, 0 fail.
- `bunx tsc --noEmit` -- 0 errors, whole repo.
- `bun test` (full suite) -- 2071 pass, 0 fail.

## Completed
- [x] Read enforcePolicy()/redactPii()/ai-reply-gate.ts prior art in full
- [x] Reconcile Layer 1 with checkPromptInjection() (cross-check, no drift)
- [x] Reconcile Layer 4 with pii-redaction.ts's findPii()/redactPii() (+ GSTIN/PAN/IFSC/Aadhaar coverage, no regression)
- [x] Fix Layer 3 silent fail-open -> fail-closed + explicit logging (input-side and output-side)
- [x] Wire runDefenseInDepth() into api/help/ask/route.ts (the real call site)
- [x] Update/add tests for the integration + corrected fail-closed behavior
- [x] Full test suite green, tsc clean

## Remaining
- [ ] None -- awaiting fresh audit pass per this task's CONSTRAINTS (not self-merging)
# PROGRESS -- task-20260726-171942-serverless-resource-limit-tradeoff-doc

## Completed
- [x] Read AGENTS.md/CLAUDE.md governance docs, confirmed still-open via GAP_ANALYSIS_2026-07-20_HOLD.md + MASTER-TRACKER.yaml + SUPERBOSS_IMPLEMENTATION_PLAN_2026-07-19_v2.md (V2-12/C3, CSV row #13)
- [x] Confirmed no collision: grepped ai-os/boss/ACTIVE-CLAIMS.yaml, `gh pr list --state open` -- no other claim/PR on serverless doc or route scope
- [x] Registered claim in ai-os/boss/ACTIVE-CLAIMS.yaml, committed + pushed (4255d591)
- [x] Confirmed repo is on Vercel Hobby plan (MASTER-TRACKER.yaml:1891 cron-limit note) + fetched current Vercel Functions limits (2026-07-01 docs snapshot)
- [x] Confirmed no `functions` block/`maxDuration`/`runtime` override anywhere in vercel.json or src/app/api today (dispatched Explore audit of heaviest routes: payroll, reports, bulk ops)

- [x] Manually read+verified payroll/reports/bulk-op/upload routes directly (processPayrollRun, bulkMarkAttendance, bulkReassignLeads, bulkUpdateSalesOrderStatus, financial reports, generic report engine, construction reports, payslip PDF)
- [x] Dispatched + incorporated a wider Explore-agent sweep (every awaited-DB-call-in-a-loop pattern across src/app/api + src/lib/services), independently re-verified its 2 most severe claims by direct file reads before trusting them (compliance/import has zero file-size cap; computeCostOverrunReport fans out budgetVsActual, ~7 queries each, across up to ~500 projects per this codebase's own scale comments)
- [x] Wrote ai-os/V2-12_SERVERLESS_RESOURCE_LIMITS.md (tradeoff doc + full audit table, 5 HIGH-severity N+1 routes found, revised upward from the initial 1-route finding once the wider sweep landed)
- [x] Registered the new doc in ai-os/OS.yaml's metadata index (required by scripts/check-metadata-index-coverage.mjs -- new top-level ai-os/ file)
- [x] Re-scored CSV row #13 in ai-os/SUPERBOSS_IMPLEMENTATION_PLAN_2026-07-19_v2.md (C3/V2-12 row, RE-SCORED CLOSED)

- [x] Committed doc + OS.yaml + plan re-score (ca1c7aa9), pushed
- [x] Opened PR #581: https://github.com/FChecklist/compliance-tracker/pull/581

- [x] CI dispatch anomaly resolved on its own -- GitHub Actions has now run on PR #581.
      All branch-protection **required** checks pass: Lint, Type Check, Build, audit-check,
      Guardrail Presence Check, Asset Registry Coverage Check, Unit Tests (confirmed via
      `gh api repos/.../branches/main/protection --jq '.required_status_checks.contexts'`).
      One non-required check, "Metadata Index Coverage Check", shows failing -- verified this
      is pre-existing on `main` itself (same check fails on `main`'s own head commit, over
      ~40 unrelated files under ai-os/scripts/* and ai-os/registry/*, none of which this PR
      touches; the new V2-12 doc is already correctly indexed in ai-os/OS.yaml). Left that
      pre-existing gap out of scope rather than a drive-by fix. Posted a PR comment explaining
      both findings: https://github.com/FChecklist/compliance-tracker/pull/581#issuecomment-5084984271

## Remaining
- [ ] Owner/reviewer sign-off, then merge (not done by this session per Rule 6)
- [ ] Move ACTIVE-CLAIMS.yaml entry to recently_completed once merged
# PROGRESS -- task-20260726-171950-preview-deployment-spot-check

## Completed
- [x] Re-verified live repo state: confirmed no verification note existed for V2-14/row #38
      anywhere in `ai-os/`, and no colliding entry in `ai-os/boss/ACTIVE-CLAIMS.yaml` for this
      objective before starting.
- [x] Registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` (committed/pushed separately, before
      the real work, per protocol).
- [x] Identified the current most-recent open PR via `gh pr list` (PR #571, not the 2026-07-20
      one the original prompt was scoped to -- that PR is 6 days/~70 PRs stale).
- [x] Resolved PR #571's actual Vercel preview URL for its HEAD commit via the GitHub
      Deployments API (not from a possibly-stale PR comment).
- [x] Live spot-checked the preview deployment: `vercel inspect` + Vercel REST API confirm
      `readyState: READY` / `target: preview` with a full ~2000+ route build; anonymous `curl`
      is blocked by Vercel team SSO Deployment Protection (expected security behavior, not an
      app defect) -- disclosed as an honest limitation rather than silently claiming full
      browser-level verification.
- [x] Wrote `ai-os/PREVIEW_DEPLOYMENT_SPOTCHECK_2026-07-26.md` recording the pass/fail result,
      method, and evidence.
- [x] Verified success criteria command locally:
      `gh pr list --repo FChecklist/compliance-tracker --state open --limit 1 --json number,url;
      find ai-os -iname "*preview*spot*check*"` -- returns PR #571 and the new note file.

## Remaining
- [ ] Open PR against `compliance-tracker` (this task's deliverable).
- [ ] (Optional, future work, not this task) Provision a Vercel "Protection Bypass for
      Automation" secret on `veridian-compliance-ai` if a future spot-check needs full
      browser-level page-render verification instead of deploy-health verification.


# PROGRESS -- worker/task-20260726-071400-migration-drift-audit-and-reconciliation (PR #563)

This file is stomped by whichever task last wrote to it on this branch; combined
below are all real narratives merged in rather than dropped, in the order they
landed.

## task-20260726-071400-migration-drift-audit-and-reconciliation (original task)

### Completed
- [x] Root-caused `drizzle/meta/_journal.json` frozen at migration 0000 since
      first commit; found + applied 12 genuinely-missing migrations live
      (0005/0037/0140/0165/0169/0199/0217/0218/0249/0251/0253/0255); rebuilt the
      journal with all 261 real migrations and populated
      `drizzle.__drizzle_migrations` with 261 correct rows.
      Full findings: `ai-os/MIGRATION_DRIFT_AUDIT_2026-07-26.yaml`.

### Remaining
- [x] Opened PR #563.

## task-20260726-081117-fix-pr563-ci---stale-migration-files--do (follow-up, same branch)

### Completed
- [x] Read ai-os/boss/ACTIVE-CLAIMS.yaml + AGENTS.md/CLAUDE.md governance docs.
- [x] Located PR #563 (`gh pr view 563`), branch
      `worker/task-20260726-071400-migration-drift-audit-and-reconciliation`,
      already checked out in another task's worktree -- worked via a local
      branch built on `FETCH_HEAD` of that remote branch instead, then pushed
      straight back to the same remote branch name (never touched the other
      worktree).
- [x] Registered `ai-os/MIGRATION_DRIFT_AUDIT_2026-07-26.yaml` in
      `ai-os/OS.yaml`'s `index.health_and_compliance` section. Verified locally
      (via a temp `js-yaml`/`argparse` node_modules symlink, since `bun` was
      not usable in this sandbox): without the entry the check reports 57
      missing items including this file; with it, 56, and this file is no
      longer in the missing list.
- [x] Read migration `0245_create_platform_schema_compartment.sql` to confirm
      the real relocation target (`ALTER TABLE compliance.dynamic_chains SET
      SCHEMA platform;`), then corrected:
      - `drizzle/0140_wave166_monitoring_tool_health.sql` line 39 ->
        `platform.dynamic_chains`
      - `drizzle/0199_gap_dcmd_rich_schema_slice.sql` (all 7 ALTER TABLE
        lines) -> `platform.dynamic_chains`
      - `drizzle/0253_tenant_ai_config.sql` line 27 `provider ai_provider` ->
        `provider compliance.ai_provider` (confirmed `compliance.ai_provider`
        is the real enum, defined in `drizzle/0004_ai_configurations_and_indexes.sql`)
      Verified via grep: `compliance.dynamic_chains` no longer appears in
      0140/0199; `platform.dynamic_chains` does.
- [x] Fixed PR #563's own `PROGRESS.md` stale `[ ] Open PR` line (PR is
      confirmed open) and documented the CI-fix work there.
- [x] Registered this follow-up task + closed it in
      `ai-os/boss/ACTIVE-CLAIMS.yaml`'s `recently_completed`.

### Remaining
- [ ] Flagged, not fixed (out of scope for this narrow follow-up): Metadata
      Index Coverage Check has a much larger pre-existing gap (56 unrelated
      `ai-os/` files never indexed), already failing on `main` HEAD before
      this PR -- needs real per-file research, not a guessed fix.

## task-20260726-102520-analyze-update--supabase-schema-migratio (later follow-up, PR #567)

### Completed
- [x] Resolved PR #563's then-current CONFLICTING/DIRTY merge conflict
      against main (PROGRESS.md narrative -- took main's more-current side;
      `ai-os/boss/ACTIVE-CLAIMS.yaml` `recently_completed:` list -- kept both
      real sides' entries) via a scratch worktree/branch pushed straight back
      to PR #563's own remote branch. Verified `gh pr view 563 --json
      mergeable` MERGEABLE at that time.
- [x] Re-verified live state matched PR #563's prior fix, no new drift:
      `drizzle.__drizzle_migrations` on compliance-tracker (pcrjmlpuqsbocqfwoxod)
      still 261 rows matching 261 real migration files; projexa
      (evpckeuxgvahguwsaeul) confirmed to still have no `drizzle` schema at
      all (out of scope).
- [x] Re-ran `ai-os/scripts/extract-db-schema-catalog.mjs` against current
      `schema.ts` and regenerated `ai-os/DATABASE_CATALOG.json`: 449 tables /
      124 enums, real growth from the 2026-07-20 baseline (444/124) -- 5
      tables added (crm_activities, crm_campaigns, crm_lost_reasons,
      ops_dev_tasks, tenant_ai_config), 0 removed, 0 enum changes. Opened PR
      #567 for the catalog regeneration.

### Remaining
- [x] Did not merge either PR (#563 or #567) per that task's own CONSTRAINTS.
- Note: the "now MERGEABLE" verification above did not hold going forward --
  subsequent merges to `main` (notably PR #568) touched the same
  `PROGRESS.md`/`ai-os/boss/ACTIVE-CLAIMS.yaml` files again and reintroduced
  the conflict. See the next section.

## task-20260726-115425-resolve-pr563-merge-conflict--supabase-m (follow-up, PR #563 branch)

### Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml` -- confirmed no other active claim
      overlaps PR #563's branch/file scope.
- [x] Confirmed PR #563 (`worker/task-20260726-071400-migration-drift-audit-and-reconciliation`)
      was CONFLICTING/DIRTY against `main`, reintroduced by PR #568 (a later,
      unrelated stale-PR-state correction) touching the same
      `PROGRESS.md`/`ai-os/boss/ACTIVE-CLAIMS.yaml` files after the prior
      session's "resolved -> MERGEABLE" claim (task-20260726-102520) had
      already stopped holding.
- [x] Merged `origin/main` into PR #563's existing branch, in its existing
      worktree (`/opt/veridian/ai-os/tasks/task-20260726-071400-.../workspace`)
      -- did not create a duplicate worktree, did not touch any other task's
      checkout.
- [x] Resolved both real conflicts:
      - `PROGRESS.md` -- combined every prior task's real narrative on this
        branch instead of dropping either side.
      - `ai-os/boss/ACTIVE-CLAIMS.yaml` -- union-merged both sides'
        `recently_completed` entries (same pattern used repeatedly on this
        file this session), plus added this task's own entry.
- [x] While validating the merged YAML (`python3 -c "import yaml;
      yaml.safe_load(...)"`), found the parse still failed on a
      **pre-existing bug already on `main`**, unrelated to this merge: 3 list
      entries (2026-07-19/07-21 claims) and 5 `scope_note:` keys were
      mis-indented by 2 spaces, going back as far as the 2026-07-20 V2-7
      entry. Fixed via whitespace-only re-indentation (verified via a Python
      script operating on exact line ranges, no content altered) -- file now
      parses (75 `active` + 65 `recently_completed` entries).
- [x] Verified live, read-only (no DDL/migration executed, per CONSTRAINTS):
      `SELECT COUNT(*) FROM drizzle.__drizzle_migrations` on compliance-tracker
      (project `pcrjmlpuqsbocqfwoxod`, via Supabase MCP `execute_sql`) still
      returns 261 rows, matching PR #563's original fix -- no drift.
- [x] Pushed the resolved merge commit (`d6ceb270`) directly to PR #563's
      existing branch. Did not open a new PR, did not merge PR #563.
- [x] Updated PR #563's body (via `gh api ... -X PATCH -F body=@...`, since
      `gh pr edit`/`gh pr view` both hit an unrelated GitHub GraphQL
      Projects-classic deprecation error / silent line-truncation
      respectively) with the conflict-resolution summary and the live
      verification result.
- [x] Confirmed `gh pr view 563 --json mergeable -q '.mergeable'` -> `MERGEABLE`.

### Remaining
- Note: this "resolved -> MERGEABLE" state did not hold going forward either --
  `main` advanced further (PR #568's merge, then PR #569's merge, the latter
  itself a `PROGRESS.md`-only record of this exact re-resolution) and
  reintroduced the same `PROGRESS.md` conflict again. See the next section.

## task-20260726-154338-resolve-pr563-conflict-properly--v2--exp (this task)

### Completed
- [x] Re-confirmed PR #563 was CONFLICTING/DIRTY again against current `main`
      (tip `7d8c6f28`, after PR #568 and PR #569 both merged).
- [x] Cloned PR #563's real branch directly (no local rename/alias) and
      merged current `origin/main` into it. Only `PROGRESS.md` conflicted this
      time (`ai-os/boss/ACTIVE-CLAIMS.yaml` auto-merged cleanly).
- [x] Resolved the conflict by combining every prior task's real narrative on
      this branch (rather than picking one side and dropping the other),
      appending this section for the current re-resolution.

### Remaining
- [ ] Push this merge commit directly to
      `worker/task-20260726-071400-migration-drift-audit-and-reconciliation`.
- [ ] Confirm `gh pr view 563 --json mergeable -q '.mergeable'` -> `MERGEABLE`.

## task-20260726-171129-tier2-fix--pr-563-migration-drift-ci-fai (this task)

Dispatched off task-20260726-071400's own `review.json` (AUDIT: REJECT),
which found 2 real, still-open defects after the 08:17 follow-up fix above.

### Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml`, registered this task's own claim.
- [x] Re-verified both disclosed defects: issue 1 (missing
      `ai-os/OS.yaml` index entry for `MIGRATION_DRIFT_AUDIT_2026-07-26.yaml`)
      and issue 2 (stale `compliance.dynamic_chains`/unqualified `ai_provider`
      in migrations 0140/0199/0253) were **already fixed** on this branch by
      the 08:17 follow-up commit (`9288746`, task-081117) -- confirmed via
      `git show` diff, not just the commit message.
- [x] Re-ran `gh pr checks 563`: `Metadata Index Coverage Check` and
      `audit-check` were still both FAILING despite that. Root-caused why:
      the check fails not because of either disclosed defect, but because of
      the **56-file pre-existing `ai-os/OS.yaml` index drift** that
      task-081117 had already found and explicitly deferred ("flagged for a
      follow-up task rather than bulk-registered with unresearched
      descriptions"). Confirmed this drift is real and pre-existing on `main`
      itself, independent of PR #563's diff, by running the exact same check
      script (`node scripts/check-metadata-index-coverage.mjs`, after
      installing a local `js-yaml@4.3.0` since `bun` is unavailable in this
      sandbox) against a clean `git worktree` of `origin/main` HEAD
      (`7d8c6f28`) -- identical 56-item failure list there too.
- [x] Since the task's SUCCESS_CRITERIA requires this named check to pass,
      and since leaving 56 real governance files/dirs permanently unindexed
      isn't a defensible steady state either, did the deferred research: read
      each of the 56 files' own header/docstring (all had one) and added a
      real, honestly-derived one-line `covers` entry for each to
      `ai-os/OS.yaml` (two new sections, `reference_docs_and_catalogs` for
      14 top-level docs/catalogs and `operational_scripts` for 39 scripts +
      1 directory under `ai-os/scripts/`, plus
      `ai-os/registry/terminology-guardrail-exemptions.yaml` into the
      existing `health_and_compliance` section) -- no fabricated
      descriptions, no bulk copy-paste of a single reason across unrelated
      files.
- [x] Verified locally: `node scripts/check-metadata-index-coverage.mjs` ->
      `Metadata Index Coverage Check passed -- all 101 governance items
      accounted for (102 indexed, 3 exempted).` Also verified
      `ai-os/OS.yaml` still parses (`python3 -c "import yaml; ..."`).
- [x] Did NOT touch `audit-check`: that gate requires an independent
      `AUDIT: PASS` PR comment per AGENTS.md Rule 7(c) (whoever did **not**
      implement a fix must be its auditor -- no self-certification) and Rule
      10's real CI enforcement of that norm. This session is the one that
      just made the fix, so it cannot also be the auditor without violating
      that explicit, CI-enforced rule -- this is analogous to, and left
      alone for the same reason as, the SPEC's own "issue 3" (live-DDL
      governance) carve-out. A separate agent/session (or the Owner) needs
      to review this diff and post a real structured `AUDIT: PASS` (or
      `FAIL`) comment before that check can legitimately go green.

### Remaining
- [ ] Independent audit of this fix + a resulting `AUDIT: PASS` PR comment
      from a different agent/session (not this one) -- required before
      `audit-check` can pass without violating Rule 7(c)'s no-self-
      certification norm.
- [ ] PR #563 merge itself -- explicitly out of scope for this task
      (CONSTRAINTS: "Do not merge the PR yourself").

## Note for future sessions
`gh pr view <n> --json body -q '.body'` and `gh show <ref>:<path>` for large
files were observed silently truncating output in this sandbox (per-line
~120-char cutoff with a literal `...`, and whole-file cutoffs respectively) --
use `gh api repos/<owner>/<repo>/pulls/<n> --jq '.body'` and
`git cat-file -p <blob-sha>` instead when the content matters. Likely the
`snip` shell-output filter (see `ai-os/boss/ACTIVE-CLAIMS.yaml`'s snip
integration entries) intercepting recognized "verbose" commands, not a
general/silent corruption of file writes made directly by tools (Write/Edit)
or by Python's own `open()/write()`.

Also note: a "resolved -> MERGEABLE" verification is only true at the moment
it's taken. Every merge to `main` that touches `PROGRESS.md` or
`ai-os/boss/ACTIVE-CLAIMS.yaml` reintroduces this conflict on PR #563's
long-lived branch. This has now recurred at least four times
(task-102520, task-115425, task-171129 (this task, before this section), and
now again via PR #572's merge to `main` while resolving this same conflict
yet again). Whoever actually merges PR #563 should do so promptly after the
next MERGEABLE confirmation rather than leaving it open indefinitely.

## task-20260726-171129-tier2-fix--pr-563-migration-drift-ci-fai (this task, continued -- re-resolving conflict reintroduced by PR #572)

### Completed
- [x] After pushing the 56-file `ai-os/OS.yaml` index backfill (commit
      `eafa1b63`) and closing this task's claim (commit `fa4ba6f9`), found
      PR #563's branch CONFLICTING again against `main`: PR #572 (an unrelated
      task, `task-20260726-171200-tier2-fix--pr-566-pr-83-...`) merged to
      `main` and touched this same `PROGRESS.md` file again.
- [x] Merged `origin/main` into this branch; only `PROGRESS.md` conflicted
      (`ai-os/boss/ACTIVE-CLAIMS.yaml` auto-merged cleanly this time).
      Resolved by keeping this branch's full narrative and appending
      PR #572's task section below (rather than dropping either side),
      matching the established pattern on this file.

### Remaining
- [x] Push this merge commit to
      `worker/task-20260726-071400-migration-drift-audit-and-reconciliation`
      (commit `5890fc78`).
- [x] Re-confirmed `gh pr view 563 --json mergeable -q '.mergeable'` ->
      `MERGEABLE`.
- [ ] CI re-triggered by this push (`gh pr checks 563`) was still `pending`
      across all jobs at push time -- not yet re-verified green. Next
      invocation should re-check `gh pr checks 563` once the run completes.
- [ ] Independent audit / `AUDIT: PASS` comment (per Rule 7(c)) and PR #563's
      own merge remain out of scope for this task, as noted above.

## task-20260726-171200-tier2-fix--pr-566-pr-83-stale-pr-81-stil

# PROGRESS -- task-20260726-171946-chat-context---terminology---mode-pill-a

V2-13-CHAT-CONTEXT-ANALYTICS -- Chat context + terminology + mode-pill analytics.
Claim registered in `ai-os/boss/ACTIVE-CLAIMS.yaml`.
