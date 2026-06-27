import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL!;
const dbSchema = process.env.DB_SCHEMA || "compliance_tracker";

const queryClient = postgres(connectionString, {
  prepare: true,
});

export const db = drizzle(queryClient, {
  schema,
});

// Helper to set the PostgreSQL search_path so queries hit the correct schema
let schemaSet = false;
export async function ensureSchema() {
  if (schemaSet) return;
  await queryClient.unsafe(`SET search_path TO "${dbSchema}", public`);
  schemaSet = true;
}

export type Database = typeof db;