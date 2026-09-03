/// <reference types="bun-types" />
// R67 F-28. The VERIDIAN-side half of the Server-Timing split.

import { describe, expect, test } from "bun:test"
import { NextResponse } from "next/server"
import { withRouteTiming } from "./route-timing"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("withRouteTiming", () => {
  test("stamps app;dur measured around the handler", async () => {
    const res = await withRouteTiming("GET", async () => {
      await sleep(25)
      return NextResponse.json({ boqs: [] })
    })
    const header = res.headers.get("Server-Timing")
    expect(header).toMatch(/^app;dur=\d+$/)
    // A real measurement, not a constant: the handler genuinely slept.
    const ms = Number(header!.split("=")[1])
    expect(ms).toBeGreaterThanOrEqual(20)
  })

  test("keeps the body, the status and every other header exactly as the handler built them", async () => {
    const res = await withRouteTiming("POST", async () =>
      NextResponse.json({ id: "b1" }, { status: 201, headers: { "X-Thing": "kept" } })
    )
    expect(res.status).toBe(201)
    expect(res.headers.get("X-Thing")).toBe("kept")
    expect(await res.json()).toEqual({ id: "b1" })
  })

  test("a 4xx from the handler is passed through untouched, and still timed", async () => {
    // The failures are the rows a latency table most wants: a request that
    // spent time and then refused is not a free request.
    const res = await withRouteTiming("GET", async () =>
      NextResponse.json({ error: "projectId query param is required" }, { status: 400 })
    )
    expect(res.status).toBe(400)
    expect(res.headers.get("Server-Timing")).toContain("app;dur=")
  })

  test("an existing Server-Timing entry is merged, never overwritten", async () => {
    const res = await withRouteTiming("GET", async () => {
      const r = NextResponse.json({ ok: true })
      r.headers.set("Server-Timing", "db;dur=12")
      return r
    })
    expect(res.headers.get("Server-Timing")).toMatch(/^db;dur=12, app;dur=\d+$/)
  })

  test("a throwing handler is re-thrown, not turned into a malformed success", async () => {
    await expect(
      withRouteTiming("GET", async () => {
        throw new Error("pool exhausted")
      })
    ).rejects.toThrow("pool exhausted")
  })
})
