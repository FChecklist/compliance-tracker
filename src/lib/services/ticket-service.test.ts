// Helpdesk gap-closure (DEEP_ERP_FUNCTIONALITY_COMPLETION_VIA_ODOO_ERPNEXT_REFERENCE
// Phase 0, 2026-07-27): tiered SLA policy resolution + business-hours-aware
// deadline math. Pure-function tests only, same house convention as
// email-intelligence-service.test.ts -- no live Postgres connection.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { computeSlaDeadline, pickBestSlaPolicy, scoreSlaPolicyMatch, type SlaPolicyLike } from "./ticket-service"

describe("scoreSlaPolicyMatch / pickBestSlaPolicy", () => {
  const criteria = { teamId: "team-1", priority: "high", category: "billing" }

  test("an inactive policy never matches", () => {
    const policy: SlaPolicyLike = { id: "p1", teamId: null, priority: null, category: null, isActive: false }
    expect(scoreSlaPolicyMatch(policy, criteria)).toBeNull()
  })

  test("a fully wildcard (org-wide) active policy matches with score 0", () => {
    const policy: SlaPolicyLike = { id: "p1", teamId: null, priority: null, category: null, isActive: true }
    expect(scoreSlaPolicyMatch(policy, criteria)).toBe(0)
  })

  test("a policy scoped to a different team never matches, even if priority/category match", () => {
    const policy: SlaPolicyLike = { id: "p1", teamId: "team-2", priority: "high", category: "billing", isActive: true }
    expect(scoreSlaPolicyMatch(policy, criteria)).toBeNull()
  })

  test("more specific fields score higher", () => {
    const orgWide: SlaPolicyLike = { id: "org-wide", teamId: null, priority: null, category: null, isActive: true }
    const priorityOnly: SlaPolicyLike = { id: "priority-only", teamId: null, priority: "high", category: null, isActive: true }
    const teamAndPriority: SlaPolicyLike = { id: "team-and-priority", teamId: "team-1", priority: "high", category: null, isActive: true }
    const allThree: SlaPolicyLike = { id: "all-three", teamId: "team-1", priority: "high", category: "billing", isActive: true }

    expect(scoreSlaPolicyMatch(orgWide, criteria)).toBe(0)
    expect(scoreSlaPolicyMatch(priorityOnly, criteria)).toBe(1)
    expect(scoreSlaPolicyMatch(teamAndPriority, criteria)).toBe(2)
    expect(scoreSlaPolicyMatch(allThree, criteria)).toBe(3)

    expect(pickBestSlaPolicy([orgWide, priorityOnly, teamAndPriority, allThree], criteria)?.id).toBe("all-three")
    expect(pickBestSlaPolicy([orgWide, priorityOnly], criteria)?.id).toBe("priority-only")
    expect(pickBestSlaPolicy([orgWide], criteria)?.id).toBe("org-wide")
  })

  test("returns null when nothing matches", () => {
    const wrongTeam: SlaPolicyLike = { id: "p1", teamId: "team-99", priority: null, category: null, isActive: true }
    expect(pickBestSlaPolicy([wrongTeam], criteria)).toBeNull()
  })

  test("returns null for an empty policy list", () => {
    expect(pickBestSlaPolicy([], criteria)).toBeNull()
  })
})

describe("computeSlaDeadline", () => {
  test("with no schedule, adds plain calendar hours (preserves the legacy manual-slaHours behavior)", () => {
    const start = new Date("2026-07-27T10:00:00.000Z") // a Monday
    const deadline = computeSlaDeadline(start, 4, null)
    expect(deadline.toISOString()).toBe("2026-07-27T14:00:00.000Z")
  })

  test("business hours 09:00-17:00 UTC Mon-Fri: a request with time left today stays within today's window", () => {
    const weeklyHours = { "1": [[540, 1020]] as [number, number][], "2": [[540, 1020]] as [number, number][], "3": [[540, 1020]] as [number, number][], "4": [[540, 1020]] as [number, number][], "5": [[540, 1020]] as [number, number][] }
    const start = new Date("2026-07-27T10:00:00.000Z") // Monday 10:00 UTC, 7h of window left today
    const deadline = computeSlaDeadline(start, 4, weeklyHours)
    expect(deadline.toISOString()).toBe("2026-07-27T14:00:00.000Z")
  })

  test("business hours: a request near end-of-day rolls over into the next open window (skips the weekend)", () => {
    const weeklyHours = { "1": [[540, 1020]] as [number, number][], "2": [[540, 1020]] as [number, number][], "3": [[540, 1020]] as [number, number][], "4": [[540, 1020]] as [number, number][], "5": [[540, 1020]] as [number, number][] }
    // Friday 16:00 UTC -- 1h left in Friday's window (16:00-17:00), needs 4h total,
    // so 3h more must come from Monday 09:00 onward.
    const start = new Date("2026-07-31T16:00:00.000Z") // a Friday
    const deadline = computeSlaDeadline(start, 4, weeklyHours)
    expect(deadline.toISOString()).toBe("2026-08-03T12:00:00.000Z") // Monday 12:00 UTC
  })

  test("a request outside any open window still only counts minutes inside the next window", () => {
    const weeklyHours = { "1": [[540, 1020]] as [number, number][] } // only Monday 09:00-17:00 UTC is open
    const start = new Date("2026-07-25T03:00:00.000Z") // a Saturday, nothing open until next Monday
    const deadline = computeSlaDeadline(start, 2, weeklyHours)
    expect(deadline.toISOString()).toBe("2026-07-27T11:00:00.000Z") // following Monday 09:00 + 2h
  })
})
