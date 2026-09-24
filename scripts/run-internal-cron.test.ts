/// <reference types="bun-types" />
// Unit tests for scripts/run-internal-cron.ts (PROJEXA-COST-001, prepare-only).
//
// Deliberately imports NO real route module -- every route under
// src/app/api/internal/*/run pulls in @/lib/db (and, transitively, the
// 11,500-line schema plus a postgres.js client). The handler-invocation
// tests use a stubbed module shaped exactly like those routes (GET reads the
// authorization header, answers NextResponse.json 200 or 401), so the
// request-building / header / exit-code mechanics are proven without any
// database in the picture. main()'s happy path (a real dynamic import) is
// covered only by the manual mechanics check recorded in
// ai-os/COST001_GHA_RUNNER_NOTES.md; its usage-error paths are covered here.
//
// Run:  bun test --isolate ./scripts/run-internal-cron.test.ts
import { describe, test, expect } from "bun:test"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { NextRequest, NextResponse } from "next/server"
import {
  CRON_PATH_PATTERN,
  BODY_PRINT_LIMIT,
  EXIT_OK,
  EXIT_ROUTE_FAILED,
  EXIT_USAGE,
  validateCronPath,
  routeModuleRelativePath,
  resolveRouteModuleUrl,
  buildRequestUrl,
  buildAuthHeaders,
  buildCronRequest,
  exitCodeForStatus,
  truncateBody,
  formatBody,
  getHandler,
  runCronHandler,
  renderResult,
  main,
  type CronRouteModule,
} from "./run-internal-cron"

const SECRET = "s3cr3t-for-tests"

// Shaped like every real /api/internal/*/run route: isAuthorized() compares
// the header to `Bearer ${CRON_SECRET}` and answers 401 otherwise.
const stubRoute: CronRouteModule = {
  GET: async (request: NextRequest) => {
    if (request.headers.get("authorization") !== `Bearer ${SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    return NextResponse.json({ ranAt: "2026-09-22T00:00:00.000Z", results: { ok: true } })
  },
}

describe("validateCronPath", () => {
  test("accepts a single segment", () => {
    expect(validateCronPath("loops")).toEqual({ ok: true, path: "loops" })
  })
  test("accepts nested segments with hyphens and digits", () => {
    expect(validateCronPath("the-firm/x")).toEqual({ ok: true, path: "the-firm/x" })
    expect(validateCronPath("a1/b2-c3/d")).toEqual({ ok: true, path: "a1/b2-c3/d" })
  })
  test.each([
    ["../x", "parent traversal"],
    ["a/../b", "embedded traversal"],
    ["a b", "space"],
    ["/loops", "leading slash"],
    ["loops/", "trailing slash"],
    ["a//b", "double slash"],
    ["Loops", "uppercase"],
    ["a\\b", "backslash"],
    ["loops?x=1", "query string"],
    ["loops.ts", "dot"],
    ["", "empty"],
  ])("rejects %j (%s)", (input) => {
    const result = validateCronPath(input)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0)
  })
  test("rejects a missing / non-string argument", () => {
    expect(validateCronPath(undefined).ok).toBe(false)
    expect(validateCronPath(42).ok).toBe(false)
  })
  test("the exported pattern is the one documented in the workflow notes", () => {
    expect(CRON_PATH_PATTERN.source).toBe("^[a-z0-9-]+(\\/[a-z0-9-]+)*$")
  })
})

describe("route module resolution", () => {
  test("relative path targets src/app/api/internal/<path>/run/route.ts", () => {
    expect(routeModuleRelativePath("loops")).toBe("../src/app/api/internal/loops/run/route.ts")
    expect(routeModuleRelativePath("the-firm/recur-engagements")).toBe(
      "../src/app/api/internal/the-firm/recur-engagements/run/route.ts",
    )
  })
  test("resolves to a real file for a real cron, and to nothing for a made-up one (fs existence only, no import)", () => {
    const real = fileURLToPath(resolveRouteModuleUrl("loops"))
    expect(real.replace(/\\/g, "/")).toMatch(/\/src\/app\/api\/internal\/loops\/run\/route\.ts$/)
    expect(existsSync(real)).toBe(true)
    expect(existsSync(fileURLToPath(resolveRouteModuleUrl("definitely-not-a-cron")))).toBe(false)
  })
})

describe("request building", () => {
  test("url mirrors the Vercel cron path", () => {
    expect(buildRequestUrl("loops")).toBe("http://localhost/api/internal/loops/run")
    expect(buildRequestUrl("the-firm/x")).toBe("http://localhost/api/internal/the-firm/x/run")
  })
  test("authorization header is `Bearer <secret>` when a secret is set", () => {
    expect(buildAuthHeaders("abc")).toEqual({ authorization: "Bearer abc" })
  })
  test("no header at all (never `Bearer undefined`) when the secret is unset or empty", () => {
    expect(buildAuthHeaders(undefined)).toEqual({})
    expect(buildAuthHeaders("")).toEqual({})
  })
  test("buildCronRequest produces a GET NextRequest with the header attached", () => {
    const req = buildCronRequest("loops", "abc")
    expect(req).toBeInstanceOf(NextRequest)
    expect(req.method).toBe("GET")
    expect(req.url).toBe("http://localhost/api/internal/loops/run")
    expect(req.headers.get("authorization")).toBe("Bearer abc")
    expect(buildCronRequest("loops", undefined).headers.get("authorization")).toBeNull()
  })
})

describe("exit-code mapping", () => {
  test("2xx -> 0", () => {
    expect(exitCodeForStatus(200)).toBe(EXIT_OK)
    expect(exitCodeForStatus(204)).toBe(EXIT_OK)
    expect(exitCodeForStatus(299)).toBe(EXIT_OK)
  })
  test("anything else -> 1", () => {
    for (const status of [199, 300, 302, 400, 401, 403, 404, 500, 503]) {
      expect(exitCodeForStatus(status)).toBe(EXIT_ROUTE_FAILED)
    }
  })
  test("the three codes are distinct and documented", () => {
    expect(new Set([EXIT_OK, EXIT_ROUTE_FAILED, EXIT_USAGE]).size).toBe(3)
    expect(EXIT_USAGE).toBe(2)
  })
})

describe("body shaping", () => {
  test("truncates to the print limit with an explicit marker", () => {
    const long = "x".repeat(BODY_PRINT_LIMIT + 10)
    const out = truncateBody(long)
    expect(out.startsWith("x".repeat(BODY_PRINT_LIMIT))).toBe(true)
    expect(out).toContain("[truncated: 10 more characters")
    expect(truncateBody("short")).toBe("short")
  })
  test("pretty-prints JSON bodies and passes non-JSON through", () => {
    expect(formatBody('{"a":1}', "application/json")).toBe('{\n  "a": 1\n}')
    expect(formatBody("not json", "application/json")).toBe("not json")
    expect(formatBody("plain", "text/plain")).toBe("plain")
    expect(formatBody("plain", null)).toBe("plain")
  })
})

describe("handler invocation against a stubbed route module", () => {
  test("getHandler returns GET when it is a function, null otherwise", () => {
    expect(typeof getHandler(stubRoute)).toBe("function")
    expect(getHandler({})).toBeNull()
    expect(getHandler({ GET: "not a function" })).toBeNull()
  })
  test("right secret -> 200, exit 0, JSON body", async () => {
    const result = await runCronHandler(getHandler(stubRoute)!, buildCronRequest("loops", SECRET))
    expect(result.kind).toBe("response")
    if (result.kind !== "response") throw new Error("unreachable")
    expect(result.status).toBe(200)
    expect(result.exitCode).toBe(EXIT_OK)
    expect(result.contentType).toContain("application/json")
    expect(JSON.parse(result.body)).toEqual({ ranAt: "2026-09-22T00:00:00.000Z", results: { ok: true } })
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
  })
  test("wrong secret -> 401, exit 1", async () => {
    const result = await runCronHandler(getHandler(stubRoute)!, buildCronRequest("loops", "wrong"))
    expect(result.kind).toBe("response")
    if (result.kind !== "response") throw new Error("unreachable")
    expect(result.status).toBe(401)
    expect(result.exitCode).toBe(EXIT_ROUTE_FAILED)
    expect(JSON.parse(result.body)).toEqual({ error: "Unauthorized" })
  })
  test("no secret -> 401, exit 1 (fails closed, same as Vercel with CRON_SECRET unset)", async () => {
    const result = await runCronHandler(getHandler(stubRoute)!, buildCronRequest("loops", undefined))
    expect(result.kind === "response" && result.status).toBe(401)
    expect(result.exitCode).toBe(EXIT_ROUTE_FAILED)
  })
  test("a handler that throws is reported, not propagated, with exit 1", async () => {
    const throwing: CronRouteModule = {
      GET: async () => {
        throw new TypeError("boom")
      },
    }
    const result = await runCronHandler(getHandler(throwing)!, buildCronRequest("loops", SECRET))
    expect(result.kind).toBe("threw")
    if (result.kind !== "threw") throw new Error("unreachable")
    expect(result.error).toBe("TypeError: boom")
    expect(result.exitCode).toBe(EXIT_ROUTE_FAILED)
  })
  test("renderResult never includes the secret value", async () => {
    const result = await runCronHandler(getHandler(stubRoute)!, buildCronRequest("loops", SECRET))
    const text = renderResult("loops", true, result)
    expect(text).not.toContain(SECRET)
    expect(text).toContain("status       : 200")
    expect(text).toContain("exit code    : 0")
    const absent = renderResult("loops", false, result)
    expect(absent).toContain("ABSENT")
  })
})

describe("main() usage-error paths (never reach a dynamic import)", () => {
  const collect = () => {
    const lines: string[] = []
    return { lines, log: (line: string) => lines.push(line) }
  }
  test("no argument -> exit 2 with usage", async () => {
    const { lines, log } = collect()
    expect(await main([], {}, log)).toBe(EXIT_USAGE)
    expect(lines.join("\n")).toContain("usage:")
  })
  test("traversal argument -> exit 2, rejected before any fs or import work", async () => {
    const { lines, log } = collect()
    expect(await main(["../../package"], {}, log)).toBe(EXIT_USAGE)
    expect(lines.join("\n")).toContain("invalid cron path")
  })
  test("well-formed but nonexistent cron -> exit 2, nothing invoked", async () => {
    const { lines, log } = collect()
    expect(await main(["definitely-not-a-cron"], { CRON_SECRET: SECRET }, log)).toBe(EXIT_USAGE)
    expect(lines.join("\n")).toContain("no such cron route")
  })
})
