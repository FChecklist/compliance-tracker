// R63 (2026-08-29): replaces `drizzle-kit migrate` in CI. Live-tested that
// the CLI's own spinner swallows the real Postgres error on failure --
// every failed CI run showed only spinner animation frames followed by
// "exited with code 1", with the actual error message (permission denied,
// bad auth, whatever it is) never reaching the log at all. This calls
// drizzle-orm's own migrator function directly, which throws a real JS
// Error with the actual Postgres error fields (code/detail/hint/schema/
// table) intact -- no CLI/spinner layer in between to lose it.
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

// prepare: false -- required when connecting through Supabase's
// transaction-mode pooler (port 6543). postgres.js prepares statements by
// default; transaction-mode pooling (Supavisor/PgBouncer) does not
// support session-scoped prepared statements, which is what was actually
// causing "CREATE SCHEMA IF NOT EXISTS" to fail (not a permissions or
// connectivity problem -- both were red herrings chased first). This is
// Supabase's own documented requirement for using postgres.js with the
// transaction pooler, not specific to migrations.
const sql = postgres(databaseUrl, { max: 1, prepare: false });
const db = drizzle(sql);

try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations applied successfully.");
} catch (err) {
  console.error("Migration failed:", err.message);
  console.error("own keys:", Object.getOwnPropertyNames(err));
  console.error("cause:", err.cause ? err.cause.message : null);
  console.error("cause own keys:", err.cause ? Object.getOwnPropertyNames(err.cause) : null);
  const src = err.cause ?? err;
  console.error(
    "Details:",
    JSON.stringify(
      {
        code: src.code,
        detail: src.detail,
        hint: src.hint,
        schema: src.schema_name,
        table: src.table_name,
        position: src.position,
        severity: src.severity,
        routine: src.routine,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  await sql.end();
}
