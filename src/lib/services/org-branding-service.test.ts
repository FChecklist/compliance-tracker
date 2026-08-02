/// <reference types="bun-types" />
// Wave B (VERIDIAN Review Framework remediation, "BYOB white-label
// branding", 2026-07-17): org-branding-service.ts is the single sanctioned
// read/write path for per-org branding (see its own header). These tests
// mock @/lib/db, matching orchestra-model-resolver.test.ts's established
// pattern for this kind of dependency (never touching a live DB from a
// .test.ts file). Coverage: (1) resolveBranding falls back cleanly to the
// default VERIDIAN AI branding for an org that never configured any of it
// -- the "never a broken/blank UI" requirement -- (2) resolveBranding
// resolves a configured logo path to a real public URL, (3) updateBranding's
// validation (hex colors, domain format, domain-uniqueness-across-orgs) all
// reject bad input with OrgBrandingValidationError rather than writing it,
// and (4) updateBrandingAsset/getBrandingAssetPath's plain read/write.
import { describe, test, expect, mock, afterEach } from "bun:test"

function orgRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "org-1",
    logo: null,
    faviconUrl: null,
    brandPrimaryColor: null,
    brandAccentColor: null,
    customDomain: null,
    emailSenderName: null,
    ...overrides,
  }
}

function mockDbUpdateChain() {
  const chain = {
    set: mock(() => chain),
    where: mock(() => chain),
    then: (resolve: (v: unknown) => void) => resolve(undefined),
  }
  return mock(() => chain)
}

const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const originalSupabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

function setSupabaseEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test-project.supabase.co"
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key"
}

afterEach(() => {
  if (originalSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl
  if (originalSupabaseAnonKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalSupabaseAnonKey
})

describe("resolveBranding (never a broken/blank UI for an unconfigured org)", () => {
  test("an org with every branding column NULL resolves to the default VERIDIAN AI branding, not nulls/errors", async () => {
    mock.module("@/lib/db", () => ({
      db: { query: { organisations: { findFirst: mock(async () => orgRow()) } } },
      organisations: {},
    }))
    const { resolveBranding, DEFAULT_BRAND_PRIMARY_COLOR, DEFAULT_BRAND_ACCENT_COLOR } = await import("./org-branding-service")
    const result = await resolveBranding("org-1")
    expect(result.logoUrl).toBeNull()
    expect(result.faviconUrl).toBeNull()
    expect(result.primaryColor).toBe(DEFAULT_BRAND_PRIMARY_COLOR)
    expect(result.accentColor).toBe(DEFAULT_BRAND_ACCENT_COLOR)
    expect(result.customDomain).toBeNull()
    expect(result.isCustomized).toBe(false)
  })

  test("a configured logo path resolves to a real public URL under the org-branding bucket", async () => {
    setSupabaseEnv()
    mock.module("@/lib/db", () => ({
      db: { query: { organisations: { findFirst: mock(async () => orgRow({ logo: "org-1/logo-abc.png" })) } } },
      organisations: {},
    }))
    const { resolveBranding } = await import("./org-branding-service")
    const result = await resolveBranding("org-1")
    expect(result.logoUrl).toContain("org-branding")
    expect(result.logoUrl).toContain("org-1/logo-abc.png")
    expect(result.isCustomized).toBe(true)
  })

  test("a configured brand color alone (no logo) still marks the org as customized", async () => {
    mock.module("@/lib/db", () => ({
      db: { query: { organisations: { findFirst: mock(async () => orgRow({ brandAccentColor: "#00FF00" })) } } },
      organisations: {},
    }))
    const { resolveBranding } = await import("./org-branding-service")
    const result = await resolveBranding("org-1")
    expect(result.accentColor).toBe("#00FF00")
    expect(result.isCustomized).toBe(true)
  })
})

describe("updateBranding validation", () => {
  test("rejects a non-hex primary color", async () => {
    mock.module("@/lib/db", () => ({
      db: { query: { organisations: { findFirst: mock(async () => orgRow()) } }, update: mockDbUpdateChain() },
      organisations: {},
    }))
    const { updateBranding, OrgBrandingValidationError } = await import("./org-branding-service")
    await expect(updateBranding("org-1", { primaryColor: "not-a-color" })).rejects.toBeInstanceOf(OrgBrandingValidationError)
  })

  test("rejects a 3-digit hex shorthand (only 6-digit hex is accepted)", async () => {
    mock.module("@/lib/db", () => ({
      db: { query: { organisations: { findFirst: mock(async () => orgRow()) } }, update: mockDbUpdateChain() },
      organisations: {},
    }))
    const { updateBranding, OrgBrandingValidationError } = await import("./org-branding-service")
    await expect(updateBranding("org-1", { accentColor: "#FFF" })).rejects.toBeInstanceOf(OrgBrandingValidationError)
  })

  test("rejects a domain with a scheme (e.g. https://) rather than a bare domain", async () => {
    mock.module("@/lib/db", () => ({
      db: { query: { organisations: { findFirst: mock(async () => orgRow()) } }, update: mockDbUpdateChain() },
      organisations: {},
    }))
    const { updateBranding, OrgBrandingValidationError } = await import("./org-branding-service")
    await expect(updateBranding("org-1", { customDomain: "https://reports.acme.com" })).rejects.toBeInstanceOf(OrgBrandingValidationError)
  })

  test("rejects a domain already registered to a DIFFERENT organisation", async () => {
    mock.module("@/lib/db", () => ({
      db: {
        query: {
          organisations: {
            // updateBranding's own duplicate-domain lookup -- simulates a
            // different org already holding this domain.
            findFirst: mock(async () => orgRow({ id: "org-OTHER", customDomain: "reports.acme.com" })),
          },
        },
        update: mockDbUpdateChain(),
      },
      organisations: {},
    }))
    const { updateBranding, OrgBrandingValidationError } = await import("./org-branding-service")
    await expect(updateBranding("org-1", { customDomain: "reports.acme.com" })).rejects.toBeInstanceOf(OrgBrandingValidationError)
  })

  test("accepts valid colors + domain + sender name and persists them", async () => {
    const updateMock = mockDbUpdateChain()
    let callCount = 0
    mock.module("@/lib/db", () => ({
      db: {
        query: {
          organisations: {
            findFirst: mock(async () => {
              callCount += 1
              // First call: the duplicate-domain check (no conflicting org).
              // Second call: resolveBranding()'s own read after the update.
              return callCount === 1 ? undefined : orgRow({ brandPrimaryColor: "#111111", brandAccentColor: "#222222", customDomain: "reports.acme.com", emailSenderName: "Acme Notifications" })
            }),
          },
        },
        update: updateMock,
      },
      organisations: {},
    }))
    const { updateBranding } = await import("./org-branding-service")
    const result = await updateBranding("org-1", {
      primaryColor: "#111111",
      accentColor: "#222222",
      customDomain: "reports.acme.com",
      emailSenderName: "Acme Notifications",
    })
    expect(updateMock).toHaveBeenCalled()
    expect(result.primaryColor).toBe("#111111")
    expect(result.accentColor).toBe("#222222")
    expect(result.customDomain).toBe("reports.acme.com")
    expect(result.emailSenderName).toBe("Acme Notifications")
  })

  test("passing an empty string clears a previously-set color back to the default", async () => {
    const updateMock = mockDbUpdateChain()
    mock.module("@/lib/db", () => ({
      db: {
        query: { organisations: { findFirst: mock(async () => orgRow()) } },
        update: updateMock,
      },
      organisations: {},
    }))
    const { updateBranding, DEFAULT_BRAND_PRIMARY_COLOR } = await import("./org-branding-service")
    const result = await updateBranding("org-1", { primaryColor: "" })
    expect(result.primaryColor).toBe(DEFAULT_BRAND_PRIMARY_COLOR)
  })

  test("rejects an emailSenderName over 100 characters", async () => {
    mock.module("@/lib/db", () => ({
      db: { query: { organisations: { findFirst: mock(async () => orgRow()) } }, update: mockDbUpdateChain() },
      organisations: {},
    }))
    const { updateBranding, OrgBrandingValidationError } = await import("./org-branding-service")
    await expect(updateBranding("org-1", { emailSenderName: "x".repeat(101) })).rejects.toBeInstanceOf(OrgBrandingValidationError)
  })
})

describe("updateBrandingAsset / getBrandingAssetPath", () => {
  test("updateBrandingAsset('logo', path) writes the logo column and returns resolved branding", async () => {
    setSupabaseEnv()
    const updateMock = mockDbUpdateChain()
    mock.module("@/lib/db", () => ({
      db: {
        query: { organisations: { findFirst: mock(async () => orgRow({ logo: "org-1/logo-new.png" })) } },
        update: updateMock,
      },
      organisations: {},
    }))
    const { updateBrandingAsset } = await import("./org-branding-service")
    const result = await updateBrandingAsset("org-1", "logo", "org-1/logo-new.png")
    expect(updateMock).toHaveBeenCalled()
    expect(result.logoUrl).toContain("org-1/logo-new.png")
  })

  test("updateBrandingAsset('favicon', null) resets the favicon (null clears the column)", async () => {
    const updateMock = mockDbUpdateChain()
    mock.module("@/lib/db", () => ({
      db: {
        query: { organisations: { findFirst: mock(async () => orgRow({ faviconUrl: null })) } },
        update: updateMock,
      },
      organisations: {},
    }))
    const { updateBrandingAsset } = await import("./org-branding-service")
    const result = await updateBrandingAsset("org-1", "favicon", null)
    expect(result.faviconUrl).toBeNull()
  })

  test("getBrandingAssetPath returns the raw stored path for cleanup purposes, not a resolved URL", async () => {
    mock.module("@/lib/db", () => ({
      db: { query: { organisations: { findFirst: mock(async () => orgRow({ logo: "org-1/logo-old.png" })) } } },
      organisations: {},
    }))
    const { getBrandingAssetPath } = await import("./org-branding-service")
    const path = await getBrandingAssetPath("org-1", "logo")
    expect(path).toBe("org-1/logo-old.png")
  })
})
