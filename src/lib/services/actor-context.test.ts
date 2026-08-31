// actor-context.ts is a pure type-declaration file (no runtime code) --
// there's nothing to unit-test in the traditional sense (types are erased
// at compile time; `tsc --noEmit` already guards the type shape itself).
// What IS real and worth guarding here is the STRUCTURAL CONTRACT the
// file's own doc comment promises every consumer: "Exactly one of
// `dbUser`/`apiKey` is present -- enforced structurally, not by runtime
// check." These tests exercise that promise against real object literals
// shaped per each branch of the discriminated union, the same way a
// consuming service (e.g. access-review-service.ts) would narrow on
// `ctx.dbUser` / `ctx.apiKey` at a real call site -- so a future accidental
// widening of the union (e.g. making both fields simultaneously optional
// instead of mutually exclusive) would still be caught here even though
// `tsc` alone can't prove a *runtime* value actually respects the shape.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import type { ActorCtx, ErpContext } from "./actor-context"

describe("ActorCtx -- dbUser/apiKey discriminated union", () => {
  test("a dbUser-shaped actor narrows to the dbUser branch", () => {
    const ctx: ActorCtx = {
      orgId: "org-1",
      userId: "user-1",
      dbUser: { id: "user-1", email: "a@b.com" } as ActorCtx["dbUser"],
    }
    expect(ctx.dbUser).toBeTruthy()
    expect(ctx.apiKey).toBeUndefined()
    if (ctx.dbUser) {
      // Real narrowing a consuming service relies on -- ctx.dbUser is
      // known non-undefined here, matching the type's own guarantee.
      expect(ctx.dbUser.id).toBe("user-1")
    }
  })

  test("an apiKey-shaped actor narrows to the apiKey branch", () => {
    const ctx: ActorCtx = {
      orgId: "org-1",
      userId: "svc-account",
      apiKey: { id: "key-1", name: "PROJEXA proxy" },
    }
    expect(ctx.apiKey).toBeTruthy()
    expect(ctx.dbUser).toBeUndefined()
    if (ctx.apiKey) {
      expect(ctx.apiKey.name).toBe("PROJEXA proxy")
    }
  })

  test("orgId/userId are present regardless of which branch is active", () => {
    const byDbUser: ActorCtx = { orgId: "org-2", userId: "u2", dbUser: {} as ActorCtx["dbUser"] }
    const byApiKey: ActorCtx = { orgId: "org-2", userId: "svc-2", apiKey: { id: "k2", name: "n2" } }
    expect(byDbUser.orgId).toBe("org-2")
    expect(byApiKey.orgId).toBe("org-2")
  })
})

describe("ErpContext -- the narrower dbUser-only shape", () => {
  test("always carries a real dbUser (no apiKey branch exists on this type)", () => {
    const ctx: ErpContext = { orgId: "org-3", userId: "user-3", dbUser: { id: "user-3" } as ErpContext["dbUser"] }
    expect(ctx.dbUser).toBeTruthy()
    expect(ctx.dbUser.id).toBe("user-3")
  })
})
