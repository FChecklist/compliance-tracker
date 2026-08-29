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

const sql = postgres(databaseUrl, { max: 1 });
const db = drizzle(sql);

try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations applied successfully.");
} catch (err) {
  console.error("Migration failed:", err.message);
  console.error(
    "Details:",
    JSON.stringify(
      {
        code: err.code,
        detail: err.detail,
        hint: err.hint,
        schema: err.schema_name,
        table: err.table_name,
        position: err.position,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  await sql.end();
}
