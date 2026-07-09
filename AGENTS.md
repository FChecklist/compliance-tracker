# AGENTS.md — Authorized AI Agents

> All agents listed here have been explicitly authorized by the repository owner.
> Owner: raajat.agarwal@gmail.com | ID: 9f3b0147-85ba-4461-9e27-aa782b313285

## Authorized Agents

### Z.ai GLM (Primary Full-Stack Agent)
- **Authority**: FULL_ACCESS — all repositories, all files, all operations
- **Owner**: raajat.agarwal@gmail.com (user_id: 9f3b0147-85ba-4461-9e27-aa782b313285)
- **Trigger**: `repository_dispatch` event type `zai-task`
- **Can**: read/write all code, create branches, open PRs, deploy, run migrations, seed DB
- **Cannot**: push or merge directly to `main` (see Operating Rule 6, added 2026-07-10)
- **API key**: stored as `ZAI_API_KEY` in GitHub Secrets

### Claude Code (Secondary Agent)
- **Authority**: FULL_ACCESS — all repositories, all files, all operations
- **Owner**: raajat.agarwal@gmail.com
- **Trigger**: `repository_dispatch` event type `claude-task`
- **Can**: read/write all code, create branches, open PRs, architecture decisions, code review
- **Cannot**: push or merge directly to `main` (see Operating Rule 6, added 2026-07-10)
- **API key**: stored as `ANTHROPIC_API_KEY` in GitHub Secrets

## Operating Rules
1. Zero human coding — all changes made by AI agents only
2. All changes logged through SENTINEL (ai-os/sentinel/)
3. BOSS agent (ai-os/boss/BOARD.yaml) tracks all tasks
4. Both agents have identical repo-level permissions via PAT_FCHECKLIST
5. GitHub is the single source of truth — all work committed here
6. **Added 2026-07-10 (Boss directive, after two concurrent full-access agents collided on `main` — one agent's uncommitted work got silently swept into the other's unrelated commit): `main` now has GitHub branch protection requiring every change to go through a pull request that passes CI (Lint/Type Check/Build/Unit Tests) before it can merge. Direct pushes to `main`, including from a full-access agent's own PAT, will be rejected (`enforce_admins` is on — there is no bypass). No human approval is required on the PR itself (there's no dedicated reviewer to bottleneck on), so this doesn't slow down single-agent work — it only prevents two agents from silently overwriting each other's in-flight changes. Work on a branch, open a PR, let CI run, merge once green.
7. **Added 2026-07-09 (Boss directive, VERIDIAN.docx constitution study):** For any implementation work arising from `Study_by_Claude.md` / `Study_by_zaizlm5.2.md` (the VERIDIAN AI OS constitution study): (a) both AIs' independent studies and independent gap-analysis reports must exist and be cross-reviewed before either starts implementing; (b) implementation tasks are divided with one explicit owner (Claude or z.ai) per task; (c) whichever agent did **not** implement a task is the mandatory auditor for it — no self-certification, on top of Rule 6's PR/CI gate; (d) both the doer and the auditor write a documentation entry for every completed task, in `ai-os/boss/COMPLETED.yaml` (schema extended 2026-07-09 for this); (e) deploying to Vercel/Supabase only happens once the full joint plan is complete, and requires explicit confirmation from the repository owner even after both agents agree it's ready — it is the one step in this sequence that is not cleanly reversible, unlike everything upstream of it which lives behind PRs and Rule 6's branch protection. Full detail: `Study_by_Claude.md`, addendum "End-to-End Study → Audit → Implementation → Deploy Workflow."

## Contact
Repository owner: raajat.agarwal@gmail.com | Z.ai user_id: 9f3b0147-85ba-4461-9e27-aa782b313285