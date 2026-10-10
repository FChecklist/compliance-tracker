/// <reference types="bun-types" />
// AUDIT TRAIL slice 1: unit test of the pure stamp helper (src/lib/audit-stamp.ts).
// Run: bun test --isolate src/lib/audit-stamp.test.ts
import { describe, test, expect } from "bun:test"
import { buildStamp, ipPrefixOf, stripForgedStamp } from "@/lib/audit-stamp"

const NOW = new Date("2026-10-06T10:00:00.000Z")
const req = (headers: Record<string, string>) => new Request("https://example.test/x", { headers })

describe("buildStamp", () => {
  test("keeps the FULL observed IPv4 and IPv6 address unchanged (owner decision 10.1), and adds a grouping prefix", () => {
    const a = buildStamp(req({ "x-forwarded-for": "203.0.113.77, 10.0.0.1" }), { now: NOW })
    expect(a.ipAddress).toBe("203.0.113.77")
    expect(a.ipPrefix).toBe("203.0.113.0/24")
    const b = buildStamp(req({ "x-forwarded-for": "2001:db8:abcd:12::7" }), { now: NOW })
    expect(b.ipAddress).toBe("2001:db8:abcd:12::7")
    expect(b.ipPrefix).toBe("2001:db8:abcd::/48")
    expect(ipPrefixOf("::1")).toBe("0:0:0::/48")
  })

  test("a malformed address is stored as null, not as text", () => {
    expect(buildStamp(req({ "x-forwarded-for": "not-an-ip" }), { now: NOW }).ipAddress).toBeNull()
    expect(buildStamp(req({ "x-forwarded-for": "999.1.1.1" }), { now: NOW }).ipPrefix).toBeNull()
    expect(buildStamp(undefined, { now: NOW }).ipAddress).toBeNull()
  })

  test("device id: valid kept, invalid rejected", () => {
    expect(buildStamp(req({ "x-px-device": "dev_ABC-12345678" }), { now: NOW }).deviceId).toBe("dev_ABC-12345678")
    expect(buildStamp(req({ "x-px-device": "short" }), { now: NOW }).deviceId).toBeNull()
    expect(buildStamp(req({ "x-px-device": "has space in it!!" }), { now: NOW }).deviceId).toBeNull()
    expect(buildStamp(req({ "x-px-device": "x".repeat(65) }), { now: NOW }).deviceId).toBeNull()
  })

  test("client clock: skew sign is server minus client; garbage and far-off clocks are dropped", () => {
    const behind = buildStamp(req({ "x-px-client-time": "2026-10-06T09:59:00.000Z" }), { now: NOW })
    expect(behind.clientAt?.toISOString()).toBe("2026-10-06T09:59:00.000Z")
    expect(behind.clockSkewMs).toBe(60_000)
    const ahead = buildStamp(req({ "x-px-client-time": String(NOW.getTime() + 5000) }), { now: NOW })
    expect(ahead.clockSkewMs).toBe(-5000)
    expect(buildStamp(req({ "x-px-client-time": "banana" }), { now: NOW })).toMatchObject({ clientAt: null, clockSkewMs: null })
    expect(buildStamp(req({ "x-px-client-time": "1999-01-01T00:00:00Z" }), { now: NOW }).clientAt).toBeNull()
    expect(buildStamp(undefined, { now: NOW }).serverAt).toEqual(NOW)
  })

  test("enumerations: unknown values become null; user agent is kept in full with a family", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
    const s = buildStamp(req({ "user-agent": ua }), { now: NOW, channel: "offline", source: "outbox_replay", product: "projexa", actionClass: "edit", correlationId: "op_1" })
    expect(s).toMatchObject({ channel: "offline", source: "outbox_replay", product: "projexa", actionClass: "edit", correlationId: "op_1", userAgent: ua, uaFamily: "Chrome on Windows" })
    const bad = buildStamp(undefined, { now: NOW, channel: "teleport" as never, source: "magic" as never })
    expect(bad.channel).toBeNull()
    expect(bad.source).toBeNull()
  })
})

describe("stripForgedStamp", () => {
  test("removes channel, source, ai_*, server_at (any depth, any casing) and keeps real business keys", () => {
    const input = { title: "Pour slab", channel: "web", source: "ui", ai_name: "Trusted AI", aiLinkId: "l1", server_at: "2020-01-01", nested: { Channel: "web", qty: 3, list: [{ source: "x", keep: 1 }] } }
    const out = stripForgedStamp(input)
    expect(out).toEqual({ title: "Pour slab", nested: { qty: 3, list: [{ keep: 1 }] } })
    expect(input.channel).toBe("web") // input untouched
  })
})
