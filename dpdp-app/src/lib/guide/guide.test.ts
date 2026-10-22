import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { API_ONLY, BY_STATUS, CATALOG } from "./catalog"
import { BLAMING_WORDS, TECHNICAL_WORDS, explain, find, isApiOnly, norm, whatFor } from "./guide"

// Guided errors, the lint. This is the test that fails when a message the database, a function or a
// screen can send has no guide (owner, 2026-10-22). Wording is linted too: no technical word, no blame.

const ROOT = resolve(import.meta.dir, "../../../..")
const APP = resolve(import.meta.dir, "../../..")

function walk(dir: string, ext: RegExp, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) { if (n !== "node_modules") walk(p, ext, out) } else if (ext.test(n)) out.push(p)
  }
  return out
}
const read = (p: string) => readFileSync(p, "utf8")

/** Every message the database can raise or return for the DPDP functions. */
function sqlMessages(): Set<string> {
  const out = new Set<string>()
  for (const f of walk(join(ROOT, "drizzle"), /dpdp.*\.sql$/).filter((p) => !p.includes(`${join("drizzle", "down")}`))) {
    const t = read(f)
    for (const m of t.matchAll(/raise\s+exception\s+'((?:[^']|'')*)'/gi)) out.add(m[1].replace(/''/g, "'"))
    for (const m of t.matchAll(/'(?:reason|message)'\s*,\s*'((?:[^']|'')*)'/g)) out.add(m[1].replace(/''/g, "'"))
  }
  return out
}

/** Messages typed into the functions a browser calls (audit log, payment). The machine-only functions (AI link, inbound mail) are covered by API_ONLY. */
function edgeMessages(): Set<string> {
  const out = new Set<string>()
  const dirs = ["dpdp-audit", "dpdp-audit-lifecycle", "dpdp-pay"].map((d) => join(ROOT, "supabase", "functions", d))
  for (const d of dirs) {
    for (const f of walk(d, /\.ts$/).filter((p) => !/\.test\./.test(p))) {
      const t = read(f)
      for (const m of t.matchAll(/(["`])([^"`\\\n]{10,200})\1/g)) {
        const s = m[2]
        if (!/^[A-Z]/.test(s) || !/[ ]/.test(s) || /^[A-Z_]+$/.test(s)) continue
        if (/^(SELECT|INSERT|UPDATE|DELETE|Content-|Authorization|Bearer|Access-|https?:)/.test(s)) continue
        const before = t.slice(Math.max(0, m.index! - 60), m.index!)
        if (/(error|message|json|fail|bad|reply|respond|err)\w*\s*[:(]\s*(\d{3}\s*,\s*)?$/i.test(before)) out.add(s)
      }
    }
  }
  return out
}

/** Messages the screens and helpers write themselves. */
function clientMessages(): Set<string> {
  const out = new Set<string>()
  const files = [
    "src/lib/dpdp-onepage/job-actions.ts", "src/lib/consent-page.ts", "src/lib/client.ts", "src/lib/audit-api.ts", "src/lib/api.ts",
    "src/components/AuditLogPanel.tsx", "src/components/CaClients.tsx", "src/components/AiFirstSteps.tsx", "src/components/AiWorkLink.tsx", "src/components/MyData.tsx",
    "src/components/TokenPages.tsx", "src/components/Screens.tsx", "src/components/OwnerPartnerPayouts.tsx", "src/components/onepage/FirstVisitWizard.tsx", "src/App.tsx",
  ]
  for (const f of files) {
    const t = read(join(APP, f))
    for (const m of t.matchAll(/(?:message|error|setError|setProblem|setCodeError|setSlip|new Error|return)\s*[:(]?\s*(["`])((?:\\.|(?!\1)[^\\\n]){12,220})\1/g)) {
      const s = m[2]
      if (!/^[A-Z]/.test(s) || !/ /.test(s) || /\$\{.*\}.*\$\{/.test(s)) continue
      if (/^(Rs |This link lets|Your file has|Recorded\.|Your answer is recorded|VITE_)/.test(s)) continue
      out.add(s)
    }
  }
  for (const m of read(join(APP, "src/lib/mock-client.ts")).matchAll(/(?:fail\(|reason: )(["`])((?:\\.|(?!\1)[^\\\n]){10,200})\1/g)) out.add(m[2])
  return out
}

const humanise = (s: string) => s.replace(/\$\{[^}]*\}/g, "5")

describe("every message a person can meet has a guide", () => {
  const corpus: [string, string][] = [
    ...[...sqlMessages()].filter((m) => m.trim()).map((m) => ["database", m] as [string, string]),
    ...[...edgeMessages()].map((m) => ["function", m] as [string, string]),
    ...[...clientMessages()].filter((m) => m.trim()).map((m) => ["screen", m] as [string, string]),
  ]

  test("the corpus is real (guards the scanners themselves)", () => {
    expect(corpus.filter(([w]) => w === "database").length).toBeGreaterThan(150)
    expect(corpus.filter(([w]) => w === "function").length).toBeGreaterThan(8)
    expect(corpus.filter(([w]) => w === "screen").length).toBeGreaterThan(15)
  })

  test("each is either guided or listed as never shown to a person", () => {
    const missing = corpus.filter(([, m]) => { const h = humanise(m); return !find(h).matched && !isApiOnly(h) }).map(([w, m]) => `${w}: ${m}`)
    expect(missing).toEqual([])
  })

  test("none is both guided and listed as never shown (the lists would hide each other)", () => {
    const both = corpus.filter(([, m]) => { const h = humanise(m); return find(h).matched && isApiOnly(h) }).map(([w, m]) => `${w}: ${m}`)
    expect(both).toEqual([])
  })
})

describe("the catalog's wording", () => {
  test("no technical word and no blame in any title, explanation or step", () => {
    const bad: string[] = []
    for (const e of [...CATALOG, ...Object.values(BY_STATUS)]) {
      for (const s of [e.t, e.w, ...e.d]) {
        if (TECHNICAL_WORDS.test(s)) bad.push(`technical: ${s}`)
        if (BLAMING_WORDS.test(s)) bad.push(`blaming: ${s}`)
      }
    }
    expect(bad).toEqual([])
  })

  test("every entry has a title, an explanation and at least one step", () => {
    for (const e of [...CATALOG, ...Object.values(BY_STATUS)]) {
      expect(e.t.length).toBeGreaterThan(8)
      expect(e.t.length).toBeLessThan(70)
      expect(e.w.length).toBeGreaterThanOrEqual(30)
      expect(e.d.length).toBeGreaterThan(0)
      for (const s of e.d) expect(/[.!?]$/.test(s)).toBe(true)
    }
  })

  test("fragments are specific (a generic fragment would hijack other messages)", () => {
    const SHORT_OK = new Set(["http", "no rows", "are not set", "is busy right now", "timed out", "otp_expired", "jwt expired", "invalid jwt", "pgrst", "load failed", "owner only", "pick a date", "failed to fetch"])
    const loose = CATALOG.flatMap((e) => e.m).map((m) => norm(m.replace(/^[\^]/, ""))).filter((f) => f.length < 12 && !SHORT_OK.has(f))
    expect(loose).toEqual([])
  })

  test("no earlier entry swallows a later entry's own fragment", () => {
    const shadowed: string[] = []
    for (const e of CATALOG) for (const m of e.m) { const hit = find(m.replace(/^[\^]/, "")).entry; if (hit !== e) shadowed.push(`"${m}" -> "${hit.t}" (wanted "${e.t}")`) }
    expect(shadowed).toEqual([])
  })

  test("a field or section a guide points at is a real label or heading on a screen", () => {
    const sources = walk(join(APP, "src"), /\.tsx$/).filter((p) => !/\.test\./.test(p)).map(read).join("\n").toLowerCase().replace(/[’‘]/g, "'").replace(/&rsquo;/g, "'")
    const unreal: string[] = []
    for (const e of CATALOG) {
      for (const key of ["field", "section"] as const) {
        const spec = e.g[key]
        if (!spec) continue
        if (!spec.split("|").some((p) => sources.includes(p.trim().toLowerCase().replace(/[’‘]/g, "'")))) unreal.push(`${e.t}: ${spec}`)
      }
    }
    expect(unreal).toEqual([])
  })

  test("a field guide always names a place to go (or says nothing needs doing)", () => {
    for (const e of CATALOG) if (e.k === "field") expect(!!(e.g.field || e.g.section || e.g.none || e.g.retry || e.g.mail || e.g.signIn)).toBe(true)
  })
})

describe("explain()", () => {
  test("numbers inside a message do not stop it matching", () => {
    expect(explain("Pick a date from 2026-09-22 to 2027-11-26").matched).toBe(true)
  })
  test("a message nobody has seen still gets a polite, complete guide", () => {
    const g = explain("Something no one has seen before", 0)
    expect(g.matched).toBe(false)
    expect(g.kind).toBe("unexpected")
    expect(g.steps.length).toBeGreaterThan(0)
    expect(g.title.length).toBeGreaterThan(0)
  })
  test("no connection is a wait, not a failure", () => {
    expect(explain("Failed to fetch").kind).toBe("wait")
    expect(explain("", 0).kind).toBe("wait")
  })
  test("a specific server sentence is kept when it says more; a technical one is not", () => {
    const m = "Pick a date from 2026-09-22 to 2027-11-26"
    const g = explain(m)
    expect(whatFor(g, m)).toBe(m)
    const t = "Pick a date from 2026-09-22 to 2027-11-26 (rpc json error 500)"
    expect(whatFor(explain(t), t)).toBe(explain(t).what)
  })
  test("the list of messages never shown to a person is not used to hide guided ones", () => {
    expect(API_ONLY.length).toBeGreaterThan(20)
    expect(isApiOnly("Only the owner can do this")).toBe(false)
  })
})
