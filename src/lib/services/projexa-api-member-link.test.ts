/// <reference types="bun-types" />
// projexa-api POST /link-member (supabase/functions/projexa-api/member-link.ts), the Edge half of "every member gets their own VERIDIAN user"
// (drizzle/0728). The handler runs for real with fake dependencies:
//   * the trust chain: the organisation and the PROJEXA role come ONLY from the membership read with the person's own token and the
//     veridian_credentials row; a body, a query or a header naming another org or role changes nothing
//   * refusals: no/bad/foreign-issuer token 401, an Auth outage 503, no membership 400, a lookup failing twice 503, an unmapped role or an org without
//     VERIDIAN credentials 200 linked:false with no SQL call
//   * the two production dependencies against a fake PostgREST / rpc
// Run: bun test --isolate src/lib/services/projexa-api-member-link.test.ts
import { describe, test, expect } from "bun:test"
import {
  createEnsureMemberRpc,
  createVeridianOrgIdLookup,
  handleMemberLink,
  isMemberLinkRequest,
  type EnsureMemberRpc,
  type MemberLinkDeps,
} from "../../../supabase/functions/projexa-api/member-link"
import type { SessionVerdict } from "../../../supabase/functions/ai-work-link/session"

const ISSUER = "https://evpckeuxgvahguwsaeul.supabase.co/auth/v1"
const SUB = "0d4b7c1e-1111-4222-8333-444455556666"
const PX_ORG = "9a1c2d3e-aaaa-4bbb-8ccc-ddddeeeeffff"
const URL_ = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-api/link-member"

type Call = Parameters<EnsureMemberRpc>[0]

function deps(o: Partial<MemberLinkDeps> & { role?: string | null; verdict?: SessionVerdict; calls?: Call[]; outcome?: string; sqlRole?: string | null } = {}): MemberLinkDeps {
  const calls = o.calls ?? []
  return {
    session: async () => o.verdict ?? { ok: true, sub: SUB, email: "pat@px.example.test", issuer: ISSUER, iat: 1 },
    issuer: ISSUER,
    membership: o.membership ?? (async () => ({ ok: true, row: { organization_id: PX_ORG, role: o.role === undefined ? "pm" : o.role } })),
    veridianOrgId: o.veridianOrgId ?? (async (id) => (id === PX_ORG ? "vorg-1" : null)),
    ensure:
      o.ensure ??
      (async (args) => {
        calls.push(args)
        return { ok: true, outcome: o.outcome ?? "created", role: o.sqlRole === undefined ? "manager" : o.sqlRole }
      }),
    log: () => {},
  }
}

const post = (init: RequestInit = {}, url = URL_) => new Request(url, { method: "POST", headers: { authorization: "Bearer tok", origin: "http://localhost:3100", ...(init.headers ?? {}) }, body: init.body })

describe("POST /link-member", () => {
  test("links with the membership's org and role; the caller cannot name another org or role", async () => {
    const calls: Call[] = []
    const res = await handleMemberLink(post({ body: JSON.stringify({ organizationId: "evil-org", role: "owner", p_org_id: "vorg-evil", p_projexa_role: "owner" }), headers: { "x-org": "evil" } }, `${URL_}?org=evil&role=owner`), deps({ calls }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ linked: true, outcome: "created", role: "manager" })
    expect(calls).toEqual([{ p_org_id: "vorg-1", p_auth_user_id: SUB, p_email: "pat@px.example.test", p_name: null, p_projexa_role: "pm" }])
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3100")
    expect(res.headers.get("cache-control")).toBe("no-store")
  })

  test("already_linked and linked_existing are linked; every guard outcome is linked:false", async () => {
    for (const outcome of ["already_linked", "linked_existing"]) expect(await (await handleMemberLink(post(), deps({ outcome }))).json()).toMatchObject({ linked: true, outcome })
    for (const outcome of ["email_taken", "linked_elsewhere", "deactivated", "not_eligible", "role_not_mapped", "bad_input"]) {
      expect(await (await handleMemberLink(post(), deps({ outcome, sqlRole: null }))).json()).toEqual({ linked: false, outcome })
    }
  })

  test("an unmapped PROJEXA role, a missing role and an org without VERIDIAN credentials never reach the SQL", async () => {
    for (const role of ["superuser", null, ""]) {
      const calls: Call[] = []
      const res = await handleMemberLink(post(), deps({ role, calls }))
      expect(await res.json()).toEqual({ linked: false, outcome: "role_not_mapped" })
      expect(calls).toEqual([])
    }
    const calls: Call[] = []
    expect(await (await handleMemberLink(post(), deps({ calls, veridianOrgId: async () => null }))).json()).toEqual({ linked: false, outcome: "not_eligible" })
    expect(await (await handleMemberLink(post(), deps({ calls, veridianOrgId: async () => { throw new Error("down") } }))).json()).toEqual({ linked: false, outcome: "not_eligible" })
    expect(calls).toEqual([])
  })

  test("refusals: no token, a bad token, another issuer's token 401; an Auth outage 503; no email linked:false", async () => {
    expect((await handleMemberLink(new Request(URL_, { method: "POST" }), deps())).status).toBe(401)
    expect((await handleMemberLink(post(), deps({ verdict: { ok: false, reason: "invalid" } }))).status).toBe(401)
    expect((await handleMemberLink(post(), deps({ verdict: { ok: true, sub: SUB, email: "a@b.test", issuer: "https://pcrjmlpuqsbocqfwoxod.supabase.co/auth/v1", iat: 1 } }))).status).toBe(401)
    const out = await handleMemberLink(post(), deps({ verdict: { ok: false, reason: "unavailable" } }))
    expect(out.status).toBe(503)
    expect(out.headers.get("retry-after")).toBe("5")
    expect(await (await handleMemberLink(post(), deps({ verdict: { ok: true, sub: SUB, email: null, issuer: ISSUER, iat: 1 } }))).json()).toEqual({ linked: false, outcome: "no_email" })
  })

  test("membership: none 400; failing twice 503 (one retry); the SQL failing 503", async () => {
    expect((await handleMemberLink(post(), deps({ membership: async () => ({ ok: true, row: null }) }))).status).toBe(400)
    let n = 0
    const flaky = deps({ membership: async () => (++n === 1 ? { ok: false } : { ok: true, row: { organization_id: PX_ORG, role: "member" } }), sqlRole: "member" })
    expect(await (await handleMemberLink(post(), flaky)).json()).toEqual({ linked: true, outcome: "created", role: "member" })
    expect((await handleMemberLink(post(), deps({ membership: async () => ({ ok: false }) }))).status).toBe(503)
    expect((await handleMemberLink(post(), deps({ ensure: async () => ({ ok: false }) }))).status).toBe(503)
    expect((await handleMemberLink(post(), deps({ ensure: async () => { throw new Error("x") } }))).status).toBe(503)
  })

  test("methods and routing", async () => {
    expect((await handleMemberLink(new Request(URL_, { method: "OPTIONS", headers: { origin: "https://projexa-ai.com" } }), deps())).status).toBe(204)
    expect((await handleMemberLink(new Request(URL_, { method: "GET", headers: { authorization: "Bearer t" } }), deps())).status).toBe(405)
    expect((await handleMemberLink(new Request(URL_, { method: "OPTIONS", headers: { origin: "https://evil.example" } }), deps())).headers.get("access-control-allow-origin")).toBeNull()
    expect(isMemberLinkRequest(new Request(URL_))).toBe(true)
    expect(isMemberLinkRequest(new Request("https://x.supabase.co/functions/v1/projexa-api/link-member/"))).toBe(true)
    expect(isMemberLinkRequest(new Request("https://x.supabase.co/functions/v1/projexa-api/api/documents"))).toBe(false)
    expect(isMemberLinkRequest(new Request("https://x.supabase.co/functions/v1/projexa-api/api/link-member-x"))).toBe(false)
  })
})

describe("the production dependencies", () => {
  test("veridianOrgId reads only veridian_org_id with the service role; never the key", async () => {
    const seen: { url?: string; headers?: Record<string, string> } = {}
    const f = (async (url: string, init: RequestInit) => {
      seen.url = url
      seen.headers = init.headers as Record<string, string>
      return new Response(JSON.stringify([{ veridian_org_id: "vorg-9" }]), { status: 200 })
    }) as unknown as typeof fetch
    const lookup = createVeridianOrgIdLookup({ projexaUrl: "https://px.example/", serviceRoleKey: "srk", fetchImpl: f })
    expect(await lookup(PX_ORG)).toBe("vorg-9")
    expect(seen.url).toBe(`https://px.example/rest/v1/veridian_credentials?select=veridian_org_id&organization_id=eq.${PX_ORG}&limit=1`)
    expect(seen.url).not.toContain("api_key")
    expect(seen.headers).toMatchObject({ apikey: "srk", Authorization: "Bearer srk" })
    expect(await lookup("not-a-uuid")).toBeNull()
    expect(await createVeridianOrgIdLookup({ projexaUrl: "https://px.example", serviceRoleKey: "srk", fetchImpl: (async () => new Response("[]", { status: 200 })) as unknown as typeof fetch })(PX_ORG)).toBeNull()
    expect(await createVeridianOrgIdLookup({ projexaUrl: "https://px.example", serviceRoleKey: "srk", fetchImpl: (async () => new Response("no", { status: 500 })) as unknown as typeof fetch })(PX_ORG)).toBeNull()
  })

  test("ensure calls projexa_ensure_member_user with the named arguments and reads its one row", async () => {
    const seen: unknown[] = []
    const ensure = createEnsureMemberRpc(async (fn, args) => {
      seen.push([fn, args])
      return { data: [{ outcome: "created", user_id: "u1", role: "member" }], error: null }
    })
    const args = { p_org_id: "o", p_auth_user_id: SUB, p_email: "e@x.test", p_name: null, p_projexa_role: "site_engineer" }
    expect(await ensure(args)).toEqual({ ok: true, outcome: "created", role: "member" })
    expect(seen).toEqual([["projexa_ensure_member_user", args]])
    expect(await createEnsureMemberRpc(async () => ({ data: null, error: { message: "boom" } }))(args)).toEqual({ ok: false })
    expect(await createEnsureMemberRpc(async () => ({ data: [], error: null }))(args)).toEqual({ ok: false })
  })
})
