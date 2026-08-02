# SENTINEL — ComplianceTrack Governance Constitution

> **AUTHORITY NOTE (2026-07-14):** `ai-os/CONSTITUTION.yaml` is now the single, machine-readable constitution for VERIDIAN AI OS and is authoritative over this document on any conflict (its `security_and_guardrails.sentinel_rules` section holds the current SE-*/AR-*/AC-* rule text verbatim). This document remains as a short historical pointer to `ai-os/sentinel/SENTINEL.yaml`'s fuller rule set.

SENTINEL is the supreme guardian of this repository. All changes pass through Sentinel.

## Rules
- No secrets in source code (SE-001)
- No direct database access from UI components (AR-001)
- All completed work logged in `ai-os/boss/COMPLETED.yaml` (corrected 2026-07-14 -- `BOARD.yaml` has been self-declared stale since 2026-06-29)
- All PRs require CI to pass (see `AGENTS.md` Operating Rule 6)
- Zero human coding — all changes by AI agents

## AI Engines
- Primary: Z.ai (GLM) — ZAI_API_KEY in GitHub Secrets
- Secondary: Claude Code — PAT_FCHECKLIST in GitHub Secrets
- Dispatch: repository_dispatch events via ai-dispatch.yml workflow

## Stack (corrected 2026-07-14 -- see `ai-os/OS.yaml`'s own 2026-07-13 correction note)
- Next.js 16, TypeScript, Tailwind CSS 4, shadcn/ui
- Drizzle ORM + postgres.js → Supabase PostgreSQL (`compliance` schema) — zero Prisma, zero SQLite
- Bun package manager
