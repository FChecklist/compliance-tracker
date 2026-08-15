/// <reference types="bun-types" />
// VERIDIAN_Architecture_v2.0 phase_2: engine-entity + engine-variable pure
// unit tests -- no live DB, matching this repo's established .test.ts
// convention.
import { describe, expect, test } from "bun:test"
import { escapeRegExp, extractEntities, extractVariables, resolveVariableDefaults } from "./entity-variable-extraction"

describe("extractEntities", () => {
  test("extracts a file path", () => {
    const entities = extractEntities("please fix src/lib/db/schema.ts today")
    expect(entities.some((e) => e.type === "FILE_PATH" && e.value === "src/lib/db/schema.ts")).toBe(true)
  })

  test("extracts a URL", () => {
    const entities = extractEntities("see https://example.com/docs for details")
    expect(entities.some((e) => e.type === "URL" && e.value === "https://example.com/docs")).toBe(true)
  })

  test("extracts a measurement", () => {
    const entities = extractEntities("the response took 250ms and used 12MB")
    expect(entities.some((e) => e.type === "MEASUREMENT" && e.value === "250ms")).toBe(true)
    expect(entities.some((e) => e.type === "MEASUREMENT" && e.value === "12MB")).toBe(true)
  })

  test("extracts a version number", () => {
    const entities = extractEntities("upgrade to v2.3.1 before Friday")
    expect(entities.some((e) => e.type === "VERSION" && e.value === "v2.3.1")).toBe(true)
  })

  test("domain-specific: extracts an email", () => {
    const entities = extractEntities("send it to compliance@example.com")
    expect(entities.some((e) => e.type === "EMAIL" && e.value === "compliance@example.com")).toBe(true)
  })

  test("domain-specific: extracts a regulation reference", () => {
    const entities = extractEntities("this must comply with GDPR Article 17")
    expect(entities.some((e) => e.type === "REGULATION_REF")).toBe(true)
  })

  test("domain-specific: extracts a deadline date", () => {
    const entities = extractEntities("the filing is due 2026-08-15")
    expect(entities.some((e) => e.type === "DEADLINE_DATE" && e.value === "2026-08-15")).toBe(true)
  })

  test("de-duplicates repeated entities, preserving first-seen order", () => {
    const entities = extractEntities("check config.py and then check config.py again")
    const filePaths = entities.filter((e) => e.type === "FILE_PATH")
    expect(filePaths.length).toBe(1)
  })
})

describe("extractVariables", () => {
  test("extracts a {{token}} placeholder and infers a string type by default", () => {
    const vars = extractVariables("Hello {{userName}}, welcome.")
    expect(vars).toEqual([{ name: "userName", inferredType: "string", defaultValue: null, boundElsewhere: false }])
  })

  test("infers a date type from a date-hinted name", () => {
    const vars = extractVariables("Due by {{dueDate}}.")
    expect(vars[0].inferredType).toBe("date")
  })

  test("infers a number type from a count-hinted name", () => {
    const vars = extractVariables("There are {{itemCount}} items.")
    expect(vars[0].inferredType).toBe("number")
  })

  test("infers a boolean type from an is/has-prefixed name", () => {
    const vars = extractVariables("{{isActive}} determines visibility.")
    expect(vars[0].inferredType).toBe("boolean")
  })

  test("flags a variable as boundElsewhere when its bare name also appears as plain text", () => {
    const vars = extractVariables("The {{status}} field shows the current status of the item.")
    expect(vars[0].boundElsewhere).toBe(true)
  })

  test("de-duplicates repeated variable tokens", () => {
    const vars = extractVariables("{{name}} and {{name}} again")
    expect(vars.length).toBe(1)
  })
})

describe("escapeRegExp (CodeQL js/regex-injection fix, 2026-07-27)", () => {
  test("escapes every regex-special character so the result matches only the literal input", () => {
    const raw = ".*+?^${}()|[]\\"
    const escaped = escapeRegExp(raw)
    const re = new RegExp(escaped)
    expect(re.test(raw)).toBe(true)
    expect(re.test("x" + raw)).toBe(true)
    // an unescaped version of the same raw string would either throw or
    // match something other than its own literal text -- confirm escaping
    // actually changed the string, not a no-op.
    expect(escaped).not.toBe(raw)
  })

  test("leaves an already-safe alphanumeric/underscore name unchanged", () => {
    expect(escapeRegExp("orgName_2")).toBe("orgName_2")
  })
})

describe("input length cap (CodeQL js/polynomial-redos fix, 2026-07-27)", () => {
  test("extractEntities truncates pathological-length input instead of running unbounded regex work over all of it", () => {
    const huge = "a".repeat(200_000) + " https://example.com/real-url"
    const start = performance.now()
    const entities = extractEntities(huge)
    const elapsedMs = performance.now() - start
    // real, generous bound -- this is a correctness/DoS-mitigation check,
    // not a tight perf benchmark: it must not scale with the full 200k
    // input, so a few seconds of slack is fine, an unbounded blowup is not.
    expect(elapsedMs).toBeLessThan(5000)
    // the real URL sits past the 50_000-char cap, so it is correctly NOT
    // found -- proving the cap is actually applied, not just fast by luck.
    expect(entities.find((e) => e.type === "URL")).toBeUndefined()
  })

  test("extractEntities still finds a real entity that sits within the length cap", () => {
    const entities = extractEntities("see https://example.com/real-url for details")
    expect(entities.find((e) => e.type === "URL")?.value).toBe("https://example.com/real-url")
  })
})

describe("resolveVariableDefaults", () => {
  test("fills in defaultValue only for variables present in the defaults map", () => {
    const vars = extractVariables("{{orgName}} and {{userName}}")
    const resolved = resolveVariableDefaults(vars, { orgName: "Acme Corp" })
    expect(resolved.find((v) => v.name === "orgName")?.defaultValue).toBe("Acme Corp")
    expect(resolved.find((v) => v.name === "userName")?.defaultValue).toBeNull()
  })
})
