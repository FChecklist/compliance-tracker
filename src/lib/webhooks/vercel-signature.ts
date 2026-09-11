import { createHmac, timingSafeEqual } from "node:crypto"

// GAP-D15-REMAINING-TRIGGERS (Priority 11). Verifies Vercel's
// `x-vercel-signature` webhook header exactly per Vercel's own documented
// algorithm (https://vercel.com/docs/headers/request-headers#x-vercel-signature):
// an HMAC-SHA1 hex digest of the RAW request body, keyed with the webhook's
// secret (shown once at webhook-creation time in the Vercel dashboard/API).
// Kept in its own module (not inlined in the route handler) so it's a plain
// importable/testable function -- Next.js route.ts files only recognize a
// fixed set of exports (GET/POST/etc. + segment config), so a reusable
// helper like this can't safely live as an extra named export there.
export function verifyVercelSignature(rawBody: string, headerSignature: string | null | undefined, secret: string): boolean {
  if (!headerSignature) return false
  const expected = createHmac("sha1", secret).update(rawBody).digest("hex")
  if (headerSignature.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(headerSignature), Buffer.from(expected))
  } catch (err) {
    // Still fail closed -- that part was always right. What was missing is the
    // distinction between "an attacker sent a bad signature", which is ordinary
    // traffic, and "our own verifier threw", which means a wrong secret
    // encoding or a length skew and would otherwise look identical forever.
    console.warn(
      JSON.stringify({
        event: 'vercel_signature_verify_threw',
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    return false
  }
}
