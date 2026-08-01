/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  resolvePricingConfig,
  setOrgPricingConfigOverride,
  clearOrgPricingConfigOverride,
  PLATFORM_DEFAULT_PRICING_CONFIG,
  COMMISSION_RATE,
  MARGIN_MULTIPLIER,
  ESTIMATION_BUFFER,
} from "./pricing-config"

describe("resolvePricingConfig", () => {
  test("falls back to the platform default (placeholder values) when no org override exists", () => {
    const resolved = resolvePricingConfig("org-with-no-override")
    expect(resolved).toEqual(PLATFORM_DEFAULT_PRICING_CONFIG)
  })

  test("null/undefined orgId resolves to the platform default", () => {
    expect(resolvePricingConfig(null)).toEqual(PLATFORM_DEFAULT_PRICING_CONFIG)
    expect(resolvePricingConfig(undefined)).toEqual(PLATFORM_DEFAULT_PRICING_CONFIG)
  })

  test("a registered per-org override replaces only the placeholder fields it sets", () => {
    const orgId = "org-test-override-1"
    setOrgPricingConfigOverride(orgId, { basePrice: 199 })
    const resolved = resolvePricingConfig(orgId)
    expect(resolved.basePrice).toBe(199)
    expect(resolved.includedUsersInBase).toBe(PLATFORM_DEFAULT_PRICING_CONFIG.includedUsersInBase)
    expect(resolved.pricePerExtraUser).toBe(PLATFORM_DEFAULT_PRICING_CONFIG.pricePerExtraUser)
    clearOrgPricingConfigOverride(orgId)
  })

  test("real, confirmed constants are never affected by a per-org override, even if a caller tries", () => {
    const orgId = "org-test-override-2"
    // @ts-expect-error -- deliberately trying to smuggle a real-constant override to prove it's rejected
    setOrgPricingConfigOverride(orgId, { marginMultiplier: 999 })
    const resolved = resolvePricingConfig(orgId)
    expect(resolved.marginMultiplier).toBe(MARGIN_MULTIPLIER)
    expect(resolved.commissionRate).toBe(COMMISSION_RATE)
    expect(resolved.estimationBuffer).toBe(ESTIMATION_BUFFER)
    clearOrgPricingConfigOverride(orgId)
  })

  test("clearOrgPricingConfigOverride reverts an org back to the platform default", () => {
    const orgId = "org-test-override-3"
    setOrgPricingConfigOverride(orgId, { basePrice: 500 })
    expect(resolvePricingConfig(orgId).basePrice).toBe(500)
    clearOrgPricingConfigOverride(orgId)
    expect(resolvePricingConfig(orgId).basePrice).toBe(PLATFORM_DEFAULT_PRICING_CONFIG.basePrice)
  })
})
