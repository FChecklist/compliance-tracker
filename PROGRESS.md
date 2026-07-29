# PROGRESS -- task-20260729-210307-backend--backend-001--correct-the-opena

## Completed
- [x] Read current src/lib/llm-client.ts and confirmed the `openai/gpt-oss-120b` row and its preceding comment still matched the task's INPUT description (line ~170, values 0.000036/0.00018, comment citing 2026-07-10 openrouter.ai cross-check).
- [x] Updated the row to `{ promptPer1k: 0.00015, completionPer1k: 0.0006 }` (Groq's $0.15/$0.60 per 1M tokens).
- [x] Rewrote the preceding comment to cite groq.com/pricing, verified 2026-07-18, and note it replaces the prior 2026-07-10 openrouter.ai-derived figure, which understated real Groq spend ~3.3-4x.
- [x] Verified via `git diff` that only the `openai/gpt-oss-120b` row + its comment changed; the sibling Cerebras `gpt-oss-120b` row (no `openai/` prefix, line ~179) is untouched.
- [x] Confirmed no other MODEL_PRICING rows or file logic (e.g. `estimateCostUsd()`) were touched.

## Remaining
- [ ] Type-check/build validation: could not run `bun run build` or any TS type-check in this environment -- `bun` binary is not installed/available on PATH, and `node_modules` is not present (`npx tsc` also fails without a local install). The change itself is two numeric literals + a comment, with no change to object shape, so type-check risk is effectively nil, but this step could not be mechanically executed here. Flagging so a supervisor/CI run confirms it (CI on the PR will run the real build).
- [ ] Commit + push (pending, per protocol, now that the edit is verified).
