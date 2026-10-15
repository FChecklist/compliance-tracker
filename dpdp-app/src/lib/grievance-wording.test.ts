/// <reference types="bun-types" />
// The published grievance time is the owner's own wording (2026-10-05): "we reply within 14 days; we resolve issues through mutual discussion within
// 90 days". It must appear on the Privacy Notice exactly, and the earlier invented 7 / 30 day figures must not.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const privacy = readFileSync(join(import.meta.dir, "..", "..", "public", "privacy", "index.html"), "utf8")

describe("grievance response time", () => {
  test("the Privacy Notice says 14 days to reply and 90 days to resolve through mutual discussion", () => {
    expect(privacy).toContain("We reply within 14 days. We resolve issues through mutual discussion within 90 days.")
  })
  test("no other promised grievance time contradicts it", () => {
    expect(privacy).not.toContain("We reply within 7 days")
    expect(privacy).not.toContain("resolve within 30 days")
    expect(privacy).not.toContain("SPDI Rules' one-month period")
  })
})
