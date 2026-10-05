/// <reference types="bun-types" />
// AUDIT-100 B58: every call to the AI work link leaves ONE timing line, and a slow or failed one can be found by a single filter.
// timing.ts is the real file; the clock and the handler are fakes so the 21-second stall can be reproduced in a few milliseconds.
// Run: bun test --isolate src/lib/services/ai-work-link-timing.test.ts
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { SLOW_MS, routeShape, timingLine, withTiming } from "../../../supabase/functions/ai-work-link/timing"

const req = (url: string, method = "GET") => new Request(url, { method })
const BASE = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/ai-work-link"

describe("routeShape never carries a token or an id", () => {
  test("token and ids are replaced, words stay", () => {
    expect(routeShape("/functions/v1/ai-work-link/pxa_AbCdEf123456/projects/8f14e45f-ceea-467a-9ab1-0a5b1c2d3e4f/actions")).toBe("/:token/projects/:id/actions")
    expect(routeShape("/functions/v1/ai-work-link/pxa_secretsecretsecretsecret")).toBe("/:token")
    expect(routeShape("/functions/v1/ai-work-link/pxa_x/openapi.json")).toBe("/:token/openapi.json")
  })
  test("a secret never survives, whatever its shape", () => {
    const shaped = routeShape("/functions/v1/ai-work-link/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/card.md")
    expect(shaped).toBe("/:token/card.md")
    expect(shaped).not.toContain("aaaa")
  })
})

describe("withTiming", () => {
  test("logs one line with the route shape, status and milliseconds; the answer is untouched", async () => {
    const lines: string[] = []
    let t = 1000
    const res = await withTiming(req(`${BASE}/pxa_abc/projects?token=pxa_leak`), async () => { t += 450; return new Response("ok", { status: 200 }) }, (l) => lines.push(l), () => t)
    expect(await res.text()).toBe("ok")
    expect(lines).toHaveLength(1)
    expect(lines[0]).toStartWith("[awl-timing] ")
    expect(JSON.parse(lines[0].slice("[awl-timing] ".length))).toEqual({ route: "/:token/projects", method: "GET", status: 200, ms: 450, slow: false, failed: false })
    expect(lines[0]).not.toContain("pxa_")
  })

  test("a 21 second call is marked slow, a 503 is marked failed", async () => {
    const lines: string[] = []
    let t = 0
    await withTiming(req(`${BASE}/pxa_abc`), async () => { t += 21_000; return new Response("guide") }, (l) => lines.push(l), () => t)
    await withTiming(req(`${BASE}/pxa_abc/projects`), async () => new Response("down", { status: 503 }), (l) => lines.push(l), () => t)
    const [slow, failed] = lines.map((l) => JSON.parse(l.slice("[awl-timing] ".length)))
    expect(slow).toMatchObject({ ms: 21_000, slow: true, failed: false })
    expect(SLOW_MS).toBe(3000)
    expect(failed).toMatchObject({ status: 503, failed: true })
  })

  test("a handler that throws is logged as a 500 and the error still reaches the caller", async () => {
    const lines: string[] = []
    await expect(withTiming(req(`${BASE}/pxa_abc`), async () => { throw new Error("boom") }, (l) => lines.push(l))).rejects.toThrow("boom")
    expect(JSON.parse(lines[0].slice("[awl-timing] ".length))).toMatchObject({ status: 500, failed: true })
  })

  test("a logger that throws changes nothing", async () => {
    const res = await withTiming(req(`${BASE}/pxa_abc`), async () => new Response("fine"), () => { throw new Error("log down") })
    expect(await res.text()).toBe("fine")
  })

  test("an unreadable URL is logged as '/'", () => {
    expect(timingLine({ method: "GET", url: "not a url" }, 200, 5).route).toBe("/")
  })
})

describe("index.ts really uses it", () => {
  test("Deno.serve wraps handleAwl in withTiming and logs through console.log", () => {
    const src = readFileSync(new URL("../../../supabase/functions/ai-work-link/index.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "utf8")
    expect(src).toContain('import { withTiming } from "./timing.ts"')
    expect(src).toMatch(/withTiming\(req, \(\) => handleAwl\(req,/)
    expect(src).toContain("console.log(line)")
  })
})
