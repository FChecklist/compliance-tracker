/// <reference types="bun-types" />
// Priority 5: unit tests for the classification decision -- pure, no DB,
// no mocking needed since this file has zero external dependencies.
import { describe, test, expect } from "bun:test"
import {
  classifyExecution,
  classifyExecutionWithReliability,
  isPackageReliable,
  MIN_ACCEPTABLE_SUCCESS_RATE,
  type ClassificationInput,
} from "./software-coverage-service"
import type { InstructionPackage } from "./capability-learning-service"

function makePackage(overrides: Partial<InstructionPackage> = {}): InstructionPackage {
  return {
    id: "pkg-1",
    capabilityId: "cap-1",
    packageType: "task_execution",
    version: 1,
    status: "approved",
    steps: [],
    requiredVariables: null,
    createdByRole: "governance_backend_engineer",
    approvedAt: new Date("2026-01-01T00:00:00Z"),
    successRate: null,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as unknown as InstructionPackage
}

describe("classifyExecution", () => {
  test("FULL_SOFTWARE wins regardless of package presence", () => {
    const input: ClassificationInput = { alreadyFullSoftware: true, approvedPackage: makePackage() }
    expect(classifyExecution(input)).toEqual({ bucket: "FULL_SOFTWARE" })
  })

  test("PACKAGE_AVAILABLE when a package exists and software alone can't do it", () => {
    const pkg = makePackage()
    const input: ClassificationInput = { alreadyFullSoftware: false, approvedPackage: pkg }
    expect(classifyExecution(input)).toEqual({ bucket: "PACKAGE_AVAILABLE", package: pkg })
  })

  test("NOVEL when no package exists and software alone can't do it", () => {
    const input: ClassificationInput = { alreadyFullSoftware: false, approvedPackage: null }
    expect(classifyExecution(input)).toEqual({ bucket: "NOVEL" })
  })
})

describe("isPackageReliable", () => {
  test("a never-used package is trusted once (usageCount=0)", () => {
    expect(isPackageReliable(makePackage({ usageCount: 0, successRate: null }))).toBe(true)
  })

  test("a package at or above the reliability floor is trusted", () => {
    expect(isPackageReliable(makePackage({ usageCount: 10, successRate: MIN_ACCEPTABLE_SUCCESS_RATE }))).toBe(true)
    expect(isPackageReliable(makePackage({ usageCount: 10, successRate: 100 }))).toBe(true)
  })

  test("a package below the reliability floor is NOT trusted", () => {
    expect(isPackageReliable(makePackage({ usageCount: 10, successRate: MIN_ACCEPTABLE_SUCCESS_RATE - 1 }))).toBe(false)
    expect(isPackageReliable(makePackage({ usageCount: 20, successRate: 0 }))).toBe(false)
  })
})

describe("classifyExecutionWithReliability", () => {
  test("a degraded package routes to NOVEL instead of PACKAGE_AVAILABLE", () => {
    const failingPackage = makePackage({ usageCount: 50, successRate: 40 })
    const input: ClassificationInput = { alreadyFullSoftware: false, approvedPackage: failingPackage }
    expect(classifyExecutionWithReliability(input)).toEqual({ bucket: "NOVEL" })
  })

  test("a reliable package still routes to PACKAGE_AVAILABLE", () => {
    const goodPackage = makePackage({ usageCount: 50, successRate: 95 })
    const input: ClassificationInput = { alreadyFullSoftware: false, approvedPackage: goodPackage }
    expect(classifyExecutionWithReliability(input)).toEqual({ bucket: "PACKAGE_AVAILABLE", package: goodPackage })
  })

  test("FULL_SOFTWARE still wins even with a failing package present", () => {
    const failingPackage = makePackage({ usageCount: 50, successRate: 10 })
    const input: ClassificationInput = { alreadyFullSoftware: true, approvedPackage: failingPackage }
    expect(classifyExecutionWithReliability(input)).toEqual({ bucket: "FULL_SOFTWARE" })
  })
})
