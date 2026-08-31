// Standalone probe, deliberately NOT a *.test.ts file so bun:test never
// loads it into the shared test process. Run in its own child process (see
// schema.relations.test.ts) so it always gets a fresh, unpolluted module
// registry -- this repo's full `bun test` run executes 200+ *.test.ts files
// in one shared process, and several of them `mock.module("@/lib/db", ...)`
// (or a schema sub-path) without restoring it, which can leave a stubbed-out
// schema export behind for whichever test happens to import the real
// "./schema" module later in the run. This check is the ONLY thing in the
// whole suite that constructs a real, live `drizzle(client, { schema })`
// relational query builder over the FULL schema (every other route test
// mocks `withTenantContext`/`db` itself and never reaches this code path),
// so it's uniquely exposed to that pollution -- running it out-of-process
// sidesteps the problem entirely rather than trying to track down and fix
// every offending mock.module() call across the suite.
import { drizzle } from "drizzle-orm/postgres-js";
import { asc } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema.ts";

// Deliberately unroutable -- this must never actually connect. Building the
// relational query throws (or doesn't) before any network I/O is attempted.
const client = postgres("postgresql://nouser:nopass@127.0.0.1:1/nodb", {
  prepare: false,
  max: 1,
  connect_timeout: 1,
});
const db = drizzle(client, { schema });

let message = "";
try {
  await db.query.departments.findMany({
    with: {
      head: { columns: { name: true } },
      complianceItems: { columns: { id: true, status: true } },
      users: { columns: { id: true } },
    },
    orderBy: asc(schema.departments.name),
  });
} catch (err) {
  message = err instanceof Error ? err.message : String(err);
} finally {
  await client.end({ timeout: 1 });
}

process.stdout.write(JSON.stringify({ message }));
