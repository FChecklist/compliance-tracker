import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

function buildConnectionString(url: string): string {
  try {
    const parsed = new URL(url)
    // If host contains a project ref (e.g., postgres.jusqumifsmtcaujqyjuy),
    // it means the URL is malformed — the project ref should be the username, not the host.
    // Correct Supabase direct format:
    //   postgresql://postgres.[ref]:[password]@db.[ref].supabase.co:5432/postgres
    // Correct Supabase pooler format:
    //   postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
    const refMatch = parsed.hostname.match(/^(postgres\.)?([a-z0-9]+)$/)
    if (refMatch && !parsed.hostname.includes('.')) {
      // Host is just a project ref or postgres.ref — fix it
      const ref = refMatch[2]
      parsed.hostname = `db.${ref}.supabase.co`
      parsed.port = '5432'
      if (parsed.username === 'postgres' || !parsed.username) {
        parsed.username = `postgres.${ref}`
      }
      if (!parsed.pathname || parsed.pathname === '/') {
        parsed.pathname = '/postgres'
      }
      const result = parsed.toString()
      console.log(`[db] Reconstructed DATABASE_URL host from ${url.split('@')[1]?.split('/')[0] || '?'} to ${parsed.hostname}`)
      return result
    }
    return url
  } catch {
    return url
  }
}

const rawUrl = process.env.DATABASE_URL!
const connectionString = buildConnectionString(rawUrl)

const client = postgres(connectionString, {
  prepare: false,
  ssl: {
    rejectUnauthorized: false,
  },
})

export const db = drizzle(client, { schema })

export * from './schema'
