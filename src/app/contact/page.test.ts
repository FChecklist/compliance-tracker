/// <reference types="bun-types" />
// OCID-020 child UMR-20260805-142629-8087 ("broader pre-auth brand
// mismatch"): contact/page.tsx was never updated to use the Stage 1
// pre-authentication domain-based brand resolution built and shipped for
// src/app/login/page.tsx / login-form.tsx (org-branding-service.ts's
// resolvePreAuthBrandByHost(), PR #886). Mirrors src/app/signup/
// page.test.ts's own established convention exactly (see that file's own
// header for why this mocks "@/lib/db" rather than "@/lib/services/org-
// branding-service" -- mocking the service module wholesale was found to
// silently break org-branding-service.test.ts's own real-implementation
// tests when both run in the same `bun test` process/shared module cache).
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

// Walks a React-element tree (built via React.createElement, never
// rendered) collecting every string/number leaf -- used below to prove the
// real resolved brand name reaches the actual rendered text, not just an
// intermediate prop, without depending on this page's exact DOM shape.
function collectText(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined) return out
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out)
    return out
  }
  if (typeof node === "object" && "props" in (node as Record<string, unknown>)) {
    collectText((node as { props: { children?: unknown } }).props?.children, out)
  }
  return out
}

describe("ContactPage (Server Component brand-resolution wiring)", () => {
  test("a request to a resolved brand host (e.g. projexa-ai.com) resolves that real brand into the page title", async () => {
    mockHeaders("projexa-ai.com")
    mockDb(mock(async () => productBranchRow()))

    const { generateMetadata } = await import("./page")
    const metadata = await generateMetadata()

    expect(metadata.title).toBe("Contact Us — PROJEXA")
  })

  test("an unmatched host (the common/default case) keeps the exact original static title, unchanged", async () => {
    mockHeaders("veridian-ai-os.vercel.app")
    mockDb(mock(async () => undefined))

    const { generateMetadata } = await import("./page")
    const metadata = await generateMetadata()

    expect(metadata.title).toBe("Contact Us — VERIDIAN AI")
  })

  test("a null/missing host keeps the original static title without ever querying the database", async () => {
    mockHeaders(null)
    const findFirst = mock(async () => productBranchRow())
    mockDb(findFirst)

    const { generateMetadata } = await import("./page")
    const metadata = await generateMetadata()

    expect(metadata.title).toBe("Contact Us — VERIDIAN AI")
    expect(findFirst).not.toHaveBeenCalled()
  })

  test("ContactPage itself renders the real resolved brand name in its wordmark text, not the hardcoded VERIDIAN COGNITIVE AI OS default", async () => {
    mockHeaders("projexa-ai.com")
    mockDb(mock(async () => productBranchRow()))

    const { default: ContactPage } = await import("./page")
    const element = await ContactPage({ searchParams: Promise.resolve({}) })
    const text = collectText(element).join(" ")

    expect(text).toContain("PROJEXA")
    expect(text).not.toContain("COGNITIVE AI OS")
  })

  test("ContactPage with an unmatched host renders exactly the original hardcoded wordmark, unchanged", async () => {
    mockHeaders("veridian-ai-os.vercel.app")
    mockDb(mock(async () => undefined))

    const { default: ContactPage } = await import("./page")
    const element = await ContactPage({ searchParams: Promise.resolve({}) })
    const text = collectText(element).join(" ")

    expect(text).toContain("COGNITIVE AI OS")
  })
})
