# AGENTS.md — Authorized AI Agents

> All agents listed here have been explicitly authorized by the repository owner.
> Owner: raajat.agarwal@gmail.com | ID: 9f3b0147-85ba-4461-9e27-aa782b313285

## Authorized Agents

### Z.ai GLM (Primary Full-Stack Agent)
- **Authority**: FULL_ACCESS — all repositories, all files, all operations
- **Owner**: raajat.agarwal@gmail.com (user_id: 9f3b0147-85ba-4461-9e27-aa782b313285)
- **Trigger**: `repository_dispatch` event type `zai-task`
- **Can**: read/write all code, create/push/merge branches, delete branches, deploy, run migrations, seed DB
- **API key**: stored as `ZAI_API_KEY` in GitHub Secrets

### Claude Code (Secondary Agent)
- **Authority**: FULL_ACCESS — all repositories, all files, all operations
- **Owner**: raajat.agarwal@gmail.com
- **Trigger**: `repository_dispatch` event type `claude-task`
- **Can**: read/write all code, create/push/merge branches, architecture decisions, code review
- **API key**: stored as `ANTHROPIC_API_KEY` in GitHub Secrets

## Operating Rules
1. Zero human coding — all changes made by AI agents only
2. All changes logged through SENTINEL (ai-os/sentinel/)
3. BOSS agent (ai-os/boss/BOARD.yaml) tracks all tasks
4. Both agents have identical repo-level permissions via PAT_FCHECKLIST
5. GitHub is the single source of truth — all work committed here

## Contact
Repository owner: raajat.agarwal@gmail.com | Z.ai user_id: 9f3b0147-85ba-4461-9e27-aa782b313285