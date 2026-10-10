// Stub of src/lib/db/index.ts for the ai-work-link-exec bundle: the postgres-role (RLS bypass) database client. The exec function holds no such
// credential; every link write runs through withTenantContext (tenant-scoped.ts) as app_runtime. The schema tables are re-exported unchanged, because
// services import them through the `@/lib/db` barrel, and `db` throws when it is used.
import { unavailable } from "./unavailable"
export * from "@/lib/db/schema"
export const db: never = new Proxy({} as never, {
  get() {
    return unavailable("the postgres-role database client (db)")
  },
})
