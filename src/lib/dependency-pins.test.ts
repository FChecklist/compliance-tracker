/// <reference types="bun-types" />
// R-A6 (batch r75p2-w103-security): does this repo's dependency pin actually
// carry the nanoid fix for CVE-2026-67213?
//
// THE CVE (fetched live while writing this test, 2026-09-05 -- sources
// below). "nanoid: custom generators can loop indefinitely when size is
// zero" -- customAlphabet()/customRandom() contain a `while (true)` loop
// whose exit condition is never satisfied when a caller passes size = 0,
// hanging the calling thread/event loop (CVSS 5.9, DoS). Two maintained
// nanoid lines are affected, with two different fixed floors:
//   - the 3.x branch: vulnerable  < 3.3.18,        fixed AT   3.3.18
//   - the 4.x/5.x line: vulnerable >= 4.0.0 < 5.1.6, fixed AT 5.1.6
// Sources (both agree on the above ranges):
//   https://advisories.gitlab.com/npm/nanoid/CVE-2026-67213/
//   https://www.miggo.io/vulnerability-database/cve/CVE-2026-67213
//
// THE HONEST CAVEAT THE ACCEPTANCE CONDITION GLOSSES OVER. The condition as
// given ("the veridian-ui-kit dependency pin ... includes the nanoid fix")
// presumes @fchecklist/veridian-ui-kit itself pulls in nanoid. It does not:
// its own bun.lock entry declares no "dependencies" field at all, only
// peerDependencies (lucide-react, next, react, react-dom,
// react-resizable-panels, sonner, tailwindcss) -- verified by the first test
// below. nanoid is not even a plain top-level "dependencies" entry of this
// app's own package.json; grepping the whole file finds exactly one
// occurrence, and it is under "overrides": `"overrides": { "nanoid":
// "^3.3.18", ... }` alongside js-yaml/postcss/prismjs/esbuild/opentelemetry
// -- i.e. a deliberate, package-manager-enforced version FLOOR applied to
// the entire dependency graph regardless of what any package (veridian-ui-kit
// included, direct or transitive) itself requests. THAT override is the real
// mechanism that would protect veridian-ui-kit if it ever imported "nanoid"
// -- so this file tests the three things that together make the acceptance
// condition true in practice: (1) veridian-ui-kit itself carries no
// conflicting nanoid dependency of its own, (2) the override's floor is
// past the fix, and (3) what bun.lock ACTUALLY resolved (the real,
// already-applied outcome of that override, not just its stated intent)
// is also past the fix.
import { describe, test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..", "..")
const bunLock = readFileSync(join(ROOT, "bun.lock"), "utf8")
const packageJson = readFileSync(join(ROOT, "package.json"), "utf8")

/** [major, minor, patch] numeric compare. nanoid has never published a
 * prerelease/build-metadata tag on a real release, so a plain X.Y.Z split
 * is sufficient -- this is deliberately not a general-purpose semver parser. */
function parseVersion(v: string): [number, number, number] {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v)
  if (!m) throw new Error(`not a plain X.Y.Z version: "${v}"`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}
function gte(v: string, floor: string): boolean {
  const a = parseVersion(v)
  const b = parseVersion(floor)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return true
}

/**
 * CVE-2026-67213's documented fix boundary (see header comment for sources):
 * a nanoid version is SAFE only if it is on the 3.x branch at or past
 * 3.3.18, or on the 4.x/5.x branch at or past 5.1.6. Anything else
 * (< 3.3.18 on the 3.x branch, or in [4.0.0, 5.1.6) on the newer branch) is
 * the vulnerable range.
 */
export function isPatchedForCVE_2026_67213(version: string): boolean {
  const [major] = parseVersion(version)
  if (major < 4) return gte(version, "3.3.18")
  return gte(version, "5.1.6")
}

describe("CVE-2026-67213 (nanoid infinite-loop DoS)", () => {
  test("sanity check on isPatchedForCVE_2026_67213 itself, against the documented boundary versions", () => {
    // 3.x branch.
    expect(isPatchedForCVE_2026_67213("3.3.17")).toBe(false) // last vulnerable 3.x
    expect(isPatchedForCVE_2026_67213("3.3.18")).toBe(true) // first patched 3.x
    expect(isPatchedForCVE_2026_67213("3.3.19")).toBe(true)
    // 4.x/5.x branch.
    expect(isPatchedForCVE_2026_67213("4.0.0")).toBe(false) // start of vulnerable range
    expect(isPatchedForCVE_2026_67213("5.1.5")).toBe(false) // last vulnerable
    expect(isPatchedForCVE_2026_67213("5.1.6")).toBe(true) // first patched 5.x
    expect(isPatchedForCVE_2026_67213("5.2.0")).toBe(true)
  })

  test("veridian-ui-kit's own bun.lock entry declares no direct nanoid dependency of its own (documented context, not the vulnerability under test)", () => {
    const entryMatch = /"@fchecklist\/veridian-ui-kit":\s*\[[^\]]*\]/.exec(bunLock)
    expect(entryMatch).not.toBeNull()
    const entry = entryMatch![0]
    // Only peerDependencies -- no "dependencies" field, and specifically no
    // nanoid dependency edge of veridian-ui-kit's own.
    expect(entry).not.toMatch(/"dependencies"/)
    expect(entry).not.toMatch(/nanoid/)
    expect(entry).toMatch(/"peerDependencies"/)
  })

  test("package.json pins nanoid via \"overrides\" to a floor that is past the CVE-2026-67213 fix -- the mechanism that protects veridian-ui-kit even without a dependency edge of its own", () => {
    const overridesMatch = /"overrides":\s*\{[^}]*\}/.exec(packageJson)
    expect(overridesMatch).not.toBeNull()
    const overridesBlock = overridesMatch![0]

    const nanoidSpec = /"nanoid":\s*"(\^?~?[0-9][^"]*)"/.exec(overridesBlock)
    expect(nanoidSpec).not.toBeNull()

    const floor = nanoidSpec![1].replace(/^[\^~]/, "")
    expect(isPatchedForCVE_2026_67213(floor)).toBe(true)
  })

  test("R-A6: the nanoid version bun.lock actually resolved app-wide (what veridian-ui-kit would receive via Node's module resolution if it ever imports \"nanoid\") is past the CVE-2026-67213 fix, not a vulnerable pre-fix version", () => {
    const resolved = [...bunLock.matchAll(/"nanoid":\s*\["nanoid@([0-9][^",]*)"/g)].map((m) => m[1])

    // There must be at least one resolved nanoid in the graph (postcss alone
    // depends on it) -- an empty result here would mean this test's own
    // extraction regex is broken, not that nanoid vanished from the tree.
    expect(resolved.length).toBeGreaterThan(0)

    for (const version of resolved) {
      expect(isPatchedForCVE_2026_67213(version)).toBe(true)
    }
  })

  // Falsifiability, WITHOUT touching the real package.json/bun.lock (this
  // task's rules forbid editing either file, even temporarily -- unlike
  // every other source file the falsifiability check may touch-and-revert).
  // This runs the exact same extraction regex + isPatchedForCVE_2026_67213
  // used by the test above against a SYNTHETIC bun.lock fragment holding a
  // known-vulnerable resolved version, proving the pipeline actually
  // discriminates rather than vacuously reporting "patched" for anything --
  // i.e. if the real bun.lock ever regressed to a vulnerable nanoid, the
  // test above would genuinely fail, not silently keep passing.
  test("falsifiability proof: the same extraction+comparison pipeline correctly flags a synthetic vulnerable resolved version as NOT patched", () => {
    const fakeVulnerableBunLockFragment = '"nanoid": ["nanoid@3.3.10", "", { "bin": { "nanoid": "bin/nanoid.cjs" } }, "sha512-fake=="],'
    const resolved = [...fakeVulnerableBunLockFragment.matchAll(/"nanoid":\s*\["nanoid@([0-9][^",]*)"/g)].map((m) => m[1])

    expect(resolved).toEqual(["3.3.10"])
    expect(resolved.every((v) => isPatchedForCVE_2026_67213(v))).toBe(false)

    // And the 4.x/5.x-line vulnerable range, e.g. a downgrade/regression to
    // 4.5.0 (inside [4.0.0, 5.1.6)) would be caught the same way.
    const fakeVulnerable5xFragment = '"nanoid": ["nanoid@4.5.0", "", {}, "sha512-fake=="],'
    const resolved5x = [...fakeVulnerable5xFragment.matchAll(/"nanoid":\s*\["nanoid@([0-9][^",]*)"/g)].map((m) => m[1])
    expect(resolved5x.every((v) => isPatchedForCVE_2026_67213(v))).toBe(false)
  })
})
