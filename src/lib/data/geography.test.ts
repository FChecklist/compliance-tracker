/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  COUNTRIES,
  STATES_BY_COUNTRY,
  getCountries,
  getStatesForCountry,
  findCountryByName,
  findStateByName,
  countryHasStateData,
  resolveCountryChange,
  resolveStateChange,
} from "./geography"

describe("COUNTRIES", () => {
  test("is a real, complete list -- not a 2-country stub", () => {
    // Real ISO-3166-1-scale list, not a placeholder. Loosely bounded (not an
    // exact count) so this doesn't churn every time a country is added.
    expect(COUNTRIES.length).toBeGreaterThan(150)
  })

  test("every entry has a non-empty 2-letter code and a non-empty name", () => {
    for (const c of COUNTRIES) {
      expect(c.code.length).toBe(2)
      expect(c.code).toBe(c.code.toUpperCase())
      expect(c.name.trim().length).toBeGreaterThan(0)
    }
  })

  test("codes are unique", () => {
    const codes = COUNTRIES.map((c) => c.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  test("names are unique", () => {
    const names = COUNTRIES.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
  })

  test("includes real, well-known countries relevant to this codebase's domain", () => {
    const names = COUNTRIES.map((c) => c.name)
    for (const expected of ["India", "United States", "United Kingdom", "Canada", "Australia", "United Arab Emirates", "Singapore", "Germany", "China", "Japan"]) {
      expect(names).toContain(expected)
    }
  })

  test("getCountries() returns the same list", () => {
    expect(getCountries()).toBe(COUNTRIES)
  })
})

describe("STATES_BY_COUNTRY", () => {
  test("covers more than a token handful of countries", () => {
    // Guards against "stub with 2 countries and call it done" -- the task's
    // own explicit bar.
    expect(Object.keys(STATES_BY_COUNTRY).length).toBeGreaterThanOrEqual(15)
  })

  test("every STATES_BY_COUNTRY key is a real country code in COUNTRIES", () => {
    const validCodes = new Set(COUNTRIES.map((c) => c.code))
    for (const code of Object.keys(STATES_BY_COUNTRY)) {
      expect(validCodes.has(code)).toBe(true)
    }
  })

  test("every country's state list has unique, non-empty names and codes", () => {
    for (const [countryCode, states] of Object.entries(STATES_BY_COUNTRY)) {
      expect(states.length).toBeGreaterThan(0)
      const names = states.map((s) => s.name)
      expect(new Set(names).size).toBe(names.length)
      for (const s of states) {
        expect(s.name.trim().length).toBeGreaterThan(0)
        expect(s.code.trim().length).toBeGreaterThan(0)
      }
      // sanity: no country claims an implausibly huge hardcoded subdivision list
      expect(states.length).toBeLessThan(60)
      void countryCode
    }
  })

  test("India has the real current 28 states + 8 union territories (36 total)", () => {
    expect(STATES_BY_COUNTRY.IN.length).toBe(36)
    const names = STATES_BY_COUNTRY.IN.map((s) => s.name)
    for (const expected of ["Maharashtra", "Karnataka", "Tamil Nadu", "Delhi", "Jammu and Kashmir", "Ladakh", "Telangana"]) {
      expect(names).toContain(expected)
    }
  })

  test("United States has 50 states + DC (51 total)", () => {
    expect(STATES_BY_COUNTRY.US.length).toBe(51)
    expect(STATES_BY_COUNTRY.US.map((s) => s.name)).toContain("California")
    expect(STATES_BY_COUNTRY.US.map((s) => s.name)).toContain("District of Columbia")
  })
})

describe("getStatesForCountry", () => {
  test("returns the real state list for a covered country, by name", () => {
    const states = getStatesForCountry("India")
    expect(states.length).toBe(36)
    expect(states.map((s) => s.name)).toContain("Gujarat")
  })

  test("is case-insensitive on the country name", () => {
    expect(getStatesForCountry("india").length).toBe(36)
    expect(getStatesForCountry("INDIA").length).toBe(36)
  })

  test("returns an empty array (not undefined) for an uncovered country", () => {
    // Singapore is a real country in COUNTRIES but deliberately has no
    // STATES_BY_COUNTRY entry (city-state, no subdivisions) -- this is the
    // documented free-text-fallback path.
    expect(getStatesForCountry("Singapore")).toEqual([])
  })

  test("returns an empty array for an unknown/garbage country string", () => {
    expect(getStatesForCountry("Not A Real Country")).toEqual([])
  })

  test("returns an empty array for null/undefined", () => {
    expect(getStatesForCountry(null)).toEqual([])
    expect(getStatesForCountry(undefined)).toEqual([])
  })
})

describe("findCountryByName", () => {
  test("finds an exact match", () => {
    expect(findCountryByName("India")?.code).toBe("IN")
  })

  test("is case-insensitive and trims whitespace", () => {
    expect(findCountryByName("  india  ")?.code).toBe("IN")
    expect(findCountryByName("UNITED STATES")?.code).toBe("US")
  })

  test("returns undefined for legacy/unrecognized free text", () => {
    expect(findCountryByName("USA")).toBeUndefined()
    expect(findCountryByName("Not A Real Country")).toBeUndefined()
  })

  test("returns undefined for null/undefined/empty", () => {
    expect(findCountryByName(null)).toBeUndefined()
    expect(findCountryByName(undefined)).toBeUndefined()
    expect(findCountryByName("")).toBeUndefined()
  })
})

describe("findStateByName", () => {
  test("finds an exact match within the given country, case-insensitively", () => {
    expect(findStateByName("India", "maharashtra")?.name).toBe("Maharashtra")
    expect(findStateByName("United States", "CALIFORNIA")?.name).toBe("California")
  })

  test("does not cross-match a state name from a different country", () => {
    // "Punjab" is a real state in both India and Pakistan -- confirm lookup
    // is genuinely scoped by country, not a flat global search.
    expect(findStateByName("India", "Punjab")?.name).toBe("Punjab")
    expect(findStateByName("United States", "Punjab")).toBeUndefined()
  })

  test("returns undefined when the country has no state data at all", () => {
    expect(findStateByName("Singapore", "Central Region")).toBeUndefined()
  })
})

describe("countryHasStateData", () => {
  test("true for a covered country", () => {
    expect(countryHasStateData("India")).toBe(true)
    expect(countryHasStateData("United States")).toBe(true)
  })

  test("false for a real but uncovered country", () => {
    expect(countryHasStateData("Singapore")).toBe(false)
  })

  test("false for an unrecognized country or empty input", () => {
    expect(countryHasStateData("Not A Real Country")).toBe(false)
    expect(countryHasStateData(null)).toBe(false)
    expect(countryHasStateData(undefined)).toBe(false)
  })
})

// ─── Cascading logic ────────────────────────────────────────────────────────
// This is the actual reducer both PartyAddressesAndContacts.tsx and the CRM
// account billing/shipping blocks call -- not a test-only reimplementation.

describe("resolveCountryChange", () => {
  test("selecting a genuinely different country resets State and City", () => {
    const previous = { country: "India", state: "Maharashtra", city: "Mumbai" }
    const next = resolveCountryChange(previous, "United States")
    expect(next).toEqual({ country: "United States", state: null, city: null })
  })

  test("re-selecting the SAME country is a no-op (returns the same object)", () => {
    const previous = { country: "India", state: "Maharashtra", city: "Mumbai" }
    const next = resolveCountryChange(previous, "India")
    expect(next).toBe(previous)
  })

  test("clearing the country (null) also resets State and City", () => {
    const previous = { country: "India", state: "Maharashtra", city: "Mumbai" }
    const next = resolveCountryChange(previous, null)
    expect(next).toEqual({ country: null, state: null, city: null })
  })

  test("works starting from a fully empty triple", () => {
    const previous = { country: null, state: null, city: null }
    const next = resolveCountryChange(previous, "India")
    expect(next).toEqual({ country: "India", state: null, city: null })
  })
})

describe("resolveStateChange", () => {
  test("selecting a genuinely different state resets City, keeps Country", () => {
    const previous = { country: "India", state: "Maharashtra", city: "Mumbai" }
    const next = resolveStateChange(previous, "Karnataka")
    expect(next).toEqual({ country: "India", state: "Karnataka", city: null })
  })

  test("re-selecting the SAME state is a no-op (returns the same object)", () => {
    const previous = { country: "India", state: "Maharashtra", city: "Mumbai" }
    const next = resolveStateChange(previous, "Maharashtra")
    expect(next).toBe(previous)
  })

  test("clearing the state (null) also resets City", () => {
    const previous = { country: "India", state: "Maharashtra", city: "Mumbai" }
    const next = resolveStateChange(previous, null)
    expect(next).toEqual({ country: "India", state: null, city: null })
  })

  test("never modifies Country", () => {
    const previous = { country: "India", state: "Maharashtra", city: "Mumbai" }
    const next = resolveStateChange(previous, "Kerala")
    expect(next.country).toBe("India")
  })
})
