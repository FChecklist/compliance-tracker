// PROJEXA-BUILD-001 U-20b -- shared test seam for requireActingPerson().
//
// WHY THIS EXISTS. Most route tests replace @/lib/supabase/auth-guard
// wholesale with mock.module(). Once a route calls requireActingPerson (or its
// read-side twin resolveOptionalActingPerson), bun refuses to even load the
// route unless the mock exports it too, so each of those tests needs a
// stand-in. Writing ~20 private copies would let them drift from the real
// contract; this one mirrors it, reading the REAL request headers:
//   - session ctx (dbUser set)         -> that user, actor { dbUser };
//   - API key + X-Acting-User(-Email)  -> the person `resolve` returns (or
//     400 USER_NOT_LINKED when it returns null), actor = person AND key;
//   - API key + no signal              -> 400 ACTING_USER_REQUIRED;
//   - no auth                          -> 401.
// So a test that used to lean on the old key-id fallback has to send the
// header, exactly as PROJEXA now must.
//
// The real helper -- including its DB lookup through resolveActingUser -- is
// proven directly in src/lib/supabase/acting-user-required.test.ts; this file
// only stands in for it where a test has already replaced the whole module.
//
// Lives in __test-helpers__ for the same reason as
// src/lib/services/__test-helpers__/img-entitlement-fake.ts: a test seam is not
// a module that owes the repo a sibling test.
import { NextResponse } from "next/server"

type Ctx = {
  orgId: string | null
  dbUser: { id: string } | null
  apiKey: { id: string; name: string } | null
}

type Person = { id: string; [k: string]: unknown }

const REQUIRED_MESSAGE =
  "This write was made with an API key, so it must name the person it is made for: send the X-Acting-User header (their user id) or the X-Acting-User-Email header (their email)"

/** Default resolution: every signal names a person whose id says where it came from. */
function defaultResolve(actorId: string | null, actorEmail: string | null): Person | null {
  return { id: actorId ? `person:${actorId}` : `person:${actorEmail}` }
}

function read(headers: Headers, name: string): string | null {
  const v = headers.get(name)?.trim()
  return v ? v : null
}

export function actingPersonDouble(resolve: (actorId: string | null, actorEmail: string | null) => Person | null = defaultResolve) {
  async function requireActingPerson(request: { headers: Headers }, ctx: Ctx, body?: unknown) {
    if (ctx.dbUser) return { acting: { person: ctx.dbUser, actor: { dbUser: ctx.dbUser } }, error: null }
    if (!ctx.apiKey) return { acting: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
    const actorId = read(request.headers, "x-acting-user")
    const bodyEmail =
      body && typeof body === "object" && typeof (body as { actorEmail?: unknown }).actorEmail === "string"
        ? ((body as { actorEmail: string }).actorEmail.trim() || null)
        : null
    const actorEmail = bodyEmail ?? read(request.headers, "x-acting-user-email")
    if (!actorId && !actorEmail) {
      return { acting: null, error: NextResponse.json({ error: REQUIRED_MESSAGE, code: "ACTING_USER_REQUIRED" }, { status: 400 }) }
    }
    const person = resolve(actorId, actorEmail)
    if (!person) {
      return {
        acting: null,
        error: NextResponse.json({ error: "Your PROJEXA account is not linked to a VERIDIAN user - ask your admin", code: "USER_NOT_LINKED" }, { status: 400 }),
      }
    }
    return {
      acting: { person, actor: { dbUser: person, apiKey: { id: ctx.apiKey.id, name: ctx.apiKey.name }, actingViaApiKey: true as const } },
      error: null,
    }
  }

  async function resolveOptionalActingPerson(request: { headers: Headers }, ctx: Ctx) {
    if (ctx.dbUser) return { acting: { person: ctx.dbUser, actor: { dbUser: ctx.dbUser } }, error: null }
    if (!read(request.headers, "x-acting-user") && !read(request.headers, "x-acting-user-email")) return { acting: null, error: null }
    return requireActingPerson(request, ctx)
  }

  async function resolveWriteActorId(request: { headers: Headers }, ctx: Ctx) {
    const { acting, error } = await requireActingPerson(request, ctx)
    if (error) return { actorId: null, error }
    return { actorId: acting!.person.id, error: null }
  }

  return { requireActingPerson, resolveOptionalActingPerson, resolveWriteActorId }
}

/** The headers a PROJEXA write now carries, for a test's Request. */
export const ACTING_HEADERS = { "X-Acting-User": "projexa-user-1", "X-Acting-User-Email": "arjun@example.test" }
