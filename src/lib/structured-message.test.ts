// Wave 151 (Phase4_Implementation_Plan.md, structured-response renderer v1).
// Optional parser tests -- the rendering side is UI and is exercised by
// hand/visual review; these cover parseStructuredMessage's contract:
// valid summary JSON, valid confirmation JSON, and invalid/plain-text
// input returning null (the explicit "fall back to plain text" signal).
import { test, expect } from "bun:test"
import { parseStructuredMessage } from "./structured-message"

test("parses a valid summary message", () => {
  const content = JSON.stringify({
    type: "summary",
    title: "Compliance status",
    items: [
      { label: "Open tasks", value: "3" },
      { label: "Overdue", value: "1" },
    ],
  })
  const parsed = parseStructuredMessage(content)
  expect(parsed).not.toBeNull()
  expect(parsed?.type).toBe("summary")
  if (parsed?.type === "summary") {
    expect(parsed.title).toBe("Compliance status")
    expect(parsed.items).toHaveLength(2)
    expect(parsed.items[0]).toEqual({ label: "Open tasks", value: "3" })
  }
})

test("parses a valid confirmation message", () => {
  const content = JSON.stringify({
    type: "confirmation",
    message: "I'll mark these three tasks complete.",
    actionLabel: "Confirm",
  })
  const parsed = parseStructuredMessage(content)
  expect(parsed).not.toBeNull()
  expect(parsed?.type).toBe("confirmation")
  if (parsed?.type === "confirmation") {
    expect(parsed.message).toBe("I'll mark these three tasks complete.")
    expect(parsed.actionLabel).toBe("Confirm")
  }
})

// Calculation Explainability (VERIDIAN Review Framework gap closure,
// 2026-07-18): the "calculation" type task-execution-engine.ts's
// executeEngineDispatch() emits when a dispatched engine's output carries
// a breakdown (see breakdown.ts).
test("parses a valid calculation message with a breakdown", () => {
  const content = JSON.stringify({
    type: "calculation",
    engineName: "Income Tax Calculator",
    engineVersion: "1.0.0",
    result: [{ label: "Total tax payable", value: "109200" }],
    steps: [
      { label: "Slab 400,000-800,000 @ 5%", formula: "400000 x 5%", value: 20000 },
      { label: "Total tax payable", value: 109200 },
    ],
  })
  const parsed = parseStructuredMessage(content)
  expect(parsed).not.toBeNull()
  expect(parsed?.type).toBe("calculation")
  if (parsed?.type === "calculation") {
    expect(parsed.engineName).toBe("Income Tax Calculator")
    expect(parsed.result).toEqual([{ label: "Total tax payable", value: "109200" }])
    expect(parsed.steps).toHaveLength(2)
  }
})

test("parses a valid calculation message with no steps (breakdown-less engines never emit this, but the schema doesn't require it)", () => {
  const content = JSON.stringify({
    type: "calculation",
    engineName: "GST Split Engine",
    result: [{ label: "Total tax", value: "18000" }],
  })
  const parsed = parseStructuredMessage(content)
  expect(parsed).not.toBeNull()
  expect(parsed?.type).toBe("calculation")
})

test("returns null for plain English text (not valid JSON)", () => {
  expect(parseStructuredMessage("Hi, how can I help?")).toBeNull()
})

test("returns null for valid JSON that doesn't match the schema", () => {
  // Wrong type discriminator.
  expect(parseStructuredMessage(JSON.stringify({ type: "unknown", foo: 1 }))).toBeNull()
  // Missing required field.
  expect(
    parseStructuredMessage(JSON.stringify({ type: "summary", title: "x" })),
  ).toBeNull()
  // Valid JSON but wrong shape entirely.
  expect(parseStructuredMessage(JSON.stringify({ hello: "world" }))).toBeNull()
})

test("returns null for malformed JSON without throwing", () => {
  expect(parseStructuredMessage("{ not json")).toBeNull()
  expect(parseStructuredMessage("")).toBeNull()
})
