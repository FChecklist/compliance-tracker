# PROGRESS -- task-20260806-230706-real-reject-both-external-agent-pilot-su

## Completed
- [x] Registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` before starting real work (Rule 11).
- [x] Verified the SPEC's real-reject evidence against live state (not just re-trusted):
  - ZAI-COMMS-01 (UMR-20260806-104534-b29c, target `src/app/layout.tsx`): fabricated diff
    referencing "Z.ai Code Scaffold"/"Z.ai Team"/a `z-cdn.chatglm.cn` icon URL, none of which
    exist in the real file. Real reject.
  - DEEPSEEK-COMMS-02 (UMR-20260806-104527-4f5f, target `src/app/sitemap.ts`): correct target
    line, invented surrounding imports, confirmed by a real failing `git apply`. Real reject.
- [x] **Found the exact fixes already exist, done, unmerged**: `git log --all` surfaced
  commit 577b66f9 (`fix/layout-pwa-metadata-zai-comms-02-umr20260806104534-b29c`, PR #979
  OPEN) and commit 04ab410d (`fix/sitemap-canonical-domain-deepseek-comms-03-umr20260806104527-4f5f`,
  PR #978 OPEN) -- the real ZAI-COMMS-02/DEEPSEEK-COMMS-03 retries. Independently re-diffed
  both against their own real merge-base with main (not trusted from commit message):
  - `src/app/sitemap.ts`: `BASE` -> `https://projexa-ai.com` exactly, one line, nothing else.
  - `src/app/layout.tsx`: `icons.apple` (reuses existing `/logo-mark.svg`), `themeColor`
    (`"#1C2B3A"`, matches `src/app/manifest.ts`'s real `theme_color`), `appleWebApp: { capable: true }`
    added; `keywords`/`openGraph`/`twitter` confirmed untouched.
  Both match the SPEC's requested fixes byte-for-byte. No code change made in this task --
  redoing it would duplicate real, already-correct work.
- [x] **Debunked the SPEC's proposed root cause** (independently re-verified, not re-trusted
  from a prior session's note already on UMR 4f5f): read `render_external_agent_prompt()`
  (superboss-register.py:6733) directly -- it already embeds each file's **entire** real
  content, not a single line. `external_agent_dispatch` table has **zero rows total** --
  neither COMMS pilot went through this tracked pipeline at all. The SPEC's "prompt only
  supplied the single target line" explanation is false for the one real prompt-rendering
  code path in this repo; the actual fabrication is unattributed to any fixable code here.
  **Declined to implement** the requested "≥5 lines of context" prompt-rendering change --
  it would edit already-correct, unrelated code.
- [x] Independently audited both open PRs as the mandatory auditor (did not implement either
  fix): posted structured `AUDIT: PASS` verdicts (8-field format per `audit-protocol.ts`) --
  [PR #978 comment](https://github.com/FChecklist/compliance-tracker/pull/978#issuecomment-5209838394),
  [PR #979 comment](https://github.com/FChecklist/compliance-tracker/pull/979#issuecomment-5209839539).
  This unblocks each PR's `audit-check` CI gate (was FAILING on missing verdict).
- [x] **Did NOT merge either PR.** Both are explicitly `never_auto_merge: true` /
  "Needs human review before merge" in their own dispatch code and PR body -- a guardrail
  specific to external-agent-sourced code that Rule 9 protects even under the Owner's
  2026-07-31 full-autonomy directive. Both also show `reviewDecision: REVIEW_REQUIRED` with
  zero reviews -- the known, still-active branch-protection self-approval deadlock (only one
  real GitHub identity exists to approve). Left open, blocked, for real human review.
- [x] Checked all 25 `gtm_certification_categories` rows for a real mapping for CB-09/MP-12-14:
  **none exists honestly.** Category 24 (lighthouse audit)'s own live production run already
  scored `seo=1`/`best-practices=1` (these two findings never surfaced there), and every other
  row already carries its own distinct, already-verified, unrelated finding (e.g. category 23
  UX audit already links PR #987 to different files). Did not fabricate a link via
  `update_gtm_certification_category()`.
- [x] Updated both child UMR rows (`UMR-20260806-104534-b29c`, `UMR-20260806-104527-4f5f`) via
  the canonical `update_umr_task()` function (never raw SQL) with: the exact real-reject
  evidence quoted above, the independent root-cause re-verification, the audit-verdict record,
  and the gtm-mapping finding -- all additive, merged into existing `metadata_json` (nothing
  overwritten).

## Remaining
- [ ] Both PR #978 and PR #979 still need a real human reviewer to approve + merge (branch
  protection self-approval deadlock -- out of scope for this session to resolve, same as every
  other PR currently stuck on it).
- [ ] The real root cause of how ZAI-COMMS-01/DEEPSEEK-COMMS-02 were actually dispatched
  (clearly outside `get_next_external_agent_task`/`submit_external_agent_result`, since
  `external_agent_dispatch` has zero rows) remains genuinely unattributed -- flagging for the
  Owner rather than guessing.
