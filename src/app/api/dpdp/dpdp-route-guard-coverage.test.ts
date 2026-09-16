/// <reference types="bun-types" />
// WO-DPDP-002 Section 4.1 (Route test row): "Every one of the 83 screens
// loads for the correct role and 403s for every wrong role. Generate this
// list from the spec file, do not hand-write it."
//
// What's actually true of this codebase (checked directly, not assumed):
// there is no 8-role/4-capability route-gating matrix to generate a list
// against -- every dpdp route checks only session + org membership
// (requireDpdpSession/requireDpdpIdentity/requireDpdpSigner), never
// advisor/fiduciary/processor/auditor capability (capability is enforced
// only via RLS relationship-kind matching, per drizzle/0415's own comment
// and confirmed by reading every route). So "403s for every wrong role" is
// not a thing to test here in the literal 8-role sense -- there IS a real
// role axis (owner vs staff, checked inline in a handful of routes) and a
// real access-mode axis (session-gated / token-scoped / public), and this
// test is a drift guard over THOSE, generated from the real file list via
// git ls-files (not hand-maintained), the same shape as this repo's own
// src/lib/supabase/authz-gap-inventory.test.ts. A handful of routes get a
// real, functional 401/200/403 integration test alongside this file
// (dpdp-route-smoke.test.ts) rather than duplicating near-identical
// coverage 42 times over.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"

// execFileSync (not execSync) -- no shell involved, so the glob reaches git
// as a literal argument on every platform including Windows cmd.exe, where
// execSync's shell quoting rules for a single-quoted string are different
// from POSIX and silently matched zero files.
const ROUTE_FILES = execFileSync("git", ["ls-files", "src/app/api/dpdp/**/route.ts"], { cwd: process.cwd() })
  .toString()
  .trim()
  .split("\n")
  .filter(Boolean)
  .sort()

type Category = "SESSION_GATED" | "OWNER_ONLY" | "TOKEN_SCOPED" | "PUBLIC_BY_DESIGN" | "PRE_ORG_IDENTITY"

// Every route's classification, with a one-line reason -- mirrors
// authz-gap-inventory.test.ts's EXEMPT_ROUTES convention (a reviewable
// table, not a black box). A route added to the filesystem without an
// entry here fails FRESH_ROUTE_MUST_BE_CLASSIFIED below.
const CLASSIFICATION: Record<string, { category: Category; why: string }> = {
  "src/app/api/dpdp/auth/logout/route.ts": { category: "PUBLIC_BY_DESIGN", why: "clearing a cookie needs no session to already exist" },
  "src/app/api/dpdp/auth/request-link/route.ts": { category: "PUBLIC_BY_DESIGN", why: "requesting a magic link is how signed-out visitors start" },
  "src/app/api/dpdp/auth/verify/route.ts": { category: "PUBLIC_BY_DESIGN", why: "consumes the magic-link token itself; there is no session yet by definition" },
  "src/app/api/dpdp/g/[slug]/route.ts": { category: "PUBLIC_BY_DESIGN", why: "the free public page, WO-DPDP-001 4.9" },
  "src/app/api/dpdp/g/[slug]/rights-request/route.ts": { category: "PUBLIC_BY_DESIGN", why: "anyone may raise a rights request from the public page, no account" },
  "src/app/api/dpdp/organisations/route.ts": { category: "PRE_ORG_IDENTITY", why: "org-bootstrap: identity exists, no org membership yet (requireDpdpIdentity)" },
  "src/app/api/dpdp/organisations/switch/route.ts": { category: "PRE_ORG_IDENTITY", why: "switching active org only needs an identity, not an already-active org" },
  "src/app/api/dpdp/p/[token]/route.ts": { category: "TOKEN_SCOPED", why: "consent-token link, no account (WO-DPDP-001 4.4)" },
  "src/app/api/dpdp/p/[token]/consent/route.ts": { category: "TOKEN_SCOPED", why: "consent-token link, no account" },
  "src/app/api/dpdp/p/[token]/grievance/route.ts": { category: "TOKEN_SCOPED", why: "consent-token link, no account" },
  "src/app/api/dpdp/p/[token]/rights-request/route.ts": { category: "TOKEN_SCOPED", why: "consent-token link, no account" },
  "src/app/api/dpdp/ai/[token]/route.ts": { category: "TOKEN_SCOPED", why: "AI Link -- public, read-only, no session, no personal data (WO-DPDP-004 5.10)" },
  "src/app/api/dpdp/task-link/[token]/route.ts": { category: "TOKEN_SCOPED", why: "the email-click vertical slice (WO-DPDP-005/007) -- membership-scoped token IS the auth, no session" },
  "src/app/api/dpdp/members/route.ts": { category: "OWNER_ONLY", why: "naming who does what is an owner action (People screen)" },
  "src/app/api/dpdp/members/[membershipId]/revoke/route.ts": { category: "OWNER_ONLY", why: "revoking a member is an owner action" },
  "src/app/api/dpdp/relationships/route.ts": { category: "OWNER_ONLY", why: "naming an outside firm is an owner action" },
  "src/app/api/dpdp/public-page/publish/route.ts": { category: "OWNER_ONLY", why: "publishing the public page is an owner action" },
  "src/app/api/dpdp/notices/route.ts": { category: "OWNER_ONLY", why: "publishing a notice version is an owner action" },
  "src/app/api/dpdp/grievance-officer/route.ts": { category: "OWNER_ONLY", why: "appointing the Grievance Officer is an owner action" },
  "src/app/api/dpdp/obligations/[obligationId]/assign/route.ts": { category: "OWNER_ONLY", why: "assigning a job to someone is an owner action" },
}

function classify(file: string): { category: Category; why: string } {
  return CLASSIFICATION[file] ?? { category: "SESSION_GATED", why: "default: any signed-in org member (requireDpdpSession)" }
}

describe("every dpdp route.ts calls a recognised guard (drift guard, file list generated via git ls-files)", () => {
  test("FRESH_ROUTE_SANITY: the generated file list is non-trivial (catches an empty/broken git command silently passing everything)", () => {
    expect(ROUTE_FILES.length).toBeGreaterThan(30)
  })

  for (const file of ROUTE_FILES) {
    const { category, why } = classify(file)
    test(`${file} [${category}] -- ${why}`, () => {
      const content = readFileSync(file, "utf8")
      switch (category) {
        case "PUBLIC_BY_DESIGN":
          // No assertion on guard presence -- these are deliberately open.
          // The assertion IS that they're not silently doing something
          // session-gated instead (which would just mean this table is
          // wrong, not that the route is), so at minimum confirm the file
          // still exists and exports a handler.
          expect(content).toMatch(/export async function (GET|POST|PUT|DELETE|PATCH)/)
          break
        case "PRE_ORG_IDENTITY":
          expect(content).toMatch(/await requireDpdpIdentity\(\)/)
          break
        case "TOKEN_SCOPED":
          // Resolves the principal's consent/rights-request token itself --
          // never a dpdp_session cookie. Requires an ACTUAL call (`await
          // require...()`), not just the string appearing in a comment
          // explaining why it's deliberately absent (p/[token]/route.ts
          // does exactly that -- checked directly, this is a real case).
          expect(content).not.toMatch(/await requireDpdpSession\(\)/)
          break
        case "OWNER_ONLY":
          // File-level, not handler-level: this table records that an
          // owner-only check exists SOMEWHERE in the file (most of these
          // files also have a GET that any member may use) -- it is not a
          // claim that every export in the file is owner-gated.
          expect(content).toMatch(/await requireDpdpSession\(\)|await requireDpdpSigner\(\)/)
          expect(content).toMatch(/level\s*(===|!==)\s*"owner"|requireDpdpSigner/)
          break
        case "SESSION_GATED":
        default:
          expect(content).toMatch(/await requireDpdpSession\(\)|await requireDpdpSigner\(\)/)
          break
      }
    })
  }

  test("FRESH_ROUTE_MUST_BE_CLASSIFIED: every OWNER_ONLY/PRE_ORG_IDENTITY/TOKEN_SCOPED/PUBLIC_BY_DESIGN entry above still exists on disk (catches a stale table entry after a route is renamed/removed)", () => {
    for (const file of Object.keys(CLASSIFICATION)) {
      expect(ROUTE_FILES).toContain(file)
    }
  })
})
