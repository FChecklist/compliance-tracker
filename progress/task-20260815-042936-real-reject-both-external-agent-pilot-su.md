# PROGRESS -- task-20260815-042936-real-reject-both-external-agent-pilot-su

SPEC: real audit result on the first two external-agent pilots. ZAI-COMMS-01
(`UMR-20260806-104534-b29c`, `src/app/layout.tsx`) and DEEPSEEK-COMMS-02
(`UMR-20260806-104527-4f5f`, `src/app/sitemap.ts`) both real-reject with cited fabricated-diff
evidence; root-cause + fix prompt rendering (>=5 real surrounding lines); close both real points
via the normal internal path; quality gate; PR; `gtm_certification_categories` evidence; child UMR
closure.

## Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml` (Rule 11) before starting; registered this task's own
      claim (this repo, `src/app/sitemap.ts` + `src/app/layout.tsx`).
- [x] **Found this is a near-exact duplicate dispatch of `task-20260806-230706-real-reject-both-external-agent-pilot-su`**
      (same SPEC, same two UMRs), already closed and recorded in `ACTIVE-CLAIMS.yaml`
      `recently_completed:` -- independently re-verified every one of that session's findings live
      rather than trusting the record:
      - `umr_tasks` rows for both `UMR-20260806-104534-b29c` (ZAI-COMMS-01) and
        `UMR-20260806-104527-4f5f` (DEEPSEEK-COMMS-02) already `status=completed`, `metadata_json`
        citing real outcome/PR/commit/verification (queried live via `sqlite3` against
        `/opt/veridian/ai-os/memory/superboss-register.sqlite`, read-only mode).
      - PR #979 (`577b66f9`, branch `fix/layout-pwa-metadata-zai-comms-02-umr20260806104534-b29c`)
        and PR #978 (`04ab410d`, branch `fix/sitemap-canonical-domain-deepseek-comms-03-umr20260806104527-4f5f`)
        both real, `OPEN`, `mergeable=MERGEABLE`, `mergeStateStatus=BEHIND` (just stale vs `main`,
        not conflicting), each carrying a real `AUDIT: PASS` comment already. Diffs independently
        re-read via `git cat-file -p <sha>:<path>` (this sandbox's `git show -p`/`git diff <ref>
        <ref> -- <path>` both give bogus/truncated output here -- known, matches
        [[veridian-shell-large-output-truncation-bug]] / [[veridian-task-gateway-audit24-declined-e122-unmet-plus-git-diff-stat-bug]]):
        PR #978 changes `sitemap.ts` `BASE` from `https://veridian-ai-os.vercel.app` to
        `https://projexa-ai.com` exactly, 1 line. PR #979 adds `themeColor: "#1C2B3A"` (matches
        `src/app/manifest.ts`'s real `theme_color`), `icons: { icon: "/logo-mark.svg", apple:
        "/logo-mark.svg" }` (reuses the real existing asset -- confirmed present at
        `public/logo-mark.svg`, no invented file), and `appleWebApp: { capable: true }` to the
        `Metadata` object -- exactly the requested 3 gaps, nothing else touched.
      - PR #1007 (`docs: real audit of ZAI-COMMS-01/DEEPSEEK-COMMS-02 ... already fixed via
        PR #978/#979`) already documents the full audit -- root-cause debunk, decision not to
        implement the requested prompt-rendering change, `AUDIT: PASS` posted on both #978/#979,
        `gtm_certification_categories` checked (no real mapping exists, none fabricated), both
        child UMR rows' `metadata_json` enriched with reject evidence. This PR itself is currently
        `CONFLICTING`/`DIRTY` (stale vs `main`) and was never merged.
    - Read PR #1007's own diff (`gh pr diff 1007 --patch`) directly rather than trusting its title:
        confirms the above conclusions verbatim, including the exact reject-evidence text this
        SPEC also asks for ("Z.ai Code Scaffold"/"Z.ai Team"/`z-cdn.chatglm.cn`, DeepSeek's
        `git apply` failure) and the debunked root cause.
- [x] **Independently re-verified the root-cause debunk myself**, not re-trusted: read
      `render_external_agent_prompt()` directly at
      `/opt/veridian/scripts/superboss-register.py:9295` -- it already embeds each file's ENTIRE
      real current content per file (`--- BEGIN FILE: {path} ---\n{body}\n--- END FILE ---`, where
      `body = content`, the real file text, never a single line). Queried
      `external_agent_dispatch` directly: zero rows for either UMR id. Conclusion unchanged from
      the prior session: the SPEC's proposed root cause ("prompt only supplied the single target
      line") is FALSE for the one real prompt-rendering code path in this repo -- both pilots ran
      entirely outside the tracked dispatch pipeline, so there is nothing real to fix in
      `render_external_agent_prompt()`. Declining the requested >=5-line-context change again, for
      the same reason already recorded (would edit already-correct code).
- [x] **New finding this session** (branch-protection state changed since PR #1007's own
      2026-08-06 note about a self-approval deadlock -- re-verified live, not re-trusted stale):
      `gh api repos/FChecklist/compliance-tracker/branches/main/protection` now shows
      `required_approving_review_count: 0` on `main`. The
      [[veridian-branch-protection-self-approval-deadlock-active]] blocker that stopped the prior
      session from merging #978/#979 no longer applies.
- [x] **New finding this session**: `progress_completion_gate.py` (added 2026-08-14, postdates
      task-20260806-230706) rejects a task whose own SPEC names a code file as objective if that
      file is absent from the task's own branch diff, unless real cross-repo PR evidence exists
      with THIS task's own task_id in the referenced PR's branch name. Neither PR #978 nor #979
      carries this task's task_id, so citing them alone would not satisfy the gate -- applied the
      same already-twice-audited fix directly on this task's own branch instead (fresh read of
      current `origin/main` content, matching the SPEC's own explicit instruction to read fresh
      rather than reuse the fabricated diffs' content), rather than re-litigating already-settled
      evidence a third time.
- [x] Read `src/app/sitemap.ts` and `src/app/layout.tsx` fresh from current `origin/main`
      (`005da8d3c`) via the `Read` tool (not the external agents' fabricated diffs, not the old PR
      branches) -- confirmed both files are still in their original, unfixed state, matching what
      PR #978/#979 also started from.
- [x] Applied the real fix directly: `src/app/sitemap.ts` `BASE` ->
      `https://projexa-ai.com`; `src/app/layout.tsx` `metadata.themeColor` = `"#1C2B3A"`,
      `metadata.icons` = `{ icon: "/logo-mark.svg", apple: "/logo-mark.svg" }`,
      `metadata.appleWebApp` = `{ capable: true }`. `keywords`/`openGraph`/`twitter` blocks left
      untouched.

## Remaining
- [ ] Run real quality gate (lint/typecheck/build).
- [ ] Commit + push; open PR referencing both child UMRs and the real-reject evidence.
- [ ] Post structured `AUDIT: PASS` verdict (Rule 10 mandatory-audit-check gate applies to every
      PR into `main`, per [[veridian-audit-check-applies-to-all-prs-not-just-ai-team]]).
- [ ] Close PR #978, #979, #1007 as superseded by this task's own consolidated PR (avoid 3
      overlapping open PRs touching the same 2 files) -- comment citing this PR's number on each.
- [ ] Update both child UMR rows (`b29c`, `4f5f`) via `update_umr_task()` (never raw SQL) with this
      task's own PR number/commit + a pointer to this progress file.
- [ ] Re-check `gtm_certification_categories` (25 rows, none previously mapped per PR #1007's own
      audit) for a real category this maps to; do not fabricate a link if none exists.
- [ ] Merge once CI green.
