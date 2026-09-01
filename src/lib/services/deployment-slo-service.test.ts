/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  computeSloFromEvents,
  getSentryIssueSummary,
  DEPLOYMENT_SLO_TARGET_SUCCESS_RATE_PCT,
  type DeploymentEventLite,
} from "./deployment-slo-service"

// Same precedent as ci.yml's `unit-tests` job / vercel-deployment/route.test.ts:
// importing this module transitively constructs src/lib/db/index.ts's
// Postgres client at module-load time, which throws without *some*
// connection string present -- placeholder values are enough for that
// construction to succeed even though computeSloFromEvents/
// getSentryIssueSummary below never touch the DB.
process.env.DATABASE_URL ??= "postgresql://postgres:placeholder@localhost:5432/postgres"
process.env.APP_RUNTIME_DATABASE_URL ??= "postgresql://app_runtime:placeholder@localhost:5432/postgres"

const now = new Date("2026-08-07T00:00:00Z")
function daysAgo(n: number): Date {
  return new Date(now.getTime() - n * 24 * 60 * 60 * 1000)
}
function ev(eventType: string, receivedAt: Date, target: string | null = "production"): DeploymentEventLite {
  return { eventType, target, receivedAt }
}

describe("computeSloFromEvents", () => {
  test("returns nulls (not a divide-by-zero crash) when there are no outcome events at all", () => {
    const result = computeSloFromEvents([], now, 30)
    expect(result.totalOutcomes).toBe(0)
    expect(result.successRatePct).toBeNull()
    expect(result.meetsTarget).toBeNull()
    expect(result.lastEvent).toBeNull()
    expect(result.daysSinceLastError).toBeNull()
  })

  test("ignores deployment.created -- it's a lifecycle marker, not an outcome", () => {
    const result = computeSloFromEvents(
      [ev("deployment.created", daysAgo(1)), ev("deployment.succeeded", daysAgo(1))],
      now,
      30
    )
    expect(result.totalOutcomes).toBe(1)
    expect(result.successRatePct).toBe(100)
  })

  test("computes a correct success rate and meetsTarget against the documented target", () => {
    const events = [
      ev("deployment.succeeded", daysAgo(1)),
      ev("deployment.succeeded", daysAgo(2)),
      ev("deployment.succeeded", daysAgo(3)),
      ev("deployment.error", daysAgo(4)),
    ]
    const result = computeSloFromEvents(events, now, 30)
    expect(result.totalOutcomes).toBe(4)
    expect(result.succeeded).toBe(3)
    expect(result.errored).toBe(1)
    expect(result.successRatePct).toBe(75)
    expect(result.meetsTarget).toBe(75 >= DEPLOYMENT_SLO_TARGET_SUCCESS_RATE_PCT)
  })

  test("meetsTarget is true at exactly the documented threshold", () => {
    const events = Array.from({ length: 19 }, (_, i) => ev("deployment.succeeded", daysAgo(i + 1)))
    events.push(ev("deployment.error", daysAgo(20))) // 19/20 = 95%
    const result = computeSloFromEvents(events, now, 30)
    expect(result.successRatePct).toBe(95)
    expect(result.meetsTarget).toBe(true)
  })

  test("lastEvent picks the most recently received event regardless of array order", () => {
    const result = computeSloFromEvents(
      [ev("deployment.succeeded", daysAgo(10)), ev("deployment.error", daysAgo(1)), ev("deployment.succeeded", daysAgo(5))],
      now,
      30
    )
    expect(result.lastEvent?.eventType).toBe("deployment.error")
    expect(result.daysSinceLastError).toBe(1)
  })

  test("daysSinceLastError is null when no error event exists in the window", () => {
    const result = computeSloFromEvents([ev("deployment.succeeded", daysAgo(2))], now, 30)
    expect(result.daysSinceLastError).toBeNull()
  })
})

describe("getSentryIssueSummary", () => {
  test("reports {configured: false} without making any network call when Sentry env vars are absent", async () => {
    const originals = {
      token: process.env.SENTRY_AUTH_TOKEN,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
    }
    delete process.env.SENTRY_AUTH_TOKEN
    delete process.env.SENTRY_ORG
    delete process.env.SENTRY_PROJECT
    try {
      const result = await getSentryIssueSummary(30)
      expect(result.configured).toBe(false)
      if (!result.configured) expect(result.note).toContain("not configured")
    } finally {
      if (originals.token) process.env.SENTRY_AUTH_TOKEN = originals.token
      if (originals.org) process.env.SENTRY_ORG = originals.org
      if (originals.project) process.env.SENTRY_PROJECT = originals.project
    }
  })
})
