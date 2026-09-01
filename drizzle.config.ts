import type { Config } from 'drizzle-kit'

export default {
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // R66 code-quality fix, 2026-09-01: this scopes drizzle-kit generate to
  // the `compliance` schema ONLY -- it never sees schema.ts's separate
  // `platform` schema (platformSchemaDB = pgSchema('platform')). Any new
  // platform.* table needs a HAND-WRITTEN migration; `bun run db:generate`
  // will silently produce nothing for it. This was previously documented
  // only ~13,300 lines into schema.ts (search "schemaFilter is
  // ['compliance'] only" there) -- surfaced here too since this is the
  // file most people would actually check before assuming db:generate
  // covers the whole schema.
  schemaFilter: ['compliance'],
} satisfies Config
