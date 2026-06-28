import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL!

// Disable prefetch for Vercel Edge / serverless
const client = postgres(connectionString, { prepare: false })

export const db = drizzle(client, { schema, logger: process.env.NODE_ENV === 'development' })

export type Database = typeof db