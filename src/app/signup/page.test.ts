/// <reference types="bun-types" />
// GAP-OCID038-PROJEXA-DOMAIN-BRAND-MISMATCH addendum: signup/page.tsx was
// the one pre-auth entry point never updated to use the Stage 1
// pre-authentication domain-based brand resolution built and shipped for
// src/app/login/page.tsx / login-form.tsx (org-branding-service.ts's
// resolvePreAuthBrandByHost(), PR #886). This test deliberately does NOT
// mock org-branding-service.ts itself -- doing so would replace the module
// in bun's shared test-process module cache and silently break
// org-branding-service.test.ts's own real-implementation tests when both
// files run in the same `bun test` invocation (confirmed by hitting this
// exact collision while writing this file: mocking
// "@/lib/services/org-branding-service" here made org-branding-service
// .test.ts's own 17 real-implementation tests fail when both files ran
// together, even though each passed alone). Instead this mocks "@/lib/db",
// the same shared dependency org-branding-service.test.ts itself already
// mocks per-test -- matching this repo's own established convention (see
// that file's own header) -- so the REAL resolvePreAuthBrandByHost() runs
// its real logic here, with only the DB layer faked. What this test proves,
// and what was NOT covered anywhere before this fix: does signup/page.tsx
// actually read the real Host header and thread the resolved brand down to
// SignupForm as a prop, the same way login/page.tsx does for LoginForm?
// Matches this repo's own established "test the pure function, not the
// component" convention (see settings/page.test.ts, HomeThreadSlot.test.ts)
// -- SignupPage is just an async function that returns a React element
// tree; calling it directly and inspecting that tree needs no real
// rendering, browser, or live DB.
import { describe, test, expect, mock } from "bun:test"

function mockHeaders(host: string | null) {
  mock.module("next/headers", () => ({
    headers: async () => ({
      get: (name: string) => (name === "host" ? host : null),
    }),
    // Stubbed alongside headers() -- mock.module() replaces the whole
    // "next/headers" module for this test file, and something else in this
    // page's import graph destructures `cookies` from it too; a bare
    // pass-through stub is enough since no test here exercises cookie reads.
    cookies: async () => ({ get: () => undefined, getAll: () => [] }),
  }))
}

function productBranchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "branch-projexa",
    displayName: "PROJEXA",
    hostDomain: "projexa-ai.com",
    ...overrides,
  }
}

function mockDb(findFirst: ReturnType<typeof mock>) {
  // Exports all three names org-branding-service.ts itself imports from
  // "@/lib/db" (`db`, `organisations`, `productBranches`) -- matching
  // org-branding-service.test.ts's own mock shape exactly, since this
  // module is shared/cached across test files in the same `bun test` run
  // and a mock missing an export it needs breaks that OTHER file's own
  // (unrelated) tests, not just this one.
  mock.module("@/lib/db", () => ({
    db: { query: { productBranches: { findFirst } } },
    organisations: {},
    productBranches: {},
  }))
}

function getBrandFromElement(element: unknown): unknown {
  // element === <Suspense fallback={null}><SignupForm brand={...} /></Suspense>
  return (element as { props: { children: { props: { brand: unknown } } } }).props.children.props.brand
}

describe("SignupPage (Server Component brand-resolution wiring)", () => {
  test("a request to a resolved brand host (e.g. projexa-ai.com) threads that real brand down to SignupForm, not a hardcoded default", async () => {
    mockHeaders("projexa-ai.com")
    mockDb(mock(async () => productBranchRow()))

    const { default: SignupPage } = await import("./page")
    const element = await SignupPage()

    expect(getBrandFromElement(element)).toEqual({ productBranchId: "branch-projexa", brandName: "PROJEXA" })
  })

  test("an unmatched host (the common/default case) resolves brand to null -- SignupForm falls back to rendering exactly as before this change", async () => {
    mockHeaders("veridian-ai-os.vercel.app")
    mockDb(mock(async () => undefined))

    const { default: SignupPage } = await import("./page")
    const element = await SignupPage()

    expect(getBrandFromElement(element)).toBeNull()
  })

  test("a null/missing host resolves brand to null without ever querying the database", async () => {
    mockHeaders(null)
    const findFirst = mock(async () => productBranchRow())
    mockDb(findFirst)

    const { default: SignupPage } = await import("./page")
    const element = await SignupPage()

    expect(getBrandFromElement(element)).toBeNull()
    expect(findFirst).not.toHaveBeenCalled()
  })
})
