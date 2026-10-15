// Test / Live mode, as the browser sees it (drizzle/0735). The mode itself lives in the database; the owner changes it from the owner screen.
// Everything here is pure so a test can pin the wording and the rule "the banner is only ever inside the signed-in app".
import type { MyAccountPayload, PlatformModePayload } from "./rpc-types"

/** Calm, plain, one sentence. No alarm words: a practice workspace is not an emergency. */
export const TEST_BANNER = "Test mode: this is a practice workspace. Nothing here is real, and no real person is e-mailed."
export const TEST_PAYMENT_LABEL = "Record a test payment"
export const TEST_PAYMENT_NOTE = "A practice payment on this test account. No money moves and nothing goes to Razorpay."

export function isTestMode(p: PlatformModePayload | null | undefined): boolean {
  return p?.mode === "TEST"
}

/** The banner shows inside the signed-in app and nowhere else (never a public page, never an e-mail). */
export function showTestBanner(p: PlatformModePayload | null | undefined, surface: "app" | "public" | "email"): boolean {
  return surface === "app" && isTestMode(p)
}

/** The Test payment action: Test mode, and the paying account itself is a test account. The server enforces the same two rules. */
export function testPaymentAvailable(p: PlatformModePayload | null | undefined, account: MyAccountPayload | null | undefined): boolean {
  return isTestMode(p) && !!account && account.hasAccount && account.isTest && !account.coveredByFirm
}

const TTL_MS = 5000
let cached: { at: number; value: PlatformModePayload } | null = null
/** One read per few seconds however many components ask. */
export async function readModeCached(read: () => Promise<PlatformModePayload>, now: number = Date.now()): Promise<PlatformModePayload> {
  if (cached && now - cached.at < TTL_MS) return cached.value
  const value = await read()
  cached = { at: now, value }
  return value
}
export function forgetCachedMode(): void {
  cached = null
}
