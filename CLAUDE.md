@AGENTS.md

# ComplianceTrack AI Agent Context

pnpm monorepo (Turborepo) | Next.js 14 App Router | TypeScript | Supabase | Drizzle ORM
Package manager: pnpm 9.4.0

## Monorepo Structure
- apps/web — Next.js web app
- apps/mobile — Expo React Native
- packages/db — Drizzle ORM schema and client
- packages/api-client — typed API client
- packages/types — shared TypeScript types
- packages/ui — shared UI components

## AI-OS Rules
- All tasks tracked in ai-os/boss/BOARD.yaml
- All violations logged in ai-os/sentinel/VIOLATIONS.yaml
- SENTINEL.yaml is the supreme guardian — never bypass its rules
- Run: pnpm install && pnpm turbo build --filter=web to verify

## AI Engine Access
- Claude Code: use ANTHROPIC_API_KEY from GitHub Secrets
- Z.ai: use ZAI_API_KEY from GitHub Secrets
- Codex: use OPENAI_API_KEY from GitHub Secrets
- AI dispatch: trigger via repository_dispatch event
