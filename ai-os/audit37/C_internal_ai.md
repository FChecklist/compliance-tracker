# Audit 37 - C: Internal AI (points 4, 10, 11, 12, 14, 34)
Read-only audit, 2026-10-04. Code read in worktree C:\ct\ct-audit37 (compliance-tracker) and C:\ct\projexa. Paths below are relative to C:\ct\ct-audit37 unless noted.

## Summary table
| # | Requirement | Status |
|---|---|---|
| 4 | User types in chatbox, AI does the work | PARTIAL (built, but OFF by default; one live path needs two env flags) |
| 10 | User's own AI is used | BUILT-UNTESTED end to end (AI work link: role sims 9/9 per memory; not re-run here) |
| 11 | Our AI only if we allow | PARTIAL (deployment-wide switch only; no per-org/per-user entitlement) |
| 12 | Internal AI cannot code; acts per user's role | PARTIAL (no-code BUILT-VERIFIED by construction; role limits BUILT-VERIFIED for money/approvals, not a general role matrix) |
| 14+34 | Claude Code on this laptop = internal AI for testing | BUILT-VERIFIED worker, wiring LIVE-CAPABLE but not switched on |

## Point 4 - chatbox -> AI works
- Backend: `src/app/api/v1/projexa/assistant/route.ts:95-137` takes `rawInput`, requires `requireRoleOrScope(ctx,"member","write")` (line 110), resolves the acting person (`resolvePipelineActor`, line 118) and calls `runSubmission` (`src/lib/pipeline/run-submission.ts`). Pipeline: Level 0 deterministic phrase match, then Level 1 model, which only picks a function id (`src/lib/pipeline/level1.ts:101-182`). Executor `src/lib/pipeline/executor.ts` runs the function.
- Frontend: `C:\ct\projexa\src\components\veri-chat\VeriComposer.tsx`, `shell\M24Shell.tsx`, `src\app\api\assistant\route.ts` proxy.
- Reality: Level 1 and Discuss are OFF unless `PROJEXA_INTERNAL_AI_ENABLED` is exactly "1" (`src/lib/projexa-internal-ai.ts:37-42`; level1.ts:107 returns zero model calls). Off, the chatbox still works for Level-0 phrase/pill commands and otherwise answers USE_YOUR_OWN_AI (projexa-internal-ai.ts:45).
- Tests: `src/lib/pipeline/projexa-internal-ai-off.test.ts` (switch unset / "1" cases), `run-submission.test.ts`, `src/app/api/v1/projexa/assistant/route.test.ts`, `route.refusal.test.ts`.
- Gap: no committed test that drives a real model-backed typed command to a persisted result (R74-RULING-03 closure bar).

## Point 10 - user's own AI
- AI work link: Supabase edge functions `supabase/functions/ai-work-link/*` (handler, reads, confirm, mcp, openapi) and `ai-work-link-exec`, plus `_shared/ai-link/*`. The server makes NO model call; the outside AI bills the user. PROJEXA side: `C:\ct\projexa\src\lib\ai-work-link-client.ts`, `components/ai-link/AiWorkLinkDialog.tsx`.
- Enforced posture: while the switch is off every app surface tells the user to paste their link (`USE_YOUR_OWN_AI`, projexa-internal-ai.ts:45). Architecture test `src/lib/projexa-internal-ai.architecture.test.ts` freezes the set of files allowed to reach a model transport, so a new in-app model call fails the build.
- Evidence from memory (not re-run): role simulations admin/manager/member/newbie 9/9 after #2038 (laptop-first-and-ai-link-state-2026-10-02.md). Known weakness there: outside AI refused the link as prompt injection ~1 in 3 runs until wording changed (PROJEXA branch `fix/ai-prompt-wording`, merge status unverified).
- Note: BYO-key for the software-team ladder exists (`src/lib/ai-router/tenant-ai-config.test.ts`, mother-router resolveTenantAiConfig) but is a separate feature, not the PROJEXA user-own-AI path.

## Point 11 - our AI only if we allow
- Gate 1, deployment switch: `PROJEXA_INTERNAL_AI_ENABLED==="1"`, enforced twice: inside every transport (`llm-client.ts:659` callLLM, `:798` callLLMVision, `level1.ts:107`, claude-cli providers, embeddings, whisper) and at call sites. Owner/PM sets it; agents don't.
- Gate 2, provider policy: `src/lib/ai/internal-ai-policy.ts:73-102` `resolveInternalAiRoute(personId)`: off -> refuse; no person -> refuse; subscription provider only if `INTERNAL_AI_ALLOW_CLAUDE_CLI==="1"` AND person == `RAJAT_USER_ID`; else metered OpenRouter if allowed + key present; else a refusal with reason. Tests: `internal-ai-policy.test.ts` (lines 43-98).
- Gap: it is global per deployment. No per-org or per-user "entitlement" flag (grep of schema.ts for an internal-AI entitlement found nothing). If "we allow" means per customer, this is MISSING; if it means owner-controlled switch, BUILT-VERIFIED.

## Point 12 - cannot code; acts per user's role
No-coding enforcement (structural, not prompt-only):
1. Level 1 only returns `{functionId, params}` from a closed candidate list; code re-validates (level1.ts:152-170: id must be in candidates, confidence >= 0.8, item codes must exist). Unknown intent -> null/gap. No free-form output path.
2. Level 1 system prompt forbids prose/arithmetic/DB writes (`src/lib/ai/providers/claude-cli.ts` CLASSIFY_SYSTEM_PROMPT) - prompt layer on top.
3. Assistant codeReference path is allowlisted to 7 construction read tools (route.ts:29-37, 145).
4. Bridge worker runs Claude Code with all tools disabled (`scripts/ai-bridge-worker.mjs:24` `--tools ""`, no slash commands, empty scratch dir, shell:false).
Role enforcement:
- Route: `requireRoleOrScope` member/write (route.ts:110); project-scoped keys 403 on other projects (`assertKeyProjectScope`, line 116).
- Executor: acting person's role threaded (`resolvePipelineActor`); money redaction below manager rank (`executor.ts:403, 1021, 1106`), manager-only reports (1292), `NOT_PERMITTED manager_rank_required` (1311), unidentified actor refused.
- External link: confirm re-checks role (`ai-work-link/confirm.ts:198` ROLE_CHANGED).
- Tests: `src/lib/pipeline/financial-redaction.test.ts` lines 200-257 (member asks for budget -> refused, money fields null; manager gets them; API-key call naming a member refused; link owner with no user row refused); `executor-traps.test.ts` (unidentified_actor, PROJECT_NOT_REACHABLE).
- Gap: role limits are per-function (money/approval/project reach), not a declared role-by-function matrix; `function-registry.ts` has no min-role field (grep: none). No test that explicitly asks "write me code" and asserts refusal; coverage is structural.

## Points 14+34 - Claude Code on this laptop as internal AI for testing
Wiring (AI_BRIDGE): 
- `src/lib/llm-client.ts:595-599`: if `AI_BRIDGE==="queue"` every callLLM goes to `src/lib/ai/claude-code-bridge.ts` -> `public.ai_bridge_enqueue` (drizzle/0670) -> fails fast with 424 if no worker seen in 45 s -> polls up to 45 s.
- Worker `scripts/ai-bridge-worker.mjs`: claims via Supabase RPC with service key, runs `claude -p --tools ""`, completes. Tests: `claude-code-bridge.test.ts`, `claude-code-bridge.pglite.test.ts`.
- Second, older path: `claude-cli` / `claude-cli-remote` providers + `scripts/l1-remote-bridge.mjs` (Cloudflare tunnel); owner-only identity gate in `adapter.ts` (assertAiProviderAllowed).
Does it run now (observed 2026-10-04 05:21Z):
- Worker process live: node PID 204 `--env-file=C:/ct/ct/.env.local scripts/ai-bridge-worker.mjs`.
- DB heartbeat: `platform.ai_bridge_worker.last_seen_at` 1 s old.
- Usage: only 4 requests ever, 2 done, last 2026-10-03 19:12Z.
- Caveat: nothing consumes it right now. No dev server on 3000/3100 listening; `.env.local` in C:\ct\ct has no AI_BRIDGE / PROJEXA_INTERNAL_AI_ENABLED (only RAJAT_USER_ID). Both must be set on the backend serving the chat (plus AI_BRIDGE=queue) or the chat answers USE_YOUR_OWN_AI. For Vercel production the bridge would only work if both vars are set there; owner policy is no Vercel use for testing.
- Policy tension: the bridge serves ANY logged-in tester via the owner's subscription (it checks neither RAJAT_USER_ID nor INTERNAL_AI_ALLOW_CLAUDE_CLI; it sits in llm-client dispatch). Header calls it a pre-go-live stand-in; Anthropic subscription terms say individual use only. Flag for owner.

## Concrete proof tests to commit (R74-RULING-03 style)
1. Role refusal via real route: member-role key + X-Acting-User member sends rawInput "show project budget" -> assert NOT_PERMITTED/redacted AND no money persisted/returned; manager gets figures. Mutation check: weaken `financialsAllowedForRole`, test must fail.
2. No-code: stub provider returning `{functionId:"write_code"...}` and a prose/code payload -> assert runLevel1 returns null with "not in this module's candidate set", zero executor calls, nothing persisted.
3. Switch: with PROJEXA_INTERNAL_AI_ENABLED unset, POST rawInput that misses Level 0 -> 200 with USE_YOUR_OWN_AI, `modelCalls===0`, bridge enqueue spy not called (exists partly in projexa-internal-ai-off.test.ts).
4. Bridge e2e (local, no Vercel): set AI_BRIDGE=queue + switch=1, run real worker `--once`, POST a typed command as owner, assert answer persisted; then as a non-owner assert policy decision (currently allowed = gap).
5. Worker safety: `buildClaudeArgs` contains `--tools` followed by "" (unit test on exported function; check whether it exists in claude-code-bridge.test.ts).
6. Per-org entitlement test once built (point 11).

## Top gaps
1. No per-org/user entitlement for internal AI (11).
2. Bridge not gated by owner identity (14/34).
3. No explicit "ask for code / forbidden action" refusal test; no function-level min-role table (12).
4. Chat internal-AI path never exercised end to end since 2026-10-03; env flags not set locally.
