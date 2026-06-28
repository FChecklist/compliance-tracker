@AGENTS.md

# ComplianceTrack AI Agent Context

**Built by Z.ai (GLM) on 2026-06-28**
Bun | Next.js 16 | TypeScript | Tailwind CSS 4 | shadcn/ui | Prisma | SQLite → PostgreSQL

## Structure
- src/app/ — Next.js App Router pages
- src/components/ — shadcn/ui components
- src/lib/ — utilities and helpers
- prisma/ — Prisma schema and migrations
- public/ — static assets

## Design Tokens
- Navy: #1C2B3A | Saffron: #F5820A | Teal: #0E7C6E | Cream: #FFFDF9
- Fonts: DM Serif Display (headings) + Inter (body)

## Commands
- bun install — install dependencies
- bun run dev — start dev server
- bun run db:generate — generate Prisma client
- bun run db:push — push schema to database
- bun run build — production build

## AI-OS Rules
- All tasks in ai-os/boss/BOARD.yaml
- SENTINEL.yaml is supreme — never bypass
- Dispatch tasks via repository_dispatch with event_type: zai-task