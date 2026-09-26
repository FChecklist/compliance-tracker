/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-09b (blockers B1 and B6 of the ai-work-link-exec bundle): the two behaviour-preserving moves. ServiceError now lives in the leaf
// service-error.ts and compliance-service.ts re-exports it, so the class is ONE object for every importer (`instanceof` holds across modules); hasRole now
// lives in the leaf role-rank.ts and auth-guard.ts re-exports it. Nothing about either changed: same defaults, same ranks.
//
// Falsifiability: copy the class into compliance-service.ts again -> "the class is one object" fails; make hasRole compare > instead of >= -> "hasRole"
// fails.
//
// Run: bun test --isolate src/lib/services/service-error.test.ts
import { describe, expect, test } from "bun:test"
import { hasRole as fromLeaf, ROLE_RANK } from "@/lib/supabase/role-rank"
import * as complianceService from "./compliance-service"
import * as authGuard from "@/lib/supabase/auth-guard"
import { ServiceError, serviceErrorBody } from "./service-error"

describe("ServiceError", () => {
  test("the class is one object: compliance-service re-exports the leaf's, so instanceof holds across modules", () => {
    expect(complianceService.ServiceError).toBe(ServiceError)
    expect(complianceService.serviceErrorBody).toBe(serviceErrorBody)
    expect(new complianceService.ServiceError("x", 404) instanceof ServiceError).toBe(true)
  })

  test("the defaults are the ones the class always had: kind and retryable from the status, a catalogue code fills the friendly text", () => {
    const business = new ServiceError("bad input", 400)
    expect({ kind: business.kind, retryable: business.retryable, status: business.status }).toEqual({ kind: "business", retryable: false, status: 400 })
    const system = new ServiceError("db down", 503)
    expect({ kind: system.kind, retryable: system.retryable }).toEqual({ kind: "system", retryable: true })
    const forced = new ServiceError("lock contention", 409, { kind: "system", retryable: true, code: "TEXT_TOO_LONG" })
    expect({ kind: forced.kind, retryable: forced.retryable, code: forced.code }).toEqual({ kind: "system", retryable: true, code: "TEXT_TOO_LONG" })
    expect(serviceErrorBody(business)).toEqual({ error: "bad input" })
  })
})

describe("hasRole", () => {
  test("auth-guard re-exports the leaf's hasRole and ROLE_RANK unchanged", () => {
    expect(authGuard.hasRole).toBe(fromLeaf)
    expect(authGuard.ROLE_RANK).toBe(ROLE_RANK)
  })

  test("hasRole: at least the minimum rank, null is never allowed, an unknown role is rank 0", () => {
    expect(fromLeaf({ role: "manager" }, "member")).toBe(true)
    expect(fromLeaf({ role: "member" }, "member")).toBe(true)
    expect(fromLeaf({ role: "viewer" }, "member")).toBe(false)
    expect(fromLeaf({ role: "admin" }, "manager")).toBe(true)
    expect(fromLeaf({ role: "no_such_role" }, "viewer")).toBe(false)
    expect(fromLeaf(null, "viewer")).toBe(false)
  })
})
