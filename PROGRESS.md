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
