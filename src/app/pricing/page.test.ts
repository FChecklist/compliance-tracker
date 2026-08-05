/// <reference types="bun-types" />
// OCID-020 child UMR-20260805-142629-8087 ("broader pre-auth brand
// mismatch"): pricing/page.tsx was never updated to use the Stage 1
// pre-authentication domain-based brand resolution built and shipped for
// src/app/login/page.tsx / login-form.tsx (org-branding-service.ts's
// resolvePreAuthBrandByHost(), PR #886). Mirrors src/app/signup/
// page.test.ts's own established convention exactly, including asserting
// on the plain `brand` prop threaded to PricingContent (the client
// component) rather than rendering it -- calling PricingPage() builds an
// unrendered element tree, so PricingContent's own body never executes
// here; that's fine, this test only needs to prove the wiring, not
// PricingContent's own JSX (that component's brand-name substitutions are
// plain, un-branching string interpolation, not logic worth a render test).
import { describe, test, expect, mock } from "bun:test"

function mockHeaders(host: string | null) {
  mock.module("next/headers", () => ({
    headers: async () => ({
      get: (name: string) => (name === "host" ? host : null),
    }),
    cookies: async () => ({ get: () => undefined, getAll: () => [] }),
  }))
}

function productBranchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "branch-projexa",
    displayName: "PROJEXA",
    hostDomain: "projexa-ai.com",
    tagline: null,
    footer: null,
    ...overrides,
  }
}

function mockDb(findFirst: ReturnType<typeof mock>) {
  mock.module("@/lib/db", () => ({
    db: { query: { productBranches: { findFirst } } },
    organisations: {},
    productBranches: {},
  }))
}

function getBrandProp(element: unknown): unknown {
  return (element as { props: { brand: unknown } }).props.brand
}

describe("PricingPage (Server Component brand-resolution wiring)", () => {
  test("a request to a resolved brand host (e.g. projexa-ai.com) threads that real brand down to PricingContent, not a hardcoded default", async () => {
    mockHeaders("projexa-ai.com")
    mockDb(mock(async () => productBranchRow()))

    const { default: PricingPage } = await import("./page")
    const element = await PricingPage()

    expect(getBrandProp(element)).toEqual({ productBranchId: "branch-projexa", brandName: "PROJEXA", tagline: null, footer: null })
  })

  test("an unmatched host (the common/default case) resolves brand to null -- PricingContent falls back to rendering exactly as before this change", async () => {
    mockHeaders("veridian-ai-os.vercel.app")
    mockDb(mock(async () => undefined))

    const { default: PricingPage } = await import("./page")
    const element = await PricingPage()

    expect(getBrandProp(element)).toBeNull()
  })

  test("a null/missing host resolves brand to null without ever querying the database", async () => {
    mockHeaders(null)
    const findFirst = mock(async () => productBranchRow())
    mockDb(findFirst)

    const { default: PricingPage } = await import("./page")
    const element = await PricingPage()

    expect(getBrandProp(element)).toBeNull()
    expect(findFirst).not.toHaveBeenCalled()
  })

  test("generateMetadata resolves the real brand into the page title", async () => {
    mockHeaders("projexa-ai.com")
    mockDb(mock(async () => productBranchRow()))

    const { generateMetadata } = await import("./page")
    const metadata = await generateMetadata()

    expect(metadata.title).toBe("Pricing — PROJEXA")
  })
})
