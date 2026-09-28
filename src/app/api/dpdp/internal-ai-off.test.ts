/// <reference types="bun-types" />
// Owner directive 2026-09-28: the in-app (internal) AI work link option of
// /dpdp is not available; the external AI work link (Edge Function, made
// from the static app) and email are the DPDP work flow. This pins, at the
// real exported handlers, that with DPDP_INTERNAL_AI_ENABLED unset every
// internal-AI route answers 404 BEFORE it looks at a session, and that the
// menu does not offer the page. It also pins the switch back on, so "off"
// is proven to be the gate and not a deleted route.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

let sessionCalls = 0
await mock.module("@/lib/services/dpdp-session", () => ({
  requireDpdpSession: async () => {
    sessionCalls++
    return { response: new Response(JSON.stringify({ error: "Unauthorised" }), { status: 401 }) }
  },
  getDpdpAuthContext: async () => null,
}))

const aiLink = await import("./ai-link/route")
const aiWork = await import("./ai-work/route")
const aiWorkApply = await import("./ai-work/[proposalId]/apply/route")
const aiWorkDiscard = await import("./ai-work/[proposalId]/discard/route")
const aiToken = await import("./ai/[token]/route")
const { dpdpInternalAiEnabled } = await import("@/lib/dpdp-internal-ai")
const { navFor } = await import("@/app/dpdp/(app)/_components/DpdpShell")
const aiLinkPage = (await import("@/app/dpdp/(app)/ai-link/page")).default
const aiWorkPage = (await import("@/app/dpdp/(app)/ai-work/page")).default

const saved = process.env.DPDP_INTERNAL_AI_ENABLED
beforeEach(() => {
  delete process.env.DPDP_INTERNAL_AI_ENABLED
  sessionCalls = 0
})
afterEach(() => {
  if (saved === undefined) delete process.env.DPDP_INTERNAL_AI_ENABLED
  else process.env.DPDP_INTERNAL_AI_ENABLED = saved
})

const params = { params: Promise.resolve({ proposalId: "p1" }) }
const req = () => new Request("https://veridian-aios.com/api/dpdp/x", { method: "POST", body: "{}" }) as never

describe("internal AI routes are not available by default", () => {
  test("the switch is off unless it is exactly 1", () => {
    expect(dpdpInternalAiEnabled()).toBe(false)
    for (const v of ["0", "true", "yes", ""]) {
      process.env.DPDP_INTERNAL_AI_ENABLED = v
      expect(dpdpInternalAiEnabled()).toBe(false)
    }
    process.env.DPDP_INTERNAL_AI_ENABLED = "1"
    expect(dpdpInternalAiEnabled()).toBe(true)
  })

  test("every internal-AI handler answers 404 and never reaches the session check", async () => {
    const responses = [
      await aiLink.GET(),
      await aiLink.POST(),
      await aiWork.GET(),
      await aiWork.POST(req()),
      await aiWorkApply.POST(req(), params),
      await aiWorkDiscard.POST(req(), params),
      await aiToken.GET(req(), { params: Promise.resolve({ token: "a".repeat(64) }) }),
    ]
    expect(responses.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 404, 404])
    expect(sessionCalls).toBe(0)
  })

  test("switched on, the same handlers reach the session check again (the gate, not a deleted route)", async () => {
    process.env.DPDP_INTERNAL_AI_ENABLED = "1"
    const r = await aiLink.GET()
    expect(r.status).toBe(401)
    expect(sessionCalls).toBe(1)
  })
})

describe("the pages", () => {
  // next/navigation's notFound() throws an error whose digest starts NEXT_HTTP_ERROR_FALLBACK;404
  const isNotFound = (fn: () => unknown) => {
    try { fn() } catch (e) { return String((e as { digest?: string }).digest).includes("404") }
    return false
  }

  test("/dpdp/ai-link and /dpdp/ai-work render a 404 by default", () => {
    expect(isNotFound(() => aiLinkPage())).toBe(true)
    expect(isNotFound(() => aiWorkPage())).toBe(true)
  })

  test("and render again when the switch is on", () => {
    process.env.DPDP_INTERNAL_AI_ENABLED = "1"
    expect(isNotFound(() => aiLinkPage())).toBe(false)
    expect(isNotFound(() => aiWorkPage())).toBe(false)
  })
})

describe("the menu", () => {
  const labels = (internalAi?: boolean) =>
    navFor("owner", ["fiduciary"], 0, internalAi).flatMap((g) => g.items.map((i) => i.href))

  test("offers no AI Link entry by default, for owners or staff", () => {
    expect(labels()).not.toContain("/dpdp/ai-link")
    expect(navFor("staff", [], 0).flatMap((g) => g.items.map((i) => i.href))).not.toContain("/dpdp/ai-link")
  })

  test("offers it only when the switch is on", () => {
    expect(labels(true)).toContain("/dpdp/ai-link")
  })
})
