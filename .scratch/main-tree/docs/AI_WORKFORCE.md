# VERIDIAN AI Workforce — Repo-Write Pipeline

How a task becomes a reviewed PR, never a direct push to `main`.

**1. Classify.** `classifyTask()` (`src/lib/ai-team/team-service.ts`) calls the **AI Router** role (`ai_router`, `z-ai/glm-5.2`) via OpenRouter in JSON mode, returning `{ role, reasoning, confidence }`. The `role` is validated to be on the `AI_WORKFORCE` team — anything else throws.

**2. Assign.** The roster (`src/lib/ai-team/roster.ts`, team `AI_WORKFORCE`) is the only set the Router may pick from: `ceo_technical_director` (claude-sonnet-4.6), `senior_backend_engineer` (deepseek-v4-pro), `fullstack_developer` (deepseek-v4-flash), `frontend_engineer` (qwen3.6-27b), `qa_engineer` (deepseek-r1-0528), `research_analyst` (gemini-2.5-pro), `documentation_specialist` (glm-5.2), `devops_engineer` (deepseek-v4-pro), `security_code_reviewer` (claude-sonnet-4.6), `escalation_second_opinion` (gpt-5.5). Human roles (`founder_ceo`, `executive_advisor`) and `isCodeOnly` roles (`cost_policy_engine`, `user_permission_manager`) are never dispatched.

**3. Dispatch.** `dispatchRepoTask()` fires the `ai-team-task` `repository_dispatch` event with `{ role_key, task }`. Requires `GITHUB_DISPATCH_PAT`; from the deployed app it throws until that env var is set (trigger via `gh api .../dispatches` meanwhile).

**4. Execute.** `.github/workflows/ai-team-workforce.yml` checks out a fresh copy, creates branch `ai-team/<role>/<timestamp>`, and runs `scripts/ai-workforce-agent.mjs`. The agent loads the role's prompt from Supabase and loops (max 20 turns) through OpenRouter tool-calling with exactly four tools: `read_file` (≤200 KB), `write_file`, `list_dir`, `finish`. There is **no shell/exec tool**; paths are sandboxed to the repo root and governance files (`.claude/`, `CLAUDE.md`, `AGENTS.md`, `SENTINEL.md`, `ai-os/`, `.env`, `.git/`) are blocked in code.

**5. Land as a PR.** The workflow commits as `veridian-ai-workforce[bot]`, pushes the branch, and opens a PR against `main` using the workflow's own `GITHUB_TOKEN`. No file changes → no PR. PRs are **never auto-merged** — they wait for the Security & Code Reviewer / human review (branch protection requires one review before merge).
