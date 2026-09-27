/// <reference types="bun-types" />
// The Supabase Edge runtime defines neither setImmediate nor clearImmediate, and the postgres driver needs both: the first live call of the exec
// function (2026-09-27) died in an unhandled rejection and answered an empty 503. process-global.ts must define them when the runtime does not.
import { expect, test } from "bun:test"
import "node:timers" // loaded while the globals still exist: Bun's own node:timers reads setImmediate when it is first evaluated

test("process-global.ts defines setImmediate and clearImmediate when the runtime has neither, and leaves them alone when it has them", async () => {
  const g = globalThis as unknown as { setImmediate?: unknown; clearImmediate?: unknown }
  const saved = { set: g.setImmediate, clear: g.clearImmediate }
  try {
    delete g.setImmediate
    delete g.clearImmediate
    await import("../../../supabase/functions/ai-work-link-exec/process-global.ts?without")
    expect(typeof g.setImmediate).toBe("function")
    expect(typeof g.clearImmediate).toBe("function")
    const ran = await new Promise<boolean>((resolve) => (g.setImmediate as (fn: () => void) => void)(() => resolve(true)))
    expect(ran).toBe(true)

    const own = () => undefined
    g.setImmediate = own
    await import("../../../supabase/functions/ai-work-link-exec/process-global.ts?with")
    expect(g.setImmediate).toBe(own)
  } finally {
    g.setImmediate = saved.set
    g.clearImmediate = saved.clear
  }
})
