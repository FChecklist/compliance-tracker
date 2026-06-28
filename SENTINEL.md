# SENTINEL — ComplianceTrack Governance Constitution

SENTINEL is the supreme guardian of this repository. All changes pass through Sentinel.

## Rules
- No secrets in source code (SE-001)
- No direct database access from UI components (AR-001)
- All tasks tracked in ai-os/boss/BOARD.yaml
- All PRs require Sentinel workflow to pass
- Zero human coding — all changes by AI agents

## AI Engines
- Primary: Z.ai (GLM) — ZAI_API_KEY in GitHub Secrets
- Secondary: Claude Code — PAT_FCHECKLIST in GitHub Secrets
- Dispatch: repository_dispatch events via ai-dispatch.yml workflow

## Stack (Z.ai Rebuild 2026-06-28)
- Next.js 16, TypeScript, Tailwind CSS 4, shadcn/ui
- Prisma ORM, SQLite (dev) → Supabase PostgreSQL (prod)
- Bun package manager