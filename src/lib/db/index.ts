import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

// Prefer DATABASE_URL; fall back to building pooler URL from Supabase env vars
// The direct host (db.[ref].supabase.co) can have DNS issues in some Vercel regions;
// the transaction pooler (aws-0-[region].pooler.supabase.com:6543) is more reliable globally.
function getConnectionString(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const dbPassword = process.env.SUPABASE_DB_PASSWORD
  if (supabaseUrl && dbPassword) {
    const ref = supabaseUrl.replace('https://', '').split('.')[0]
    return `postgresql://postgres.${ref}:${dbPassword}@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres`
  }

  throw new Error('No database connection string available. Set DATABASE_URL or NEXT_PUBLIC_SUPABASE_URL + SUPABASE_DB_PASSWORD.')
}

const client = postgres(getConnectionString(), {
  prepare: false,
  ssl: { rejectUnauthorized: false },
  max: 1,
})

export const db = drizzle(client, { schema })

export * from './schema'
