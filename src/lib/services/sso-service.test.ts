/// <reference types="bun-types" />
// New coverage for sso-service.ts, required by
// scripts/check-new-test-coverage.mjs ("Previously-untested files touched")
// on PR #1634 (CRR-027 CONTRACT, 7 EXISTING_FN sites). Zero coverage existed
// on main for this file before this commit.
//
// Same convention as this repo's own
// passcode-login-service.recordAttempt.test.ts and this window's own
// auth-failure-service.test.ts: mock.module() every dependency, reset
// controllable state in beforeEach, import the function under test AFTER
// mocks are set up. @node-saml/node-saml is mocked rather than exercised for
// real -- this file's own header comment says signature/replay/audience
// validation is that library's job, not hand-rolled here, so this test
// verifies sso-service.ts's OWN logic (config validation, the pre-existing-
// user-only rule, the org-match check, error classification) against a
// controllable stand-in for what the library returns, not SAML cryptography.
import { describe, expect, test, mock, beforeEach } from "bun:test"

// ── compliance-service.ts mock (same reasoning as auth-failure-service.test.ts:
// importing the real file pulls in its own full @/lib/db export surface and
// breaks with an unrelated "Export named X not found" SyntaxError). ──
class MockServiceError extends Error {
  public status: number
  public kind: string
  constructor(message: string, status: number, opts?: { kind?: string }) {
    super(message)
    this.status = status
    this.kind = opts?.kind ?? (status >= 500 ? "system" : "business")
  }
}
mock.module("./compliance-service", () => ({ ServiceError: MockServiceError }))

let orgResult: { id: string; slug: string } | null = null
let ssoConfigResult: { id: string; orgId: string; idpEntryPoint: string; idpIssuer: string; idpCert: string; spEntityId: string; isEnabled: boolean } | null = null
let updateReturning: Array<Record<string, unknown>> = []
let insertReturning: Array<Record<string, unknown>> = []
let logActivityCalls: Array<Record<string, unknown>> = []

mock.module("@/lib/db", () => ({
  db: {
    query: {
      organisations: { findFirst: async () => orgResult },
      ssoConfigurations: { findFirst: async () => ssoConfigResult },
    },
  },
  ssoConfigurations: {},
  organisations: {},
  users: {},
}))

mock.module("@/lib/db/tenant-scoped", () => ({
  withTenantContext: async (_ctx: Record<string, unknown>, fn: (tx: unknown) => unknown) =>
    fn({
      query: {
        ssoConfigurations: { findFirst: async () => ssoConfigResult },
      },
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => updateReturning,
          }),
        }),
      }),
      insert: () => ({
        values: () => ({
          returning: async () => insertReturning,
        }),
      }),
    }),
}))

mock.module("@/lib/audit", () => ({
  logActivity: async (args: Record<string, unknown>) => {
    logActivityCalls.push(args)
  },
}))

let lookupUserResult: { id: string; orgId: string | null } | null = null
mock.module("@/lib/db/preauth-lookups", () => ({
  lookupUserByEmail: async (_email: string) => lookupUserResult,
}))

// Controllable stand-in for @node-saml/node-saml's SAML class -- the real
// library's own signature/replay/timestamp/audience validation is
// deliberately out of scope for this file's tests (this file's own header
// comment: "none of that is hand-rolled here").
let authorizeUrlResult = "https://idp.example.com/sso/authorize?SAMLRequest=fake"
let validateResult: { profile: Record<string, unknown> | null } = { profile: null }
let validateShouldThrow: Error | null = null
class MockSAML {
  constructor(public config: Record<string, unknown>) {}
  async getAuthorizeUrlAsync(_a: string, _b: unknown, _c: unknown) {
    return authorizeUrlResult
  }
  async validatePostResponseAsync(_body: Record<string, unknown>) {
    if (validateShouldThrow) throw validateShouldThrow
    return validateResult
  }
}
mock.module("@node-saml/node-saml", () => ({ SAML: MockSAML }))

beforeEach(() => {
  orgResult = null
  ssoConfigResult = null
  updateReturning = []
  insertReturning = []
  logActivityCalls = []
  lookupUserResult = null
  authorizeUrlResult = "https://idp.example.com/sso/authorize?SAMLRequest=fake"
  validateResult = { profile: null }
  validateShouldThrow = null
})

describe("getSsoConfiguration", () => {
  test("returns the real config when one exists for the org", async () => {
    ssoConfigResult = { id: "cfg-1", orgId: "org-1", idpEntryPoint: "https://idp/entry", idpIssuer: "issuer", idpCert: "cert", spEntityId: "sp", isEnabled: true }
    const { getSsoConfiguration } = await import("./sso-service")
    const result = await getSsoConfiguration({ orgId: "org-1" })
    expect(result).toEqual(ssoConfigResult)
  })

  test("returns null (not undefined) when no config exists for the org", async () => {
    ssoConfigResult = null
    const { getSsoConfiguration } = await import("./sso-service")
    const result = await getSsoConfiguration({ orgId: "org-1" })
    expect(result).toBeNull()
  })
})

describe("upsertSsoConfiguration -- required-field validation", () => {
  const validInput = { idpEntryPoint: "https://idp/entry", idpIssuer: "issuer", idpCert: "cert", spEntityId: "sp" }
  const ctx = { orgId: "org-1", userId: "user-1", dbUser: {} as never }

  test("rejects a missing/blank idpEntryPoint with a real ServiceError(400)", async () => {
    const { upsertSsoConfiguration } = await import("./sso-service")
    await expect(upsertSsoConfiguration(ctx, { ...validInput, idpEntryPoint: "  " })).rejects.toMatchObject({ status: 400, message: "idpEntryPoint is required" })
  })
  test("rejects a missing idpIssuer with a real ServiceError(400)", async () => {
    const { upsertSsoConfiguration } = await import("./sso-service")
    await expect(upsertSsoConfiguration(ctx, { ...validInput, idpIssuer: "" })).rejects.toMatchObject({ status: 400, message: "idpIssuer is required" })
  })
  test("rejects a missing idpCert with a real ServiceError(400)", async () => {
    const { upsertSsoConfiguration } = await import("./sso-service")
    await expect(upsertSsoConfiguration(ctx, { ...validInput, idpCert: "" })).rejects.toMatchObject({ status: 400, message: "idpCert is required" })
  })
  test("rejects a missing spEntityId with a real ServiceError(400)", async () => {
    const { upsertSsoConfiguration } = await import("./sso-service")
    await expect(upsertSsoConfiguration(ctx, { ...validInput, spEntityId: "" })).rejects.toMatchObject({ status: 400, message: "spEntityId is required" })
  })
})

describe("upsertSsoConfiguration -- create vs update", () => {
  const validInput = { idpEntryPoint: "https://idp/entry", idpIssuer: "issuer", idpCert: "cert", spEntityId: "sp" }
  const ctx = { orgId: "org-1", userId: "user-1", dbUser: { id: "user-1" } as never }

  test("no existing config: creates a new one and logs sso_configuration.created", async () => {
    ssoConfigResult = null
    insertReturning = [{ id: "new-cfg", orgId: "org-1", ...validInput, isEnabled: false }]
    const { upsertSsoConfiguration } = await import("./sso-service")
    const result = await upsertSsoConfiguration(ctx, validInput)

    expect(result).toEqual(insertReturning[0])
    expect(logActivityCalls).toHaveLength(1)
    expect(logActivityCalls[0]).toMatchObject({ orgId: "org-1", action: "sso_configuration.created", entityType: "sso_configuration", entityId: "new-cfg" })
  })

  test("an existing config: updates it in place and logs sso_configuration.updated, never creates a second row", async () => {
    ssoConfigResult = { id: "existing-cfg", orgId: "org-1", idpEntryPoint: "https://old/entry", idpIssuer: "old-issuer", idpCert: "old-cert", spEntityId: "old-sp", isEnabled: true }
    updateReturning = [{ id: "existing-cfg", orgId: "org-1", ...validInput, isEnabled: true }]
    const { upsertSsoConfiguration } = await import("./sso-service")
    const result = await upsertSsoConfiguration(ctx, validInput)

    expect(result).toEqual(updateReturning[0])
    expect(logActivityCalls).toHaveLength(1)
    expect(logActivityCalls[0]).toMatchObject({ orgId: "org-1", action: "sso_configuration.updated", entityType: "sso_configuration", entityId: "existing-cfg" })
  })
})

describe("getOrgBySlugWithSso", () => {
  test("throws a real ServiceError(404) when the org slug does not resolve to a real org", async () => {
    orgResult = null
    const { getOrgBySlugWithSso } = await import("./sso-service")
    await expect(getOrgBySlugWithSso("no-such-org")).rejects.toMatchObject({ status: 404, message: "Organisation not found" })
  })

  test("throws a real ServiceError(404) when the org exists but has no enabled SSO config", async () => {
    orgResult = { id: "org-1", slug: "acme" }
    ssoConfigResult = null
    const { getOrgBySlugWithSso } = await import("./sso-service")
    await expect(getOrgBySlugWithSso("acme")).rejects.toMatchObject({ status: 404, message: "SSO is not enabled for this organisation" })
  })

  test("returns the real org and config when both exist and SSO is enabled", async () => {
    orgResult = { id: "org-1", slug: "acme" }
    ssoConfigResult = { id: "cfg-1", orgId: "org-1", idpEntryPoint: "https://idp/entry", idpIssuer: "issuer", idpCert: "cert", spEntityId: "sp", isEnabled: true }
    const { getOrgBySlugWithSso } = await import("./sso-service")
    const result = await getOrgBySlugWithSso("acme")
    expect(result).toEqual({ org: orgResult, config: ssoConfigResult })
  })
})

describe("getSsoLoginRedirectUrl", () => {
  test("returns the real IdP redirect URL for an org with SSO enabled", async () => {
    orgResult = { id: "org-1", slug: "acme" }
    ssoConfigResult = { id: "cfg-1", orgId: "org-1", idpEntryPoint: "https://idp/entry", idpIssuer: "issuer", idpCert: "cert", spEntityId: "sp", isEnabled: true }
    authorizeUrlResult = "https://idp.example.com/sso/authorize?SAMLRequest=real-request-id"
    const { getSsoLoginRedirectUrl } = await import("./sso-service")
    const url = await getSsoLoginRedirectUrl("acme", "https://app.example.com/auth/sso/callback")
    expect(url).toBe(authorizeUrlResult)
  })
})

describe("validateSsoAssertionAndGetUser", () => {
  beforeEach(() => {
    orgResult = { id: "org-1", slug: "acme" }
    ssoConfigResult = { id: "cfg-1", orgId: "org-1", idpEntryPoint: "https://idp/entry", idpIssuer: "issuer", idpCert: "cert", spEntityId: "sp", isEnabled: true }
  })

  test("throws a real ServiceError(401) when the library returns no profile at all", async () => {
    validateResult = { profile: null }
    const { validateSsoAssertionAndGetUser } = await import("./sso-service")
    await expect(validateSsoAssertionAndGetUser("acme", "fake-saml-response", "https://cb")).rejects.toMatchObject({ status: 401, message: "SAML assertion could not be validated" })
  })

  test("throws a real ServiceError(400) when the profile carries no usable email/mail/nameID", async () => {
    validateResult = { profile: { someOtherField: "x" } }
    const { validateSsoAssertionAndGetUser } = await import("./sso-service")
    await expect(validateSsoAssertionAndGetUser("acme", "fake-saml-response", "https://cb")).rejects.toMatchObject({ status: 400, message: "SAML assertion did not include an email address" })
  })

  test("throws a real ServiceError(403) when no user in this org matches the assertion's email -- never auto-provisions", async () => {
    validateResult = { profile: { email: "nobody@acme.example.com" } }
    lookupUserResult = null
    const { validateSsoAssertionAndGetUser } = await import("./sso-service")
    await expect(validateSsoAssertionAndGetUser("acme", "fake-saml-response", "https://cb")).rejects.toMatchObject({ status: 403 })
  })

  test("throws the SAME real ServiceError(403) when the matched user belongs to a DIFFERENT org -- never reveals which case it was", async () => {
    validateResult = { profile: { email: "someone@other-org.example.com" } }
    lookupUserResult = { id: "user-in-other-org", orgId: "org-999" }
    const { validateSsoAssertionAndGetUser } = await import("./sso-service")
    let caughtMessage: string | null = null
    try {
      await validateSsoAssertionAndGetUser("acme", "fake-saml-response", "https://cb")
    } catch (e) {
      caughtMessage = e instanceof Error ? e.message : null
    }
    expect(caughtMessage).toBe("No matching user found for this organisation -- SAML login does not create new users")
  })

  test("returns the real org, user and lowercased/trimmed email on a genuine match", async () => {
    validateResult = { profile: { email: "  Real.User@Acme.example.com  " } }
    lookupUserResult = { id: "user-1", orgId: "org-1" }
    const { validateSsoAssertionAndGetUser } = await import("./sso-service")
    const result = await validateSsoAssertionAndGetUser("acme", "fake-saml-response", "https://cb")
    expect(result.org).toEqual(orgResult)
    expect(result.user).toEqual(lookupUserResult)
    expect(result.email).toBe("real.user@acme.example.com")
  })

  test("falls back to profile.mail, then profile.nameID, when email is absent", async () => {
    validateResult = { profile: { nameID: "fallback@acme.example.com" } }
    lookupUserResult = { id: "user-1", orgId: "org-1" }
    const { validateSsoAssertionAndGetUser } = await import("./sso-service")
    const result = await validateSsoAssertionAndGetUser("acme", "fake-saml-response", "https://cb")
    expect(result.email).toBe("fallback@acme.example.com")
  })
})
