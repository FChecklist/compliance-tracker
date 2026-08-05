/// <reference types="bun-types" />
// OCID-020 child UMR-20260805-142629-8087 ("broader pre-auth brand
// mismatch"): terms/page.tsx (via the shared LegalShell) never resolved
// the real pre-auth brand for its nav wordmark. Mirrors src/app/signup/
// page.test.ts's own established convention. Deliberately asserts only on
// the `brand` prop threaded to LegalShell (the nav-wordmark scope of this
// fix) -- NOT on the legal body text, which intentionally stays
// brand-neutral (see LegalShell.tsx's own comment on why).
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

describe("TermsPage (Server Component brand-resolution wiring, nav wordmark only)", () => {
  test("a request to a resolved brand host threads that real brand down to LegalShell", async () => {
    mockHeaders("projexa-ai.com")
    mockDb(mock(async () => productBranchRow()))

    const { default: TermsPage } = await import("./page")
    const element = await TermsPage()

    expect(getBrandProp(element)).toEqual({ productBranchId: "branch-projexa", brandName: "PROJEXA", tagline: null, footer: null })
  })

  test("an unmatched host resolves brand to null -- LegalShell falls back to rendering exactly as before this change", async () => {
    mockHeaders("veridian-ai-os.vercel.app")
    mockDb(mock(async () => undefined))

    const { default: TermsPage } = await import("./page")
    const element = await TermsPage()

    expect(getBrandProp(element)).toBeNull()
  })

  test("generateMetadata resolves the real brand into the page title", async () => {
    mockHeaders("projexa-ai.com")
    mockDb(mock(async () => productBranchRow()))

    const { generateMetadata } = await import("./page")
    const metadata = await generateMetadata()

    expect(metadata.title).toBe("Terms & Conditions — PROJEXA")
  })

  test("an unmatched host keeps the exact original static title", async () => {
    mockHeaders("veridian-ai-os.vercel.app")
    mockDb(mock(async () => undefined))

    const { generateMetadata } = await import("./page")
    const metadata = await generateMetadata()

    expect(metadata.title).toBe("Terms & Conditions — VERIDIAN AI OS")
  })
})
