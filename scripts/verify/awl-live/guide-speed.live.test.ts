/// <reference types="bun-types" />
// Audit 100, checklist rows B31, B32 and B33: how fast does the deployed work-link GUIDE answer, and where do the slow calls come from?
//   B31: the guide answers well under 8 s.     B32: the median is under 1 s.     B33: the ~21 s stalls are not the function.
//
// METHOD. N sequential GETs of the guide of a throwaway link, each made by curl (the same kind of client an outside AI's tool uses) with
// curl's own timing fields:
//   connect   time_connect                            TCP connection set-up (on this laptop this is what stalls, 15 to 21 s on a bad moment)
//   server    time_starttransfer - time_appconnect    the SERVER's time to first byte after TLS: Edge Function + database, no network set-up
//   total     time_total                              everything, from the caller's point of view
// After every guide call a CONTROL call is made to a host that has nothing to do with Supabase (cloudflare.com/cdn-cgi/trace) and its
// connect time is recorded, so a stall that hits the control host too is plainly the caller's network.
// Every call is classified, nothing is dropped from the percentiles:
//   ok            200, connected in under 5 s
//   net_stall     the TCP connection took 5 s or more, or never completed (curl failed before the first byte): the caller's network
//   server_stall  connected fine, and then the first byte took 8 s or more, or the answer was not 200: the FUNCTION. Must be zero.
// Assertions: no server_stall; server p50 under 1 s and p95 under 8 s; the caller-visible total p50 under 1 s; net stalls are limited to
// 10 percent of the calls (a laptop with a worse network than that is not a measurement of the function). Everything is written to
// ai-os/audit37/evidence/guide-speed-<UTC time>.json (committed evidence of the run).
//
// The throwaway link belongs to a manager of the e2e test organisation and is REVOKED in afterAll. Reads only: the test never calls /actions.
// Run: bun test --isolate ./scripts/verify/awl-live/guide-speed.live.test.ts       (N requests: AWL_SPEED_N, default 40, minimum 30)
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { liveEnabled, mintThrowaway, revoke, linkStatus, expectPerson, PEOPLE, redact, type Throwaway } from "./live-lib"

const N = Math.max(30, Number(process.env.AWL_SPEED_N || 40))
const NULL_DEVICE = process.platform === "win32" ? "NUL" : "/dev/null"
const CONTROL_URL = "https://www.cloudflare.com/cdn-cgi/trace"
const NET_STALL_S = 5
const SERVER_STALL_S = 8

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]
}

export type Sample = { code: number; connect: number; server: number; total: number; bytes: number; curl_exit: number; kind?: "ok" | "net_stall" | "server_stall" }

export function classify(s: Sample): "ok" | "net_stall" | "server_stall" {
  // never connected (time_connect 0), or connected slowly: the caller's network
  if (s.connect === 0 || s.connect >= NET_STALL_S) return "net_stall"
  // connected fast, then a failed transfer, a non-200 or a slow first byte: the function
  if (s.curl_exit !== 0 || s.code !== 200 || s.server >= SERVER_STALL_S) return "server_stall"
  return "ok"
}

/** One curl. A curl that fails is NOT dropped: it keeps whatever timing curl reported plus the time it took. */
function timeOne(url: string): Sample {
  const fmt = "%{http_code} %{time_connect} %{time_appconnect} %{time_starttransfer} %{time_total} %{size_download}"
  const t0 = performance.now()
  const r = spawnSync("curl", ["-s", "--connect-timeout", "30", "--max-time", "60", "-o", NULL_DEVICE, "-w", fmt, url], { encoding: "utf8" })
  const elapsed = (performance.now() - t0) / 1000
  const [code, connect, appconnect, starttransfer, total, bytes] = (r.stdout || "").trim().split(/\s+/).map(Number)
  const exit = r.status ?? -1
  if (exit !== 0 || !Number.isFinite(total)) {
    return { code: Number.isFinite(code) ? code : 0, connect: Number.isFinite(connect) ? connect : 0, server: elapsed, total: elapsed, bytes: 0, curl_exit: exit }
  }
  return { code, connect, server: starttransfer - appconnect, total, bytes, curl_exit: 0 }
}

const summary = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return { min: s[0], p50: percentile(s, 50), p95: percentile(s, 95), max: s[s.length - 1] }
}

describe.skipIf(!liveEnabled())("guide speed, live", () => {
  let link: Throwaway
  const samples: Sample[] = []

  beforeAll(async () => {
    await expectPerson(PEOPLE.manager2, "manager")
    link = await mintThrowaway(PEOPLE.manager2, "audit100 guide-speed")
  }, 240_000)

  afterAll(async () => {
    if (link) await revoke(link.id)
  })

  test(`N=${N} sequential guide GETs: no server stall, server p50 under 1 s and p95 under 8 s, caller p50 under 1 s`, () => {
    const warm = timeOne(link.url) // one cold-isolate call, reported but not part of the percentiles
    const controls: Sample[] = []
    for (let i = 0; i < N; i++) {
      samples.push(timeOne(link.url))
      controls.push(timeOne(CONTROL_URL))
    }
    for (const s of samples) s.kind = classify(s)
    const count = (k: string) => samples.filter((s) => s.kind === k).length
    const answered = samples.filter((s) => s.code === 200)

    const out = {
      measured_at: new Date().toISOString(),
      what: "ai-work-link guide GET, user link of a manager of the e2e organisation, curl timing fields, sequential",
      n: samples.length,
      warmup: warm,
      ok: count("ok"),
      net_stall: count("net_stall"),
      server_stall: count("server_stall"),
      guide_bytes: answered[0]?.bytes ?? 0,
      server_first_byte_s: summary(samples.map((s) => s.server)),
      server_first_byte_s_answered_only: summary(answered.map((s) => s.server)),
      total_s: summary(samples.map((s) => s.total)),
      connect_s: summary(samples.filter((s) => s.connect > 0).map((s) => s.connect)),
      control_host_connect_s: { host: "www.cloudflare.com", ...summary(controls.map((s) => (s.connect > 0 ? s.connect : s.total))), stalls_over_5s: controls.filter((s) => s.connect >= NET_STALL_S || s.curl_exit !== 0).length },
      stalled_calls: samples.filter((s) => s.kind !== "ok").map((s) => ({ kind: s.kind, code: s.code, curl_exit: s.curl_exit, connect_s: s.connect, server_s: s.server, total_s: s.total })),
    }
    const dir = join(import.meta.dir, "..", "..", "..", "ai-os", "audit37", "evidence")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `guide-speed-${out.measured_at.replace(/[:.]/g, "-")}.json`), redact(JSON.stringify(out, null, 2)) + "\n")
    console.log(redact(JSON.stringify(out)))

    expect(out.server_stall).toBe(0)
    expect(out.guide_bytes).toBeGreaterThan(5_000)
    expect(out.server_first_byte_s_answered_only.p50).toBeLessThan(1)
    expect(out.server_first_byte_s_answered_only.p95).toBeLessThan(SERVER_STALL_S)
    expect(out.total_s.p50).toBeLessThan(1)
    expect(out.net_stall).toBeLessThanOrEqual(Math.ceil(N * 0.1))
  }, 20 * 60_000)

  test("revoking the link makes the guide answer 410 on the very next call", async () => {
    await revoke(link.id)
    expect(await linkStatus(link.id)).toBe("revoked")
    expect(timeOne(link.url).code).toBe(410)
  }, 240_000)
})

describe("classification and percentile helpers (no network)", () => {
  test("nearest-rank percentiles", () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(percentile(s, 50)).toBe(5)
    expect(percentile(s, 95)).toBe(10)
    expect(percentile([7], 95)).toBe(7)
  })

  const base = { bytes: 100, curl_exit: 0 }
  test("a slow TCP connect is a network stall, a slow first byte after a fast connect is a server stall", () => {
    expect(classify({ ...base, code: 200, connect: 0.1, server: 0.4, total: 0.6 })).toBe("ok")
    expect(classify({ ...base, code: 200, connect: 15.1, server: 0.4, total: 15.8 })).toBe("net_stall")
    expect(classify({ ...base, code: 200, connect: 0.1, server: 9, total: 9.3 })).toBe("server_stall")
    expect(classify({ ...base, code: 503, connect: 0.1, server: 0.4, total: 0.6 })).toBe("server_stall")
    // curl gave up before the connection finished
    expect(classify({ ...base, code: 0, connect: 0, server: 21, total: 21, curl_exit: 28 })).toBe("net_stall")
    // connected, then the transfer died: that is on the function side of the line
    expect(classify({ ...base, code: 0, connect: 0.2, server: 21, total: 21, curl_exit: 28 })).toBe("server_stall")
  })
})
