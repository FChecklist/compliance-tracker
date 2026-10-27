import { afterAll, describe, expect, test } from "bun:test"

// The school / institution choice is hidden (owner, 2026-10-27). The database and every account already saved as "institution" are
// untouched, but nothing a visitor arrives with may open one: an old landing link (?edition=institution) and a value an earlier visit
// left on this device both read as "firm". This is the safe default the sign-up screen relies on.

const store = new Map<string, string>()
const g = globalThis as Record<string, unknown>
const saved = { localStorage: g.localStorage, window: g.window }
g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
const replaced: string[] = []
g.window = { location: { href: "https://veridian-aios.com/app/?edition=institution&email=A@B.TEST" }, history: { state: null, replaceState: (_s: unknown, _t: string, url: string) => void replaced.push(url) } }
afterAll(() => { g.localStorage = saved.localStorage; g.window = saved.window })

const { readLanding, recallEdition, rememberEdition } = await import("./landing")

describe("the institution edition is not a way in any more", () => {
  test("?edition=institution on the address is read as firm, and the hint is stripped from the address bar", () => {
    const landing = readLanding()
    expect(landing.edition).toBe("firm")
    expect(landing.emailHint).toBe("a@b.test")
    expect(replaced[0]).toBe("/app/")
    expect(recallEdition()).toBe("firm") // remembered on this device as firm too
  })

  test("a value an earlier visit saved on this device as institution comes back as firm", () => {
    store.set("dpdp-edition", "institution")
    expect(recallEdition()).toBe("firm")
  })

  test("firm stays firm; anything else is nothing", () => {
    rememberEdition("firm")
    expect(recallEdition()).toBe("firm")
    store.set("dpdp-edition", "school")
    expect(recallEdition()).toBeNull()
    store.delete("dpdp-edition")
    expect(recallEdition()).toBeNull()
  })
})
