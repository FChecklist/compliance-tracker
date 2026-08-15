# PROGRESS -- task-20260718-075002-architecture---design--engineering-princ

Task: VERIDIAN Review Framework gap-closure, "Architecture & Design /
Engineering Principles" category, 3 findings (2 Low + 1 Medium). Per
prompt.txt: close all in one coherent PR since they're the same evaluation
category; verify each gap against the current codebase before changing
anything (codebase has moved since the evaluation was written).

## Completed
- [x] Read governance docs (AGENTS.md, CLAUDE.md pointers) and
      ai-os/boss/ACTIVE-CLAIMS.yaml -- no other active entry touches
      src/lib/engines/, docs/adr/, or the ERP service-layer type shapes
      this task ended up consolidating. Registered this task's own claim.
- [x] Found root-level `PROGRESS.md` had been overwritten to a stub by a
      prior invocation of this task, destroying another task's
      (task-20260718-050114-cost-estimate) real checkpoint content.
      `git checkout -- PROGRESS.md` to restore it. Per this task's RESUME
      protocol, this task now maintains its own
      `progress/task-20260718-075002-architecture---design--engineering-princ.md`
      instead of the shared root PROGRESS.md (prompt.txt's own instruction
      to "maintain PROGRESS.md" is superseded by the more specific,
      more recent per-task-file RESUME protocol -- shared-file collisions
      between concurrent tasks are exactly what that protocol exists to
      prevent, and this task just witnessed a real instance of it).

- [x] **Finding 1 (Low) -- Systems-First Engineering Principle** ("not
      applied at every AI call site"). Audited every real chat-completion
      call site in `src/`: `git grep` for direct provider-fetch usage
      (api.groq.com / openrouter.ai / api.cerebras.ai / api.anthropic.com /
      api.openai.com) found exactly 5 files with real fetch calls --
      `src/lib/llm-client.ts` (the canonical wrapper), `src/lib/
      orchestra-model-resolver.ts` (imports and calls `callLLM` from
      llm-client.ts -- does not bypass it), `src/lib/embeddings.ts` and
      `src/lib/whisper-client.ts` (embeddings/audio-transcription -- a
      different call shape than chat completion, legitimately not routed
      through callLLM), and `src/lib/ai-team/roster.ts` (the "matches"
      there are just provider-URL citations inside comments, not real
      fetch calls). Cross-checked: 40 files call `callLLM`/`callLLMJson`/
      `callLLMVision`, zero files call a provider directly for a
      chat-completion-shaped request outside llm-client.ts itself.
      **Conclusion: this finding's stated gap does not hold up under
      inspection as of 2026-08-15 -- every real AI call site already
      routes through the one central system.** Documented this
      audit + its reasoning in `docs/adr/0001-centralized-ai-call-site.md`
      rather than making an unnecessary code change (per prompt.txt's own
      instruction for gaps that turn out to already be resolved).
- [x] **Finding 2 (Low) -- First-Principles Design Methodology**
      ("cannot be independently verified... only inferred from consistent
      patterns"). Created `docs/adr/` (did not exist before) with a
      README explaining the ADR practice itself, plus two real ADRs
      capturing actual decisions made in this repo with their
      first-principles rationale: 0001 (the centralized-AI-call-site
      pattern from finding 1) and 0002 (the actor-context consolidation
      from finding 3, below).
- [x] **Finding 3 (Medium) -- Elimination of Duplicate Functionality**
      ("duplicate detection narrow in scope; some naming suggests
      undetected duplication elsewhere"). Ran `bunx jscpd` scoped to
      `src/lib/engines/` + `src/lib/services/` (min-lines 10, min-tokens
      50): 258 files, 30 clones, 0.80% duplicated lines / 0.69%
      duplicated tokens overall -- low. Followed up by hand on jscpd's
      `erp-buying-service.ts` <-> other-erp-service.ts clone hits (which
      were boilerplate constructor/type clusters at the edge of jscpd's
      detection threshold) and found the real, larger cluster jscpd's
      line-based clustering under-counted: an identical "actor performing
      this mutation" type shape (`{ orgId, userId } & (dbUser-branch |
      apiKey-branch)`) was independently redefined in 22 separate files
      across src/lib/services/ -- 6 as `ActorCtx`, and 5 more under
      file-local names (`AccessReviewActorCtx`, `RecordPaymentActorCtx`,
      `SellingActorCtx`, `FraudActorCtx`, `GrcActorCtx`) that were exactly
      this same structure wearing a different label -- plus 18 files (7
      overlapping the ActorCtx set) independently redefining the related,
      narrower `ErpContext` shape. This differing-names-same-shape pattern
      is exactly what the finding's gap description flagged as the risk
      ("some naming suggests undetected duplication elsewhere").
      Consolidated into new `src/lib/services/actor-context.ts` exporting
      canonical `ActorCtx` and `ErpContext`; all 22 sites now import from
      there. The 5 differently-named exports are kept as one-line type
      aliases (`export type FraudActorCtx = ActorCtx`, etc.) so every
      existing external import of those names still resolves -- zero
      call-site signature changes needed anywhere else in the codebase.
      Did not touch `permission-service.ts` or its `ERP_ACTION_ROLES`
      table (out of scope per prompt.txt).
- [x] Verification: `bunx tsc --noEmit` clean (0 errors -- one real
      break caught and fixed: `erp-returns-service.ts` was importing
      `ErpContext` re-exported through `erp-inventory-service.ts`;
      repointed it straight at `./actor-context`). `bun run lint` --
      0 errors, 3 pre-existing/unrelated warnings. `bun test
      src/lib/services` -- 719 pass / 0 fail (the one visible
      `console.error` in the output is an intentionally-thrown error
      inside a passing negative-path test, not a real failure).

- [x] Merged origin/main into this branch (was 1326 commits behind).
      Resolved 8 real merge conflicts -- mostly import-line collisions
      where a concurrent session had added a new import to the same line
      range I touched. Along the way found one more real instance of the
      duplicate-type pattern surfaced by the merge diff itself:
      `fraud-case-service.ts`'s own `FraudContext` (dbUser-only, same
      shape as `ErpContext`, previously unexported-by-name anywhere else)
      -- aliased it to `ErpContext` too. Re-ran full verification
      post-merge: `bunx tsc --noEmit` clean, `bun run lint` 0 errors,
      `bun test src/lib/services` 1202 pass / 0 fail (grew from 719 --
      main added many new test files during the gap), and all 4
      governance checks (guardrail-presence, doc-quarantine-banner,
      metadata-index-coverage, doc-cross-reference) still pass.
- [x] Pushed branch, opened PR #1228 against main.
- [x] Moved this task's ACTIVE-CLAIMS entry from `active:` to
      `recently_completed:`.

## Remaining
- [ ] PR #1228 needs CI to go green and then to be merged (Rule 6 -- no
      direct push to main, this session cannot merge it itself if CI is
      still running when this invocation ends).
