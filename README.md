# compliance-tracker — VERIDIAN AI OS

VERIDIAN AI OS core monorepo: a multi-tenant Next.js application (Bun,
Next.js 16 App Router, TypeScript strict, Tailwind 4, shadcn/ui) backed by
Drizzle ORM + Supabase Postgres (`compliance` schema). This is the real
backend behind the VERIDIAN AI brand and its thin-client product
(`FChecklist/projexa`, live at PROJEXA-AI.COM).

## Running it

```
bun install
bun run dev
```

See `CLAUDE.md`'s Commands section for the full list (build, typecheck,
lint, db:generate/db:push/db:seed, test:prompts, and the `check:*`
technical-debt scripts).

## Where to actually start

Read `CLAUDE.md` first — its "Read Before Starting Work" list is the real
governance-doc index (`ai-os/boss/ACTIVE-CLAIMS.yaml`,
`ai-os/CONSTITUTION.yaml`, `ai-os/OS.yaml`, `ai-os/BRAIN.md`, and more).
There are ~39 other top-level `.md` files in this repo (architecture,
strategy, wave-report, and study documents); none of them is an index of
the others, so don't assume completeness from title alone — CLAUDE.md's
own list is the closest thing to a map.

---
*Added 2026-09-01 as part of a code-quality inspection pass (see
`public.code_quality_inspection_findings` in the `verdian-ai` Supabase
project) that found this repo's README.md contained only a single leftover
CI-smoke-test comment.*
