// The pipeline bundle reads `process.env` (tenant-scoped.ts: APP_RUNTIME_DATABASE_URL, APP_RUNTIME_POOL_MAX). Deno 2 has a `process` global; this makes
// sure of it, and MUST be imported before the bundle (ES modules evaluate their imports in order).
import process from "node:process"
import { Buffer } from "node:buffer"
import { clearImmediate, setImmediate } from "node:timers"

const g = globalThis as unknown as { process?: unknown; Buffer?: unknown }
if (!g.process) g.process = process
// the postgres driver and its helpers read the Node `Buffer` global at module load; Deno does not define it
if (!g.Buffer) g.Buffer = Buffer
// the postgres driver schedules its connection work with setImmediate and clearImmediate; the Supabase Edge runtime defines neither, so the first
// database call died in an unhandled rejection (found on the first live run, 2026-09-27: /health answered an empty 503)
const t = globalThis as unknown as { setImmediate?: unknown; clearImmediate?: unknown }
if (!t.setImmediate) t.setImmediate = setImmediate
if (!t.clearImmediate) t.clearImmediate = clearImmediate
// one warm isolate serves one link write at a time: a pool of 2 keeps it from opening 20 pooler connections (write-path gap G23, blocker B9)
try {
  if (!process.env.APP_RUNTIME_POOL_MAX) process.env.APP_RUNTIME_POOL_MAX = "2"
} catch {
  // the default pool size stays
}
